"""SRT에 접속하지 않고 동작을 확인하기 위한 가짜 조회기.

`python -m train_alert.watch --fake --dry-run` 으로 알림 문구와
상태 페이지를 실제 조회 없이 확인할 수 있다.
"""

from __future__ import annotations

import os
import random
from .config import Leg
from .matcher import TrainView

SOLD_OUT = "매진"
AVAILABLE = "예약가능"


class FakeSearcher:
    """30분 간격 시각표를 만들고 일부만 좌석이 남은 것으로 표시한다."""

    name = "fake"

    def __init__(self, seed: int | None = None) -> None:
        env_seed = os.environ.get("FAKE_SEED", "").strip()
        self.random = random.Random(seed if seed is not None else (int(env_seed) if env_seed else 20260924))

    def reset(self) -> None:  # SrtSearcher와 인터페이스를 맞춘다
        pass

    def search(self, leg: Leg, seat_count_filter: bool = True) -> list[TrainView]:
        start = int(leg.time_from[0:2]) * 60 + int(leg.time_from[2:4])
        end = int(leg.time_to[0:2]) * 60 + int(leg.time_to[2:4])
        trains: list[FakeTrain] = []
        number = 300
        for minutes in range(start - start % 30, end + 1, 30):
            if minutes < start:
                continue
            number += 2
            arrive = minutes + 165
            roll = self.random.random()
            trains.append(
                _view(
                    train_number=str(number),
                    dep_time=f"{minutes // 60:02d}{minutes % 60:02d}00",
                    arr_time=f"{(arrive // 60) % 24:02d}{arrive % 60:02d}00",
                    dep=leg.dep,
                    arr=leg.arr,
                    general=AVAILABLE if roll < 0.12 else SOLD_OUT,
                    special=AVAILABLE if 0.12 <= roll < 0.2 else SOLD_OUT,
                    standby="9" if roll > 0.7 else "0",
                )
            )
        return trains


def _view(
    train_number: str,
    dep_time: str,
    arr_time: str,
    dep: str,
    arr: str,
    general: str,
    special: str,
    standby: str,
) -> TrainView:
    return TrainView(
        train_name="KTX",
        train_number=train_number,
        dep_time=dep_time,
        arr_time=arr_time,
        dep_station=dep,
        arr_station=arr,
        general_state=general,
        special_state=special,
        general_available=AVAILABLE in general,
        special_available=AVAILABLE in special,
        standby_available="9" in standby,
    )
