"""SRT에 접속하지 않고 동작을 확인하기 위한 가짜 조회기.

`python -m train_alert.watch --fake --dry-run` 으로 알림 문구와
상태 페이지를 실제 조회 없이 확인할 수 있다.
"""

from __future__ import annotations

import os
import random
from dataclasses import dataclass

from .config import Leg

SOLD_OUT = "매진"
AVAILABLE = "예약가능"


@dataclass
class FakeTrain:
    """SRTTrain과 같은 인터페이스만 흉내낸 객체."""

    train_number: str
    dep_date: str
    dep_time: str
    arr_time: str
    dep_station_name: str
    arr_station_name: str
    general_seat_state: str = SOLD_OUT
    special_seat_state: str = SOLD_OUT
    reserve_wait_possible_code: str = "0"

    def general_seat_available(self) -> bool:
        return AVAILABLE in self.general_seat_state

    def special_seat_available(self) -> bool:
        return AVAILABLE in self.special_seat_state

    def reserve_standby_available(self) -> bool:
        return "9" in self.reserve_wait_possible_code

    def seat_available(self) -> bool:
        return self.general_seat_available() or self.special_seat_available()


class FakeSearcher:
    """30분 간격 시각표를 만들고 일부만 좌석이 남은 것으로 표시한다."""

    def __init__(self, seed: int | None = None) -> None:
        env_seed = os.environ.get("FAKE_SEED", "").strip()
        self.random = random.Random(seed if seed is not None else (int(env_seed) if env_seed else 20260924))

    def reset(self) -> None:  # SrtSearcher와 인터페이스를 맞춘다
        pass

    def search(self, leg: Leg, seat_count_filter: bool = True) -> list[FakeTrain]:
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
                FakeTrain(
                    train_number=str(number),
                    dep_date=leg.date,
                    dep_time=f"{minutes // 60:02d}{minutes % 60:02d}00",
                    arr_time=f"{(arrive // 60) % 24:02d}{arrive % 60:02d}00",
                    dep_station_name=leg.dep,
                    arr_station_name=leg.arr,
                    general_seat_state=AVAILABLE if roll < 0.12 else SOLD_OUT,
                    special_seat_state=AVAILABLE if 0.12 <= roll < 0.2 else SOLD_OUT,
                    reserve_wait_possible_code="9" if roll > 0.7 else "0",
                )
            )
        return trains
