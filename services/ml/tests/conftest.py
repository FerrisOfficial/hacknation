import pytest


@pytest.fixture(autouse=True)
def _no_youtube_delay(monkeypatch: pytest.MonkeyPatch) -> None:
    """Testy kolektora bez przerw między zapytaniami do YouTube (YOUTUBE_DELAY_S)."""
    monkeypatch.setenv("YOUTUBE_DELAY_S", "0")
