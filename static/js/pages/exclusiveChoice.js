/**
 * Drives the preprocessing dropdowns.
 *
 * Feature extraction, normalization and imbalance handling each allow one
 * choice at a time. Presenting them as checkboxes meant the interface had to
 * explain the rule in a note under each group, and let a user break it before
 * being told. A dropdown states the rule by existing.
 *
 * The checkboxes remain in the page, hidden, and are kept in step with the
 * dropdowns. Everything that already reads them, including the pipeline
 * preview and the apply step, keeps working unchanged.
 */
(function () {
  'use strict';

  const GROUPS = [
    { select: 'featureMethod',       boxes: ['useTF', 'useTFIDF', 'useWord2Vec'] },
    { select: 'normalizationMethod', boxes: ['useStemming', 'useLemmatization'] },
    { select: 'imbalanceMethod',     boxes: ['useSMOTE', 'useOversampling', 'useUndersampling'] }
  ];

  function sync(group) {
    const select = document.getElementById(group.select);
    if (!select) return;
    group.boxes.forEach(id => {
      const box = document.getElementById(id);
      if (!box) return;
      const wanted = select.value === id;
      if (box.checked !== wanted) {
        box.checked = wanted;
        // Listeners elsewhere are bound to the checkbox, not the dropdown.
        box.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  function adoptCheckedState(group) {
    // Anything that ticks a box directly, such as restoring a previous
    // session, should still be reflected in the dropdown.
    const select = document.getElementById(group.select);
    if (!select) return;
    const on = group.boxes.find(id => (document.getElementById(id) || {}).checked);
    if (on && select.value !== on) select.value = on;
  }

  document.addEventListener('DOMContentLoaded', () => {
    GROUPS.forEach(group => {
      const select = document.getElementById(group.select);
      if (!select) return;
      adoptCheckedState(group);
      select.addEventListener('change', () => sync(group));
    });
  });
})();
