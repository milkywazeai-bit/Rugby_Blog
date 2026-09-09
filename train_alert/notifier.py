"""휴대폰 푸시 알림 전송 (ntfy / 텔레그램)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import requests

log = logging.getLogger(__name__)

TIMEOUT = 15


@dataclass
class Notifier:
    ntfy_server: str = "https://ntfy.sh"
    ntfy_topic: str = ""
    ntfy_token: str = ""
    telegram_token: str = ""
    telegram_chat_id: str = ""
    dry_run: bool = False

    @classmethod
    def from_env(cls, dry_run: bool = False) -> "Notifier":
        return cls(
            ntfy_server=os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/"),
            ntfy_topic=os.environ.get("NTFY_TOPIC", "").strip(),
            ntfy_token=os.environ.get("NTFY_TOKEN", "").strip(),
            telegram_token=os.environ.get("TELEGRAM_BOT_TOKEN", "").strip(),
            telegram_chat_id=os.environ.get("TELEGRAM_CHAT_ID", "").strip(),
            dry_run=dry_run,
        )

    @property
    def channels(self) -> list[str]:
        names = []
        if self.ntfy_topic:
            names.append("ntfy")
        if self.telegram_token and self.telegram_chat_id:
            names.append("telegram")
        return names

    @property
    def enabled(self) -> bool:
        return bool(self.channels)

    def send(
        self,
        title: str,
        message: str,
        priority: int = 5,
        tags: list[str] | None = None,
        click: str = "",
    ) -> bool:
        """설정된 모든 채널로 보낸다. 하나라도 성공하면 True."""
        if self.dry_run:
            print(f"[DRY-RUN] {title}\n{message}\n---")
            return True
        if not self.enabled:
            log.warning("알림 채널이 하나도 설정되지 않았습니다: %s", title)
            return False

        ok = False
        if self.ntfy_topic:
            ok = self._send_ntfy(title, message, priority, tags or [], click) or ok
        if self.telegram_token and self.telegram_chat_id:
            ok = self._send_telegram(title, message, click) or ok
        return ok

    def _send_ntfy(
        self, title: str, message: str, priority: int, tags: list[str], click: str
    ) -> bool:
        # 헤더 방식은 ASCII만 허용해서 한글 제목이 깨진다. JSON 발행 엔드포인트를 쓴다.
        payload = {
            "topic": self.ntfy_topic,
            "title": title,
            "message": message,
            "priority": priority,
        }
        if tags:
            payload["tags"] = tags
        if click:
            payload["click"] = click

        headers = {}
        if self.ntfy_token:
            headers["Authorization"] = f"Bearer {self.ntfy_token}"

        try:
            res = requests.post(
                self.ntfy_server, json=payload, headers=headers, timeout=TIMEOUT
            )
            res.raise_for_status()
            return True
        except Exception as exc:
            log.error("ntfy 전송 실패: %r", exc)
            return False

    def _send_telegram(self, title: str, message: str, click: str) -> bool:
        text = f"*{_escape(title)}*\n{_escape(message)}"
        if click:
            text += f"\n{_escape(click)}"
        try:
            res = requests.post(
                f"https://api.telegram.org/bot{self.telegram_token}/sendMessage",
                json={
                    "chat_id": self.telegram_chat_id,
                    "text": text,
                    "parse_mode": "Markdown",
                    "disable_web_page_preview": True,
                },
                timeout=TIMEOUT,
            )
            res.raise_for_status()
            return True
        except Exception as exc:
            log.error("텔레그램 전송 실패: %r", exc)
            return False


def _escape(text: str) -> str:
    for ch in ("_", "*", "`", "["):
        text = text.replace(ch, "\\" + ch)
    return text
