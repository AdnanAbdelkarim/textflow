/**
 * Named Entity Recognition (NER) module.
 *
 * Backend: /api/extract_entities (called by getEntitiesFromText)
 *          /ner (called by displayNER for full text analysis)
 *
 * State:
 *   - currentNERMethod: which method to use (spacy/nltk/both)
 *   - currentNERText: last analyzed text, used by refreshNER()
 */
(function () {
    'use strict';
    let _pageUnloading = false;
    window.addEventListener('pagehide', () => { _pageUnloading = true; });
  
    // ---- NER label name lookup table ----
    const NER_LABEL_NAMES = {
      PERSON: 'Person',
      ORG: 'Organization',
      GPE: 'Country/City/State',
      LOC: 'Location',
      NORP: 'Nationality/Religious/Political group',
      PRODUCT: 'Product',
      EVENT: 'Event',
      WORK_OF_ART: 'Work of Art',
      LAW: 'Law',
      LANGUAGE: 'Language',
      DATE: 'Date',
      TIME: 'Time',
      MONEY: 'Money',
      QUANTITY: 'Quantity',
      PERCENT: 'Percent',
      CARDINAL: 'Cardinal number',
      ORDINAL: 'Ordinal number',
      FAC: 'Facility'
    };
  
    // ---- Module-level state ----
    let currentNERMethod = 'both';
    let currentNERText = '';
  
    /**
     * Fetch named entities for a single text string.
     * Used by word cloud preprocessing (NER-aware tokenization).
     *
     * @param {string} text
     * @returns {Promise<Array<{type: string, value: string, source?: string}>>}
     */
    async function getEntitiesFromText(text) {
      try {
        const response = await fetch('/api/extract_entities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await response.json();
        return data.entities || [];
      } catch (err) {
        console.error('Entity extraction failed:', err);
        return [];
      }
    }
  
    /**
     * Replace multi-word entity spans in text with underscore-joined tokens
     * so that tokenization treats "New York" as one token "New_York".
     *
     * @param {string} text
     * @param {Array<{text: string}>} entities
     * @returns {string}
     */
    function processTextWithNER(text, entities) {
      let processedText = text;
      const sortedEntities = entities
        .filter(e => e.text && e.text.includes(' '))
        .sort((a, b) => b.text.length - a.text.length);
  
      sortedEntities.forEach(entity => {
        const original = entity.text;
        const replaced = original.replace(/\s+/g, '_');
        const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
        processedText = processedText.replace(regex, replaced);
      });
  
      return processedText;
    }
  
    /**
     * Update the active NER method based on radio button selection.
     * Triggers automatic refresh if a previous text exists.
     */
    function updateNERMethod() {
      const selected = document.querySelector('input[name="nerMethod"]:checked');
      if (!selected) return;
      currentNERMethod = selected.value;
      if (currentNERText) {
        displayNER(currentNERText);
      }
    }
  
    /**
     * Re-run NER on the last analyzed text.
     */
    function refreshNER() {
      if (currentNERText) {
        displayNER(currentNERText);
      }
    }
  
    /**
     * Run named entity recognition on the provided text and render results
     * as a grouped table by entity type.
     *
     * If the caller passes a non-empty string, it's used as-is.
     * If text is empty AND lastCSVData exists, falls back to the labeled CSV
     * data as the analysis source - see F27.
     *
     * @param {string} text
     */
    async function displayNER(text) {
      const container = document.getElementById('nerResults');
      if (!container) return;
  
      container.innerHTML = '<em>Analyzing named entities...</em>';
      currentNERText = text;
  
      try {
        // If caller provided non-empty text, respect it.
        // Otherwise fall back to lastCSVData (labeled CSV path) - see F27.
        const callerProvidedText = typeof text === 'string' && text.trim().length > 0;
  
        if (!callerProvidedText && Array.isArray(window.lastCSVData) && window.lastCSVData.length > 0) {
          const textsToAnalyze = window.lastCSVData
            .map(row => row.text || '')
            .filter(Boolean);
          text = textsToAnalyze.join('\n\n');
        }

        // Send complete rows (not truncated) so NER has full sentence context.
        // NER quality depends heavily on complete sentences - truncating mid-sentence
        // causes the model to misclassify entities due to missing context.
        if (Array.isArray(window.lastCSVData) && window.lastCSVData.length > 0) {
          // Take complete rows, joining until we reach the char limit
          const NER_CHAR_LIMIT = 15000;
          const lines = [];
          let total = 0;
          for (const row of window.lastCSVData) {
            const rowText = (row.text || '').trim();
            if (!rowText) continue;
            if (total + rowText.length > NER_CHAR_LIMIT) break;
            lines.push(rowText);
            total += rowText.length;
          }
          text = lines.join('\n\n');

          const nerContainer = document.getElementById('nerResults');
          if (nerContainer && lines.length < window.lastCSVData.length) {
            const note = document.createElement('div');
            note.style.cssText = 'font-size:11px;color:#9ca3af;margin-bottom:6px;';
            note.textContent = `Analyzed ${lines.length} of ${window.lastCSVData.length} documents.`;
            nerContainer.prepend(note);
          }
        }
  
        const method = currentNERMethod;
        const methodNames = { spacy: 'spaCy', nltk: 'NLTK', both: 'spaCy + NLTK' };
        container.innerHTML = `<em>Analyzing named entities using ${methodNames[method]}...</em>`;
  
        // 60s timeout - spaCy transformer can be slow on CPU for large texts
        const nerCtrl = new AbortController();
        const nerTimeout = setTimeout(() => nerCtrl.abort(), 60000);

        const response = await fetch('/ner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, ner_method: method }),
          signal: nerCtrl.signal
        });
        clearTimeout(nerTimeout);
  
        const rawText = await response.text();
        let result = {};
        try { result = rawText ? JSON.parse(rawText) : {}; } catch (_) { result = {}; }
  
        if (!response.ok) {
          const msg = (result && (result.detail || result.error)) || rawText || 'NER request failed.';
          throw new Error(msg);
        }
  
        const raw = (result && result.entities) ? result.entities : [];
        const entities = raw.map(e => ({
          type: e.type || e.label || e.label_ || 'ENTITY',
          value: e.value || e.text || '',
          source: e.source || 'unknown'
        }));
  
        if (!entities.length) {
          container.innerHTML = `<i>No named entities found using ${methodNames[method]}.</i>`;
          return;
        }
  
        // Group entities by category
        const grouped = {
          ORG: [], PERSON: [], GPE: [], DATE: [], CARDINAL_MONEY: [],
          LOC: [], FACILITY: [], PRODUCT: [], EVENT: [], OTHER: []
        };
  
        entities.forEach(e => {
          const type = e.type.toUpperCase();
          if (type.includes('ORG')) grouped.ORG.push(e.value);
          else if (type.includes('PERSON') || type === 'PER') grouped.PERSON.push(e.value);
          else if (type.includes('GPE')) grouped.GPE.push(e.value);
          else if (type.includes('DATE') || type.includes('TIME')) grouped.DATE.push(e.value);
          else if (type.includes('CARDINAL') || type.includes('MONEY') || type.includes('PERCENT') || type.includes('QUANTITY')) grouped.CARDINAL_MONEY.push(e.value);
          else if (type.includes('LOC') && !type.includes('GPE')) grouped.LOC.push(e.value);
          else if (type.includes('FAC')) grouped.FACILITY.push(e.value);
          else if (type.includes('PRODUCT')) grouped.PRODUCT.push(e.value);
          else if (type.includes('EVENT')) grouped.EVENT.push(e.value);
          else grouped.OTHER.push(e.value);
        });
  
        const allColumns = [
          { key: 'ORG', label: 'Organization' },
          { key: 'PERSON', label: 'Person' },
          { key: 'GPE', label: 'Location (GPE)' },
          { key: 'DATE', label: 'Date/Time' },
          { key: 'CARDINAL_MONEY', label: 'Cardinal/Money' },
          { key: 'LOC', label: 'Location' },
          { key: 'FACILITY', label: 'Facility' },
          { key: 'PRODUCT', label: 'Product' },
          { key: 'EVENT', label: 'Event' }
        ];
  
        const activeColumns = [];
        const columnData = [];
  
        allColumns.forEach(col => {
          if (grouped[col.key].length === 0) return;
          const countMap = {};
          grouped[col.key].forEach(item => {
            countMap[item] = (countMap[item] || 0) + 1;
          });
          const deduped = Object.entries(countMap).map(([value, count]) => {
            return count > 1 ? `${value} (×${count})` : value;
          });
          activeColumns.push(col);
          columnData.push(deduped);
        });
  
        if (activeColumns.length === 0) {
          container.innerHTML = `<i>No named entities found using ${methodNames[method]}.</i>`;
          return;
        }
  
        const maxRows = Math.max(...columnData.map(col => col.length));
        const methodDisplay = ` (${methodNames[method]})`;
  
        let tableHTML = `
          <details class="ner-block" open>
            <summary style="font-weight:bold; color:#0074cc; font-size: 1.1em; cursor: pointer; padding: 10px; background: #f9f9f9; border-radius: 6px;">
              Named Entity Recognition${methodDisplay} - ${entities.length} entities found
            </summary>
            <div style="max-height: 400px; overflow-y: auto; overflow-x: hidden; margin-top: 15px; border: 1px solid #ddd; border-radius: 6px;">
              <table style="width: 100%; border-collapse: collapse; table-layout: fixed;">
                <thead style="position: sticky; top: 0; background: #0074cc; z-index: 10;">
                  <tr>`;
  
        activeColumns.forEach(col => {
          tableHTML += `<th style="padding: 8px; border-bottom: 2px solid #ddd; text-align: left; font-weight: 700; color: white; word-wrap: break-word; white-space: normal;">${col.label}</th>`;
        });
  
        tableHTML += `</tr></thead><tbody>`;
  
        for (let i = 0; i < maxRows; i++) {
          tableHTML += '<tr>';
          columnData.forEach(colData => {
            const value = colData[i] || '';
            tableHTML += `<td style="padding: 8px; border-bottom: 1px solid #eee; word-wrap: break-word; white-space: normal;">${value}</td>`;
          });
          tableHTML += '</tr>';
        }
  
        tableHTML += `</tbody></table></div></details>`;
        container.innerHTML = tableHTML;
  
        // Hover effect via event delegation (replaces inline onmouseover/onmouseout)
        const tbody = container.querySelector('tbody');
        if (tbody) {
          tbody.addEventListener('mouseover', (e) => {
            const tr = e.target.closest('tr');
            if (tr && tbody.contains(tr)) tr.style.background = '#f5f5f5';
          });
          tbody.addEventListener('mouseout', (e) => {
            const tr = e.target.closest('tr');
            if (tr && tbody.contains(tr)) tr.style.background = 'white';
          });
        }
      } catch (error) {
        // If the container is no longer in the DOM, user navigated away - ignore silently
        if (!document.contains(container)) return;
  
        // Real timeout (spaCy transformer is slow on large text)
        if (error.name === 'AbortError') {
          container.innerHTML = `
            <i style="color:#92400e;">
              NER timed out. Your text may be too long for real-time analysis.<br>
              Try uploading a smaller sample, or switch to NLTK-only mode (faster).
            </i>`;
          return;
        }
  
        container.innerHTML = `<span style="color:red;">Error: ${error.message}</span>`;
        console.error('NER error:', error);
      }
    }
  
    // Expose on window
    window.NER_LABEL_NAMES = NER_LABEL_NAMES;
    window.getEntitiesFromText = getEntitiesFromText;
    window.processTextWithNER = processTextWithNER;
    window.updateNERMethod = updateNERMethod;
    window.refreshNER = refreshNER;
    window.displayNER = displayNER;
  })();