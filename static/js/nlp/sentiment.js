/**
 * Sentiment analysis module.
 *
 * Backend: /sentiment endpoint
 * Lexicon: /static/js/afinn.json (lazy-loaded once via loadAFINN)
 */
(function () {
    'use strict';
  
    // AFINN lexicon - populated by loadAFINN() on first call
    let afinnLexicon = {};
    let _afinnPromise = null;
  
    /**
     * Lazy-load the AFINN sentiment lexicon. Returns a cached promise on
     * subsequent calls so the file is only fetched once per page load.
     * See F38.
     *
     * @returns {Promise<Object>} resolves to the AFINN word->score map
     */
    function loadAFINN() {
      if (_afinnPromise) return _afinnPromise;
      _afinnPromise = fetch('/static/js/afinn.json')
        .then(res => {
          if (!res.ok) throw new Error(`AFINN fetch failed: ${res.status}`);
          return res.json();
        })
        .then(data => {
          afinnLexicon = data;
          // Mirror onto window for any legacy callers that read it directly
          window.afinnLexicon = data;
          return data;
        })
        .catch(err => {
          console.error('AFINN lexicon load failed:', err);
          _afinnPromise = null; // allow retry
          throw err;
        });
      return _afinnPromise;
    }
  
    /**
     * Display sentence-level sentiment analysis with filtering.
     * Posts text to /sentiment and renders sentence-by-sentence breakdown.
     *
     * @param {string} text
     */
    async function displaySentenceLevelSentiment(text) {
      const container = document.getElementById('sentimentResults');
      if (!container) return;
  
      container.innerHTML = '<em>Analyzing sentiment...</em>';
  
      try {
        const response = await fetch('/sentiment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
  
        const result = await response.json();
        if (result.error) throw new Error(result.error);
  
        const results = result.results;
        if (!results || !results.length) {
          container.innerHTML = '<i>No valid sentences found for analysis.</i>';
          return;
        }
  
        // Calculate distribution
        const sentimentCounts = {
          Positive: results.filter(r => r.sentiment === 'Positive').length,
          Negative: results.filter(r => r.sentiment === 'Negative').length,
          Neutral:  results.filter(r => r.sentiment === 'Neutral').length
        };
  
        const filterHTML = `
          <div class="sentiment-summary">
            <div class="sentiment-counts">
              <span class="sentiment-chip"><strong>Positive:</strong> <span style="color: #1e6b4f; font-weight: 600;">${sentimentCounts.Positive}</span></span>
              <span class="sentiment-chip"><strong>Negative:</strong> <span style="color: #a32b22; font-weight: 600;">${sentimentCounts.Negative}</span></span>
              <span class="sentiment-chip"><strong>Neutral:</strong> <span style="color: #5a6169; font-weight: 600;">${sentimentCounts.Neutral}</span></span>
            </div>
            <div class="sentiment-filter-wrap">
              <select id="sentiment-filter" style="
                padding: 8px 36px 8px 14px;
                border: 2px solid #2d6ca8;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                background: linear-gradient(to bottom, #ffffff 0%, #fafaf8 100%);
                color: #1b4470;
                box-shadow: 0 2px 4px rgba(37, 99, 235, 0.1);
                appearance: none;
                -webkit-appearance: none;
                -moz-appearance: none;
                transition: all 0.2s ease;
              ">
                <option value="all">All Sentiments</option>
                <option value="Positive">Positive Only</option>
                <option value="Negative">Negative Only</option>
                <option value="Neutral">Neutral Only</option>
              </select>
              <svg style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; width: 16px; height: 16px;" fill="none" stroke="#2d6ca8" stroke-width="2" viewBox="0 0 24 24">
                <path d="M19 9l-7 7-7-7"/>
              </svg>
            </div>
          </div>`;
  
        let sentenceHTML = '';
        results.forEach((r) => {
          let displayText = r.text;
          let extractedLabel = r.label;
          const labelMatch = displayText.match(/^\[([^\]]+)\]\s*(.*)$/);
          if (labelMatch) {
            extractedLabel = labelMatch[1];
            displayText = labelMatch[2];
          }
  
          const labelName = extractedLabel != null
                && typeof window.classDisplayName === 'function'
            ? window.classDisplayName(extractedLabel)
            : extractedLabel;

          const summary = extractedLabel != null
            ? `Sentence ${r.sentence_id} (Label: ${labelName}) - ${r.sentiment}`
            : `Sentence ${r.sentence_id} - ${r.sentiment}`;
  
          sentenceHTML += `
            <details class="sentence-block sentiment-item" data-sentiment="${r.sentiment}" style="margin-bottom: 8px; border: 1px solid #e3e5e2; border-radius: 6px; padding: 8px; background: white;">
              <summary style="color:${r.color}; font-weight:bold; cursor: pointer; padding: 4px;">${summary}</summary>
              <div style="margin-left: 1em; margin-top: 8px; padding: 8px; background: #fafaf8; border-radius: 4px;">
                <p style="margin: 0 0 8px 0; line-height: 1.6;">${displayText}</p>
                <span style="color:${r.color}; font-size: 13px;"><em>Score:</em> <strong>${r.score}</strong></span>
              </div>
            </details>`;
        });
  
        container.innerHTML = `
          <details class="sentiment-section">
            <summary style="font-weight:bold; color:#1f4e79; font-size: 1.1em; cursor: pointer; padding: 10px; background: #f9f9f9; border-radius: 6px;">
              Sentiment Analysis - ${results.length} sentences analyzed
            </summary>
            <div style="background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-top: 10px;">
              ${filterHTML}
              <div id="sentiment-list" style="max-height: 600px; overflow-y: auto; padding-right: 8px;">
                ${sentenceHTML}
              </div>
            </div>
          </details>`;
  
        // Filter dropdown handler
        const filterSelect = document.getElementById('sentiment-filter');
        if (filterSelect) {
          filterSelect.addEventListener('change', (e) => {
            const selected = e.target.value;
            document.querySelectorAll('.sentiment-item').forEach(item => {
              item.style.display = (selected === 'all' || item.dataset.sentiment === selected)
                ? 'block' : 'none';
            });
          });
        }
      } catch (error) {
        if (!document.contains(container)) return;
        container.innerHTML = `<span style="color:red;">Error: ${error.message}</span>`;
      }
    }
  
    // Expose on window
    window.loadAFINN = loadAFINN;
    window.displaySentenceLevelSentiment = displaySentenceLevelSentiment;
    // Provide a getter for legacy code that reads window.afinnLexicon directly
    Object.defineProperty(window, 'afinnLexicon', {
      get: () => afinnLexicon,
      set: (v) => { afinnLexicon = v; },
      configurable: true
    });
  })();