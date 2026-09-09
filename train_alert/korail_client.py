"""코레일 열차 시간표 조회 (2026년 9월 SR 통합 이후의 기본 경로).

코레일-SR 통합으로 수서 출발 고속열차도 KTX로 통합 운행되고 예매/조회 창구가
코레일로 일원화되어서, 기본 조회 대상은 코레일이다.

필요한 것이 '시간표 조회' 하나뿐이라 라이브러리를 쓰지 않고 코레일톡 모바일
엔드포인트를 직접 호출한다. 조회는 로그인 없이 된다.
(`korail2` 패키지는 2014년식 sdist라 최신 setuptools에서 빌드가 깨지고,
 로그인/예매까지 딸려 오는 의존성이 필요 없다.)
"""

from __future__ import annotations

import logging
import os
from typing import Any

import requests

from .config import Leg
from .errors import LoginRequiredError, SearchError
from .matcher import TrainView

log = logging.getLogger(__name__)

KORAIL_MOBILE = "https://smart.letskorail.com/classes/com.korail.mobile"
SCHEDULE_URL = f"{KORAIL_MOBILE}.seatMovie.ScheduleView"

DEFAULT_USER_AGENT = "Dalvik/2.1.0 (Linux; U; Android 5.1.1; Nexus 4 Build/LMY48T)"
DEFAULT_APP_VERSION = "190617001"
TIMEOUT = 20

#: 한 번 호출에 돌아오는 열차 수가 적어서 시간대를 넘겨가며 여러 번 부른다.
MAX_PAGES = 8

#: 조회 결과가 비었을 때의 코레일 메시지 코드
NO_RESULT_CODES = {"P100", "WRG000000", "WRD000061", "WRT300005"}
NEED_LOGIN_CODES = {"P058"}

#: 열차 종류 코드 (selGoTrain / txtTrnGpCd)
TRAIN_TYPES = {
    "KTX": "100",
    "SAEMAEUL": "101",
    "MUGUNGHWA": "102",
    "ALL": "109",
}

#: h_gen_rsv_cd / h_spe_rsv_cd
SEAT_CODE_LABEL = {"11": "예약가능", "13": "매진", "00": "-"}


class KorailSearcher:
    """세션을 재사용하면서 여러 구간을 반복 조회한다."""

    name = "korail"

    def __init__(self, verbose: bool = False) -> None:
        self.verbose = verbose
        self.version = os.environ.get("KORAIL_APP_VERSION", "").strip() or DEFAULT_APP_VERSION
        self.device = os.environ.get("KORAIL_DEVICE", "").strip() or "AD"
        self._session: requests.Session | None = None

    def client(self) -> requests.Session:
        if self._session is None:
            session = requests.Session()
            session.headers.update({"User-Agent": DEFAULT_USER_AGENT})
            self._session = session
        return self._session

    def reset(self) -> None:
        self._session = None

    def search(self, leg: Leg, seat_count_filter: bool = True) -> list[TrainView]:
        try:
            return self._search_window(leg, seat_count_filter)
        except SearchError:
            raise
        except Exception as exc:  # 네트워크 끊김, JSON 깨짐 등
            self.reset()
            raise SearchError(f"조회 실패: {exc!r}") from exc

    def _search_window(self, leg: Leg, seat_count_filter: bool) -> list[TrainView]:
        adults = leg.adults if seat_count_filter else 1
        train_type = TRAIN_TYPES.get(leg.train_type.upper(), TRAIN_TYPES["ALL"])

        views: list[TrainView] = []
        seen: set[str] = set()
        cursor = leg.time_from

        for _ in range(MAX_PAGES):
            page = self._fetch_page(leg, cursor, adults, train_type)
            if not page:
                break

            for info in page:
                key = f"{info.get('h_trn_no')}:{info.get('h_dpt_tm')}"
                if key in seen:
                    continue
                seen.add(key)
                views.append(to_view(info))

            last = max(str(info.get("h_dpt_tm", "")) for info in page)
            if not last or last >= leg.time_to or last >= "235900":
                break
            cursor = _plus_one_minute(last)

        return views

    def _fetch_page(
        self, leg: Leg, time: str, adults: int, train_type: str
    ) -> list[dict[str, Any]]:
        params = {
            "Device": self.device,
            "Version": self.version,
            "radJobId": "1",
            "selGoTrain": train_type,
            "txtTrnGpCd": train_type,
            "txtGoAbrdDt": leg.date,
            "txtGoHour": time,
            "txtGoStart": leg.dep,
            "txtGoEnd": leg.arr,
            "txtPsgFlg_1": str(adults),  # 어른
            "txtPsgFlg_2": "0",  # 어린이
            "txtPsgFlg_3": "0",  # 경로
            "txtPsgFlg_4": "0",  # 중증 장애인
            "txtPsgFlg_5": "0",  # 경증 장애인
            "txtPsgFlg_8": "0",  # 유아
            "txtCardPsgCnt": "0",
            "txtSeatAttCd_2": "000",
            "txtSeatAttCd_3": "000",
            "txtSeatAttCd_4": "015",
            "txtGdNo": "",
            "txtJobDv": "",
            "txtMenuId": "11",
        }

        res = self.client().get(SCHEDULE_URL, params=params, timeout=TIMEOUT)
        res.raise_for_status()
        payload = res.json()

        if payload.get("strResult") == "FAIL":
            code = str(payload.get("h_msg_cd", ""))
            message = str(payload.get("h_msg_txt", "")).strip()
            if code in NO_RESULT_CODES:
                log.info("[%s] 조회 결과 없음 (%s)", leg.id, code)
                return []
            if code in NEED_LOGIN_CODES:
                raise LoginRequiredError(f"코레일이 로그인을 요구합니다 ({code})")
            raise SearchError(f"코레일 응답 오류: {message} ({code})")

        infos = (payload.get("trn_infos") or {}).get("trn_info") or []
        if isinstance(infos, dict):  # 결과가 1건이면 리스트가 아닐 수 있다
            infos = [infos]
        return infos


def to_view(info: dict[str, Any]) -> TrainView:
    """코레일 trn_info 한 건 -> 공통 TrainView."""
    general_code = str(info.get("h_gen_rsv_cd", ""))
    special_code = str(info.get("h_spe_rsv_cd", ""))
    wait_flag = str(info.get("h_wait_rsv_flg", "")).strip()

    return TrainView(
        train_name=str(info.get("h_trn_clsf_nm") or "열차"),
        train_number=str(info.get("h_trn_no", "")),
        dep_time=str(info.get("h_dpt_tm", "")),
        arr_time=str(info.get("h_arv_tm", "")),
        dep_station=str(info.get("h_dpt_rs_stn_nm", "")),
        arr_station=str(info.get("h_arv_rs_stn_nm", "")),
        general_state=SEAT_CODE_LABEL.get(general_code, general_code or "-"),
        special_state=SEAT_CODE_LABEL.get(special_code, special_code or "-"),
        general_available=general_code == "11",
        special_available=special_code == "11",
        # 9 = 일반실 예약대기 가능, -2 = 좌석 있음, 0 = 매진
        standby_available=wait_flag.lstrip("+") == "9",
    )


def _plus_one_minute(hhmmss: str) -> str:
    total = int(hhmmss[0:2]) * 3600 + int(hhmmss[2:4]) * 60 + int(hhmmss[4:6]) + 60
    total = min(total, 23 * 3600 + 59 * 60 + 59)
    return f"{total // 3600:02d}{(total % 3600) // 60:02d}{total % 60:02d}"
