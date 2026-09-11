/**
 * Generate/retrieve a stable session ID for this browser session.
 * Defined at global scope so all modules can access it.
 * Stored in sessionStorage so it persists across page navigations within the tab.
 */
function _getSessionId() {
  let id = sessionStorage.getItem('sc_session_id');
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : ('sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36));
    sessionStorage.setItem('sc_session_id', id);
  }
  return id;
}

/**
 * Unified API module - single fetch wrapper for the entire platform.
 *
 * Replaces:
 *   - fetchJSON (defined twice in script.js)
 *   - getJSON (script.js)
 *   - postJSON (script.js)
 *   - inline fetch() calls scattered across modules
 *
 * Exposes:
 *   window.API_BASE        - base URL
 *   window.api(path)       - URL builder
 *   window.request(url, opts)  - core fetch wrapper
 *   window.apiGet(url, opts)
 *   window.apiPost(url, body, opts)
 *   window.apiPostJSON(url, body, opts)  - alias for apiPost (backward compat)
 *   window.fetchJSON(url, opts)          - alias for request (backward compat)
 *   window.getJSON(url, opts)            - alias for request (backward compat)
 *   window.postJSON(url, body, opts)     - alias for apiPost (backward compat)
 */
(function () {
  'use strict';

  // ---- Base URL resolution ----
  const API_BASE =
    (typeof window.API_BASE === 'string' && window.API_BASE.trim())
      ? window.API_BASE
      : window.location.origin;

  window.API_BASE = API_BASE;

  /**
   * Build an absolute URL from a path string.
   * @param {string} path
   * @returns {string}
   */
  window.api = function api(path) {
    return new URL(path, API_BASE).toString();
  };

  // ---- Error helpers ----

  /**
   * Returns true if an error came from an AbortController.
   */
  window.isAbortError = function isAbortError(err) {
    return !!(err && (err.name === 'AbortError' || /aborted/i.test(String(err.message || err))));
  };

  // ---- Core request function ----

  /**
   * Core fetch wrapper. Handles:
   *   - AbortController signal pass-through
   *   - Content-type validation (only parses JSON when server says so)
   *   - Safe JSON parsing (text-first to handle HTML error pages)
   *   - Structured error messages with response snippet
   *
   * @param {string} url
   * @param {RequestInit & {signal?: AbortSignal, expectJSON?: boolean}} [opts]
   * @returns {Promise<any>}
   */
  async function request(url, opts = {}) {
    const { signal, expectJSON = true, ...fetchOpts } = opts;

    // Auto-inject session ID for backend cache keying.
    // Merged here so it doesn't affect the opts object passed by callers.
    const sessionHeaders = {
      'X-Session-ID': _getSessionId(),
      ...(fetchOpts.headers || {})
    };

    const response = await fetch(url, {
      ...fetchOpts,
      headers: sessionHeaders,
      signal,
      cache: fetchOpts.cache || 'no-store'
    });

    const raw = await response.text();

    let data = null;
    const contentType = response.headers.get('content-type') || '';
    const isJSON = contentType.includes('application/json');

    if (raw) {
      if (isJSON || expectJSON) {
        try {
          data = JSON.parse(raw);
        } catch (e) {
          // JSON parse failed - keep raw for error reporting below
          data = null;
        }
      } else {
        data = raw;
      }
    }

    if (!response.ok) {
      const detail =
        (data && (data.detail || data.error || data.message)) ||
        (typeof raw === 'string' ? raw : '') ||
        response.statusText;
      const snippet = String(detail).slice(0, 300);
      const error = new Error(`${url} ${response.status}: ${snippet}`);
      error.status = response.status;
      error.url = url;
      error.responseData = data;
      throw error;
    }

    if (expectJSON && data === null && raw) {
      const error = new Error(
        `Expected JSON from ${url} but got ${contentType || 'unknown content-type'}: ${raw.slice(0, 200)}`
      );
      error.url = url;
      throw error;
    }

    return data;
  }

  // ---- Public API ----

  window.request = request;

  /**
   * GET request.
   * @param {string} url
   * @param {RequestInit & {signal?: AbortSignal}} [opts]
   */
  window.apiGet = function apiGet(url, opts = {}) {
    return request(url, { ...opts, method: 'GET' });
  };

  /**
   * POST request with JSON body.
   * @param {string} url
   * @param {any} body
   * @param {RequestInit & {signal?: AbortSignal}} [opts]
   */
  window.apiPost = function apiPost(url, body, opts = {}) {
    return request(url, {
      ...opts,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      },
      body: JSON.stringify(body)
    });
  };

  // ---- Backward-compatible aliases ----
  // These exist so existing code in script.js keeps working during the migration.
  // They will be removed in Phase 5 once all callers use the new names.

  window.fetchJSON = function fetchJSON(url, opts = {}) {
    return request(url, opts);
  };

  window.getJSON = function getJSON(url, opts = {}) {
    return request(url, opts);
  };

  window.postJSON = function postJSON(url, body, opts = {}) {
    // Old signature: postJSON(url, payload, { signal })
    return window.apiPost(url, body, opts);
  };

  window.apiPostJSON = window.apiPost;
  // Expose session ID getter for modules that need it directly
  window.getSessionId = _getSessionId;
  })();