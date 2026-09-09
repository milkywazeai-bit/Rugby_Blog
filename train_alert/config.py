"""감시할 여정(leg) 설정과 로딩."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))

DEFAULT_CONFIG_PATH = Path(__file__).with_name("trips.json")

WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"]


def now_kst() -> datetime:
    return datetime.now(KST)


def normalize_date(value: str) -> str:
    """'2026-09-24' / '20260924' -> '20260924'."""
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if len(digits) != 8:
        raise ValueError(f"날짜 형식이 잘못되었습니다: {value!r} (yyyymmdd)")
    return digits


def normalize_time(value: str) -> str:
    """'6' / '06' / '0610' / '06:10' / '061000' -> '061000'."""
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if len(digits) in (1, 3, 5):  # 앞자리 0이 떨어진 경우 (6, 610, 61000)
        digits = "0" + digits
    if len(digits) == 2:  # 시
        digits += "0000"
    elif len(digits) == 4:  # 시분
        digits += "00"
    if len(digits) != 6:
        raise ValueError(f"시각 형식이 잘못되었습니다: {value!r} (hhmmss)")
    return digits


def fmt_date(yyyymmdd: str) -> str:
    d = date(int(yyyymmdd[0:4]), int(yyyymmdd[4:6]), int(yyyymmdd[6:8]))
    return f"{d.month}/{d.day}({WEEKDAY_KO[d.weekday()]})"


def fmt_time(hhmmss: str) -> str:
    return f"{hhmmss[0:2]}:{hhmmss[2:4]}"


@dataclass
class Leg:
    """감시할 편도 구간 하나."""

    id: str
    dep: str
    arr: str
    date: str
    time_from: str = "000000"
    time_to: str = "235959"
    adults: int = 1
    train_type: str = "KTX"
    label: str = ""
    enabled: bool = True

    def __post_init__(self) -> None:
        self.date = normalize_date(self.date)
        self.time_from = normalize_time(self.time_from)
        self.time_to = normalize_time(self.time_to)
        if self.time_from > self.time_to:
            raise ValueError(
                f"[{self.id}] 출발 시각 범위가 거꾸로입니다: "
                f"{self.time_from} > {self.time_to}"
            )
        if self.adults < 1:
            raise ValueError(f"[{self.id}] 인원은 1명 이상이어야 합니다")
        if not self.label:
            self.label = f"{self.dep} → {self.arr}"

    @property
    def date_label(self) -> str:
        return fmt_date(self.date)

    @property
    def window_label(self) -> str:
        return f"{fmt_time(self.time_from)}~{fmt_time(self.time_to)}"

    @property
    def headline(self) -> str:
        return f"{self.dep}→{self.arr} {self.date_label} {self.window_label}"

    def is_past(self, now: datetime | None = None) -> bool:
        """출발일 + 시간대가 이미 지났으면 True (감시 대상에서 제외)."""
        now = now or now_kst()
        deadline = datetime(
            int(self.date[0:4]),
            int(self.date[4:6]),
            int(self.date[6:8]),
            int(self.time_to[0:2]),
            int(self.time_to[2:4]),
            tzinfo=KST,
        )
        return now > deadline


@dataclass
class Config:
    legs: list[Leg] = field(default_factory=list)
    #: 조회 대상. "korail"(기본) 또는 "srt"(통합 전 예매 시스템, 레거시)
    provider: str = "korail"
    #: 같은 열차를 다시 알릴 때까지의 최소 간격(분)
    renotify_minutes: int = 120
    #: 매진이지만 '예약대기'가 열린 열차도 알릴지
    notify_standby: bool = False
    #: 조회 시 인원수를 SRT에 전달해서 '동시 N석'만 잡을지
    seat_count_filter: bool = True
    #: 한 프로세스 안에서 반복 조회할 때의 간격(초)
    interval_seconds: int = 90
    #: 한 프로세스 안에서 반복 조회할 시간(분). 0이면 1회만 조회
    loop_minutes: int = 0
    #: 예매 화면 링크 (알림 클릭 시 이동)
    booking_url: str = "https://www.korail.com/ticket/main"

    @property
    def active_legs(self) -> list[Leg]:
        return [leg for leg in self.legs if leg.enabled and not leg.is_past()]


def _env_int(name: str, fallback: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return fallback
    try:
        return int(raw)
    except ValueError:
        raise ValueError(f"{name} 값이 숫자가 아닙니다: {raw!r}") from None


def _env_bool(name: str, fallback: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return fallback
    return raw in ("1", "true", "yes", "y", "on")


def load_config(path: str | Path | None = None) -> Config:
    """trips.json을 읽고 환경변수로 일부 값을 덮어씁니다."""
    path = Path(path) if path else DEFAULT_CONFIG_PATH
    raw = json.loads(path.read_text(encoding="utf-8"))

    legs = [Leg(**leg) for leg in raw.get("legs", [])]
    if not legs:
        raise ValueError(f"{path}에 감시할 구간(legs)이 없습니다")

    seen: set[str] = set()
    for leg in legs:
        if leg.id in seen:
            raise ValueError(f"leg id가 중복됩니다: {leg.id}")
        seen.add(leg.id)

    cfg = Config(
        legs=legs,
        provider=raw.get("provider", "korail"),
        renotify_minutes=raw.get("renotify_minutes", 120),
        notify_standby=raw.get("notify_standby", False),
        seat_count_filter=raw.get("seat_count_filter", True),
        interval_seconds=raw.get("interval_seconds", 90),
        loop_minutes=raw.get("loop_minutes", 0),
        booking_url=raw.get("booking_url", Config.booking_url),
    )

    # 워크플로에서 코드 수정 없이 조절할 수 있도록 환경변수를 우선 적용한다.
    cfg.renotify_minutes = _env_int("RENOTIFY_MINUTES", cfg.renotify_minutes)
    cfg.interval_seconds = _env_int("INTERVAL_SECONDS", cfg.interval_seconds)
    cfg.loop_minutes = _env_int("LOOP_MINUTES", cfg.loop_minutes)
    cfg.notify_standby = _env_bool("NOTIFY_STANDBY", cfg.notify_standby)
    cfg.provider = os.environ.get("PROVIDER", "").strip().lower() or cfg.provider
    return cfg
