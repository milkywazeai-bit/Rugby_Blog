"""SRTrain 설치 여부와 무관하게 import할 수 있는 예외 정의."""


class SrtSearchError(RuntimeError):
    """조회에 실패했고, 이번 회차는 건너뛰어야 하는 상황."""
