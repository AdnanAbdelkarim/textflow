/**
 * Topic modeling display module.
 *
 * Backend: /api/topic_modeling
 * Renders pie chart for topic distribution + document-topic mapping list
 * for labeled data.
 */
(function () {
    'use strict';

    // Set when the page is unloading (user navigated away)
    // More reliable than document.contains() during navigation
    let _pageUnloading = false;
    window.addEventListener('pagehide', () => { _pageUnloading = true; });
  
    function escapeHTML(s) {
      return String(s).replace(/[&<>"']/g, (m) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[m]));
    }

    /**
     * Display topic modeling results - pie chart for the labeled case,
     * pie chart with relevance threshold for the unlabeled case.
     *
     * @param {string} text
     */
    async function displayTopics(text) {
      const container = document.getElementById('topicModeling');
      if (!container) return;

      container.innerHTML = '<em>Analyzing topics...</em>';

      try {
        // Resolve rows from multiple potential sources
        let rows = (window.lastCSVData || [])
          .map(r => (r.text || r.Message || r.body || r.content || '').toString())
          .filter(s => s.trim());

        if (!rows.length) {
          try {
            const cached = JSON.parse(sessionStorage.getItem('lastCSVTextRows') || '[]');
            rows = Array.isArray(cached) ? cached.filter(s => s && s.trim()) : [];
          } catch (_) {
            rows = [];
          }
        }

        if (!rows.length && text) {
          rows = text.split(/\r?\n\r?\n|\r?\n/).map(s => s.trim()).filter(Boolean);
        }

        if (!rows.length) {
          container.innerHTML = '<em>No text found. Upload a file on the Input tab first.</em>';
          return;
        }

        // Detect labeled state
        let isLabeled = false;
        const detectedLabelCol = sessionStorage.getItem('detectedLabelCol');
        if (detectedLabelCol && detectedLabelCol !== 'null' && detectedLabelCol !== '') {
          isLabeled = true;
        } else if (window.lastCSVData && window.lastCSVData.length > 0) {
          const firstRow = window.lastCSVData[0];
          isLabeled = ('label' in firstRow) || ('Label' in firstRow) ||
                      ('class' in firstRow) || ('Class' in firstRow);
        }

        // Cap row count and per-row length without merging - see F54
        const MAX_ROWS = 2000;
        const MAX_CHARS_PER_ROW = 2000;
        const safeRows = rows
          .slice(0, MAX_ROWS)
          .map(s => (s.length > MAX_CHARS_PER_ROW ? s.slice(0, MAX_CHARS_PER_ROW) : s));

        const data = await fetchJSON('/api/topic_modeling', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows: safeRows,
            topN: 10,
            includeStopwords: false,
            isLabeled: isLabeled
          })
        });

        const topics  = Array.isArray(data.topics)  ? data.topics  : [];
        const mapping = Array.isArray(data.mapping) ? data.mapping : [];

        if (!topics.length) {
          container.innerHTML = '<em>No topics found.</em>';
          return;
        }

        if (isLabeled) {
          _renderLabeledTopics(container, topics, mapping);
        } else {
          _renderUnlabeledTopics(container, topics);
        }
      } catch (err) {
        console.error('Topic modeling error:', err);
        let msg = err?.message || String(err);
        if (msg.includes('max_df')) {
          msg = 'The uploaded file has too few valid documents or unique words. Please upload a file with more text content.';
        } else if (msg.includes('400')) {
          msg = 'There was a problem analyzing the text. Please check your file format or try again.';
        }
        // User navigated away - ignore silently
        if (_pageUnloading || !document.contains(container)) return;
        container.innerHTML = `<span style="color:red;">${escapeHTML(msg)}</span>`;
      }
    }
  
    /**
     * Render topics for labeled data - pie chart + document-topic mapping list.
     */
    function _renderLabeledTopics(container, topics, mapping) {
      // Group identical labels (case-insensitive) and sum their percentages
      const groupedMap = {};
      topics.forEach((t, idx) => {
        const id = (t.id != null) ? t.id : (idx + 1);
        const pct = Number(t.percent ?? 0);
        const label = (t.label && String(t.label).trim()) ? t.label : `Topic ${id}`;
        const key = label.toLowerCase();
        if (!groupedMap[key]) groupedMap[key] = { label, percent: 0 };
        groupedMap[key].percent += pct;
      });
  
      let grouped = Object.values(groupedMap);
      const total = grouped.reduce((s, g) => s + g.percent, 0) || 1;
      grouped.forEach(g => g.percent = g.percent * (100 / total));
  
      let rounded = grouped.map(g => ({ ...g, percent: Number(g.percent.toFixed(2)) }));
      let drift = 100 - rounded.reduce((s, g) => s + g.percent, 0);
      if (rounded.length) {
        const iMax = rounded.reduce((i, g, j) => g.percent > rounded[i].percent ? j : i, 0);
        rounded[iMax].percent = Number((rounded[iMax].percent + drift).toFixed(2));
      }
      grouped = rounded.sort((a, b) => b.percent - a.percent);
  
      const pieChartHTML = window.createPieChart(grouped);
  
      let docListHTML = '';
      if (mapping.length > 1) {
        const uniqueTopics = [...new Set(mapping.map(m =>
          (m.label && String(m.label).trim()) ? m.label : `Topic ${m.topic}`
        ))].sort();
  
        const topicCounts = {};
        mapping.forEach(m => {
          const topicLabel = (m.label && String(m.label).trim()) ? m.label : `Topic ${m.topic}`;
          topicCounts[topicLabel] = (topicCounts[topicLabel] || 0) + 1;
        });
  
        const filterHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding: 12px; background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 8px; border: 1px solid #bae6fd;">
            <div style="display: flex; gap: 20px; font-size: 14px;">
              <span style="background: white; padding: 4px 12px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                <strong>Total Documents:</strong> <span style="color: #1e40af; font-weight: 600;">${mapping.length}</span>
              </span>
            </div>
            <div style="position: relative;">
              <select id="topic-filter" style="padding: 8px 36px 8px 14px; border: 2px solid #2563eb; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; background: linear-gradient(to bottom, #ffffff 0%, #f8fafc 100%); color: #1e40af; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.1); appearance: none; -webkit-appearance: none; -moz-appearance: none; min-width: 200px;">
                <option value="all">All Topics</option>
                ${uniqueTopics.map(topic =>
                  `<option value="${escapeHTML(topic)}">${escapeHTML(topic)} (${topicCounts[topic]})</option>`
                ).join('')}
              </select>
              <svg style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; width: 16px; height: 16px;" fill="none" stroke="#2563eb" stroke-width="2" viewBox="0 0 24 24">
                <path d="M19 9l-7 7-7-7"/>
              </svg>
            </div>
          </div>`;
  
        docListHTML = `
          <div class="doc-topic-list" style="margin-top: 1.5rem; border-top: 1px solid #e0e0e0; padding-top: 1rem;">
            <h4 style="margin-bottom: 1rem; font-weight: 600; font-size: 1.1rem;">Document-Topic Mapping</h4>
            ${filterHTML}
            <div style="max-height: 400px; overflow-y: auto; padding-right: 10px; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; background: #fafafa;">
              <ul id="topic-mapping-list" style="list-style: none; padding: 0; margin: 0;">`;
  
        mapping.forEach(m => {
          const label = (m.label && String(m.label).trim()) ? m.label : `Topic ${m.topic}`;
          const conf = Number.isFinite(Number(m.confidence)) ? Number(m.confidence).toFixed(1) : String(m.confidence || '');
          docListHTML += `
            <li class="topic-mapping-item" data-topic="${escapeHTML(label)}" style="padding: 10px 0; border-bottom: 1px solid #e8e8e8; display: flex; justify-content: space-between; align-items: center;">
              <span><strong style="color: #1e40af;">Doc ${m.doc_id}</strong> -> ${escapeHTML(label)}</span>
              <span style="color: #666; font-size: 0.9rem; background: #e0e7ff; padding: 2px 8px; border-radius: 4px;">${conf}%</span>
            </li>`;
        });
  
        docListHTML += `</ul></div></div>`;
      }
  
      container.innerHTML = `
        <details class="topic-section">
          <summary style="font-weight:bold; color:#0074cc; font-size: 1.1em; cursor: pointer; padding: 10px; background: #f9f9f9; border-radius: 6px;">
            Topic Modeling - ${grouped.length} topics identified
          </summary>
          <div style="max-height: 700px; overflow-y: auto; padding: 1.5rem; margin-top: 10px;">
            <h3 style="margin-bottom: 1.5rem; text-align: center;">Topic Distribution</h3>
            ${pieChartHTML}
            ${docListHTML}
          </div>
        </details>`;
  
      // Filter dropdown handler
      if (mapping.length > 1) {
        const filterSelect = document.getElementById('topic-filter');
        if (filterSelect) {
          filterSelect.addEventListener('change', (e) => {
            const selected = e.target.value;
            document.querySelectorAll('.topic-mapping-item').forEach(item => {
              item.style.display = (selected === 'all' || item.dataset.topic === selected)
                ? 'flex' : 'none';
            });
          });
        }
      }
    }
  
    /**
     * Render topics for unlabeled data - relevance-filtered pie chart only.
     */
    function _renderUnlabeledTopics(container, topics) {
      const UNLABELED_THRESHOLD = 5.0;
  
      const isValidTopic = (label) => {
        if (!label || typeof label !== 'string') return false;
        const stops = window.STOPWORDS || window.stopwords || new Set();
        const words = label.replace(/[•·]/g, ' ').trim().split(/\s+/).filter(Boolean);
        const meaningfulWords = words.filter(w => {
          const cleanWord = w.toLowerCase();
          return cleanWord.length > 2 && !stops.has(cleanWord);
        });
        return meaningfulWords.length > 0;
      };
  
      const relevantTopics = topics.filter(t =>
        (t.percent || 0) >= UNLABELED_THRESHOLD && isValidTopic(t.label)
      );
  
      if (!relevantTopics.length) {
        container.innerHTML = `
          <details class="topic-section">
            <summary style="font-weight: bold; font-size: 1.2em; cursor: pointer; padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; color: #1e40af;">
              Topic Modeling - No topics identified
            </summary>
            <div style="padding: 1.5rem; margin-top: 10px;">
              <h3 style="margin-bottom: 1rem;">Topic Modeling</h3>
              <p style="color:#666; font-size:15px; text-align:center; padding:40px; background:#f9fafb; border-radius:8px;">
                This document could not be mapped to any category.
              </p>
            </div>
          </details>`;
        return;
      }
  
      relevantTopics.sort((a, b) => (b.percent || 0) - (a.percent || 0));
  
      const topicData = relevantTopics.map(t => ({
        label: (t.label && String(t.label).trim()) ? t.label : `Topic ${t.id}`,
        percent: Number.isFinite(t.percent) ? Number(t.percent.toFixed(2)) : 0
      }));
  
      const pieChartHTML = window.createPieChart(topicData);
  
      container.innerHTML = `
        <details class="topic-section">
          <summary style="font-weight: bold; font-size: 1.2em; cursor: pointer; padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; color: #1e40af;">
            Topic Modeling - ${relevantTopics.length} topics identified
          </summary>
          <div style="max-height: 700px; overflow-y: auto; padding: 1.5rem; margin-top: 10px;">
            <h3 style="margin-bottom: 1.5rem; text-align: center;">Topic Distribution</h3>
            ${pieChartHTML}
          </div>
        </details>`;
    }
  
    window.displayTopics = displayTopics;
  })();