#!/usr/bin/env python3
"""
Naver blog post crawler for NotebookLM ingestion.

Crawls every post of a Naver blog, and for every iHerb product link found
inside a post, fetches the product's name/description and appends it to
that post's markdown file. Output: one .md file per post under --out.

Usage:
    pip install -r requirements.txt
    python crawler.py --blog-id skckckskckck --out posts

Notes:
    - Naver and iHerb are not reachable from network-restricted sandboxes
      (e.g. some CI/cloud dev environments). Run this on a machine with
      normal internet access.
    - Re-running is safe/idempotent: existing output files are skipped
      unless --overwrite is passed.
"""
import argparse
import json
import re
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}

IHERB_LINK_RE = re.compile(r"https?://(?:www\.)?iherb\.com/[^\s\"'<>)\]]+", re.IGNORECASE)


def slugify(text: str, max_len: int = 60) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"[^\w\-가-힣]+", "-", text).strip("-")
    return text[:max_len] or "untitled"


def fetch(session: requests.Session, url: str, **kwargs) -> requests.Response:
    resp = session.get(url, headers=HEADERS, timeout=20, **kwargs)
    resp.raise_for_status()
    return resp


def list_post_log_nos(session: requests.Session, blog_id: str, delay: float, max_pages: int):
    """Yield (logNo, title) for every post on the blog, oldest paging API first."""
    page = 1
    seen = set()
    while page <= max_pages:
        api_url = (
            "https://blog.naver.com/PostTitleListAsync.naver"
            f"?blogId={blog_id}&viewdate=&currentPage={page}"
            "&categoryNo=0&parentCategoryNo=&countPerPage=30&isSympathyBtn=false"
        )
        resp = fetch(session, api_url)
        raw = resp.text.strip()
        posts = []
        try:
            data = json.loads(raw)
            posts = data.get("postList") or data.get("PostList") or []
        except json.JSONDecodeError:
            # Fall back to a defensive regex scrape if the API's JSON shape
            # changes underneath us.
            for m in re.finditer(
                r'"logNo"\s*:\s*"?(\d+)"?.*?"title"\s*:\s*"((?:[^"\\]|\\.)*)"',
                raw,
                re.DOTALL,
            ):
                posts.append({"logNo": m.group(1), "title": m.group(2)})

        if not posts:
            break

        new_count = 0
        for p in posts:
            log_no = str(p.get("logNo") or p.get("logno") or "").strip()
            title = (p.get("title") or "").strip()
            if not log_no or log_no in seen:
                continue
            seen.add(log_no)
            new_count += 1
            yield log_no, title

        if new_count == 0:
            break
        page += 1
        time.sleep(delay)


def extract_post_content(session: requests.Session, blog_id: str, log_no: str):
    url = f"https://m.blog.naver.com/PostView.naver?blogId={blog_id}&logNo={log_no}"
    resp = fetch(session, url)
    soup = BeautifulSoup(resp.text, "lxml")

    title = None
    if soup.select_one(".se-title-text"):
        title = soup.select_one(".se-title-text").get_text(strip=True)
    elif soup.select_one("meta[property='og:title']"):
        title = soup.select_one("meta[property='og:title']")["content"].strip()
    if not title:
        title = f"post-{log_no}"

    date = None
    date_el = soup.select_one(".se_publishDate, .blog_date, .date")
    if date_el:
        date = date_el.get_text(strip=True)

    content_el = (
        soup.select_one(".se-main-container")
        or soup.select_one("#postViewArea")
        or soup.select_one("#viewTypeSelector")
    )
    body_text = content_el.get_text("\n", strip=True) if content_el else ""

    # iHerb links can appear as real <a href> targets or as plain visible text.
    html_str = str(content_el) if content_el else resp.text
    links = set(IHERB_LINK_RE.findall(html_str))
    if content_el:
        for a in content_el.select("a[href]"):
            href = a["href"]
            if "iherb.com" in href:
                links.add(urljoin(url, href))

    return {
        "log_no": log_no,
        "title": title,
        "date": date,
        "source_url": url,
        "body": body_text,
        "iherb_links": sorted(links),
    }


def fetch_iherb_product(session: requests.Session, url: str):
    try:
        resp = fetch(session, url, allow_redirects=True)
    except requests.RequestException as exc:
        return {"url": url, "final_url": url, "name": None, "description": None, "error": str(exc)}

    soup = BeautifulSoup(resp.text, "lxml")

    name = None
    og_title = soup.select_one("meta[property='og:title']")
    if og_title and og_title.get("content"):
        name = og_title["content"].strip()
    elif soup.title:
        name = re.sub(r"\s*[:|-]\s*iHerb.*$", "", soup.title.get_text(strip=True)).strip()

    description = None
    og_desc = soup.select_one("meta[property='og:description']")
    meta_desc = soup.select_one("meta[name='description']")
    if og_desc and og_desc.get("content"):
        description = og_desc["content"].strip()
    elif meta_desc and meta_desc.get("content"):
        description = meta_desc["content"].strip()

    return {
        "url": url,
        "final_url": resp.url,
        "name": name,
        "description": description,
        "error": None,
    }


def render_markdown(post: dict, products: list) -> str:
    lines = ["---"]
    lines.append(f"title: {post['title']}")
    if post.get("date"):
        lines.append(f"date: {post['date']}")
    lines.append(f"log_no: {post['log_no']}")
    lines.append(f"source_url: {post['source_url']}")
    lines.append("---")
    lines.append("")
    lines.append(f"# {post['title']}")
    lines.append("")
    lines.append(post["body"])

    if products:
        lines.append("")
        lines.append("## 참고 - 언급된 iHerb 제품")
        for p in products:
            lines.append("")
            lines.append(f"### {p['name'] or '(제품명 확인 불가)'}")
            lines.append(f"- 링크: {p['final_url']}")
            if p.get("description"):
                lines.append(f"- 설명: {p['description']}")
            if p.get("error"):
                lines.append(f"- (조회 실패: {p['error']})")

    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blog-id", default="skckckskckck")
    parser.add_argument("--out", default="posts")
    parser.add_argument("--delay", type=float, default=1.5, help="seconds between requests")
    parser.add_argument("--max-pages", type=int, default=1000)
    parser.add_argument("--limit", type=int, default=0, help="max number of posts to crawl (0 = all)")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    count = 0

    for log_no, listed_title in list_post_log_nos(session, args.blog_id, args.delay, args.max_pages):
        if args.limit and count >= args.limit:
            break

        existing = list(out_dir.glob(f"{log_no}-*.md"))
        if existing and not args.overwrite:
            print(f"[skip] {log_no} already crawled -> {existing[0].name}")
            count += 1
            continue

        try:
            post = extract_post_content(session, args.blog_id, log_no)
        except requests.RequestException as exc:
            print(f"[error] failed to fetch post {log_no}: {exc}", file=sys.stderr)
            continue

        products = []
        for link in post["iherb_links"]:
            time.sleep(args.delay)
            products.append(fetch_iherb_product(session, link))

        md = render_markdown(post, products)
        filename = f"{log_no}-{slugify(post['title'])}.md"
        (out_dir / filename).write_text(md, encoding="utf-8")
        print(f"[saved] {filename} ({len(products)} iHerb product(s))")

        count += 1
        time.sleep(args.delay)

    print(f"Done. {count} post(s) processed into {out_dir}/")


if __name__ == "__main__":
    main()
