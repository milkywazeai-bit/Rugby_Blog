# 기차표 취소표 감시기 (수서↔부산)

원하는 시간대에 좌석이 풀리면 **휴대폰으로 푸시 알림**을 보냅니다.
상태를 보여주는 모바일 페이지도 GitHub Pages로 같이 올라갑니다.

현재 등록된 일정 (`train_alert/trips.json`):

| 구간 | 날짜 | 출발 시간대 | 인원 |
|---|---|---|---|
| 수서 → 부산 | 9/24(목) | 05:00 ~ 11:59 | 성인 2명 |
| 부산 → 수서 | 9/27(일) | 16:00 ~ 19:00 | 성인 2명 |

> 예매는 **직접** 하셔야 합니다. 이 도구는 조회와 알림만 합니다.

---

## 모바일에서 설정하기 (전부 폰으로 됩니다)

PC 없이 폰 브라우저만으로 끝납니다. 아래 링크를 순서대로 누르세요.
GitHub 설정 화면이 깨져 보이면 브라우저 메뉴에서 **데스크톱 사이트 요청**을 켜세요.
(GitHub 앱이 아니라 **브라우저**로 여세요. 앱에서는 Secrets 등록이 안 됩니다.)

### ① ntfy 앱 설치하고 토픽 구독

[iOS](https://apps.apple.com/app/ntfy/id1625396347) · [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)

앱에서 `+` → 토픽 이름을 **아무도 못 맞출 긴 문자열**로 정해 구독합니다.
예: `train-suseo-busan-9f3k2h7q1x` — 이 이름을 그대로 ②에 넣습니다.

### ② 토픽 이름을 Secret으로 등록

👉 [Secret 추가 화면 열기](https://github.com/milkywazeai-bit/Rugby_Blog/settings/secrets/actions/new)

- **Name**: `NTFY_TOPIC`
- **Secret**: ①에서 정한 토픽 이름
- **Add secret** 누르기

### ③ 이 브랜치를 기본 브랜치에 머지

스케줄 실행은 기본 브랜치에서만 되기 때문에 꼭 필요합니다.

👉 [PR 만들기 화면 열기](https://github.com/milkywazeai-bit/Rugby_Blog/compare/claude/naver-blog-crawl-products-n4k7sw...claude/train-ticket-alert-site-qhk4wp?expand=1)

**Create pull request** → 다음 화면에서 **Merge pull request** → **Confirm merge**

### ④ 바로 한 번 돌려보기

👉 [워크플로 화면 열기](https://github.com/milkywazeai-bit/Rugby_Blog/actions/workflows/train-alert.yml)

우측 **Run workflow** → `dry_run` 체크(알림 없이 조회만) → **Run workflow**
1~2분 뒤 실행 결과를 열어 로그를 확인합니다.
잘 되면 `dry_run` 없이 한 번 더 돌려서 폰에 알림이 오는지 봅니다.

### ⑤ 상태 페이지를 홈 화면에 추가

④가 성공하면 Pages가 자동으로 켜집니다.

👉 <https://milkywazeai-bit.github.io/Rugby_Blog/>

Safari는 **공유 → 홈 화면에 추가**, Chrome은 **⋮ → 홈 화면에 추가**.

### ⑥ (선택) 감시 주기 조절

👉 [Variables 화면 열기](https://github.com/milkywazeai-bit/Rugby_Blog/settings/variables/actions)

`INTERVAL_SECONDS`, `LOOP_MINUTES` 등을 넣으면 코드 수정 없이 바뀝니다.
값은 아래 [동작 조절](#동작-조절-settings--variables) 표를 참고하세요.

### 일정만 바꾸고 싶을 때

👉 [trips.json 편집](https://github.com/milkywazeai-bit/Rugby_Blog/edit/claude/naver-blog-crawl-products-n4k7sw/train_alert/trips.json)

폰에서도 편집됩니다. 아래로 내려 **Commit changes**를 누르면 다음 실행부터 반영됩니다.

---

## 안드로이드 폰에서 직접 돌리기 (선택)

GitHub Actions는 스케줄이 5~15분씩 밀립니다. 더 촘촘히 보려면 Termux에서
폰이 직접 돌리게 할 수 있습니다. **코레일 조회는 `requests` 하나만 있으면 됩니다.**

```bash
pkg install python git -y
git clone https://github.com/milkywazeai-bit/Rugby_Blog
cd Rugby_Blog
pip install requests

export NTFY_TOPIC=train-suseo-busan-9f3k2h7q1x
termux-wake-lock                       # 화면 꺼져도 계속 돌게
python -m train_alert.watch --loop 360 --interval 30
```

아이폰에는 이런 방법이 없습니다. GitHub Actions 쪽을 쓰세요.

---

## 0. 먼저 알아둘 것 — 코레일·SR 통합

2026년 9월 1일자로 코레일과 SR이 통합되어 **수서 출발 고속열차도 KTX로 통합 운행**되고,
예매·조회 창구가 **코레일+ 앱과 코레일 홈페이지로 일원화**되었습니다.
그래서 이 감시기의 기본 조회 대상은 **코레일**입니다 (`"provider": "korail"`).

### 2026 추석 승차권 일정

| 날짜 | 내용 |
|---|---|
| 9/7 ~ 9/11 (07:00~13:00) | 일반 예매 — **노선별로 날짜가 다름** |
| **9/10 (목)** | **수서 출발·도착 KTX 예매일** ← 이번 일정에 해당 |
| 9/11 (금) 15:00 | 명절 예매 잔여석 판매 시작 |
| 9/12 00:00 ~ 9/15 24:00 | 결제 기한 (미결제 시 자동취소) |
| 9/15 이후 | 미결제 자동취소분·예약대기 배정분이 취소표로 방출 |

**감시기가 실제로 힘을 발휘하는 건 9/11 15시 이후, 특히 9/15 결제 마감 뒤입니다.**
명절 예매 기간에는 전용 예매 페이지에서 좌석이 배정되므로, 그 기간에는 조회에
잡히지 않거나 매진으로만 보일 수 있습니다.

기존 SR 회원이라면 **코레일 통합회원 전환**을 마쳐야 예매할 수 있습니다.

---

## 1. 알림 받을 채널 만들기 (ntfy, 3분)

가장 간단한 방법입니다. 계정 가입이 필요 없습니다.

1. 휴대폰에 **ntfy** 앱 설치 ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy))
2. 앱에서 `+` → 토픽 이름을 **아무도 못 맞출 긴 문자열**로 정해서 구독
   - 예: `train-suseo-busan-9f3k2h7q1x`
   - ntfy.sh의 토픽은 이름만 알면 누구나 볼 수 있으므로, 짧고 뻔한 이름은 쓰지 마세요.
3. 앱 알림 설정에서 이 토픽을 **중요 알림 / 방해금지 예외**로 켜두세요. (좌석은 몇 분 만에 사라집니다)

### 텔레그램을 쓰고 싶다면 (선택)

`@BotFather`로 봇을 만들어 토큰을 받고, 봇에게 아무 메시지나 보낸 뒤
`https://api.telegram.org/bot<토큰>/getUpdates`에서 `chat.id`를 확인하세요.

---

## 2. GitHub Secrets 등록

저장소 → **Settings → Secrets and variables → Actions → New repository secret**

| 이름 | 필수 | 설명 |
|---|---|---|
| `NTFY_TOPIC` | ✅ | 위에서 정한 ntfy 토픽 이름 |
| `NTFY_SERVER` | | 자체 ntfy 서버를 쓸 때만 (기본 `https://ntfy.sh`) |
| `NTFY_TOKEN` | | 접근 제한된 ntfy 토픽을 쓸 때만 |
| `TELEGRAM_BOT_TOKEN` | | 텔레그램으로 받을 때 |
| `TELEGRAM_CHAT_ID` | | 텔레그램으로 받을 때 |
| `SRT_ID` / `SRT_PW` | | `provider`를 `srt`로 되돌릴 때만 |

**코레일 조회에는 계정 정보가 필요 없습니다.** 시간표 조회는 비로그인으로 됩니다.

**이 저장소는 public이므로 토픽 이름은 반드시 Secrets로만 넣으세요.** 코드에 직접 적으면 안 됩니다.

---

## 3. 스케줄이 돌게 만들기

**GitHub Actions의 `schedule`은 기본 브랜치에서만 실행됩니다.**
지금 작업 브랜치는 `claude/train-ticket-alert-site-qhk4wp`이고 기본 브랜치는
`claude/naver-blog-crawl-products-n4k7sw`이므로, 이 브랜치를 **기본 브랜치에 머지해야**
20분마다 자동으로 돕니다. 머지 전에는 Actions 탭에서 수동 실행(`Run workflow`)만 가능합니다.

머지 후 첫 실행을 기다리지 말고 한 번 눌러서 확인하세요:

**Actions → 기차표 취소표 감시 → Run workflow**
- `dry_run` 체크 → 알림은 안 보내고 조회만 확인
- `loop_minutes`에 `5` 입력 → 5분 동안 반복 조회

---

## 4. 상태 페이지 (모바일)

워크플로가 매번 `_site/`를 만들어 GitHub Pages로 배포합니다.
처음 실행될 때 Pages가 자동으로 켜지고, 주소는 다음과 같습니다:

```
https://milkywazeai-bit.github.io/Rugby_Blog/
```

휴대폰 홈 화면에 추가해두면 앱처럼 쓸 수 있습니다. 60초마다 자동 새로고침되고,
구간별로 조회된 전 열차의 매진/예약가능/예약대기 상태를 보여줍니다.

---

## 5. 일정 바꾸기

`train_alert/trips.json`만 고치면 됩니다.

```json
{
  "id": "go",
  "label": "가는 편 · 수서 → 부산",
  "dep": "수서",
  "arr": "부산",
  "date": "20260924",
  "time_from": "05:00",
  "time_to": "11:59",
  "adults": 2,
  "train_type": "KTX"
}
```

- 역 이름은 한글 역명 그대로 (`수서`, `동탄`, `대전`, `동대구`, `부산` …)
- 시각은 `"6"`, `"06:10"`, `"061000"` 다 됩니다
- `train_type`: `KTX`(기본) / `ALL` / `SAEMAEUL` / `MUGUNGHWA`
- 잠시 끄고 싶으면 `"enabled": false`
- 출발 시간대가 지난 구간은 자동으로 감시 대상에서 빠집니다

맨 위의 `"provider"`로 조회 대상을 고릅니다.

| 값 | 설명 |
|---|---|
| `korail` | 기본. 통합 이후 코레일 시간표 조회 |
| `srt` | 통합 전 SRT 예매 시스템. 기존 SRT 앱이 살아 있는 동안의 대비책 |
| `fake` | 접속 없이 동작만 확인 |

### 동작 조절 (Settings → Variables)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `LOOP_MINUTES` | `18` | 한 번 실행될 때 반복 조회하는 시간(분) |
| `INTERVAL_SECONDS` | `90` | 반복 조회 간격(초) |
| `RENOTIFY_MINUTES` | `120` | 같은 열차를 다시 알리기까지의 최소 간격(분) |
| `NOTIFY_STANDBY` | `false` | 매진이지만 **예약대기**가 열린 열차도 알릴지 |
| `PROVIDER` | `korail` | `trips.json`의 provider를 덮어씀 |
| `KORAIL_APP_VERSION` | | 코레일이 앱 버전을 거부할 때 올리는 값 |

같은 열차가 계속 남아 있으면 2시간에 한 번만 다시 알립니다.
반대로 매진됐다가 다시 풀리면 기다리지 않고 즉시 알립니다.

---

## 6. 내 PC에서 돌리기

GitHub Actions는 스케줄이 5~15분씩 밀리는 일이 잦습니다.
취소표처럼 초 단위가 중요한 상황이라면 PC나 라즈베리파이에서 직접 돌리는 쪽이 확실합니다.

```bash
pip install -r train_alert/requirements.txt

export NTFY_TOPIC=train-suseo-busan-9f3k2h7q1x

# 알림 문구와 상태 페이지를 실제 조회 없이 확인
python -m train_alert.watch --fake --dry-run

# 실제 조회 1회
python -m train_alert.watch

# 6시간 동안 30초 간격으로 계속 감시
python -m train_alert.watch --loop 360 --interval 30

# 통합 전 SRT 시스템으로 조회
python -m train_alert.watch --provider srt
```

로직 테스트:

```bash
python -m unittest discover -s train_alert/tests -t .
```

---

## 7. 알아둘 점 / 아직 확인 못 한 것

- **실제 조회는 검증되지 않았습니다.** 이 코드를 만든 환경에서는 코레일·SRT 도메인이
  모두 차단되어 있어서, 조회 요청이 실제로 어떤 응답을 받는지 확인하지 못했습니다.
  첫 실행 로그를 꼭 확인하세요. 검증된 것은 시간대 필터·좌석 판정·응답 매핑·중복 제거
  같은 순수 로직(테스트 26개)뿐입니다.
- **역 이름 `수서`.** 코레일에는 분당선 수서역도 있어서, 통합 후 고속열차 조회에서
  `수서`가 어떻게 해석되는지 확인이 필요합니다. 조회 결과가 이상하면 `trips.json`의
  역 이름을 바꿔보세요.
- **앱 버전.** 코레일 모바일 API에 보내는 버전 문자열이 오래된 값입니다.
  거부당하면 `KORAIL_APP_VERSION` 변수로 올리세요.
- **차단 가능성.** 비정상 접근으로 판단되면 IP가 막힐 수 있습니다. GitHub Actions는
  데이터센터 IP라 개인 PC보다 차단될 여지가 큽니다. 조회가 3회 연속 실패하면
  "⚠️ 감시기 오류" 알림이 갑니다(6시간에 한 번). 그때는 `INTERVAL_SECONDS`를
  늘리거나 PC에서 돌리세요.
- **2매 동시 예약 판정.** 조회 요청에 어른 인원수를 실어 보내 2석 기준으로 판단하게
  합니다. 서버가 이 값을 무시하면 1석만 남았는데 알림이 올 수 있습니다.
  `trips.json`의 `seat_count_filter`를 `false`로 두면 1석 기준으로 바뀝니다.
- **자동 예매는 하지 않습니다.** 알림을 받고 직접 예매하세요.
- 저장소에 60일 동안 아무 활동이 없으면 GitHub가 스케줄 워크플로를 자동으로 끕니다.
