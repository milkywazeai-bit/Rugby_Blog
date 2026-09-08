# Rugby Blog Crawler

네이버 블로그 "프로바이오틱스 이야기 | 럭비" (`skckckskckck`)의 글을 전부 크롤링해서
NotebookLM 학습용 markdown 파일로 저장하는 스크립트입니다.

글 본문에 포함된 iHerb 제품 링크는 자동으로 따라가서 제품명/설명을 함께 저장합니다.

## 사용법

```bash
pip install -r requirements.txt
python crawler.py --blog-id skckckskckck --out posts
```

- `--limit 5` : 테스트로 5개 글만 크롤링
- `--overwrite` : 이미 저장된 글도 다시 크롤링
- `--delay 2` : 요청 간 대기 시간(초), 기본 1.5초

실행하면 `posts/` 폴더에 글 하나당 markdown 파일 하나가 생성됩니다. 각 파일은:

```
---
title: ...
date: ...
log_no: ...
source_url: ...
---

# 제목

(본문 내용)

## 참고 - 언급된 iHerb 제품

### 제품명
- 링크: ...
- 설명: ...
```

형식이라 NotebookLM에 파일별로 업로드하면 출처 인용이 잘 됩니다.

## 참고

- 네이버 블로그 API(`PostTitleListAsync.naver`)로 전체 글 목록(logNo)을 페이지 단위로 가져온 뒤,
  모바일 뷰어(`m.blog.naver.com/PostView.naver`)에서 본문을 파싱합니다.
- 이미 크롤링된 글은 재실행 시 건너뛰므로 중간에 끊겨도 이어서 실행할 수 있습니다.
- 네트워크가 제한된 환경(예: naver.com/iherb.com 접근이 차단된 샌드박스)에서는 동작하지 않습니다.
  일반 인터넷이 열려 있는 로컬 PC에서 실행하세요.
