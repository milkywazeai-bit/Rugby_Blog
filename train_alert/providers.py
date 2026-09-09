"""조회 대상(코레일 / SRT / 가짜)을 고르는 곳."""

from __future__ import annotations

import os
from typing import Any


def make_searcher(provider: str, verbose: bool = False) -> Any:
    """provider 이름으로 조회기를 만든다. 무거운 import는 필요할 때만 한다."""
    name = (provider or "korail").strip().lower()

    if name == "korail":
        from .korail_client import KorailSearcher

        # 코레일 시간표 조회는 로그인이 필요 없다.
        return KorailSearcher(verbose=verbose)

    if name == "srt":
        from .srt_client import SrtSearcher

        return SrtSearcher(
            srt_id=os.environ.get("SRT_ID"),
            srt_pw=os.environ.get("SRT_PW"),
            verbose=verbose,
        )

    if name == "fake":
        from .fake import FakeSearcher

        return FakeSearcher()

    raise ValueError(f"알 수 없는 provider: {provider!r} (korail / srt / fake)")
