"""
Server-side caching utilities.

Currently houses the WordCloudCache used by the visualizations endpoints.
Phase 6D will extend this with a SessionCache for cross-page persistence
(so users don't re-render visualizations when switching between subtabs).
"""
import hashlib
import logging
from datetime import datetime
from typing import List, Dict, Any


def _stable_hash(content: str) -> str:
    """
    Deterministic hash for cache keys.
    Python's built-in hash() is randomized per process - use SHA1 for stability
    across server restarts. SHA1 is fine for cache keys (no security need).
    """
    return hashlib.sha1(content.encode('utf-8')).hexdigest()[:16]


class WordCloudCache:
    """
    In-memory cache for word frequency computations.

    The key covers the full input rows, the stopwords flag and the class name,
    so different filtering combinations are cached independently and two
    datasets can never share an entry.
    """

    def __init__(self):
        self._cache = {}

    def _make_key(self, rows: List, include_stopwords: bool, class_name: str = "all") -> str:
        """Stable cache key over the full input, the settings, and the class."""
        # Hashing only a leading sample let a longer or edited dataset that
        # starts with the same rows reuse the previous dataset's frequencies.
        text_content = "|".join(str(row) for row in rows)
        stopwords_flag = "stop" if include_stopwords else "nostop"
        return (f"wordcloud_{class_name}_{_stable_hash(text_content)}_"
                f"{len(rows)}_{stopwords_flag}")

    def store_frequency_data(self, rows: List, include_stopwords: bool, class_name: str, freq_data: List):
        """Store frequency data for a specific class."""
        cache_key = self._make_key(rows, include_stopwords, class_name)
        self._cache[cache_key] = {
            "freq_data": freq_data,
            "timestamp": datetime.now().isoformat(),
            "class_name": class_name,
            "row_count": len(rows)
        }
        logging.debug(f"WordCloudCache stored: {class_name} ({len(rows)} rows)")

    def get_frequency_data(self, rows: List, include_stopwords: bool, class_name: str):
        """Get cached frequency data for a specific class."""
        cache_key = self._make_key(rows, include_stopwords, class_name)
        cached = self._cache.get(cache_key)
        if cached:
            logging.debug(f"WordCloudCache hit: {class_name}")
            return cached["freq_data"]
        return None

    def clear_old(self, max_hours: int = 24):
        """Clear cache entries older than max_hours."""
        now = datetime.now()
        cleared = 0
        for key in list(self._cache.keys()):
            cached_time = datetime.fromisoformat(self._cache[key]["timestamp"])
            if (now - cached_time).total_seconds() > max_hours * 3600:
                del self._cache[key]
                cleared += 1
        if cleared:
            logging.info(f"WordCloudCache cleared {cleared} old entries")

    # Backward-compat aliases for old method names
    def get_cache_key(self, rows, include_stopwords, className="all"):
        return self._make_key(rows, include_stopwords, className)


# Module-level singleton - same pattern as before
wordcloud_cache = WordCloudCache()

# ============================================================
# SESSION CACHE
# ============================================================

import hashlib
import json
import threading
import time
from typing import Any, Dict, Optional


class SessionCache:
    """
    Server-side result cache keyed by (session_id, endpoint, params_fingerprint).

    Designed for expensive operations (topic modeling, NER) where re-computation
    on every page navigation is noticeably slow.

    WHY THIS EXISTS:
      The frontend sessionStorage cache (sessionCache.js) stores rendered HTML
      and survives tab switches. But it clears on hard-refresh (F5) or if the
      browser evicts it due to quota pressure.
      This backend cache persists for the lifetime of the Flask process, so a
      hard-refresh on the advanced page still returns results instantly
      as long as the server hasn't restarted.

    THREAD SAFETY:
      Single RLock guards all state. Acceptable for single-user / small-team
      deployments. For high-concurrency, replace with an external store (Redis).

    EVICTION:
      LRU by session - when max_sessions is hit, the session with the
      oldest last-access timestamp across all its entries is dropped.
      Individual entries expire after ttl_seconds regardless.
    """

    def __init__(self, max_sessions: int = 200, ttl_seconds: int = 1800):
        self._store: Dict[str, Dict] = {}  # {session_id: {cache_key: entry}}
        self._max_sessions = max_sessions
        self._ttl = ttl_seconds
        self._lock = threading.RLock()

    # ---- Helpers ----

    @staticmethod
    def fingerprint(data: Any) -> str:
        """
        Stable fingerprint of the complete input.

        Covers the whole input so that two inputs sharing a prefix cannot map
        to the same entry. SHA-1 over a 5,000-row dataset takes milliseconds,
        which is negligible next to the NER and topic-modeling work this cache
        avoids. Uses hashlib rather than Python's hash(), so the same input has
        the same key in every gunicorn worker and across restarts.
        """
        canonical = json.dumps(data, sort_keys=True, default=str)
        return hashlib.sha1(canonical.encode('utf-8')).hexdigest()[:16]

    def _entry_key(self, endpoint: str, fp: str) -> str:
        return f"{endpoint}:{fp}"

    # ---- Public API ----

    def get(self, session_id: str, endpoint: str, fp: str) -> Optional[Any]:
        """Return cached result or None if missing or expired."""
        with self._lock:
            session_data = self._store.get(session_id, {})
            entry = session_data.get(self._entry_key(endpoint, fp))

            if entry is None:
                return None

            if time.time() > entry['expires']:
                del session_data[self._entry_key(endpoint, fp)]
                return None

            # Touch last_access for LRU accounting
            entry['last_access'] = time.time()
            return entry['data']

    def set(
        self,
        session_id: str,
        endpoint: str,
        fp: str,
        data: Any,
        ttl: Optional[int] = None
    ) -> None:
        """Store a result. Evicts oldest session if at capacity."""
        ttl = ttl if ttl is not None else self._ttl
        now = time.time()

        with self._lock:
            if session_id not in self._store:
                if len(self._store) >= self._max_sessions:
                    self._evict_oldest_session()
                self._store[session_id] = {}

            self._store[session_id][self._entry_key(endpoint, fp)] = {
                'data':        data,
                'created':     now,
                'last_access': now,
                'expires':     now + ttl,
            }

    def invalidate_session(self, session_id: str) -> None:
        """Remove all cached results for a session (user uploaded new data)."""
        with self._lock:
            self._store.pop(session_id, None)

    def stats(self) -> Dict:
        """Return cache diagnostics."""
        with self._lock:
            return {
                'sessions':      len(self._store),
                'total_entries': sum(len(v) for v in self._store.values()),
                'max_sessions':  self._max_sessions,
            }

    # ---- Internal eviction ----

    def _evict_oldest_session(self) -> None:
        if not self._store:
            return
        oldest = min(
            self._store.keys(),
            key=lambda sid: max(
                (e.get('last_access', 0) for e in self._store[sid].values()),
                default=0.0
            )
        )
        del self._store[oldest]


# Module-level singleton - shared across all requests in this process
session_cache = SessionCache(
    max_sessions=int(__import__('os').getenv('SESSION_CACHE_MAX_SESSIONS', 200)),
    ttl_seconds=int(__import__('os').getenv('SESSION_CACHE_TTL', 1800)),
)