/**
 * Corpus summary panels for the Overview tab.
 *
 * The tab previously showed four aggregate figures, which left most of the
 * page empty and told the user little about the shape of their corpus. These
 * three panels answer the questions a user asks before deciding what to do
 * next: is the dataset balanced, what is it about, and how long are the
 * documents.
 *
 * Class balance and document length are computed here from the corpus already
 * held in the session. Term frequency goes to /api/word_frequency so the
 * counts match the Visualizations tab, which applies the same tokenization
 * and stopword handling.
 */
(function () {
  'use strict';

  const MAX_TERMS = 12;
  const LENGTH_BUCKETS = 8;

  function rows() {
    if (Array.isArray(window.lastCSVData) && window.lastCSVData.length) {
      return window.lastCSVData;
    }
    try {
      const raw = sessionStorage.getItem('lastCSVData');
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function displayName(label) {
    return typeof window.classDisplayName === 'function'
      ? window.classDisplayName(label)
      : String(label);
  }

  function escapeHTML(value) {
    const d = document.createElement('div');
    d.textContent = String(value);
    return d.innerHTML;
  }

  /** A labelled row of bars: [name][bar][value]. */
  function barList(items, unit) {
    const max = Math.max(...items.map(i => i.value), 1);
    return '<ul class="bar-list">' + items.map(item => `
      <li>
        <span class="bar-label" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</span>
        <span class="bar-track"><span class="bar-fill"
              style="width:${(item.value / max * 100).toFixed(1)}%"></span></span>
        <span class="bar-value">${item.value.toLocaleString()}${unit || ''}</span>
      </li>`).join('') + '</ul>';
  }

  function note(text) {
    return `<p class="panel-note">${escapeHTML(text)}</p>`;
  }

  // --- Class balance -------------------------------------------------------

  function renderClassBalance(container, data) {
    const labelled = data.filter(r => r.label !== undefined && r.label !== null
                                      && r.label !== '' && r.label !== '-1');
    if (!labelled.length) {
      container.innerHTML = note(
        'This dataset has no labels, so there are no classes to compare. '
        + 'Upload a file with a label column to use the modelling tabs.');
      return;
    }

    const counts = {};
    labelled.forEach(r => {
      const name = displayName(r.label);
      counts[name] = (counts[name] || 0) + 1;
    });

    const items = Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const total = items.reduce((sum, i) => sum + i.value, 0);
    const ratio = items[0].value / items[items.length - 1].value;

    // A ratio above 1.5 is where imbalance starts to affect a classifier
    // enough that the Preprocessing tab's resampling is worth considering.
    const verdict = items.length < 2 ? ''
      : ratio >= 1.5
        ? `Largest class is ${ratio.toFixed(1)} times the smallest. `
          + 'Resampling in the Preprocessing tab may help.'
        : 'The classes are close to balanced.';

    container.innerHTML = barList(items)
      + note(`${items.length} classes over ${total.toLocaleString()} documents. ${verdict}`);
  }

  // --- Most frequent terms -------------------------------------------------

  function renderTopTerms(container, data) {
    fetch('/api/word_frequency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: data })
    })
      .then(r => r.json())
      .then(result => {
        const list = Array.isArray(result) ? result : (result.words || []);
        if (!list.length) {
          container.innerHTML = note('No terms were found in this corpus.');
          return;
        }
        const items = list.slice(0, MAX_TERMS)
          .map(w => ({ name: w.word, value: w.frequency }));
        container.innerHTML = barList(items)
          + note('Stopwords are excluded, matching the word cloud.');
      })
      .catch(() => {
        container.innerHTML = note('Term frequencies could not be loaded.');
      });
  }

  // --- Document length -----------------------------------------------------

  function renderDocLengths(container, data) {
    const lengths = data
      .map(r => String(r.text || '').trim().split(/\s+/).filter(Boolean).length)
      .filter(n => n > 0)
      .sort((a, b) => a - b);

    if (!lengths.length) {
      container.innerHTML = note('No documents to measure.');
      return;
    }

    const min = lengths[0];
    const max = lengths[lengths.length - 1];
    const median = lengths[Math.floor(lengths.length / 2)];
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;

    if (min === max) {
      container.innerHTML = note(
        `All ${lengths.length.toLocaleString()} documents are ${min} words long.`);
      return;
    }

    const width = (max - min) / LENGTH_BUCKETS;
    const buckets = new Array(LENGTH_BUCKETS).fill(0);
    lengths.forEach(n => {
      const i = Math.min(LENGTH_BUCKETS - 1, Math.floor((n - min) / width));
      buckets[i] += 1;
    });

    const items = buckets.map((count, i) => ({
      name: `${Math.round(min + i * width)}-${Math.round(min + (i + 1) * width)}`,
      value: count
    }));

    container.innerHTML = barList(items, ' docs') + note(
      `${lengths.length.toLocaleString()} documents. Shortest ${min}, longest ${max}, `
      + `median ${median}, mean ${mean.toFixed(1)} words.`);
  }

  // --- Entry point ---------------------------------------------------------

  function initializeOverviewPanels() {
    const data = rows();
    const panels = [
      ['classBalance', renderClassBalance],
      ['topTerms', renderTopTerms],
      ['docLengths', renderDocLengths]
    ];

    panels.forEach(([id, render]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!data.length) {
        el.innerHTML = note('Upload a dataset on the Input tab to see this.');
        return;
      }
      try {
        render(el, data);
      } catch (e) {
        el.innerHTML = note('This panel could not be rendered.');
        console.error('[TextFlow] overview panel ' + id + ' failed:', e);
      }
    });
  }

  window.initializeOverviewPanels = initializeOverviewPanels;
  document.addEventListener('DOMContentLoaded', initializeOverviewPanels);
})();
