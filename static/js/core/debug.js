/**
 * Centralized debug logging.
 *
 * Set DEBUG via:
 *   - Running on localhost (auto-enabled)
 *   - Adding ?debug=1 to the URL
 *   - Setting localStorage.debug = "1"
 *
 * In production, all dbg() calls are no-ops. This consolidates ~40 scattered
 * console.log calls under a single switch - see F7, F58.
 *
 * Usage:
 *   dbg("message", obj);          // info
 *   dbg.warn("warning", obj);     // warning (always shown)
 *   dbg.error("error", obj);      // error (always shown)
 *   dbg.group("label", () => {    // grouped logs (collapsed by default)
 *     dbg(...);
 *   });
 */
(function () {
    'use strict';
  
    const DEBUG = (function () {
      try {
        if (window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1') return true;
        if (window.location.search.includes('debug=1')) return true;
        if (localStorage.getItem('debug') === '1') return true;
      } catch (_) {}
      return false;
    })();
  
    // Primary: info-level logging (silent in production)
    function dbg() {
      if (!DEBUG) return;
      console.log.apply(console, arguments);
    }
  
    // Warnings always shown - they indicate something to investigate
    dbg.warn = function () {
      console.warn.apply(console, arguments);
    };
  
    // Errors always shown - they indicate something broken
    dbg.error = function () {
      console.error.apply(console, arguments);
    };
  
    // Grouped logging - collapsed by default in DevTools
    dbg.group = function (label, fn) {
      if (!DEBUG) {
        if (typeof fn === 'function') fn();
        return;
      }
      console.groupCollapsed(label);
      try {
        if (typeof fn === 'function') fn();
      } finally {
        console.groupEnd();
      }
    };
  
    // Conditional logging - only logs if predicate is truthy
    dbg.cond = function (predicate, ...args) {
      if (DEBUG && predicate) console.log(...args);
    };
  
    window.DEBUG = DEBUG;
    window.dbg = dbg;
  })();