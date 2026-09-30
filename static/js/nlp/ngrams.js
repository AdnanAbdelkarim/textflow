/**
 * N-gram exploration for the Advanced Analysis tab.
 *
 * Renders a ranked frequency table and a bar chart of the most frequent
 * unigrams, bigrams or trigrams, with the n-gram order chosen through a
 * graphical control and an optional per-class breakdown for labeled data.
 *
 * Backend: POST /api/ngrams
 */
(function () {
  'use strict';

  let ngramChart = null;

  function getRows() {
    // Prefer structured rows so the per-class breakdown works; fall back to
    // plain text lines for unlabeled corpora.
    if (Array.isArray(window.lastCSVData) && window.lastCSVData.length) {
      return window.lastCSVData;
    }
    try {
      const stored = sessionStorage.getItem('lastCSVData');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
      const rows = sessionStorage.getItem('lastCSVTextRows');
      if (rows) return JSON.parse(rows);
      const textData = sessionStorage.getItem('textData');
      if (textData) {
        const t = JSON.parse(textData).text || '';
        return t.split('\n')
                .map(l => l.replace(/^\[[^\]]+\]\s*/, ''))
                .filter(Boolean);
      }
    } catch (e) { /* fall through */ }
    return [];
  }

  function availableClasses(rows) {
    const labels = new Set();
    rows.forEach(r => {
      if (r && typeof r === 'object' && r.label !== undefined && r.label !== null) {
        labels.add(String(r.label));
      }
    });
    return [...labels].sort((a, b) =>
      (!isNaN(a) && !isNaN(b)) ? Number(a) - Number(b) : a.localeCompare(b));
  }

  function displayName(cls) {
    return (typeof window.classDisplayName === 'function')
      ? window.classDisplayName(cls) : cls;
  }

  function buildControls(container, rows) {
    const classes = availableClasses(rows);
    const classOptions = ['all', ...classes]
      .map(c => `<option value="${c}">${c === 'all' ? 'All data' : 'Class ' + displayName(c)}</option>`)
      .join('');

    container.innerHTML = `
      <h3 style="margin-top:0;">N-gram Exploration</h3>
      <div class="ngram-controls"
           style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;
                  margin-bottom:15px;padding:10px;background:#f4f5f2;border-radius:6px;">
        <label style="display:flex;align-items:center;gap:6px;">
          <span style="font-weight:bold;color:#333;">N-gram order:</span>
          <select id="ngramOrder">
            <option value="1">Unigrams (1)</option>
            <option value="2" selected>Bigrams (2)</option>
            <option value="3">Trigrams (3)</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:6px;">
          <span style="font-weight:bold;color:#333;">Show:</span>
          <select id="ngramTopN">
            <option value="10">Top 10</option>
            <option value="25" selected>Top 25</option>
            <option value="50">Top 50</option>
          </select>
        </label>
        ${classes.length ? `
        <label style="display:flex;align-items:center;gap:6px;">
          <span style="font-weight:bold;color:#333;">Class:</span>
          <select id="ngramClass">${classOptions}</select>
        </label>` : ''}
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" id="ngramStopwords" style="accent-color:#1f4e79;">
          <span>Include stopwords</span>
        </label>
      </div>
      <div id="ngramSummary" style="margin-bottom:10px;color:#555;"></div>
      <div style="max-width:100%;overflow-x:auto;">
        <canvas id="ngramChart" height="320"></canvas>
      </div>
      <div id="ngramTable" style="margin-top:15px;max-height:320px;overflow-y:auto;"></div>
    `;

    ['ngramOrder', 'ngramTopN', 'ngramClass', 'ngramStopwords'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => runNgramAnalysis());
    });
  }

  function renderTable(data) {
    const el = document.getElementById('ngramTable');
    if (!el) return;
    if (!data.ngrams.length) {
      el.innerHTML = '<p>No n-grams found for this selection.</p>';
      return;
    }
    const max = data.ngrams[0].frequency;
    const rows = data.ngrams.map((g, i) => `
      <tr>
        <td style="padding:4px 10px;color:#888;">${i + 1}</td>
        <td style="padding:4px 10px;font-family:monospace;">${g.ngram}</td>
        <td style="padding:4px 10px;text-align:right;">${g.frequency}</td>
        <td style="padding:4px 10px;text-align:right;color:#666;">
          ${((g.frequency / data.total_ngrams) * 100).toFixed(2)}%
        </td>
      </tr>`).join('');
    el.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:2px solid #ddd;text-align:left;">
            <th style="padding:6px 10px;">#</th>
            <th style="padding:6px 10px;">N-gram</th>
            <th style="padding:6px 10px;text-align:right;">Frequency</th>
            <th style="padding:6px 10px;text-align:right;">Share</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
    void max;
  }

  function renderChart(data) {
    const canvas = document.getElementById('ngramChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (ngramChart) { ngramChart.destroy(); ngramChart = null; }
    if (!data.ngrams.length) return;

    const top = data.ngrams.slice(0, 20);
    ngramChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: top.map(g => g.ngram),
        datasets: [{
          label: `${data.n}-gram frequency`,
          data: top.map(g => g.frequency),
          backgroundColor: '#2d6ca8',
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, title: { display: true, text: 'Frequency' } } },
      },
    });
  }

  async function runNgramAnalysis() {
    const summary = document.getElementById('ngramSummary');
    const rows = getRows();
    if (!rows.length) {
      if (summary) summary.textContent = 'No data loaded.';
      return;
    }

    const n = parseInt(document.getElementById('ngramOrder')?.value || '2', 10);
    const topN = parseInt(document.getElementById('ngramTopN')?.value || '25', 10);
    const className = document.getElementById('ngramClass')?.value || 'all';
    const includeStopwords = !!document.getElementById('ngramStopwords')?.checked;

    if (summary) summary.textContent = 'Computing...';

    try {
      const res = await fetch('/api/ngrams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, n, topN, className, includeStopwords }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        if (summary) summary.textContent = `N-gram analysis failed: ${data.error || res.status}`;
        return;
      }
      const orderName = { 1: 'unigrams', 2: 'bigrams', 3: 'trigrams' }[data.n] || `${data.n}-grams`;
      if (summary) {
        summary.textContent =
          `${data.unique_ngrams.toLocaleString()} distinct ${orderName} across ` +
          `${data.total_ngrams.toLocaleString()} occurrences in ` +
          `${data.n_documents.toLocaleString()} documents` +
          (className !== 'all' ? ` (class ${displayName(className)})` : '') + '.';
      }
      renderChart(data);
      renderTable(data);
    } catch (err) {
      if (summary) summary.textContent = `N-gram analysis failed: ${err.message}`;
    }
  }

  function initNgrams() {
    const container = document.getElementById('ngramAnalysis');
    if (!container) return;
    buildControls(container, getRows());
    runNgramAnalysis();
  }

  window.initNgrams = initNgrams;
  window.runNgramAnalysis = runNgramAnalysis;
})();
