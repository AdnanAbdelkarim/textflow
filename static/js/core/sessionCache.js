/**
 * Frontend session cache - persists computed data across page navigations.
 *
 * WHY: The browser destroys JS heap state on every page navigation.
 * sessionStorage survives navigations within the same browser tab, so
 * computed visualization data can be retrieved instantly on return.
 *
 * CACHE KEY DESIGN:
 *   'wc:{class}:{stopwords}'           word cloud frequency data
 *   'net:{class}:{stopwords}:{topN}:{minCo}'  network graph
 *   'cov:{class}:{stopwords}'          coverage data
 *   'zipf:{class}:{stopwords}'         Zipf data
 *   'overlap:{class}:{stopwords}'      class overlap results
 *   'ner:{method}:{textHash}'          NER entities
 *   'sentiment:{textHash}'             sentiment results
 *   'topics:{dataHash}:{isLabeled}'    topic modeling results
 *
 * DATA FINGERPRINT:
 *   Each entry stores a fingerprint of window.lastCSVData at write time.
 *   On read, if the current fingerprint differs (user uploaded a new file),
 *   the entry is treated as stale and re-computation is triggered.
 *
 * EVICTION:
 *   LRU eviction fires when MAX_ENTRIES is exceeded or quota is hit.
 *   Oldest 20% of entries are dropped.
 */
(function () {
    'use strict';
  
    const SC_PREFIX = 'sc_';        // distinguishes our keys from other sessionStorage entries
    const DEFAULT_TTL = 30 * 60 * 1000;  // 30 minutes
    const MAX_ENTRIES = 60;         // LRU eviction threshold
  
    // ============================================================
    // DATA FINGERPRINT
    // ============================================================
  
    /**
     * Fast fingerprint from window.lastCSVData.
     * Doesn't hash the entire dataset - just checks length + boundary labels.
     * Detects the common case: user uploads a different CSV.
     */
    function currentDataFingerprint() {
      const d = window.lastCSVData;
      if (!Array.isArray(d) || !d.length) return 'no-data';
      const first = d[0];
      const last = d[d.length - 1];
      return `${d.length}_${first?.label ?? ''}_${last?.label ?? ''}`;
    }
  
    /**
     * Hash a short string to a hex string. Used for text-based keys (NER, sentiment).
     * NOT cryptographic - just needs to be fast and collision-resistant enough for a UI cache.
     */
    function _quickHash(str) {
      let h = 0x811c9dc5;
      for (let i = 0; i < Math.min(str.length, 500); i++) {
        h ^= str.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
      }
      return h.toString(16);
    }
  
    // ============================================================
    // INTERNAL KEY HELPERS
    // ============================================================
  
    function _storageKey(key) {
      return SC_PREFIX + key;
    }
  
    function _allOurKeys() {
      return Object.keys(sessionStorage).filter(k => k.startsWith(SC_PREFIX));
    }
  
    // ============================================================
    // LRU EVICTION
    // ============================================================
  
    function _pruneIfNeeded() {
      const keys = _allOurKeys();
      if (keys.length <= MAX_ENTRIES) return;
  
      const entries = keys.map(k => {
        try {
          const e = JSON.parse(sessionStorage.getItem(k));
          return { key: k, timestamp: e.timestamp || 0 };
        } catch (_) {
          return { key: k, timestamp: 0 };
        }
      });
  
      entries.sort((a, b) => a.timestamp - b.timestamp);
      const toRemove = Math.ceil(entries.length * 0.2);
      entries.slice(0, toRemove).forEach(e => sessionStorage.removeItem(e.key));
    }
  
    function _evictOldestHalf() {
      const keys = _allOurKeys();
      if (!keys.length) return;
  
      const entries = keys.map(k => {
        try {
          const e = JSON.parse(sessionStorage.getItem(k));
          return { key: k, timestamp: e.timestamp || 0 };
        } catch (_) {
          return { key: k, timestamp: 0 };
        }
      });
  
      entries.sort((a, b) => a.timestamp - b.timestamp);
      entries.slice(0, Math.ceil(entries.length / 2)).forEach(e => {
        sessionStorage.removeItem(e.key);
      });
    }
  
    // ============================================================
    // PUBLIC API
    // ============================================================
  
    /**
     * Retrieve a cache entry.
     * Returns null if missing, expired, or corrupt.
     */
    function get(key) {
      try {
        const raw = sessionStorage.getItem(_storageKey(key));
        if (!raw) return null;
  
        const entry = JSON.parse(raw);
  
        // Check TTL expiry
        if (entry.expires && Date.now() > entry.expires) {
          sessionStorage.removeItem(_storageKey(key));
          return null;
        }
  
        return entry; // {data, timestamp, expires, dataFingerprint}
      } catch (_) {
        return null;
      }
    }
  
    /**
     * Store a cache entry.
     *
     * @param {string} key
     * @param {*} data - anything JSON-serializable
     * @param {object} [opts]
     *   @param {number} [opts.ttl]             ms until expiry (0 = never expires, -1 = session only)
     *   @param {string} [opts.dataFingerprint] fingerprint to detect data changes
     */
    function set(key, data, opts) {
      opts = opts || {};
      const ttl = opts.ttl !== undefined ? opts.ttl : DEFAULT_TTL;
      const entry = {
        data,
        timestamp: Date.now(),
        expires: ttl > 0 ? Date.now() + ttl : 0,
        dataFingerprint: opts.dataFingerprint || currentDataFingerprint()
      };
  
      const storageKey = _storageKey(key);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(entry));
        _pruneIfNeeded();
      } catch (e) {
        // Quota exceeded - evict oldest half and retry once
        if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
          _evictOldestHalf();
          try {
            sessionStorage.setItem(storageKey, JSON.stringify(entry));
          } catch (e2) {
            // Data is too large even after eviction - skip caching silently
            if (window.dbg) dbg('sessionCache: quota exceeded, skipping cache for', key);
          }
        }
      }
    }
  
    /**
     * Check whether a cached entry is stale relative to the current data.
     * Returns true if missing or fingerprint doesn't match.
     */
    function isStale(key, currentFingerprint) {
      const entry = get(key);
      if (!entry) return true;
      const fp = currentFingerprint || currentDataFingerprint();
      return entry.dataFingerprint !== fp;
    }
  
    /**
     * Remove all entries whose keys start with the given prefix.
     * Call with no argument to clear ALL session cache entries.
     *
     * Examples:
     *   sessionCache.invalidate('wc:')   // clear all word cloud entries
     *   sessionCache.invalidate('net:')  // clear all network entries
     *   sessionCache.invalidate()        // clear everything
     */
    function invalidate(prefix) {
      const fullPrefix = SC_PREFIX + (prefix || '');
      Object.keys(sessionStorage)
        .filter(k => k.startsWith(fullPrefix))
        .forEach(k => sessionStorage.removeItem(k));
    }
  
    /** Clear all session cache entries. */
    function clear() {
      invalidate('');
    }
  
    /**
     * Convenience: build a consistent cache key for visualization endpoints.
     *
     * Examples:
     *   vizKey('wc', 'label0', false)        -> 'wc:label0:0'
     *   vizKey('net', 'all', true, 100, 2)   -> 'net:all:1:100:2'
     */
    function vizKey(prefix, className, includeStopwords, ...extras) {
      const base = `${prefix}:${className}:${includeStopwords ? '1' : '0'}`;
      return extras.length ? `${base}:${extras.join(':')}` : base;
    }
  
    /**
     * Build a cache key for text-based NLP operations (NER, sentiment).
     * Uses a hash of the text to avoid key length issues.
     */
    function textKey(prefix, text, ...extras) {
      const hash = _quickHash(String(text || ''));
      const base = `${prefix}:${hash}`;
      return extras.length ? `${base}:${extras.join(':')}` : base;
    }
  
    // ============================================================
    // EXPORT
    // ============================================================
  
    window.sessionCache = {
      get,
      set,
      isStale,
      invalidate,
      clear,
      vizKey,
      textKey,
      currentDataFingerprint,
    };
  })();