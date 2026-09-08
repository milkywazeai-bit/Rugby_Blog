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

## 자동화 (GitHub Actions)

`.github/workflows/crawl.yml`이 매일 자동으로 크롤러를 실행해서 새 글만 찾아 커밋합니다.
수동 실행은 저장소의 Actions 탭 → "Crawl Naver blog posts" → Run workflow.

### Google Drive 자동 업로드 (선택)

새로 크롤링된 글을 Google Drive 폴더에도 자동 업로드해서, NotebookLM이 그 폴더를 소스로
구독해두면 새로고침만으로 새 글을 반영할 수 있게 합니다.

Drive API는 서비스 계정에 저장 용량이 없어서(개인 Gmail 기준), 서비스 계정이 아니라
**본인 계정 권한(OAuth)** 으로 업로드합니다. 설정 순서:

1. Google Cloud Console → OAuth 동의 화면 설정 (User type: 외부, 본인을 테스트 사용자로 추가)
2. 사용자 인증 정보 → OAuth 클라이언트 ID 만들기 → 애플리케이션 유형: **데스크톱 앱** → JSON 다운로드
3. 로컬(또는 Termux)에서 1회 실행:
   ```bash
   pip install google-auth-oauthlib
   python get_drive_refresh_token.py --client-secrets client_secret.json
   ```
   출력된 URL을 브라우저에서 열어 로그인/승인하면 `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`,
   `GDRIVE_REFRESH_TOKEN` 값이 출력됩니다.
4. Drive에 폴더를 만들고 그 폴더 ID(`drive.google.com/drive/folders/<ID>`)를 확인
5. GitHub 저장소 → Settings → Secrets and variables → Actions 에 등록:
   - `GDRIVE_CLIENT_ID`
   - `GDRIVE_CLIENT_SECRET`
   - `GDRIVE_REFRESH_TOKEN`
   - `GDRIVE_FOLDER_ID`

네 개 시크릿이 모두 등록되면 다음 실행부터 새 글이 그 Drive 폴더에 자동 업로드됩니다.
