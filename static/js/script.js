/**
 * Application entry point.
 *
 * After Phase 5 modularization, the heavy lifting lives in:
 *   - core/         (api, utils, state, debug, fileHandler)
 *   - ui/           (forms, tabs, classification)
 *   - visualizations/ (wordCloud, keywordNetwork, vocabCoverage, zipf,
 *                      classOverlap, labelDistribution, pieChart)
 *   - nlp/          (ner, sentiment, topicModeling)
 *   - pages/        (overview, visualizations, advanced)
 *
 * This file is responsible only for:
 *   1. Registering the Chart.js annotation plugin (used by visualizations)
 *   2. Showing/hiding the Predictive Modeling nav tab based on session state
 *   3. Routing to the right page initializer on DOMContentLoaded
 *
 * All other logic has been extracted into the modules listed above.
 * If you find yourself adding more than ~10 lines here, that code probably
 * belongs in a module instead.
 */
(function () {
  'use strict';

  /**
   * Page router - wires up the appropriate page initializer based on the
   * current URL path. This replaces ~5 separate DOMContentLoaded handlers
   * scattered across the original script.js (see F53 from Phase 4).
   */
  function routeToPage() {
    const path = window.location.pathname;

    // 1. Register Chart.js annotation plugin if Chart.js is loaded
    const plugin = window['chartjs-plugin-annotation'] || window.ChartAnnotation;
    if (window.Chart && plugin) {
      Chart.register(plugin);
    }

    // 2. Show Predictive Modeling tab if a labeled CSV is loaded
    if (typeof window.insertPredictiveTabIfNeeded === 'function') {
      window.insertPredictiveTabIfNeeded();
    } else if (typeof window.isDatasetLabeled === 'function' &&
               window.isDatasetLabeled()) {
      // Fallback for pages where ui/tabs.js isn't loaded. Gated on
      // isDatasetLabeled() - the single labeled-dataset signal - rather than on
      // the presence of any uploaded CSV, which also matched unlabeled data.
      const predictiveTab = document.getElementById('predictiveTab');
      if (predictiveTab) predictiveTab.style.display = 'inline-block';
    }

    // 3. Restore session data centrally (idempotent - no-op if already restored)
    if (typeof window.restoreSessionData === 'function') {
      window.restoreSessionData();
    }

    // 4. Wire up file handler if the input page is loaded
    if (document.getElementById('fileInput') && typeof window.initializeFileHandler === 'function') {
      window.initializeFileHandler();
    }

    // 5. Page-specific initialization
    if (path.includes('/overview') && typeof window.initializeOverviewPage === 'function') {
      window.initializeOverviewPage();
    }
    if (path.includes('/visualizations') && typeof window.initializeVisualizationsPlots === 'function') {
      window.initializeVisualizationsPlots();
    }
    if (path.includes('/advanced') && typeof window.initializeAdvancedPage === 'function') {
      window.initializeAdvancedPage();
    }
  }

  // Single DOMContentLoaded entry point
  window.addEventListener('DOMContentLoaded', routeToPage);
})();