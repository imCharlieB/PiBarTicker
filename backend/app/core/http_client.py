from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Callable

import httpx


CacheKey = str
RequestHook = Callable[[str, dict[str, Any] | None], None]
ResponseHook = Callable[[str, int], None]
CacheHitHook = Callable[[CacheKey], None]


@dataclass
class _CacheEntry:
    value: Any
    expires_at: float


class InMemoryResponseCache:
    def __init__(self) -> None:
        self._data: dict[CacheKey, _CacheEntry] = {}

    def get(self, key: CacheKey) -> Any | None:
        entry = self._data.get(key)
        if entry is None:
            return None

        if time.time() >= entry.expires_at:
            self._data.pop(key, None)
            return None

        return entry.value

    def set(self, key: CacheKey, value: Any, ttl_seconds: float) -> None:
        self._data[key] = _CacheEntry(value=value, expires_at=time.time() + ttl_seconds)


class HttpClient:
    def __init__(
        self,
        *,
        timeout_seconds: float = 8.0,
        max_retries: int = 2,
        retry_backoff_seconds: float = 0.6,
        cache: InMemoryResponseCache | None = None,
        on_request: RequestHook | None = None,
        on_response: ResponseHook | None = None,
        on_cache_hit: CacheHitHook | None = None,
    ) -> None:
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._retry_backoff_seconds = retry_backoff_seconds
        self._cache = cache
        self._on_request = on_request
        self._on_response = on_response
        self._on_cache_hit = on_cache_hit

    def get_json(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        use_cache: bool = True,
        cache_ttl_seconds: float = 30.0,
    ) -> Any:
        cache_key = self._cache_key(url, params)
        if use_cache and self._cache is not None:
            cached = self._cache.get(cache_key)
            if cached is not None:
                if self._on_cache_hit is not None:
                    self._on_cache_hit(cache_key)
                return cached

        last_error: Exception | None = None

        for attempt in range(self._max_retries + 1):
            if self._on_request is not None:
                self._on_request(url, params)

            try:
                with httpx.Client(timeout=self._timeout_seconds) as client:
                    response = client.get(url, params=params)
                response.raise_for_status()

                if self._on_response is not None:
                    self._on_response(url, response.status_code)

                payload = response.json()
                if use_cache and self._cache is not None:
                    self._cache.set(cache_key, payload, cache_ttl_seconds)

                return payload
            except (httpx.HTTPError, ValueError) as error:
                last_error = error
                if attempt >= self._max_retries:
                    break
                time.sleep(self._retry_backoff_seconds * (attempt + 1))

        assert last_error is not None
        raise last_error

    @staticmethod
    def _cache_key(url: str, params: dict[str, Any] | None) -> CacheKey:
        if not params:
            return url

        serialized = json.dumps(params, sort_keys=True, separators=(",", ":"))
        return f"{url}?{serialized}"
