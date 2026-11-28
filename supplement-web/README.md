# 영양제 스케줄러 (Firebase 웹앱)

폰에 앱처럼 설치해서 쓰는 영양제 복용 관리 앱입니다. 구글 계정으로 로그인하고, 여러 사람이 함께 쓸 수 있습니다.

- **오늘**: 오늘 먹을 영양제 체크, 재고 자동 차감, 최근 7일 복용률
- **제품**: 관리자가 만든 공용 제품 목록. 아이허브 링크를 붙여넣으면 제품명·브랜드·함량·개수가 자동으로 채워짐
- **유산균**: 달마다 먹을 유산균 조합을 적는 로테이션 표. 이번 달 줄이 강조됨
- **내 정보**: 알림 켜기, 관리자 등록, 로그아웃

## 데이터는 어디에, 누가 볼 수 있나

| 데이터 | 저장 위치 | 볼 수 있는 사람 |
|---|---|---|
| 공용 제품 목록 (`products`) | Firestore | 로그인한 모든 사람 (수정은 관리자만) |
| 내 영양제·복용 기록·로테이션 (`users/{내 ID}`) | Firestore | 나만 |
| 관리자 목록 (`config/admins`) | Firestore | 로그인한 사람 (처음 한 명만 등록 가능) |

규칙은 `firestore.rules`에 있고, `npm run test:rules`로 검사합니다.

사진은 Cloud Storage 대신 작게 줄여서(최대 약 180KB) Firestore 문서 안에 저장합니다. 그래서 무료 요금제(Spark)에서 신용카드 없이 동작합니다.

## 처음 한 번 설정하기

### 1. Firebase 프로젝트 만들기
1. https://console.firebase.google.com 에 구글 계정으로 들어갑니다.
2. **프로젝트 만들기** → 이름 입력 (예: `supplement-scheduler`) → Google 애널리틱스는 꺼도 됩니다.

### 2. 웹 앱 등록
1. 프로젝트 첫 화면에서 **`</>` (웹)** 아이콘 → 앱 이름 입력 → "Firebase 호스팅 설정"은 체크하지 않아도 됩니다.
2. 화면에 나오는 `firebaseConfig = { apiKey: ..., projectId: ... }` 값을 복사합니다.
   이 값은 비밀번호가 아니라 공개돼도 되는 값입니다. `src/config.js`에 들어갑니다.

### 3. 구글 로그인 켜기
**빌드 → Authentication → 시작하기 → 로그인 방법 → Google → 사용 설정** → 지원 이메일 선택 → 저장.

### 4. 데이터베이스 만들기
**빌드 → Firestore Database → 데이터베이스 만들기** → 위치 **asia-northeast3 (서울)** → **프로덕션 모드**로 시작.
(보안 규칙은 배포할 때 `firestore.rules` 내용으로 자동 교체됩니다.)

### 5. 자동 배포용 열쇠 (GitHub에 등록)
코드를 GitHub에 올리면 자동으로 테스트하고 배포합니다(`.github/workflows/supplement-web.yml`). 그러려면 배포 권한이 있는 열쇠가 필요합니다.

1. https://console.cloud.google.com 에서 같은 프로젝트를 선택합니다.
2. **IAM 및 관리자 → 서비스 계정 → 서비스 계정 만들기** → 이름 `github-deploy`.
3. 역할 두 개 추가: **Firebase 관리자** (Firebase Admin), **서비스 사용량 소비자** (Service Usage Consumer).
4. 만든 계정 → **키 → 키 추가 → 새 키 만들기 → JSON** → 파일이 다운로드됩니다.
5. GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Secret: 다운로드한 JSON 파일 내용 전체를 붙여넣기

> ⚠️ 이 JSON 파일은 진짜 비밀번호입니다. 채팅이나 코드에 붙여넣지 말고, GitHub Secret에만 넣으세요. 등록한 뒤에는 컴퓨터에서 파일을 지워도 됩니다.

### 6. 배포
`src/config.js`와 `.firebaserc`에 프로젝트 값을 넣고 GitHub에 올리면 자동으로 배포됩니다.
주소는 `https://<프로젝트ID>.web.app` 입니다.

### 7. 관리자 등록 (배포 직후 바로)
배포된 주소에 로그인 → **내 정보 → "내가 관리자 하기"**.
처음 누른 한 사람만 관리자가 되므로, 주소를 다른 사람에게 알리기 **전에** 하세요.

## 다른 사람과 같이 쓰기
주소(`https://<프로젝트ID>.web.app`)를 보내주면 됩니다. 받은 사람은 구글 계정으로 로그인하면 공용 제품 목록을 보고, 자기 스케줄에 담아서 씁니다.

- **카카오톡·네이버 앱 안에서 열면 구글 로그인이 막힙니다.** 메뉴에서 "다른 브라우저로 열기"를 눌러 크롬이나 사파리로 열어야 합니다.
- 공용 목록에 올리는 사진은 직접 찍은 사진만 쓰세요. 아이허브 사진은 저작권 문제가 있습니다.

## 알림에 대해
지금은 **앱이 열려 있을 때만** 복용 시간 알림이 옵니다.
앱을 꺼도 알림이 오게 하려면 정해진 시간에 서버가 알림을 보내야 하고(Cloud Functions + Cloud Messaging), 이건 **Blaze 요금제(신용카드 등록)**가 필요합니다. 무료 사용량 안에서는 요금이 나오지 않지만 카드 등록은 필요합니다. 다음 단계로 추가할 수 있습니다.

## 개발자용

```bash
npm install
npm test               # 아이허브 링크 해석 테스트
npm run test:rules     # 보안 규칙 테스트 (로컬 에뮬레이터, Java 필요)
npm run build          # src/ → public/app.js
npm run emulators      # 로컬 실행: http://127.0.0.1:5000 (테스트 로그인 버튼이 보임)
```

`src/config.js`가 `REPLACE_ME` 상태이거나 주소에 `?emulator`를 붙이면 로컬 에뮬레이터에 연결됩니다.
