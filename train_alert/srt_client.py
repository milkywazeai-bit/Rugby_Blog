"""SRT 조회 래퍼 (레거시).

2026년 9월 코레일-SR 통합으로 수서 출발 고속열차는 KTX로 통합 운행되고 예매도
코레일로 일원화되었다. 기존 SRT 앱/시스템이 살아 있는 동안의 대비책으로만 남겨둔다.
평상시에는 `korail_client`를 쓴다.

`SRTrain` 라이브러리를 쓰되,
  * 로그인 정보가 없으면 비로그인으로 조회를 시도하고
  * 인원수(psgNum)를 넘겨 '동시 N석'만 예약가능으로 잡도록
두 가지를 덧붙인다.
"""

from __future__ import annotations

import logging
from typing import Any

from SRT import SRT
from SRT.errors import SRTError, SRTLoginError, SRTResponseError

from .config import Leg
from .errors import SearchError
from .matcher import TrainView

log = logging.getLogger(__name__)

#: 조회 결과가 비었을 때 SRT가 돌려주는 메시지에 흔히 들어가는 조각들.
EMPTY_RESULT_HINTS = (
    "조회 결과가 없습니다",
    "열차가 없습니다",
    "해당하는 열차가",
    "잔여석이 없습니다",
)


class SrtSearcher:
    """로그인 세션을 재사용하면서 여러 구간을 반복 조회한다."""

    name = "srt"

    def __init__(
        self,
        srt_id: str | None = None,
        srt_pw: str | None = None,
        verbose: bool = False,
    ) -> None:
        self.srt_id = (srt_id or "").strip()
        self.srt_pw = (srt_pw or "").strip()
        self.verbose = verbose
        self._srt: SRT | None = None

    @property
    def logged_in(self) -> bool:
        return bool(self.srt_id and self.srt_pw)

    def _connect(self) -> SRT:
        if self.logged_in:
            log.info("SRT 로그인 시도 (%s)", _mask(self.srt_id))
            return SRT(self.srt_id, self.srt_pw, verbose=self.verbose)
        # 비로그인 조회: 라이브러리의 자동 로그인만 끄면 시간표 조회는 그대로 동작한다.
        log.info("SRT 비로그인 조회 모드")
        return SRT("", "", auto_login=False, verbose=self.verbose)

    def client(self) -> SRT:
        if self._srt is None:
            self._srt = self._connect()
        return self._srt

    def reset(self) -> None:
        """다음 조회 때 세션을 새로 만들도록 한다."""
        self._srt = None

    def search(self, leg: Leg, seat_count_filter: bool = True) -> list[TrainView]:
        """구간 하나를 조회한다. 결과가 없으면 빈 리스트."""
        try:
            return self._search_once(leg, seat_count_filter)
        except SRTLoginError as exc:
            raise SearchError(f"SRT 로그인 실패: {exc}") from exc
        except SRTResponseError as exc:
            message = str(exc)
            if any(hint in message for hint in EMPTY_RESULT_HINTS):
                log.info("[%s] 조회 결과 없음: %s", leg.id, message)
                return []
            # 세션이 만료된 경우가 많아 다음 회차에는 새 세션으로 붙는다.
            self.reset()
            raise SearchError(f"SRT 응답 오류: {message}") from exc
        except SRTError as exc:
            self.reset()
            raise SearchError(f"SRT 오류: {exc}") from exc
        except Exception as exc:  # 네트워크 끊김 등
            self.reset()
            raise SearchError(f"조회 실패: {exc!r}") from exc

    def _search_once(self, leg: Leg, seat_count_filter: bool) -> list[TrainView]:
        srt = self.client()
        passengers = leg.adults if seat_count_filter else 1
        with _passenger_count(srt, passengers):
            trains = srt.search_train(
                dep=leg.dep,
                arr=leg.arr,
                date=leg.date,
                time=leg.time_from,
                time_limit=leg.time_to,
                available_only=False,
            )
        return [to_view(train) for train in trains]


def to_view(train: Any) -> TrainView:
    """SRTTrain -> 공통 TrainView."""
    return TrainView(
        train_name=str(train.train_name),
        train_number=str(train.train_number),
        dep_time=str(train.dep_time),
        arr_time=str(train.arr_time),
        dep_station=str(train.dep_station_name),
        arr_station=str(train.arr_station_name),
        general_state=str(train.general_seat_state),
        special_state=str(train.special_seat_state),
        general_available=bool(train.general_seat_available()),
        special_available=bool(train.special_seat_available()),
        standby_available=bool(train.reserve_standby_available()),
    )


class _passenger_count:
    """조회 요청의 psgNum을 잠깐 바꿔치기하는 컨텍스트 매니저.

    SRTrain은 시간표 조회를 항상 1명 기준으로 보낸다(`psgNum: 1`).
    그러면 남은 좌석이 1석뿐인 열차도 '예약가능'으로 나오기 때문에,
    2명이 필요한 경우 헛알림이 생긴다. 요청 직전에 psgNum만 바꿔서
    SRT 쪽이 인원수 기준으로 판단하게 한다.
    """

    def __init__(self, srt: SRT, count: int) -> None:
        self.srt = srt
        self.count = count
        self._original = None

    def __enter__(self) -> None:
        if self.count <= 1:
            return
        session = self.srt._session
        self._original = session.post

        def post(url, data=None, **kwargs):
            if isinstance(data, dict) and "psgNum" in data:
                data = {**data, "psgNum": self.count}
            return self._original(url, data=data, **kwargs)

        session.post = post

    def __exit__(self, *exc_info) -> None:
        if self._original is not None:
            self.srt._session.post = self._original
            self._original = None


def _mask(value: str) -> str:
    if len(value) <= 4:
        return "*" * len(value)
    return value[:2] + "*" * (len(value) - 4) + value[-2:]
