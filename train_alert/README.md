# SRT 명절 취소표 감시기

수서↔부산 SRT를 계속 조회해서, **원하는 시간대에 좌석이 풀리면 휴대폰으로 푸시 알림**을 보냅니다.
상태를 보여주는 모바일 페이지도 GitHub Pages로 같이 올라갑니다.

현재 등록된 일정 (`train_alert/trips.json`):

| 구간 | 날짜 | 출발 시간대 | 인원 |
|---|---|---|---|
| 수서 → 부산 | 9/24(목) | 05:00 ~ 11:59 | 성인 2명 |
| 부산 → 수서 | 9/27(일) | 16:00 ~ 19:00 | 성인 2명 |

> 예매는 **직접** 하셔야 합니다. 이 도구는 조회와 알림만 합니다.

---

## 1. 알림 받을 채널 만들기 (ntfy, 3분)

가장 간단한 방법입니다. 계정 가입이 필요 없습니다.

1. 휴대폰에 **ntfy** 앱 설치 ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy))
2. 앱에서 `+` → 토픽 이름을 **아무도 못 맞출 긴 문자열**로 정해서 구독
   - 예: `srt-suseo-busan-9f3k2h7q1x`
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
| `SRT_ID` | | SRT 회원번호/이메일/휴대폰번호 |
| `SRT_PW` | | SRT 비밀번호 |

**이 저장소는 public이므로 토픽 이름과 계정 정보는 반드시 Secrets로만 넣으세요.** 코드에 직접 적으면 안 됩니다.

`SRT_ID` / `SRT_PW`는 비워둬도 됩니다. 비워두면 비로그인으로 시간표를 조회합니다.
비로그인 조회가 막히면 로그에 `SRT 응답 오류`가 뜨는데, 그때 계정 정보를 넣으세요.

---

## 3. 스케줄이 돌게 만들기

**GitHub Actions의 `schedule`은 기본 브랜치에서만 실행됩니다.**
지금 작업 브랜치는 `claude/train-ticket-alert-site-qhk4wp`이고 기본 브랜치는
`claude/naver-blog-crawl-products-n4k7sw`이므로, 이 브랜치를 **기본 브랜치에 머지해야**
20분마다 자동으로 돕니다. 머지 전에는 Actions 탭에서 수동 실행(`Run workflow`)만 가능합니다.

머지 후 첫 실행을 기다리지 말고 한 번 눌러서 확인하세요:

**Actions → SRT 취소표 감시 → Run workflow**
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
  "adults": 2
}
```

- 역 이름은 SRT 노선의 한글 역명 그대로 (`수서`, `동탄`, `대전`, `동대구`, `부산`, `광주송정` …)
- 시각은 `"6"`, `"06:10"`, `"061000"` 다 됩니다
- 잠시 끄고 싶으면 `"enabled": false`
- 출발 시간대가 지난 구간은 자동으로 감시 대상에서 빠집니다

### 동작 조절 (Settings → Variables)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `LOOP_MINUTES` | `18` | 한 번 실행될 때 반복 조회하는 시간(분) |
| `INTERVAL_SECONDS` | `90` | 반복 조회 간격(초) |
| `RENOTIFY_MINUTES` | `120` | 같은 열차를 다시 알리기까지의 최소 간격(분) |
| `NOTIFY_STANDBY` | `false` | 매진이지만 **예약대기**가 열린 열차도 알릴지 |

같은 열차가 계속 남아 있으면 2시간에 한 번만 다시 알립니다.
반대로 매진됐다가 다시 풀리면 기다리지 않고 즉시 알립니다.

---

## 6. 내 PC에서 돌리기

GitHub Actions는 스케줄이 5~15분씩 밀리는 일이 잦습니다.
명절 취소표처럼 초 단위가 중요한 상황이라면 PC나 라즈베리파이에서 직접 돌리는 쪽이 확실합니다.

```bash
pip install -r train_alert/requirements.txt

export NTFY_TOPIC=srt-suseo-busan-9f3k2h7q1x
export SRT_ID=... SRT_PW=...          # 선택

# 알림 문구와 상태 페이지를 실제 조회 없이 확인
python -m train_alert.watch --fake --dry-run

# 실제 조회 1회
python -m train_alert.watch

# 6시간 동안 30초 간격으로 계속 감시
python -m train_alert.watch --loop 360 --interval 30
```

로직 테스트:

```bash
python -m unittest discover -s train_alert/tests -t .
```

---

## 7. 알아둘 점

- **SRT가 조회를 차단할 수 있습니다.** SRT는 비정상 접근으로 판단하면 IP를 막습니다.
  GitHub Actions는 데이터센터 IP라 개인 PC보다 차단될 여지가 큽니다.
  조회가 3회 연속 실패하면 "⚠️ SRT 감시기 오류" 알림이 갑니다(6시간에 한 번).
  그때는 `INTERVAL_SECONDS`를 늘리거나 PC에서 돌리세요.
- **2매 동시 예약 판정.** 조회 요청에 인원수(2명)를 실어 보내서 SRT가 2석 기준으로
  판단하게 합니다. 다만 SRT가 이 값을 무시할 가능성이 있어, 알림을 받았는데
  1석만 남아 있는 경우가 생길 수 있습니다. `trips.json`의 `seat_count_filter`를
  `false`로 두면 1석 기준(=알림이 더 많이 옴)으로 바뀝니다.
- **자동 예매는 하지 않습니다.** 알림을 받고 직접 예매하세요. 알림을 누르면 SRT
  모바일 예매 화면으로 바로 이동합니다.
- 저장소에 60일 동안 아무 활동이 없으면 GitHub가 스케줄 워크플로를 자동으로 끕니다.
  이 저장소는 다른 워크플로도 매일 돌기 때문에 보통은 문제되지 않습니다.
