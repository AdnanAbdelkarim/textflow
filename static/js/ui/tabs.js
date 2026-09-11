/**
 * Tab management utilities - class-specific visualization tabs and
 * navigation tab visibility.
 */
(function () {
    'use strict';
  
    /**
     * Create class-specific tabs for a visualization (Word Cloud, Network, Coverage, Zipf).
     * Each tab type targets a different container selector.
     *
     * @param {string[]} classes - sorted unique class names
     * @param {function(string)} onClick - callback receiving the clicked class name
     * @param {string} [type='network'] - 'network' | 'coverage' | 'zipf' | 'wordcloud'
     * @param {string} [activeClass=null] - which class to mark as active initially ('all' for All Data)
     * @returns {{tabContainer: HTMLElement, contentContainer: HTMLElement, effectiveActiveClass: string}|null}
     */
    function createClassTabs(classes, onClick, type, activeClass) {
      type = type || 'network';
  
      const containerSelectors = {
        network:   '#networkContainer .network-flex',
        coverage:  '#frequencyChart .coverage-flex',
        zipf:      '#zipfPlot .zipf-flex',
        wordcloud: '#wordCloud .wordcloud-tabs'
      };
      const containerSelector = containerSelectors[type];
      if (!containerSelector) {
        console.error('createClassTabs: unknown visualization type:', type);
        return null;
      }
  
      const container = document.querySelector(containerSelector);
      if (!container) {
        console.warn('createClassTabs: container not found for', type);
        return null;
      }
  
      // Remove old tabs/content
      const oldTabs = container.querySelector('.class-tabs');
      if (oldTabs) oldTabs.remove();
      const oldContent = container.querySelector('.class-tabs-content');
      if (oldContent) oldContent.remove();
  
      // Sort classes - numeric-aware
      const sortedClasses = [...classes].sort((a, b) => {
        if (!isNaN(a) && !isNaN(b)) return Number(a) - Number(b);
        return String(a).localeCompare(String(b));
      });
  
      const tabContainer = document.createElement('div');
      tabContainer.classList.add('class-tabs');
  
      // "All Data" tab - always present
      const allDataBtn = document.createElement('button');
      allDataBtn.className = 'class-tab';
      allDataBtn.dataset.class = 'all';
      allDataBtn.textContent = 'All Data';
      if (activeClass === 'all' || !activeClass) {
        allDataBtn.classList.add('active');
      }
      tabContainer.appendChild(allDataBtn);
  
      // One tab per class
      sortedClasses.forEach(className => {
        const btn = document.createElement('button');
        btn.className = 'class-tab';
        btn.dataset.class = className;
        // Identifier stays as-is for the click handler and API calls; only the
        // visible text is resolved back to the user's own class name.
        btn.textContent = (typeof window.classDisplayName === 'function')
          ? `Class ${window.classDisplayName(className)}`
          : `Class ${className}`;
        if (String(className) === String(activeClass)) {
          btn.classList.add('active');
          allDataBtn.classList.remove('active');
        }
        tabContainer.appendChild(btn);
      });
  
      const contentContainer = document.createElement('div');
      contentContainer.classList.add('class-tabs-content');
      container.appendChild(tabContainer);
  
      if (type === 'wordcloud') {
        const flexContainer = document.querySelector('#wordCloud .wordcloud-flex');
        if (flexContainer) {
          flexContainer.appendChild(contentContainer);
        }
      } else {
        container.appendChild(contentContainer);
      }
  
      // Delegated click handler
      tabContainer.addEventListener('click', (e) => {
        if (!e.target.matches('.class-tab')) return;
        tabContainer.querySelectorAll('.class-tab').forEach(tab => tab.classList.remove('active'));
        e.target.classList.add('active');
        onClick(e.target.dataset.class);
      });
  
      return { tabContainer, contentContainer, effectiveActiveClass: activeClass };
    }
  
    /**
     * Insert the Predictive Modelling tab into the main nav if a labeled CSV
     * has been uploaded (sessionStorage.isLabeled === "true").
     */
    function insertPredictiveTabIfNeeded() {
      if (!window.isDatasetLabeled()) return;

      // Every page template ships the Predictive Modelling anchor hidden.
      // Reveal that anchor when one is present; only create a new one on a
      // page whose template does not carry it.
      const existing = document.querySelector('a[href="/predictive"]');
      if (existing) {
        existing.style.display = 'inline-block';
        return;
      }

      const tabsContainer = document.querySelector('.tabs');
      if (!tabsContainer) return;

      const predictiveTab = document.createElement('a');
      predictiveTab.href = '/predictive';
      predictiveTab.className = 'tab-button';
      predictiveTab.textContent = 'Predictive Modelling';
      tabsContainer.appendChild(predictiveTab);
    }
  
    /**
     * Show or hide the Label Distribution subtab based on whether
     * the loaded data has class labels.
     */
    function updateLabelDistributionVisibility() {
      const hasLabels = (typeof window.checkIfDataHasLabels === 'function')
        ? window.checkIfDataHasLabels()
        : (Array.isArray(window.lastCSVData) &&
           window.lastCSVData.length > 0 &&
           window.lastCSVData[0].label !== undefined);
  
      const labelTabButton = document.querySelector('.subtab-button[data-tab="label-tab"]');
      if (!labelTabButton) return;
  
      if (hasLabels) {
        labelTabButton.style.display = 'inline-block';
      } else {
        labelTabButton.style.display = 'none';
        // If the hidden tab was active, switch to word cloud
        if (labelTabButton.classList.contains('active')) {
          const wordCloudTab = document.querySelector('.subtab-button[data-tab="wordcloud-tab"]');
          if (wordCloudTab) wordCloudTab.click();
        }
      }
    }
  
    /**
     * Hide the Pre-Processing nav tab for unlabeled datasets.
     * The tab is hardcoded in HTML so Flask can't gate it -
     * we hide it client-side based on isDatasetLabeled().
     */
    function updatePreprocessingTabVisibility() {
      const preprocessingTab = document.querySelector('a[href*="preprocessing"]');
      if (!preprocessingTab) return;
      preprocessingTab.style.display = window.isDatasetLabeled() ? '' : 'none';
    }

    window.createClassTabs = createClassTabs;
    window.insertPredictiveTabIfNeeded = insertPredictiveTabIfNeeded;
    window.updateLabelDistributionVisibility = updateLabelDistributionVisibility;
    window.updatePreprocessingTabVisibility = updatePreprocessingTabVisibility;
  })();