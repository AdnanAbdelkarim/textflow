/**
 * Core utilities - canonical stopwords and shared data helpers.
 *
 * Replaces 4 stopwords Set definitions (Chunks 1, 5, 8, 10) with one canonical Set.
 * Replaces inline class filtering scattered across 8+ locations.
 * Replaces inline label extraction scattered across 4+ locations.
 *
 * Exposes on window:
 *   STOPWORDS               - canonical Set
 *   stopwords               - alias for backward compat
 *   filterRowsByClass(data, className)
 *   getUniqueLabels(data)
 *   slimRows(rows, maxRows, maxChars)
 *   extractText(row)
 *   normalizeClassName(className)
 *   downloadVisualization(target, filename)
 *   axisTitle(text)
 *   debounce(fn, ms)
 */
(function () {
    'use strict';
  
    // ============================================================
    // CANONICAL STOPWORDS
    // ============================================================
    // Single deduplicated source of truth. Built from Chunk 1's list
    // (the largest of the four) with duplicates removed.
    // All stopword filtering across the platform uses this Set.
  
    const STOPWORDS = new Set([
      'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
      'any', 'are', 'as', 'at',
      'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
      'can',
      'did', 'do', 'does', 'doing', 'don', 'down', 'during',
      'each',
      'few', 'for', 'from', 'further',
      'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him',
      'himself', 'his', 'how',
      'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
      'just',
      'me', 'more', 'most', 'my', 'myself',
      'no', 'nor', 'not', 'now',
      'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves',
      'out', 'over', 'own',
      'same', 'she', 'should', 'so', 'some', 'such',
      'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
      'these', 'they', 'this', 'those', 'through', 'to', 'too',
      'under', 'until', 'up',
      'very',
      'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
      'why', 'will', 'with', 'would',
      'you', 'your', 'yours', 'yourself', 'yourselves'
    ]);
  
    window.STOPWORDS = STOPWORDS;
    // Backward-compat alias - existing code uses `stopwords` (lowercase)
    window.stopwords = STOPWORDS;
  
    // ============================================================
    // TEXT EXTRACTION
    // ============================================================
    // Centralizes the row-to-text logic that was inlined in 8+ places
    // with subtle variations (some tried `email`, some tried `Message`,
    // some tried `body`, etc).
  
    /**
     * Extract a text string from a row regardless of which field it uses.
     * Handles strings, objects with various text field names, and edge cases.
     *
     * @param {string|object} row
     * @returns {string}
     */
    function extractText(row) {
      if (typeof row === 'string') return row;
      if (!row || typeof row !== 'object') return '';
  
      const text =
        row.text ||
        row.email ||
        row.Message ||
        row.message ||
        row.body ||
        row.content ||
        (row.data && row.data.text) ||
        '';
  
      if (text && typeof text === 'object') {
        try {
          return JSON.stringify(text);
        } catch (_) {
          return '';
        }
      }
      return String(text || '');
    }
  
    window.extractText = extractText;
  
    // ============================================================
    // ROW SLIMMING
    // ============================================================
    // Extends Chunk 1's slimRows to handle object rows uniformly.
    // Replaces 3 inline normalization blocks (Chunks 1, 4, 5).
  
    /**
     * Trim and cap an array of rows for transmission to the backend.
     * Accepts strings or objects, extracts text, slices to maxChars,
     * and limits to maxRows.
     *
     * @param {Array<string|object>} rows
     * @param {number} [maxRows=2000]
     * @param {number} [maxChars=2000]
     * @returns {string[]}
     */
    function slimRows(rows, maxRows = 2000, maxChars = 2000) {
      if (!Array.isArray(rows)) return [];
      const out = [];
      const limit = Math.min(rows.length, maxRows);
      for (let i = 0; i < limit; i++) {
        const text = extractText(rows[i]);
        if (text && text.trim()) {
          out.push(text.length > maxChars ? text.slice(0, maxChars) : text);
        }
      }
      return out;
    }
  
    window.slimRows = slimRows;
  
    // ============================================================
    // CLASS NAME NORMALIZATION
    // ============================================================
    // Many places strip the "label" prefix from class names like
    // "label0" -> "0" before comparing to numeric row labels. This
    // centralizes that logic.
  
    /**
     * Strip "label" prefix from a class name if present.
     * @param {string} className
     * @returns {string}
     */
    function normalizeClassName(className) {
      if (className == null) return '';
      const str = String(className);
      return str.startsWith('label') ? str.slice(5) : str;
    }
  
    window.normalizeClassName = normalizeClassName;
  
    // ============================================================
    // CLASS FILTERING (eliminates 8+ inline copies)
    // ============================================================
  
    /**
     * Filter rows belonging to a specific class.
     * Handles all known data shapes:
     *   - Multi-label format (row.labelNames array)
     *   - Single-label format with .label key
     *   - Legacy format with .class key
     *   - "all" shortcut returns all rows
     *
     * @param {Array<object>} data - the lastCSVData array
     * @param {string} className - class identifier (e.g. "all", "label0", "spam")
     * @returns {Array<object>}
     */
    function filterRowsByClass(data, className) {
      if (!Array.isArray(data) || !data.length) return [];
      if (className == null || className === 'all') return data.slice();
  
      const target = normalizeClassName(className);
  
      return data.filter(function (row) {
        // Multi-label format: row has labelNames array
        if (Array.isArray(row.labelNames) && row.labelNames.length) {
          return row.labelNames.includes(className);
        }
        // Single-label format: prefer .label, fall back to .class
        const rowLabel = row.label !== undefined ? row.label : row.class;
        return String(rowLabel == null ? 'Unlabeled' : rowLabel) === target;
      });
    }
  
    window.filterRowsByClass = filterRowsByClass;
  
    // ============================================================
    // UNIQUE LABEL EXTRACTION (eliminates 4+ inline copies)
    // ============================================================
  
    /**
     * Extract sorted unique class labels from a dataset.
     * Handles multi-label, single-label, and mixed-key formats.
     * Filters out null, undefined, "-1", and empty values.
     *
     * @param {Array<object>} data
     * @returns {string[]} sorted unique label strings
     */
    function getUniqueLabels(data) {
      if (!Array.isArray(data) || !data.length) return [];
  
      const labels = new Set();
  
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
  
        // Multi-label format
        if (Array.isArray(row.labelNames) && row.labelNames.length) {
          for (let j = 0; j < row.labelNames.length; j++) {
            const name = row.labelNames[j];
            if (name != null && name !== '' && name !== '-1') {
              labels.add(String(name));
            }
          }
          continue;
        }
  
        // Single-label: prefer .label, fall back to .class
        const value = row.label !== undefined ? row.label : row.class;
        if (value == null || value === '' || value === '-1') continue;
  
        if (Array.isArray(value)) {
          for (let j = 0; j < value.length; j++) {
            if (value[j] != null && value[j] !== '' && value[j] !== '-1') {
              labels.add(String(value[j]));
            }
          }
        } else {
          labels.add(String(value));
        }
      }
  
      // Numeric-aware sort: "0", "1", "10" sort numerically when all numeric
      const arr = Array.from(labels);
      const allNumeric = arr.every(function (s) { return !isNaN(Number(s)); });
      arr.sort(allNumeric
        ? function (a, b) { return Number(a) - Number(b); }
        : function (a, b) { return a.localeCompare(b); }
      );
      return arr;
    }
  
    window.getUniqueLabels = getUniqueLabels;
  
    // ============================================================
    // DOWNLOAD UTILITIES (merges Chunks 1 & 4 download functions)
    // ============================================================
  
    /**
     * Download a visualization as PNG.
     * Accepts:
     *   - canvas element id (Chart.js charts)
     *   - container id holding an SVG
     *   - direct DOM element (canvas or container)
     *
     * Replaces:
     *   - downloadChartAsPNG (Chunk 1)
     *   - downloadCanvasAsPNG (Chunk 4)
     *   - downloadCoverageChart (Chunk 4)
     *   - downloadSVGAsPNG (Chunk 4)
     *
     * @param {string|HTMLElement} target - element id or DOM node
     * @param {string} filename
     */
    function downloadVisualization(target, filename) {
      const node = (typeof target === 'string')
        ? document.getElementById(target) || document.querySelector(target)
        : target;
  
      if (!node) {
        console.error('downloadVisualization: target not found:', target);
        return;
      }
  
      // Case 1: target is a canvas
      if (node.tagName === 'CANVAS') {
        _downloadCanvas(node, filename);
        return;
      }
  
      // Case 2: target contains a canvas (e.g. Chart.js chart wrapper)
      const innerCanvas = node.querySelector('canvas');
      if (innerCanvas) {
        _downloadCanvas(innerCanvas, filename);
        return;
      }
  
      // Case 3: target is or contains an SVG
      const svg = (node.tagName === 'svg' || node.tagName === 'SVG') ? node : node.querySelector('svg');
      if (svg) {
        _downloadSVG(svg, filename);
        return;
      }
  
      console.error('downloadVisualization: no canvas or SVG found in target');
    }
  
    function _downloadCanvas(canvas, filename) {
      // Use 2x scale for high-DPI output
      const scale = 2;
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width * scale;
      tmp.height = canvas.height * scale;
      const ctx = tmp.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(canvas, 0, 0);
      tmp.toBlob(function (blob) {
        _triggerDownload(URL.createObjectURL(blob), filename);
      });
    }
  
    function _downloadSVG(svg, filename) {
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svg);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
  
      img.onload = function () {
        canvas.width = svg.width.baseVal.value || svg.clientWidth || 1200;
        canvas.height = svg.height.baseVal.value || svg.clientHeight || 700;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        _triggerDownload(canvas.toDataURL('image/png'), filename);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        console.error('downloadVisualization: failed to render SVG');
      };
      img.src = url;
    }
  
    function _triggerDownload(href, filename) {
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  
    window.downloadVisualization = downloadVisualization;
  
    // Backward-compat aliases (existing HTML may have inline onclick handlers)
    window.downloadChartAsPNG = downloadVisualization;
    window.downloadCanvasAsPNG = downloadVisualization;
    window.downloadSVGAsPNG = downloadVisualization;
  
    // ============================================================
    // CHART.JS CONFIG FACTORIES
    // ============================================================
  
    /**
     * Build a Chart.js axis title config object.
     * Replaces 4+ identical inline blocks across coverage and label chart code.
     *
     * @param {string} text
     * @returns {object}
     */
    function axisTitle(text) {
      return {
        display: true,
        text: text,
        color: '#000',
        font: { size: 18, weight: 'bold' }
      };
    }
  
    window.axisTitle = axisTitle;
  
    // ============================================================
    // DEBOUNCE
    // ============================================================
  
    /**
     * Returns a debounced version of fn.
     * @param {Function} fn
     * @param {number} ms
     */
    function debounce(fn, ms) {
      let timer = null;
      return function () {
        const args = arguments;
        const ctx = this;
        clearTimeout(timer);
        timer = setTimeout(function () {
          fn.apply(ctx, args);
        }, ms);
      };
    }
  
    window.debounce = debounce;
  })();