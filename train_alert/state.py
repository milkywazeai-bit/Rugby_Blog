"""알림 중복 방지용 상태 저장."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from .config import KST, now_kst

DEFAULT_STATE_PATH = Path(__file__).with_name("state.json")


class State:
    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path else DEFAULT_STATE_PATH
        self.data: dict[str, Any] = {"alerts": {}, "last_error_notified": None}
        if self.path.exists():
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    self.data.update(loaded)
            except (json.JSONDecodeError, OSError):
                # 상태 파일이 깨졌다면 알림이 한 번 더 갈 뿐이니 그냥 새로 시작한다.
                pass
        self.data.setdefault("alerts", {})
        self._snapshot = json.dumps(self.data, sort_keys=True, ensure_ascii=False)

    @property
    def alerts(self) -> dict[str, Any]:
        return self.data["alerts"]

    def should_notify(self, key: str, renotify_minutes: int) -> bool:
        entry = self.alerts.get(key)
        if not entry:
            return True
        last = _parse(entry.get("last_notified"))
        if last is None:
            return True
        return now_kst() - last >= timedelta(minutes=renotify_minutes)

    def mark_notified(self, key: str) -> None:
        now = now_kst().isoformat()
        entry = self.alerts.setdefault(key, {"first_seen": now, "count": 0})
        entry["last_notified"] = now
        entry["count"] = entry.get("count", 0) + 1

    def forget_missing(self, live_keys: set[str]) -> None:
        """이번 조회에서 사라진(=다시 매진된) 열차는 기록을 지운다.

        다음에 다시 좌석이 풀리면 재알림 간격을 기다리지 않고 바로 알린다.
        """
        for key in list(self.alerts):
            if key not in live_keys:
                del self.alerts[key]

    def should_notify_error(self, cooldown_minutes: int = 360) -> bool:
        last = _parse(self.data.get("last_error_notified"))
        if last is None:
            return True
        return now_kst() - last >= timedelta(minutes=cooldown_minutes)

    def mark_error_notified(self) -> None:
        self.data["last_error_notified"] = now_kst().isoformat()

    @property
    def dirty(self) -> bool:
        return json.dumps(self.data, sort_keys=True, ensure_ascii=False) != self._snapshot

    def save(self) -> bool:
        """내용이 바뀐 경우에만 파일을 쓴다. (커밋 소음 방지)"""
        if not self.dirty:
            return False
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        self._snapshot = json.dumps(self.data, sort_keys=True, ensure_ascii=False)
        return True


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=KST)
    return parsed
