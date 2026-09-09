"""조회 제공자와 무관하게 import할 수 있는 예외 정의."""


class SearchError(RuntimeError):
    """조회에 실패했고, 이번 회차는 건너뛰어야 하는 상황."""


class LoginRequiredError(SearchError):
    """비로그인 조회가 막혀서 계정 정보가 필요한 상황."""
