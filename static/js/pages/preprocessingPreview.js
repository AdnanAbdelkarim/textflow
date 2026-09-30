/**
 * Live preview for the Preprocessing tab.
 *
 * The tab asked the user to choose a feature representation, a normalizer and
 * a resampling method, then showed nothing until they pressed Apply. The
 * choices are the whole point of the tab and their effect was invisible, so
 * most of the page was configuration with no feedback.
 *
 * This sends the current settings to the preview endpoint on every change and
 * shows what the pipeline does to the user's own text: the sentence before and
 * after, the vocabulary it produces, and how resampling changes the class
 * counts. The endpoint already existed and nothing called it.
 */
(function () {
  'use strict';

  const SAMPLE_ROWS = 120;   // enough to be representative, small enough to be quick
  let timer = null;
  let lastKey = '';

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

  function currentSettings() {
    const on = id => !!(document.getElementById(id) || {}).checked;
    const slider = document.getElementById('vectorSize');
    return {
      useTF: on('useTF'), useTFIDF: on('useTFIDF'), useWord2Vec: on('useWord2Vec'),
      useStemming: on('useStemming'), useLemmatization: on('useLemmatization'),
      useSMOTE: on('useSMOTE'), useOversampling: on('useOversampling'),
      useUndersampling: on('useUndersampling'),
      vectorSize: slider ? Number(slider.value) : 100
    };
  }

  function escapeHTML(v) {
    const d = document.createElement('div');
    d.textContent = String(v);
    return d.innerHTML;
  }

  function render(container, settings, data, result) {
    const before = String((data[0] || {}).text || '').trim();
    const after = String(result.processed_sample || '').trim();

    const beforeCounts = result.original_class_distribution || {};
    const afterCounts = result.processed_class_distribution || {};
    const resampled = JSON.stringify(beforeCounts) !== JSON.stringify(afterCounts);

    const name = k => (typeof window.classDisplayName === 'function'
      ? window.classDisplayName(k) : k);

    const classRows = Object.keys(beforeCounts).sort().map(k =>
      `<tr><td>${escapeHTML(name(k))}</td><td>${beforeCounts[k]}</td>`
      + `<td>${afterCounts[k] !== undefined ? afterCounts[k] : beforeCounts[k]}</td></tr>`
    ).join('');

    container.innerHTML = `
      <div class="preview-grid">
        <div class="preview-text">
          <span class="preview-label">Before</span>
          <p>${escapeHTML(before) || '<em>empty</em>'}</p>
          <span class="preview-label">After</span>
          <p class="preview-after">${escapeHTML(after) || '<em>nothing left after filtering</em>'}</p>
        </div>
        <div class="preview-figures">
          <div><strong>${(result.vocab_size || 0).toLocaleString()}</strong><span>terms in vocabulary</span></div>
          <div><strong>${(result.vector_dimensions || 0).toLocaleString()}</strong><span>features per document</span></div>
          <div><strong>${data.length.toLocaleString()}</strong><span>documents previewed</span></div>
        </div>
        ${classRows ? `
        <div class="preview-classes">
          <table class="sample-table">
            <thead><tr><th>Class</th><th>Before</th><th>After</th></tr></thead>
            <tbody>${classRows}</tbody>
          </table>
          <p class="panel-note">${resampled
            ? 'Resampling changed the class counts.'
            : 'Resampling left the counts unchanged; the classes were already balanced.'}</p>
        </div>` : ''}
      </div>`;
  }

  function refresh() {
    const container = document.getElementById('livePreview');
    if (!container) return;

    const settings = currentSettings();
    if (!settings.useTF && !settings.useTFIDF && !settings.useWord2Vec) {
      container.innerHTML = '<p class="panel-note">Choose a feature extraction '
        + 'method to see what it does to your text.</p>';
      return;
    }

    const data = rows().slice(0, SAMPLE_ROWS);
    if (!data.length) {
      container.innerHTML = '<p class="panel-note">Upload a labelled dataset on '
        + 'the Input tab to preview the pipeline.</p>';
      return;
    }

    const key = JSON.stringify(settings) + ':' + data.length;
    if (key === lastKey) return;
    lastKey = key;

    container.innerHTML = '<p class="panel-note">Running the pipeline...</p>';
    fetch('/api/preprocess_preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: data, settings: settings, textCol: 'text' })
    })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)))
      .then(result => render(container, settings, data, result))
      .catch(err => {
        container.innerHTML = '<p class="panel-note">'
          + escapeHTML((err && err.error) || 'This combination could not be previewed.')
          + '</p>';
      });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 450);   // let a run of clicks settle
  }

  document.addEventListener('DOMContentLoaded', () => {
    ['useTF', 'useTFIDF', 'useWord2Vec', 'useStemming', 'useLemmatization',
     'useSMOTE', 'useOversampling', 'useUndersampling', 'vectorSize']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('change', schedule);
          el.addEventListener('input', schedule);
        }
      });
    refresh();
  });
})();
