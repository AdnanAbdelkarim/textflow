/**
 * Dataset summary for the Predictive Modelling tab.
 *
 * The tab asked which models to train and on what split, but said nothing
 * about the data being trained on, so the user chose a test size without
 * knowing how many documents that was, and the page sat mostly empty until a
 * run finished.
 *
 * This states what a run will actually do, and follows the split slider.
 */
(function () {
  'use strict';

  function rows() {
    if (Array.isArray(window.lastCSVData) && window.lastCSVData.length) {
      return window.lastCSVData;
    }
    try {
      const raw = sessionStorage.getItem('lastCSVData');
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function escapeHTML(v) {
    const d = document.createElement('div');
    d.textContent = String(v);
    return d.innerHTML;
  }

  function render() {
    const el = document.getElementById('datasetSummary');
    if (!el) return;

    const data = rows();
    if (!data.length) {
      el.innerHTML = '<p class="panel-note">Upload a labelled dataset on the '
        + 'Input tab to train a model.</p>';
      return;
    }

    const name = k => (typeof window.classDisplayName === 'function'
      ? window.classDisplayName(k) : k);

    const counts = {};
    data.forEach(r => {
      if (r.label === undefined || r.label === null || r.label === '') return;
      const n = name(r.label);
      counts[n] = (counts[n] || 0) + 1;
    });
    const classes = Object.keys(counts).sort();

    const slider = document.getElementById('testSize');
    const testPct = slider ? Number(slider.value) : 20;
    const testN = Math.round(data.length * testPct / 100);
    const trainN = data.length - testN;

    // The smallest class in the test partition is what decides whether a
    // per-class score is meaningful, so it is worth stating before the run.
    const smallest = classes.length
      ? Math.min(...classes.map(c => Math.round(counts[c] * testPct / 100)))
      : 0;

    const applied = sessionStorage.getItem('preprocessingApplied') === 'true';

    el.innerHTML = `
      <div class="summary-figures">
        <div><strong>${trainN.toLocaleString()}</strong><span>documents to train on</span></div>
        <div><strong>${testN.toLocaleString()}</strong><span>held back for testing</span></div>
        <div><strong>${classes.length}</strong><span>classes to tell apart</span></div>
      </div>
      ${classes.length ? `<p class="panel-note">
        ${escapeHTML(classes.map(c => `${c} (${counts[c]})`).join(', '))}.
        ${smallest > 0 && smallest < 10
          ? `The smallest class leaves about ${smallest} test documents, which is `
            + 'few enough that its per-class scores will be unstable.'
          : ''}
      </p>` : ''}
      <p class="panel-note">${applied
        ? 'Your preprocessing settings will be used.'
        : 'No preprocessing applied, so the text is vectorised with the defaults.'}</p>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    render();
    const slider = document.getElementById('testSize');
    if (slider) slider.addEventListener('input', render);
  });
})();
