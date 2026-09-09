"""조회 결과에서 '알릴 만한 열차'를 골라내는 순수 로직."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from .config import Leg, fmt_time

SEAT = "seat"
STANDBY = "standby"


@dataclass
class TrainView:
    """제공자(코레일/SRT)에 상관없이 알림·화면에서 쓰는 공통 형태."""

    train_name: str
    train_number: str
    dep_time: str
    arr_time: str
    dep_station: str
    arr_station: str
    general_state: str
    special_state: str
    general_available: bool
    special_available: bool
    standby_available: bool

    @property
    def seat_available(self) -> bool:
        return self.general_available or self.special_available

    @property
    def seat_label(self) -> str:
        kinds = []
        if self.general_available:
            kinds.append("일반실")
        if self.special_available:
            kinds.append("특실")
        if not kinds and self.standby_available:
            kinds.append("예약대기")
        return "/".join(kinds) if kinds else "매진"

    @property
    def time_label(self) -> str:
        return f"{fmt_time(self.dep_time)}→{fmt_time(self.arr_time)}"

    def line(self) -> str:
        return f"{self.time_label}  {self.train_name} {self.train_number}  {self.seat_label}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "train_name": self.train_name,
            "train_number": self.train_number,
            "dep_time": fmt_time(self.dep_time),
            "arr_time": fmt_time(self.arr_time),
            "general_state": self.general_state,
            "special_state": self.special_state,
            "general_available": self.general_available,
            "special_available": self.special_available,
            "standby_available": self.standby_available,
            "seat_available": self.seat_available,
            "seat_label": self.seat_label,
        }


@dataclass
class LegResult:
    leg: Leg
    trains: list[TrainView] = field(default_factory=list)
    hits: list[TrainView] = field(default_factory=list)
    standby_hits: list[TrainView] = field(default_factory=list)
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.leg.id,
            "label": self.leg.label,
            "dep": self.leg.dep,
            "arr": self.leg.arr,
            "date": self.leg.date,
            "date_label": self.leg.date_label,
            "window": self.leg.window_label,
            "adults": self.leg.adults,
            "error": self.error,
            "hit_count": len(self.hits),
            "standby_count": len(self.standby_hits),
            "trains": [t.to_dict() for t in self.trains],
        }


def in_window(view: TrainView, leg: Leg) -> bool:
    return leg.time_from <= view.dep_time <= leg.time_to


def build_result(
    leg: Leg, trains: Iterable[TrainView], notify_standby: bool = False
) -> LegResult:
    """조회된 열차들을 시간대로 거른 뒤 좌석/예약대기 후보를 분류한다."""
    views = [v for v in trains if in_window(v, leg)]
    views.sort(key=lambda v: v.dep_time)

    result = LegResult(leg=leg, trains=views)
    for view in views:
        if view.seat_available:
            result.hits.append(view)
        elif notify_standby and view.standby_available:
            result.standby_hits.append(view)
    return result


def alert_key(leg: Leg, view: TrainView, kind: str) -> str:
    """알림 중복 제거용 키. 열차가 바뀌거나 매진되었다 풀리면 다시 알린다."""
    return f"{leg.id}:{leg.date}:{view.train_number}:{view.dep_time}:{kind}"
