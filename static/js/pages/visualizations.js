/**
 * Visualizations page initializer.
 *
 * Wires up:
 *   - Stopwords toggle (re-renders all 4 visualizations on change)
 *   - Update Network button
 *   - Class tab initial render
 *   - Subtab switching (now in visualizations.html inline - kept there for now)
 *
 * The heavy initialization (initializeClassSpecificPlots) lives in script.js
 * for now; it'll be migrated in a future polish pass.
 */
(function () {
    'use strict';

    function initializeClassSpecificPlots(data, visualizationType = 'all', activeClass = null) {
      if (window.dbg) dbg("initializeClassSpecificPlots called with:", {
        visualizationType, 
        activeClass,
        dataLength: data?.length || 0 
      });
      
      // Handles both the single-label and multi-label row shapes.
      let classesArray = [];
      
      // Debug: Check what's actually in the data
      if (window.dbg) dbg("Data sample:", data.slice(0, 3));
      
      // Check if we have multi-label data with labelNames
      const hasLabelNames = data.some(row => row.labelNames && Array.isArray(row.labelNames) && row.labelNames.length > 0);
      
      if (hasLabelNames) {
        // Multi-label format: get ALL unique labelNames across all rows
        const allLabelNames = new Set();
        data.forEach(row => {
          if (row.labelNames && Array.isArray(row.labelNames)) {
            row.labelNames.forEach(name => allLabelNames.add(name));
          }
        });
        classesArray = [...allLabelNames].sort();
        if (window.dbg) dbg("Multi-label format detected - labelNames:", classesArray);
      } 
      // Check if we have labelColumns in sessionStorage
      else if (sessionStorage.getItem("labelColumns")) {
        try {
          const labelColumns = JSON.parse(sessionStorage.getItem("labelColumns"));
          if (window.dbg) dbg("Using labelColumns from sessionStorage:", labelColumns);
          classesArray = labelColumns;
        } catch (e) {
          console.error("Failed to parse labelColumns:", e);
        }
      }
      // Fallback: single-label format
      else {
        const allClasses = new Set();
        data.forEach(row => {
          const classValue = row.class !== undefined ? row.class : row.label;
          if (classValue !== undefined && classValue !== null && classValue !== "-1") {
            allClasses.add(String(classValue));
          }
        });
        classesArray = [...allClasses].sort();
        if (window.dbg) dbg("Single-label format detected - classes:", classesArray);
      }
      
      // Convert numeric classes to label format for tabs (0 -> "label0", 1 -> "label1")
      classesArray = classesArray.map(cls => {
        // If it's already in label format (label0, label1), keep it
        if (cls.startsWith('label')) return cls;
        // If it's numeric, convert to label format
        if (!isNaN(cls)) return `label${cls}`;
        // Otherwise keep as is
        return cls;
      });
      
      if (window.dbg) dbg("Final classes for visualizations:", classesArray);
      
    
      if (classesArray.length === 0) {
        console.error("No classes found in data");
        return;
      }
    
      const shouldInitWordCloud = visualizationType === 'all' || visualizationType === 'wordcloud';
      const shouldInitNetwork = visualizationType === 'all' || visualizationType === 'network';
      const shouldInitCoverage = visualizationType === 'all' || visualizationType === 'coverage';
      const shouldInitZipf = visualizationType === 'all' || visualizationType === 'zipf';
    
      const defaultActiveClass = "all";
    
      // ========================================
      // WORD CLOUD
      // ========================================
      if (shouldInitWordCloud) {
        const initialWordCloudClass = activeClass || defaultActiveClass;
    
        const wordCloudTabInfo = createClassTabs(
          classesArray,
          (className) => {
            window.activeClass = className;
            renderWordCloudForClass(data, className);
          },
          'wordcloud',
          initialWordCloudClass
        );
    
        if (wordCloudTabInfo) {
          if (window.dbg) dbg("Word Cloud tabs created with active:", wordCloudTabInfo.effectiveActiveClass);
          renderWordCloudForClass(data, wordCloudTabInfo.effectiveActiveClass);
        }
      }
    
      // ========================================
      // KEYWORD NETWORK - UPDATED with "All Data" tab
      // ========================================
      if (shouldInitNetwork) {
        let initialNetworkClass = activeClass || defaultActiveClass;
        
        const networkTabInfo = createClassTabs(classesArray, (className) => {
          if (window.dbg) dbg("Network tab clicked:", className);
          let textData;
          
          // In NETWORK section - replace the filtering
          if (className === "all") {
            textData = data.map(row => row.text || row.email || "");
          } else {
            const targetClassNum = className.replace('label', '');
            const classData = data.filter(row => {
              // Handle multi-label format
              if (row.labelNames && Array.isArray(row.labelNames)) {
                return row.labelNames.includes(className);
              }
              // Handle single label format
              const rowClass = row.class !== undefined ? row.class : row.label;
              return String(rowClass || 'Unlabeled') === targetClassNum;
            });
            textData = classData.map(row => row.text || row.email || "");
          }
          
          const includeStopwords = document.getElementById("includeStopwords")?.checked || false;
          const topN = parseInt(document.getElementById("topKeywordsInput")?.value, 10) || 100;
          const minCo = parseInt(document.getElementById("minCooccurrenceInput")?.value, 10) || 2;
          window.fetchAndRenderCooccurrence(textData, includeStopwords, topN, minCo, className);
        }, 'network', initialNetworkClass);
        
        if (networkTabInfo) {
          if (window.dbg) dbg("Network tabs created");
          const firstClass = initialNetworkClass;
          let firstTextData;
          
          if (firstClass === "all") {
            firstTextData = data.map(row => row.text || row.email || "");
          } else {
            const targetClassNum = firstClass.replace('label', '');
            const firstClassData = data.filter(row => {
              // Handle multi-label format
              if (row.labelNames && Array.isArray(row.labelNames)) {
                return row.labelNames.includes(firstClass);
              }
              // Handle single label format
              const rowClass = row.class !== undefined ? row.class : row.label;
              return String(rowClass || 'Unlabeled') === targetClassNum;
            });
            firstTextData = firstClassData.map(row => row.text || row.email || "");
          }
          
          const includeStopwords = document.getElementById("includeStopwords")?.checked || false;
          const topN = parseInt(document.getElementById("topKeywordsInput")?.value, 10) || 100;
          const minCo = parseInt(document.getElementById("minCooccurrenceInput")?.value, 10) || 2;
          window.fetchAndRenderCooccurrence(firstTextData, includeStopwords, topN, minCo, firstClass);
        }
      }
    
      // ========================================
      // VOCABULARY COVERAGE - UPDATED with "All Data" tab
      // ========================================
      if (shouldInitCoverage) {
        let initialCoverageClass = activeClass || defaultActiveClass;
        
        const coverageTabInfo = createClassTabs(classesArray, (className) => {
          if (window.dbg) dbg("Coverage tab clicked:", className);
          let textData;
          
          // In COVERAGE section - replace the filtering
          if (className === "all") {
            textData = data.map(row => row.text || row.email || "");
          } else {
            const targetClassNum = className.replace('label', '');
            const classData = data.filter(row => {
              // Handle multi-label format
              if (row.labelNames && Array.isArray(row.labelNames)) {
                return row.labelNames.includes(className);
              }
              // Handle single label format
              const rowClass = row.class !== undefined ? row.class : row.label;
              return String(rowClass || 'Unlabeled') === targetClassNum;
            });
            textData = classData.map(row => row.text || row.email || "");
          }
          
          const includeStopwords = document.getElementById("includeStopwords")?.checked || false;
          const minRank = parseInt(document.getElementById("minRank")?.value, 10) || 1;
          const maxRank = parseInt(document.getElementById("maxRank")?.value, 10) || 10000;
          renderCoverageForClass(textData, includeStopwords, minRank, maxRank, className);
        }, 'coverage', initialCoverageClass);
        
        if (coverageTabInfo) {
          if (window.dbg) dbg("Coverage tabs created");
          const initialClass = initialCoverageClass;
          let textData;
          
          if (initialClass === "all") {
            textData = data.map(row => row.text || row.email || "");
          } else {
            // Multi-label rows carry labelNames rather than a single label.
            // Filter by label (works with expanded multi-label format)
            const classData = data.filter(row => {
              const labelValue = row.label !== undefined ? row.label : row.class;
              return String(labelValue || 'Unlabeled') === className;
            });
            textData = classData.map(row => row.text || row.email || "");
          }
          
          const includeStopwords = document.getElementById("includeStopwords")?.checked || false;
          const minRank = parseInt(document.getElementById("minRank")?.value, 10) || 1;
          const maxRank = parseInt(document.getElementById("maxRank")?.value, 10) || 10000;
          renderCoverageForClass(textData, includeStopwords, minRank, maxRank, initialClass);
        }
      }
    
      // ========================================
      // ZIPF'S LAW - UPDATED with "All Data" tab
      // ========================================
      if (shouldInitZipf) {
        let initialZipfClass = activeClass || defaultActiveClass;
        
        const zipfTabInfo = createClassTabs(classesArray, (className) => {
          if (window.dbg) dbg("Zipf tab clicked:", className);
          let textData;
          
          // In ZIPF section - replace the filtering
          if (className === "all") {
            textData = data.map(row => row.text || row.email || "");
          } else {
            const targetClassNum = className.replace('label', '');
            const classData = data.filter(row => {
              // Handle multi-label format
              if (row.labelNames && Array.isArray(row.labelNames)) {
                return row.labelNames.includes(className);
              }
              // Handle single label format
              const rowClass = row.class !== undefined ? row.class : row.label;
              return String(rowClass || 'Unlabeled') === targetClassNum;
            });
            textData = classData.map(row => row.text || row.email || "");
          }
          
          const includeStopwords = document.getElementById("includeStopwords")?.checked || false;
          renderZipfForClass(textData, includeStopwords, className);
        }, 'zipf', initialZipfClass);
        
        if (zipfTabInfo) {
          if (window.dbg) dbg("Zipf tabs created");
          const initialClass = initialZipfClass;
          let textData;
          
          if (initialClass === "all") {
            textData = data.map(row => row.text || row.email || "");
          } else {
            // Multi-label rows carry labelNames rather than a single label.
            const classData = data.filter(row => {
              const labelValue = row.label !== undefined ? row.label : row.class;
              return String(labelValue || 'Unlabeled') === className;
            });
            textData = classData.map(row => row.text || row.email || "");
          }
          
          const includeStopwords = document.getElementById("includeStopwords")?.checked || false;
          renderZipfForClass(textData, includeStopwords, initialClass);
        }
      }
    }
  
    function initializeVisualizationsPage() {
      // Re-enable pre-rendering (may have been cancelled when user visited /advanced)
      if (typeof window.resetPreRenderState === 'function') {
        window.resetPreRenderState();
      }
  
      if (typeof window.insertPredictiveTabIfNeeded === 'function') {
        window.insertPredictiveTabIfNeeded();
      }
      if (typeof window.updatePreprocessingTabVisibility === 'function') {
        window.updatePreprocessingTabVisibility();
      }
  
      // Restore session data (idempotent)
      if (typeof window.restoreSessionData === 'function') {
        window.restoreSessionData();
      }
  
      const wordLimitSelector = document.getElementById('wordLimit');
      const stopwordCheckbox = document.getElementById('includeStopwords');
  
      const saved = sessionStorage.getItem('textData');
      const uploadedCSV = sessionStorage.getItem('uploadedCSV');
  
      if (!saved && !uploadedCSV) {
        window.location.href = '/overview';
        return;
      }
  
      const data = saved ? JSON.parse(saved) : { text: '' };
      const words = (data.text || '').split(/\n/).filter(Boolean);
      const isLabeled = window.isDatasetLabeled();
  
      const labelDistEl = document.getElementById('labelDistribution');
      if (labelDistEl) {
        labelDistEl.style.display = 'block';
        if (isLabeled && typeof window.renderLabelDistributionChart === 'function') {
          window.renderLabelDistributionChart(words);
        } else if (!isLabeled) {
          window.renderLabelRequiredMessage(labelDistEl, 'Label Distribution');
        }
      }
  
      // ---- Render orchestrator ----
      async function renderAll() {
        const includeStopwords = !!stopwordCheckbox?.checked;
  
        if (isLabeled && uploadedCSV) {
          const sampleRows = window.lastCSVData || [];
          if (!sampleRows.length) {
            console.error('No CSV data available.');
            return;
          }
  
          const existingTabs = document.querySelectorAll('.class-tab');
          const activeClassTab = document.querySelector('.class-tab.active');
          const activeClass = activeClassTab?.dataset.class || window.activeClass || null;
  
          if (existingTabs.length > 0 && activeClass) {
            window.initializeClassSpecificPlots(window.lastCSVData, 'all', activeClass);

            // Pre-render all other class word clouds in the background.
            // Runs 1.5s after initial render to avoid competing with the active class.
            // After this completes, all class tab switches are instant (SVG cache hit).
            if (typeof window.preRenderAllWordClouds === 'function') {
              const allLabels = [...new Set(
                (window.lastCSVData || [])
                  .map(r => {
                    const lbl = r.label !== undefined ? r.label : r.class;
                    return lbl != null ? String(lbl) : null;
                  })
                  .filter(Boolean)
              )].sort();

              // Start immediately - the pause-during-active-render mechanism
              // in _preRenderAllClasses prevents CPU competition
              setTimeout(() => {
                window.preRenderAllWordClouds(
                  window.lastCSVData,
                  ['all', ...allLabels],
                  activeClass || 'all'
                );
              }, 200);  // 100ms lets the active class start its API call first
                }
          } else {
            window.initializeClassSpecificPlots(window.lastCSVData, 'all');
          }
        } else {
          // Unlabeled path
          const rowsForCloud = words.map(line => {
            const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
            return match ? match[2] : line;
          }).filter(Boolean);
  
          // fetchWordFrequency is not exported to window - silent no-op.
          // Use renderWordCloudForClass (same as labeled path) with a
          // manually created container, matching the labeled rendering flow.
          if (typeof window.renderWordCloudForClass === 'function') {
            const wordcloudFlex = document.querySelector('#wordCloud .wordcloud-flex');
            if (wordcloudFlex && !wordcloudFlex.querySelector('.class-tabs-content')) {
              const contentDiv = document.createElement('div');
              contentDiv.className = 'class-tabs-content';
              wordcloudFlex.appendChild(contentDiv);
            }
            window.renderWordCloudForClass(
              window.lastCSVData || rowsForCloud.map(text => ({ text })),
              'all'
            );
          }
  
        }
  
        // Coverage + Zipf for unlabeled (parallel - don't await)
        if (!isLabeled || !uploadedCSV) {
          const rowsForCharts = (window.lastCSVData && window.lastCSVData.length)
            ? window.lastCSVData.map(r => r.text || r.Message || '').filter(Boolean)
            : words.map(line => {
                const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
                return match ? match[2] : line;
              }).filter(Boolean);
  
          const min = parseInt(document.getElementById('minRank')?.value, 10) || 1;
          const max = parseInt(document.getElementById('maxRank')?.value, 10) || Infinity;
  
          if (typeof window.generateCoverageChartServer === 'function') {
            window.generateCoverageChartServer(rowsForCharts, includeStopwords, min, max);
          }
          // Use renderZipfForClass (same as labeled path) so the container
          // context is identical and plot size matches labeled renders.
          if (typeof window.renderZipfForClass === 'function') {
            const zipfFlex = document.querySelector('#zipfPlot .zipf-flex');
            if (zipfFlex && !zipfFlex.querySelector('.class-tabs-content')) {
              const contentDiv = document.createElement('div');
              contentDiv.className = 'class-tabs-content';
              zipfFlex.appendChild(contentDiv);
            }
            window.renderZipfForClass(rowsForCharts, includeStopwords, 'all');
          }

          // Keyword network for unlabeled data - createClassTabs() never
          // runs for unlabeled data, so .class-tabs-content doesn't exist.
          // renderKeywordNetworkForClass requires it - create it manually.
          if (typeof window.fetchAndRenderCooccurrence === 'function') {
            const networkFlex = document.querySelector('#networkContainer .network-flex');
            if (networkFlex && !networkFlex.querySelector('.class-tabs-content')) {
              const contentDiv = document.createElement('div');
              contentDiv.className = 'class-tabs-content';
              networkFlex.appendChild(contentDiv);
            }
            const topN  = parseInt(document.getElementById('topKeywordsInput')?.value, 10) || 100;
            const minCo = parseInt(document.getElementById('minCooccurrenceInput')?.value, 10) || 2;
            window.fetchAndRenderCooccurrence(rowsForCharts, includeStopwords, topN, minCo, 'all');
          }
        }
      }
  
      // Expose to inline html scripts that may invoke them
      window.rerender = function () {
        renderAll();
      };
  
      window.rerenderNetworkOnly = async function () {
        if (!window.lastCSVData) {
          await renderAll();
          return;
        }
        const includeStopwords = !!document.getElementById('includeStopwords')?.checked;
        const topN  = parseInt(document.getElementById('topKeywordsInput')?.value, 10);
        const minCo = parseInt(document.getElementById('minCooccurrenceInput')?.value, 10);
  
        const activeTab = document.querySelector('#networkContainer .class-tab.active');
        const className = activeTab?.dataset.class || 'all';
  
        let classData;
        if (className === 'all') {
          classData = window.lastCSVData;
        } else {
          classData = window.lastCSVData.filter(row => {
            if (Array.isArray(row.labelNames) && row.labelNames.length) {
              return row.labelNames.includes(className);
            }
            const targetClassNum = String(className).replace('label', '');
            const rowClass = row.label !== undefined ? row.label : row.class;
            return String(rowClass == null ? 'Unlabeled' : rowClass) === targetClassNum;
          });
        }
        const rows = classData.map(r => (r.text || '').toString());
        await window.fetchAndRenderCooccurrence(rows, includeStopwords, topN, minCo, className);
      };
  
      // ---- Wire up event listeners ----
      document.getElementById('updateNetworkBtn')?.addEventListener('click', window.rerenderNetworkOnly);
  
      if (wordLimitSelector) {
        wordLimitSelector.addEventListener('change', window.rerender);
      }
  
      if (stopwordCheckbox) {
        stopwordCheckbox.addEventListener('change', _onStopwordsChange);
      }
  
      // Initial render
      window.rerender();
    }
  
    /**
     * When stopwords toggle changes, re-render whichever visualization is active.
     * Replaces the F37 fix from Phase 3.
     */
    function _onStopwordsChange() {
      if (window.wordCloudCache && typeof window.wordCloudCache.clear === 'function') {
        window.wordCloudCache.clear();
      }

      // Unlabeled data has no .class-tab elements - all active-tab lookups
      // below return null and silently skip. Re-run the full render instead.
      if (!window.isDatasetLabeled()) {
        if (typeof window.rerender === 'function') window.rerender();
        return;
      }

      const includeStop = !!document.getElementById('includeStopwords')?.checked;
  
      // Word Cloud
      const activeWcTab = document.querySelector('#wordCloud .class-tab.active');
      if (activeWcTab && window.lastCSVData && typeof window.renderWordCloudForClass === 'function') {
        window.renderWordCloudForClass(window.lastCSVData, activeWcTab.dataset.class);
      }
  
      // Coverage
      const activeCovTab = document.querySelector('#frequencyChart .class-tab.active');
      if (activeCovTab && window.lastCSVData && typeof window.renderCoverageForClass === 'function') {
        const className = activeCovTab.dataset.class;
        const minRank = parseInt(document.getElementById('minRank')?.value, 10) || 1;
        const maxRank = parseInt(document.getElementById('maxRank')?.value, 10) || 10000;
        const textData = _getTextDataForClass(className);
        window.renderCoverageForClass(textData, includeStop, minRank, maxRank, className);
      }
  
      // Zipf
      const activeZipfTab = document.querySelector('#zipfPlot .class-tab.active');
      if (activeZipfTab && window.lastCSVData && typeof window.renderZipfForClass === 'function') {
        const className = activeZipfTab.dataset.class;
        const textData = _getTextDataForClass(className);
        window.renderZipfForClass(textData, includeStop, className);
      }
  
      // Network
      const activeNetTab = document.querySelector('#networkContainer .class-tab.active');
      if (activeNetTab && window.lastCSVData && typeof window.fetchAndRenderCooccurrence === 'function') {
        const className = activeNetTab.dataset.class;
        const topN  = parseInt(document.getElementById('topKeywordsInput')?.value, 10) || 100;
        const minCo = parseInt(document.getElementById('minCooccurrenceInput')?.value, 10) || 2;
        const textData = _getTextDataForClass(className);
        window.fetchAndRenderCooccurrence(textData, includeStop, topN, minCo, className);
      }
    }
  
    function _getTextDataForClass(className) {
      if (className === 'all') {
        return window.lastCSVData.map(r => (r.text || r.email || '').toString());
      }
      const target = String(className).replace('label', '');
      return window.lastCSVData
        .filter(row => {
          if (Array.isArray(row.labelNames) && row.labelNames.length) {
            return row.labelNames.includes(className);
          }
          const rowClass = row.label !== undefined ? row.label : row.class;
          return String(rowClass == null ? 'Unlabeled' : rowClass) === target;
        })
        .map(r => (r.text || r.email || '').toString());
    }
  
    window.initializeClassSpecificPlots = initializeClassSpecificPlots;
    window.initializeVisualizationsPlots = initializeVisualizationsPage;
    })();