"""SRT 취소표 감시 본체.

    python -m train_alert.watch                # 1회 조회
    python -m train_alert.watch --loop 20      # 20분 동안 반복 조회
    python -m train_alert.watch --dry-run      # 알림 대신 화면 출력
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
import time
from pathlib import Path
from typing import Any

from .config import Config, Leg, load_config, now_kst
from .errors import SearchError
from .matcher import SEAT, STANDBY, LegResult, alert_key, build_result
from .notifier import Notifier
from .providers import make_searcher
from .state import DEFAULT_STATE_PATH, State

log = logging.getLogger("train_alert")

REPO_ROOT = Path(__file__).resolve().parent.parent
SITE_TEMPLATE = REPO_ROOT / "site" / "index.html"
DEFAULT_OUT_DIR = REPO_ROOT / "_site"

#: 이만큼의 회차가 연속으로 전부 실패하면 "감시기가 고장났다" 알림을 보낸다.
FAILURE_ALERT_THRESHOLD = 3


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SRT 명절 취소표 감시기")
    parser.add_argument("--config", default=None, help="trips.json 경로")
    parser.add_argument("--state", default=None, help="state.json 경로")
    parser.add_argument("--out", default=None, help="상태 페이지 출력 폴더 (기본: _site)")
    parser.add_argument(
        "--loop",
        type=int,
        default=None,
        metavar="MINUTES",
        help="이 시간(분) 동안 반복 조회. 0이면 1회만",
    )
    parser.add_argument(
        "--interval", type=int, default=None, metavar="SECONDS", help="반복 조회 간격(초)"
    )
    parser.add_argument("--dry-run", action="store_true", help="알림을 실제로 보내지 않음")
    parser.add_argument(
        "--provider", default=None, choices=["korail", "srt", "fake"], help="조회 대상"
    )
    parser.add_argument(
        "--fake", action="store_true", help="실제 조회 없이 가짜 데이터로 동작 확인"
    )
    parser.add_argument("--verbose", action="store_true", help="SRT 통신 로그 출력")
    return parser.parse_args(argv)


def run_round(
    cfg: Config,
    searcher: Any,
    state: State,
    notifier: Notifier,
) -> tuple[list[LegResult], int]:
    """모든 구간을 한 번씩 조회하고, 새로 열린 좌석을 알린다."""
    results: list[LegResult] = []
    live_keys: set[str] = set()
    failures = 0

    for leg in cfg.active_legs:
        try:
            trains = searcher.search(leg, seat_count_filter=cfg.seat_count_filter)
        except SearchError as exc:
            log.error("[%s] %s", leg.id, exc)
            results.append(LegResult(leg=leg, error=_short(exc)))
            failures += 1
            continue

        result = build_result(leg, trains, notify_standby=cfg.notify_standby)
        results.append(result)
        log.info(
            "[%s] %s · 조회 %d편, 좌석 %d편, 예약대기 %d편",
            leg.id,
            leg.headline,
            len(result.trains),
            len(result.hits),
            len(result.standby_hits),
        )

        for kind, views in ((SEAT, result.hits), (STANDBY, result.standby_hits)):
            pairs = [(view, alert_key(leg, view, kind)) for view in views]
            live_keys.update(key for _, key in pairs)
            fresh = [
                (view, key)
                for view, key in pairs
                if state.should_notify(key, cfg.renotify_minutes)
            ]
            if not fresh:
                continue
            if notify_hit(cfg, notifier, leg, [view for view, _ in fresh], kind):
                for _, key in fresh:
                    state.mark_notified(key)

    state.forget_missing(live_keys)
    return results, failures


def _short(exc: Exception, limit: int = 180) -> str:
    """알림과 상태 페이지에 넣기 좋게 오류 문구를 줄인다."""
    text = " ".join(str(exc).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def notify_hit(
    cfg: Config, notifier: Notifier, leg: Leg, views: list[Any], kind: str
) -> bool:
    what = "좌석" if kind == SEAT else "예약대기"
    emoji = "🚄" if kind == SEAT else "⏳"
    title = f"{emoji} {leg.dep}→{leg.arr} {leg.date_label} {what} {len(views)}편"
    body_lines = [view.line() for view in views[:10]]
    if len(views) > 10:
        body_lines.append(f"… 외 {len(views) - 10}편")
    body_lines.append("")
    body_lines.append(f"성인 {leg.adults}명 기준 · {leg.window_label} 출발")
    message = "\n".join(body_lines)

    log.info("알림 전송: %s", title)
    return notifier.send(
        title=title,
        message=message,
        priority=5 if kind == SEAT else 4,
        tags=["bullettrain_side"] if kind == SEAT else ["hourglass"],
        click=cfg.booking_url,
    )


def build_status(cfg: Config, results: list[LegResult], rounds: int) -> dict[str, Any]:
    now = now_kst()
    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "generated_at_label": now.strftime("%m/%d %H:%M:%S"),
        "rounds": rounds,
        "provider": cfg.provider,
        "notify_standby": cfg.notify_standby,
        "seat_count_filter": cfg.seat_count_filter,
        "booking_url": cfg.booking_url,
        "ok": all(r.error is None for r in results) and bool(results),
        "legs": [r.to_dict() for r in results],
    }


def write_site(out_dir: Path, status: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "status.json").write_text(
        json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if SITE_TEMPLATE.exists():
        shutil.copyfile(SITE_TEMPLATE, out_dir / "index.html")
    (out_dir / ".nojekyll").write_text("", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )

    cfg = load_config(args.config)
    if args.loop is not None:
        cfg.loop_minutes = args.loop
    if args.interval is not None:
        cfg.interval_seconds = args.interval
    if args.provider:
        cfg.provider = args.provider
    if args.fake:
        cfg.provider = "fake"

    if not cfg.active_legs:
        log.warning("감시할 구간이 없습니다 (모두 지난 날짜이거나 비활성).")
        write_site(Path(args.out) if args.out else DEFAULT_OUT_DIR, build_status(cfg, [], 0))
        return 0

    notifier = Notifier.from_env(dry_run=args.dry_run)
    if not notifier.enabled and not args.dry_run:
        log.warning(
            "알림 채널이 설정되지 않았습니다. NTFY_TOPIC 또는 "
            "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID를 설정하세요."
        )

    searcher = make_searcher(cfg.provider, verbose=args.verbose)
    log.info("조회 대상: %s", cfg.provider)

    state = State(args.state or DEFAULT_STATE_PATH)
    out_dir = Path(args.out) if args.out else DEFAULT_OUT_DIR

    deadline = time.monotonic() + max(cfg.loop_minutes, 0) * 60
    consecutive_failures = 0
    rounds = 0
    results: list[LegResult] = []

    while True:
        rounds += 1
        results, failures = run_round(cfg, searcher, state, notifier)

        if failures and failures == len(results):
            consecutive_failures += 1
        else:
            consecutive_failures = 0

        if (
            consecutive_failures >= FAILURE_ALERT_THRESHOLD
            and state.should_notify_error()
        ):
            reason = next((r.error for r in results if r.error), "알 수 없는 오류")
            if notifier.send(
                title="⚠️ SRT 감시기 오류",
                message=f"{consecutive_failures}회 연속 조회 실패\n{reason}",
                priority=4,
                tags=["warning"],
            ):
                state.mark_error_notified()

        write_site(out_dir, build_status(cfg, results, rounds))
        state.save()

        if time.monotonic() + cfg.interval_seconds >= deadline:
            break
        time.sleep(cfg.interval_seconds)

    log.info("총 %d회 조회 완료", rounds)
    # 마지막 회차가 전부 실패했으면 워크플로에서도 빨간불로 보이게 한다.
    return 1 if results and all(r.error for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
