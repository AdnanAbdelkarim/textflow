/**
 * Vocabulary coverage chart module.
 *
 * Backend: /api/word_frequency
 * Renders cumulative coverage curve with 80%/90% target guides.
 */
(function () {
    'use strict';
  
    let coverageCtrl = null;
  
    /**
     * Render coverage chart for unlabeled data (single chart, no class tabs).
     *
     * @param {string[]} rows
     * @param {boolean} includeStopwords
     * @param {number} [minRank=1]
     * @param {number} [maxRank=5000]
     */
    async function generateCoverageChartServer(rows, includeStopwords, minRank, maxRank) {
      minRank = minRank || 1;
      maxRank = maxRank || 5000;
  
      try {
        const slim = (rows || []).map(t => (t || '').toString().slice(0, 2000));
        const freq = await postJSON('/api/word_frequency', {
          rows: slim,
          includeStopwords: !!includeStopwords
        });
  
        const wrap = document.getElementById('frequencyChart');
        if (!wrap) return;
  
        if (!Array.isArray(freq) || !freq.length) {
          wrap.innerHTML = "<p style='color:red'> No data for coverage.</p>";
          return;
        }
  
        _renderCoverageChart(wrap, freq, minRank, maxRank, 'main');
      } catch (err) {
        console.error('Coverage fetch failed:', err);
        const wrap = document.getElementById('frequencyChart');
        if (wrap) wrap.innerHTML = "<p style='color:red'> Failed to load coverage.</p>";
      }
    }
  
    /**
     * Render coverage chart for a specific class (labeled data path).
     * Uses AbortController for safe re-rendering - see F17.
     */
    async function renderCoverageForClass(rows, includeStopwords, minRank, maxRank, className) {
      if (coverageCtrl) {
        try { coverageCtrl.abort(); } catch (_) {}
      }
      coverageCtrl = new AbortController();
      const signal = coverageCtrl.signal;
  
      const container = document.querySelector('.coverage-flex .class-tabs-content');
      if (!container) {
        console.error('renderCoverageForClass: .class-tabs-content not found');
        return;
      }
  
      if (!rows || rows.length === 0) {
        container.innerHTML = `<div style='text-align:center;padding:40px;'> No data available for coverage.</div>`;
        return;
      }
  
      const displayLabel = className === 'all' ? 'All Data' : `Class ${className}`;
      container.innerHTML = `<h5 style="margin-top: 20px;text-align: center;">${displayLabel}</h5>`;
  
      const canvasWrapper = document.createElement('div');
      canvasWrapper.id = `coverageChart-${className}`;
      canvasWrapper.style.cssText = 'position: relative; width: 100%; height: 430px;';
      const canvas = document.createElement('canvas');
      canvasWrapper.appendChild(canvas);
      container.appendChild(canvasWrapper);
  
      try {
        // Check sessionStorage cache before fetching
        let freq = null;
        const scKey = window.sessionCache
          ? window.sessionCache.vizKey('cov', className, includeStopwords)
          : null;
  
        if (scKey && !window.sessionCache.isStale(scKey)) {
          const entry = window.sessionCache.get(scKey);
          if (entry && entry.data) {
            freq = entry.data;
          }
        }
  
        if (!freq) {
          const slim = (rows || []).map(t => (t || '').toString().slice(0, 2000));
          freq = await postJSON('/api/word_frequency', {
            rows: slim,
            includeStopwords: !!includeStopwords
          }, { signal });
  
          if (scKey && freq && freq.length) {
            window.sessionCache.set(scKey, freq);
          }
        }
  
        if (!Array.isArray(freq) || !freq.length) {
          canvasWrapper.innerHTML = "<div style='text-align:center;padding:40px;'> No data for coverage.</div>";
          return;
        }
  
        _renderCoverageChart(canvasWrapper, freq, minRank, maxRank, className);
      } catch (err) {
        if (window.isAbortError && window.isAbortError(err)) return;
        console.error('Coverage fetch failed:', err);
        canvasWrapper.innerHTML = "<div style='text-align:center;padding:40px;'> Failed to load coverage.</div>";
      }
    }
  
    /**
     * Update coverage when user changes range or stopwords.
     */
    function updateCoverageRange() {
      const min = parseInt(document.getElementById('minRank')?.value || '1', 10);
      const max = parseInt(document.getElementById('maxRank')?.value || '10000', 10);
      const includeStop = !!document.getElementById('includeStopwords')?.checked;
  
      const hasLabels = Array.isArray(window.lastCSVData) &&
                        window.lastCSVData.length > 0 &&
                        window.lastCSVData[0].label !== undefined;
  
      if (hasLabels) {
        const activeTab = document.querySelector('#frequencyChart .class-tab.active');
        const className = activeTab ? activeTab.dataset.class : 'all';
  
        let textData;
        if (className === 'all') {
          textData = window.lastCSVData.map(row => row.text || row.email || '');
        } else {
          const targetClassNum = String(className).replace('label', '');
          const classData = window.lastCSVData.filter(row => {
            if (Array.isArray(row.labelNames) && row.labelNames.length) {
              return row.labelNames.includes(className);
            }
            const rowClass = row.label !== undefined ? row.label : row.class;
            return String(rowClass == null ? 'Unlabeled' : rowClass) === targetClassNum;
          });
          textData = classData.map(row => row.text || row.email || '');
        }
  
        if (textData.length > 0) {
          renderCoverageForClass(textData, includeStop, min, max, className);
        }
      } else {
        const rows = (typeof getRowsForCharts === 'function') ? getRowsForCharts() : [];
        if (!rows || rows.length === 0) return;
        generateCoverageChartServer(rows, includeStop, min, max);
      }
    }
  
    // ============================================================
    // INTERNAL: shared chart rendering
    // ============================================================
  
    function _renderCoverageChart(wrap, freq, minRank, maxRank, chartKey) {
      freq.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
  
      const vocabularySize = freq.length;
      const effectiveMaxRank = Math.min(maxRank, vocabularySize);
      const total = freq.reduce((acc, d) => acc + (d.frequency || 0), 0) || 1;
  
      let cum = 0;
      const points = [];
      for (let i = 0; i < freq.length; i++) {
        cum += (freq[i].frequency || 0);
        points.push({ x: i + 1, y: (cum / total) * 100 });
      }
  
      const rankAtCoverage = thr => {
        for (const p of points) if (p.y >= thr) return p.x;
        return points[points.length - 1].x;
      };
  
      const v80 = rankAtCoverage(80);
      const v90 = rankAtCoverage(90);
  
      let canvas = wrap.querySelector('canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        wrap.innerHTML = '';
        wrap.appendChild(canvas);
      }
  
      if (!window.coverageCharts) window.coverageCharts = {};
      const safeKey = String(chartKey).replace(/[^a-zA-Z0-9]/g, '_');
      if (window.coverageCharts[safeKey] && typeof window.coverageCharts[safeKey].destroy === 'function') {
        window.coverageCharts[safeKey].destroy();
      }
  
      const axisTitle = window.axisTitle || (text => ({ display: true, text }));
  
      const ctx = canvas.getContext('2d');
      window.coverageCharts[safeKey] = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: [{
            label: 'Cumulative Coverage (%)',
            data: points,
            parsing: false,
            borderColor: '#2f80ed',
            borderWidth: 4,
            pointRadius: 0,
            tension: 0,
            fill: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: chartKey === 'main' ? undefined : false,
          aspectRatio: chartKey === 'main' ? 1250 / 430 : undefined,
          interaction: { mode: 'nearest', intersect: true },
          plugins: {
            legend: { display: false },
            annotation: {
              annotations: {
                h80: { type: 'line', yMin: 80, yMax: 80, borderColor: 'red', borderWidth: 2, borderDash: [6, 4] },
                h90: { type: 'line', yMin: 90, yMax: 90, borderColor: 'red', borderWidth: 2, borderDash: [6, 4] },
                v80: { type: 'line', xMin: v80, xMax: v80, borderColor: 'red', borderWidth: 2, borderDash: [6, 4] },
                v90: { type: 'line', xMin: v90, xMax: v90, borderColor: 'red', borderWidth: 2, borderDash: [6, 4] }
              }
            },
            tooltip: { intersect: true, mode: 'nearest' },
            title: { display: false }
          },
          elements: { point: { radius: 0, hitRadius: 12, hoverRadius: 4 } },
          scales: {
            x: { type: 'linear', title: axisTitle('Word Rank'), min: +minRank, max: effectiveMaxRank },
            y: { title: axisTitle('Cumulative Coverage (%)'), min: 0, max: 100 }
          }
        }
      });
  
      wrap.style.position = 'relative';
      let domLegend = wrap.querySelector('.coverage-legend-dom');
      if (!domLegend) {
        domLegend = document.createElement('div');
        domLegend.className = 'coverage-legend-dom';
        domLegend.style.cssText = `
          position: absolute; top: 8px; right: 8px;
          background: rgba(255,255,255,0.85); border: 1px dashed #cbd5e1;
          border-radius: 6px; padding: 8px 10px;
          font: 12px system-ui, sans-serif; color: #111827; pointer-events: none;
        `;
        wrap.appendChild(domLegend);
      }
  
      domLegend.innerHTML = `
        <div style="margin-bottom: 4px;"><strong>Legend</strong></div>
        <div style="margin: 3px 0;"> Horizontal: coverage targets (80%, 90%)</div>
        <div style="margin: 3px 0;"> Vertical: rank hitting targets (k₈₀ = ${v80.toLocaleString()}, k₉₀ = ${v90.toLocaleString()})</div>
        <div style="margin-top: 6px; font-size: 11px; color: #6b7280;">Vocabulary size: ${vocabularySize.toLocaleString()} words</div>
      `;
    }
  
    // Expose public API
    window.generateCoverageChartServer = generateCoverageChartServer;
    window.renderCoverageForClass = renderCoverageForClass;
    window.updateCoverageRange = updateCoverageRange;
  })();