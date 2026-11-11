"""The upload limits on their own: the quota arithmetic and the sliding-window rate limiter."""

import pytest

from app.quotas import MB, QuotaExceeded, RateLimited, UploadRateLimiter, Usage, check_quota


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_room_for_one_more() -> None:
    check_quota(Usage(4, 10 * MB), adding_bytes=5 * MB, max_documents=5, max_bytes=20 * MB)


def test_a_full_shelf_is_refused() -> None:
    with pytest.raises(QuotaExceeded, match="Your shelf is full: 5 PDFs is the limit"):
        check_quota(Usage(5, 0), adding_bytes=0, max_documents=5, max_bytes=20 * MB)


def test_a_file_that_would_pass_the_storage_limit_is_refused() -> None:
    with pytest.raises(QuotaExceeded) as caught:
        check_quota(Usage(1, 18 * MB), adding_bytes=3 * MB, max_documents=5, max_bytes=20 * MB)
    assert str(caught.value) == (
        "Your PDFs use 18 MB of your 20 MB, and this one needs 3 MB more. Remove a PDF to make room."
    )


def test_exactly_filling_the_storage_is_allowed_but_then_full() -> None:
    check_quota(Usage(1, 15 * MB), adding_bytes=5 * MB, max_documents=5, max_bytes=20 * MB)
    with pytest.raises(QuotaExceeded):
        check_quota(Usage(2, 20 * MB), adding_bytes=0, max_documents=5, max_bytes=20 * MB)


def test_the_rate_limit_allows_n_then_says_when_to_retry() -> None:
    clock = Clock()
    limiter = UploadRateLimiter(3, 600, clock)
    for _ in range(3):
        limiter.hit("ana")
        clock.now += 10
    with pytest.raises(RateLimited) as caught:
        limiter.hit("ana")
    # the first upload was 30 s ago, so it leaves the 10-minute window in 570 s
    assert caught.value.retry_after_seconds == 570
    assert str(caught.value) == "You've uploaded 3 PDFs in the last 10 minutes. Try again in 10 minutes."


def test_the_window_slides_instead_of_resetting() -> None:
    clock = Clock()
    limiter = UploadRateLimiter(2, 60, clock)
    limiter.hit("ana")
    clock.now += 50
    limiter.hit("ana")
    clock.now += 11  # the first has left the window; the second hasn't
    limiter.hit("ana")
    with pytest.raises(RateLimited) as caught:
        limiter.hit("ana")
    assert caught.value.retry_after_seconds == 49  # the upload at +50 s leaves the window at +110 s
    assert "Try again in 49 seconds." in str(caught.value)


def test_a_refused_attempt_is_not_counted() -> None:
    clock = Clock()
    limiter = UploadRateLimiter(1, 60, clock)
    limiter.hit("ana")
    for _ in range(5):
        with pytest.raises(RateLimited):
            limiter.hit("ana")
    clock.now += 60
    limiter.hit("ana")  # hammering while blocked didn't push the wait further out


def test_each_reader_has_their_own_count() -> None:
    limiter = UploadRateLimiter(1, 60, Clock())
    limiter.hit("ana")
    limiter.hit("ben")
