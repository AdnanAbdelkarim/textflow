/**
 * Centralized state management.
 *
 * Replaces:
 *   - 4 separate sessionStorage restore blocks (Chunks 5, 8, 9 inline)
 *   - The Object.defineProperty trace setter (Chunk 8 - production bug)
 *   - Scattered sessionStorage.removeItem calls (6+ in fileHandler)
 *
 * Exposes on window:
 *   restoreSessionData()
 *   clearLabeledSessionData()
 *   getRowsForCharts()
 *   checkIfDataHasLabels()
 *   getActiveClassFromTab(tabSelector)
 *   setLastCSVData(data, persist)
 */
(function () {
    'use strict';
  
    // ============================================================
    // SESSION DATA RESTORATION
    // ============================================================
  
    /**
     * Restore window.lastCSVData from sessionStorage if not already loaded.
     * Idempotent - safe to call multiple times.
     * Returns true if data is now available, false otherwise.
     *
     * Replaces 4 separate restore blocks in:
     *   - script.js visualizations DOMContentLoaded (Chunk 5)
     *   - script.js advanced DOMContentLoaded (Chunk 5)
     *   - visualizations.html inline (Chunk 8)
     *   - visualizations.html initializeCSVData (Chunk 8)
     *
     * @returns {boolean} true if window.lastCSVData is now populated
     */
    function restoreSessionData() {
      if (Array.isArray(window.lastCSVData) && window.lastCSVData.length > 0) {
        return true;
      }
  
      const stored = sessionStorage.getItem('lastCSVData');
      if (!stored) return false;
  
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          window.lastCSVData = parsed;
          return true;
        }
      } catch (e) {
        console.error('restoreSessionData: failed to parse lastCSVData', e);
      }
      return false;
    }
  
    window.restoreSessionData = restoreSessionData;
  
    // ============================================================
    // SESSION CLEANUP
    // ============================================================
  
    // Keys related to a labeled CSV upload that should be cleared
    // when starting fresh (new upload, mode change, etc.)
    const LABELED_SESSION_KEYS = [
      'uploadedCSV',
      'labeledData',
      'isLabeled',
      'textData',
      'preprocessingComplete',
      'labelColumns',
      'labelColumnCount',
      'lastCSVData',
      'lastCSVTextRows',
      'uniqueLabels',
      'detectedTextCol',
      'detectedLabelCol',
      'preprocessingSettings',
      'preprocessingApplied',
      'preprocessingInfo',
      'preprocessedData'
    ];
  
    /**
     * Clear all session storage related to labeled data uploads.
     * Replaces 12+ removeItem calls scattered across the file upload handler.
     */
    function clearLabeledSessionData() {
      for (let i = 0; i < LABELED_SESSION_KEYS.length; i++) {
        sessionStorage.removeItem(LABELED_SESSION_KEYS[i]);
      }
      // Also reset the in-memory copy (no Object.defineProperty hack)
      window.lastCSVData = null;
    }
  
    window.clearLabeledSessionData = clearLabeledSessionData;

    /**
     * Single source of truth for "is the currently loaded dataset labeled."
     * Every page calls this rather than testing sessionStorage inline, so the
     * labeled/unlabeled decision is made in exactly one place.
     */
    function isDatasetLabeled() {
      const labelCol = sessionStorage.getItem('detectedLabelCol');
      return labelCol !== null && labelCol !== 'null' && labelCol !== '';
    }

    window.isDatasetLabeled = isDatasetLabeled;

    /**
     * Display name for a class identifier.
     *
     * String class names are encoded to numeric indices at upload so the
     * "[n] text" corpus format keeps working; this maps an index (or a
     * "labelN" tab id) back to the name the user's own file used, so the
     * interface shows "positive" rather than "label0". Falls back to the
     * identifier itself when no mapping exists.
     */
    function classDisplayName(cls) {
      const key = String(cls).replace(/^label/, '');
      try {
        const map = JSON.parse(sessionStorage.getItem('labelNameMap') || '{}');
        if (map && Object.prototype.hasOwnProperty.call(map, key)) {
          return String(map[key]);
        }
      } catch (e) { /* fall through to the identifier */ }
      return String(cls);
    }

    window.classDisplayName = classDisplayName;

    /**
     * Standardized "this requires a labeled dataset" message for in-page
     * sections gated on isDatasetLabeled() - Label Distribution, Class Overlap.
     */
    function renderLabelRequiredMessage(container, featureName) {
      if (!container) return;
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:24px;background:#E6F1FB;border:0.5px solid #B5D4F4;border-radius:10px;margin:16px 0;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#185FA5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div>
            <div style="font-weight:600;color:#0C447C;font-size:14px;margin-bottom:2px;">${featureName || 'This feature'} requires a labeled dataset</div>
            <div style="font-size:13px;color:#185FA5;">Upload a dataset with a label column to access ${featureName ? featureName.toLowerCase() : 'this feature'}.</div>
          </div>
        </div>
      `;
    }

    /**
     * Blocking modal for entire pages that require a labeled dataset
     * (Preprocessing, Predictive Modeling). Reuses the same modal CSS
     * classes as the existing "Preprocessing Required" modal in
     * predictive.js for visual consistency.
     */
    function showLabeledDatasetRequiredModal(featureName) {
      const existing = document.querySelector('.preprocessing-required-modal');
      if (existing) existing.remove();

      const modal = document.createElement('div');
      modal.className = 'preprocessing-required-modal';
      modal.innerHTML = `
        <div class="modal-overlay"></div>
        <div class="modal-content-centered">
          <div class="modal-header">
            <span class="modal-icon"></span>
            <h3>Labeled Dataset Required</h3>
          </div>
          <div class="modal-body">
            <p>${featureName} requires a dataset with a label column.</p>
            <p>Your currently loaded dataset doesn't have one detected.</p>
          </div>
          <div class="modal-footer">
            <button class="styled-button primary" id="modalGoToUpload">
              Upload a Labeled Dataset <span>→</span>
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      document.body.style.overflow = 'hidden';

      document.getElementById('modalGoToUpload').addEventListener('click', () => {
        window.location.href = '/';
      });
    }

    window.renderLabelRequiredMessage = renderLabelRequiredMessage;
    window.showLabeledDatasetRequiredModal = showLabeledDatasetRequiredModal;
  
    // ============================================================
    // PERSISTENT WRITE
    // ============================================================
  
    /**
     * Set window.lastCSVData and optionally persist to sessionStorage.
     * Centralizes the dual-write pattern (memory + sessionStorage)
     * that was scattered across upload handlers.
     *
     * @param {Array} data
     * @param {boolean} [persist=true]
     */
    function setLastCSVData(data, persist) {
      window.lastCSVData = data;
      if (persist !== false && Array.isArray(data)) {
        try {
          sessionStorage.setItem('lastCSVData', JSON.stringify(data));
        } catch (e) {
          console.warn('setLastCSVData: failed to persist to sessionStorage', e);
        }
      }
    }
  
    window.setLastCSVData = setLastCSVData;
  
    // ============================================================
    // ROWS FOR CHARTS (moved from inline HTML)
    // ============================================================
  
    /**
     * Get the appropriate rows array for chart generation.
     * Source priority:
     *   1. window.lastCSVData (labeled CSV path)
     *   2. sessionStorage textData (unlabeled path)
     *   3. empty array
     *
     * Moved from visualizations.html inline (Chunk 8) to fix the
     * load-order coupling that made it inaccessible from script.js.
     *
     * Uses extractText() from utils.js for consistent text extraction.
     *
     * @returns {string[]}
     */
    function getRowsForCharts() {
      if (Array.isArray(window.lastCSVData) && window.lastCSVData.length > 0) {
        const out = [];
        for (let i = 0; i < window.lastCSVData.length; i++) {
          const text = window.extractText
            ? window.extractText(window.lastCSVData[i])
            : (window.lastCSVData[i].text || '');
          if (text && text.trim()) out.push(text);
        }
        return out;
      }
  
      try {
        const raw = JSON.parse(sessionStorage.getItem('textData') || '{}');
        const big = (raw && raw.text) ? String(raw.text) : '';
        if (!big) return [];
  
        // Split on blank lines OR sentence boundaries
        return big
          .split(/\n{2,}|[.!?]\s+/)
          .map(function (s) { return s.trim(); })
          .filter(Boolean);
      } catch (_) {
        return [];
      }
    }
  
    window.getRowsForCharts = getRowsForCharts;
  
    // ============================================================
    // LABEL DETECTION
    // ============================================================
  
    /**
     * Determine whether the current dataset has class labels.
     * Replaces the broken Chunk 8 version that referenced
     * window.uploadedText (never defined on window) and window.words
     * (never defined anywhere).
     *
     * @returns {boolean}
     */
    function checkIfDataHasLabels() {
      const data = window.lastCSVData;
      if (!Array.isArray(data) || data.length === 0) return false;
  
      // At least one row must have a label or class field
      const firstRow = data[0];
      const hasLabelField = ('label' in firstRow) || ('class' in firstRow) ||
                           (Array.isArray(firstRow.labelNames) && firstRow.labelNames.length > 0);
      if (!hasLabelField) return false;
  
      // Use getUniqueLabels for consistent extraction
      const labels = window.getUniqueLabels
        ? window.getUniqueLabels(data)
        : Array.from(new Set(data.map(function (r) {
            return String(r.label !== undefined ? r.label : r.class);
          }).filter(function (l) { return l && l !== 'Unlabeled' && l !== '-1'; })));
  
      // Real labels: at least 2 distinct, non-trivial values
      return labels.length >= 2;
    }
  
    window.checkIfDataHasLabels = checkIfDataHasLabels;
  
    // ============================================================
    // ACTIVE CLASS RESOLUTION
    // ============================================================
  
    /**
     * Get the currently active class from a tab container's selector.
     * Falls back to 'all' if no active tab found.
     *
     * @param {string} tabContainerSelector  e.g. '#wordCloud .class-tab.active'
     * @returns {string}
     */
    function getActiveClassFromTab(tabContainerSelector) {
      const activeTab = document.querySelector(tabContainerSelector);
      return (activeTab && activeTab.dataset && activeTab.dataset.class) || 'all';
    }
  
    window.getActiveClassFromTab = getActiveClassFromTab;
  })();