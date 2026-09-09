# 영양제 스케줄러 (Supplement Scheduler)

영양제 복용 일정을 등록하고, 정해진 시간에 알림을 받고, 복용 여부와 재고를 관리하는 안드로이드 앱입니다.

## 기술 스택
- Kotlin, Jetpack Compose, Material 3
- MVVM (ViewModel + StateFlow)
- Room (로컬 DB)
- Hilt (DI)
- AlarmManager (`setExactAndAllowWhileIdle`) 기반 정시 알림

## 모듈 구조
```
app/src/main/java/com/milkywaze/supplementscheduler/
├── data/
│   ├── db/            # Room Entity, DAO, Database
│   └── repository/    # SupplementRepository
├── domain/            # UI에 노출되는 도메인 모델
├── notification/      # AlarmManager 스케줄링, BroadcastReceiver
├── di/                # Hilt 모듈
└── ui/
    ├── home/          # 오늘의 복용 리스트 화면
    ├── addsupplement/ # 영양제 등록 화면
    └── theme/
```

## 구현된 기능 (MVP)
- 영양제 등록 (이름, 용량, 재고, 복용 시간, 요일)
- 등록 시 요일×시간 기준으로 주간 반복 알림 자동 예약
- 홈 화면에서 오늘 복용해야 할 목록 확인 및 "복용 완료 / 건너뛰기" 체크
- 복용 완료 시 재고 자동 차감, 최근 7일 복용률 표시

## 아직 구현되지 않은 부분 (다음 단계)
- `BootReceiver`: 재부팅 후 모든 활성 스케줄을 다시 읽어 알람 재등록 (현재 TODO로 표시된 자리만 있음)
- 캘린더/통계 화면 (월간 뷰)
- 알림 채널/정확 알람 권한 요청 UI (Android 13+ `POST_NOTIFICATIONS`, Android 12+ `SCHEDULE_EXACT_ALARM`)
- 앱 아이콘 및 launcher 리소스 (`mipmap/ic_launcher`) 추가 필요

## 빌드 방법
1. Android Studio (Koala 이상 권장)로 `android-app/` 폴더를 엽니다.
2. Gradle Wrapper jar가 저장소에 포함되어 있지 않으므로, 최초 1회 아래 명령으로 wrapper를 생성하세요 (Gradle 8.7 이상 설치 필요):
   ```
   gradle wrapper --gradle-version 8.7
   ```
3. 이후 `./gradlew assembleDebug` 로 빌드하거나 Android Studio에서 Run 하면 됩니다.

## 최소 지원 버전
- minSdk 26 (Android 8.0)
- targetSdk / compileSdk 34
