/**
 * Multi-class overlap analysis module.
 *
 * Compares term distributions between a target class and all other classes,
 * computing unique-to-target, unique-to-others, and overlapping term sets.
 * Renders bar chart (top terms) and pie chart (term distribution).
 */
(function () {
    'use strict';
  
    let overlapBarChartInstance = null;
    let overlapPieChartInstance = null;
    let currentActiveClass = null;
  
    /**
     * Compute overlap statistics for a target class vs all others.
     *
     * @param {string} targetClass
     * @param {number} [minFrequency=10]
     * @returns {object|null}
     */
    function analyzeMultiClassOverlap(targetClass, minFrequency) {
      minFrequency = minFrequency || 10;
      const data = window.lastCSVData;
      if (!data || !Array.isArray(data) || data.length === 0) return null;
  
      const includeStopwords = document.getElementById('includeStopwords')?.checked || false;
  
      const allLabels = new Set();
      data.forEach(row => {
        const labelValue = row.label !== undefined ? row.label : row.class;
        if (labelValue == null || labelValue === '-1') return;
        if (Array.isArray(labelValue)) {
          labelValue.forEach(l => allLabels.add(String(l)));
        } else {
          allLabels.add(String(labelValue));
        }
      });
  
      const uniqueLabels = [...allLabels].sort();
      if (uniqueLabels.length < 2) return null;
  
      // Build a label-name lookup map (precomputed - faster than repeated O(n) lookups)
      const labelNameMap = {};
      data.forEach(row => {
        const rl = row.label !== undefined ? row.label : row.class;
        if (rl == null) return;
        const key = Array.isArray(rl) ? rl[0] : rl;
        if (labelNameMap[key]) return;
        if (row.labelNames && row.labelNames.length > 0) {
          labelNameMap[key] = row.labelNames[0];
        }
      });
      // Multi-label rows carry their own names; single-label indices resolve
      // through the upload-time map so the user's class names are shown.
      const getLabelName = (idx) => labelNameMap[idx] ||
        (typeof window.classDisplayName === 'function'
          ? window.classDisplayName(idx) : `Class ${idx}`);
  
      const targetClassName = getLabelName(targetClass);
      const otherClasses = uniqueLabels.filter(l => l !== targetClass);
      const otherClassesName = `All Other Classes (${otherClasses.map(getLabelName).join(', ')})`;
  
      const targetClassTerms = {};
      const otherClassesTerms = {};
  
      data.forEach(item => {
        const text = item.text || '';
        const processedText = (typeof window.preprocessText === 'function')
          ? window.preprocessText(text, includeStopwords)
          : text.toLowerCase();
        const tokens = processedText.split(/\s+/).filter(t => t.length > 0);
  
        const itemLabel = item.label !== undefined ? item.label : item.class;
        const isTargetClass = Array.isArray(itemLabel)
          ? itemLabel.includes(targetClass)
          : String(itemLabel) === targetClass;
        const isOtherClass = Array.isArray(itemLabel)
          ? itemLabel.some(l => otherClasses.includes(String(l)))
          : otherClasses.includes(String(itemLabel));
  
        tokens.forEach(token => {
          if (isTargetClass) targetClassTerms[token] = (targetClassTerms[token] || 0) + 1;
          if (isOtherClass)  otherClassesTerms[token] = (otherClassesTerms[token] || 0) + 1;
        });
      });
  
      const filterTerms = (terms) => Object.fromEntries(
        Object.entries(terms).filter(([, freq]) => freq >= minFrequency)
      );
  
      const filteredTargetClass = filterTerms(targetClassTerms);
      const filteredOtherClasses = filterTerms(otherClassesTerms);
  
      const targetKeys = new Set(Object.keys(filteredTargetClass));
      const otherKeys = new Set(Object.keys(filteredOtherClasses));
  
      const overlapTerms = {};
      const uniqueTarget = {};
      const uniqueOther = {};
  
      targetKeys.forEach(term => {
        if (otherKeys.has(term)) {
          overlapTerms[term] = {
            target: filteredTargetClass[term],
            other:  filteredOtherClasses[term],
            total:  filteredTargetClass[term] + filteredOtherClasses[term]
          };
        } else {
          uniqueTarget[term] = filteredTargetClass[term];
        }
      });
  
      otherKeys.forEach(term => {
        if (!targetKeys.has(term)) {
          uniqueOther[term] = filteredOtherClasses[term];
        }
      });
  
      return {
        targetClass: targetClassName,
        otherClasses: otherClassesName,
        uniqueTarget, uniqueOther, overlapTerms,
        targetClassTerms: filteredTargetClass,
        otherClassesTerms: filteredOtherClasses,
        allClasses: uniqueLabels,
        includeStopwords
      };
    }
  
    function createMultiClassOverlapBarChart(overlapData) {
      const canvas = document.getElementById('overlapBarChart');
      if (!canvas) return;
  
      if (overlapBarChartInstance) overlapBarChartInstance.destroy();
  
      const ctx = canvas.getContext('2d');
      const sortByFrequency = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 20);
  
      const uniqueTargetSorted = sortByFrequency(overlapData.uniqueTarget);
      const uniqueOtherSorted  = sortByFrequency(overlapData.uniqueOther);
      const overlapSorted = Object.entries(overlapData.overlapTerms)
        .sort((a, b) => b[1].total - a[1].total).slice(0, 20);
  
      const labels = [
        ...uniqueTargetSorted.map(([term]) => term),
        ...overlapSorted.map(([term]) => term),
        ...uniqueOtherSorted.map(([term]) => term)
      ];
  
      const targetData = [
        ...uniqueTargetSorted.map(([, freq]) => freq),
        ...overlapSorted.map(([, d]) => d.target),
        ...uniqueOtherSorted.map(() => 0)
      ];
  
      const otherData = [
        ...uniqueTargetSorted.map(() => 0),
        ...overlapSorted.map(([, d]) => d.other),
        ...uniqueOtherSorted.map(([, freq]) => freq)
      ];
  
      const axisTitle = window.axisTitle || (text => ({ display: true, text }));
  
      overlapBarChartInstance = new Chart(ctx, {
        type: 'bar',
        indexAxis: 'y',
        data: {
          labels,
          datasets: [
            { label: overlapData.targetClass, data: targetData,
              backgroundColor: 'rgba(54, 162, 235, 0.7)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 },
            { label: overlapData.otherClasses, data: otherData,
              backgroundColor: 'rgba(255, 99, 132, 0.7)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            title: { display: true, text: `${overlapData.targetClass} vs ${overlapData.otherClasses}`, font: { size: 16 } },
            legend: { display: true, position: 'top' },
            tooltip: {
              callbacks: {
                afterLabel: (context) => {
                  const term = labels[context.dataIndex];
                  if (overlapData.overlapTerms[term]) return `Total: ${overlapData.overlapTerms[term].total}`;
                  return '';
                }
              }
            }
          },
          scales: {
            y: { stacked: true, title: axisTitle('Frequency'), ticks: { autoSkip: false } },
            x: { stacked: true, title: axisTitle('Terms') }
          }
        }
      });
    }
  
    function createMultiClassOverlapPieChart(overlapData) {
      const canvas = document.getElementById('overlapPieChart');
      if (!canvas) return;
  
      if (overlapPieChartInstance) overlapPieChartInstance.destroy();
  
      const ctx = canvas.getContext('2d');
      const uniqueTargetCount = Object.keys(overlapData.uniqueTarget).length;
      const uniqueOtherCount  = Object.keys(overlapData.uniqueOther).length;
      const overlapCount      = Object.keys(overlapData.overlapTerms).length;
  
      const uniqueTargetFreq = Object.values(overlapData.uniqueTarget).reduce((a, b) => a + b, 0);
      const uniqueOtherFreq  = Object.values(overlapData.uniqueOther).reduce((a, b) => a + b, 0);
      const overlapFreq      = Object.values(overlapData.overlapTerms).reduce((a, b) => a + b.total, 0);
  
      overlapPieChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: [
            `${overlapData.targetClass} Only (${uniqueTargetCount} terms)`,
            `${overlapData.otherClasses} Only (${uniqueOtherCount} terms)`,
            `Overlap (${overlapCount} terms)`
          ],
          datasets: [{
            data: [uniqueTargetFreq, uniqueOtherFreq, overlapFreq],
            backgroundColor: ['rgba(54, 162, 235, 0.7)', 'rgba(255, 99, 132, 0.7)', 'rgba(255, 206, 86, 0.7)'],
            borderColor:     ['rgba(54, 162, 235, 1)',   'rgba(255, 99, 132, 1)',   'rgba(255, 206, 86, 1)'],
            borderWidth: 2
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            title: { display: true, text: `Term Distribution: ${overlapData.targetClass} vs Others`, font: { size: 16 } },
            legend: { display: true, position: 'bottom' },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const value = context.parsed || 0;
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const percentage = ((value / total) * 100).toFixed(1);
                  return `${context.label}: ${value} occurrences (${percentage}%)`;
                }
              }
            }
          }
        }
      });
    }
  
    function createClassOverlapTabs(uniqueLabels) {
      const tabsContainer = document.getElementById('classOverlapTabs');
      const tabButtonsContainer = document.getElementById('classOverlapTabButtons');
      if (!tabsContainer || !tabButtonsContainer) return;
  
      tabButtonsContainer.innerHTML = '';
  
      uniqueLabels.forEach((label, index) => {
        const tabBtn = document.createElement('button');
        tabBtn.className = 'class-tab' + (index === 0 ? ' active' : '');
        tabBtn.textContent = `Class ${typeof window.classDisplayName === 'function'
          ? window.classDisplayName(label) : label}`;
        tabBtn.dataset.class = label;
  
        tabBtn.addEventListener('click', function () {
          tabButtonsContainer.querySelectorAll('.class-tab').forEach(btn => btn.classList.remove('active'));
          this.classList.add('active');
          currentActiveClass = label;
          updateClassOverlapForClass(label);
        });
  
        tabButtonsContainer.appendChild(tabBtn);
      });
  
      tabsContainer.style.display = 'block';
  
      if (uniqueLabels.length > 0) {
        currentActiveClass = uniqueLabels[0];
      }
    }
  
    function updateClassOverlapForClass(className) {
      const minFrequency = parseInt(document.getElementById('minFrequency')?.value, 10) || 10;
      const overlapData = analyzeMultiClassOverlap(className, minFrequency);
      if (overlapData) {
        createMultiClassOverlapBarChart(overlapData);
        createMultiClassOverlapPieChart(overlapData);
      }
    }
  
    function updateClassOverlap() {
      const minFrequency = parseInt(document.getElementById('minFrequency')?.value, 10) || 10;
  
      if (!window.lastCSVData || !Array.isArray(window.lastCSVData) || window.lastCSVData.length === 0) {
        alert('No data available. Please upload a labeled dataset first.');
        return;
      }
  
      const allLabels = new Set();
      window.lastCSVData.forEach(row => {
        const labelValue = row.label !== undefined ? row.label : row.class;
        if (labelValue == null || labelValue === '-1') return;
        if (Array.isArray(labelValue)) {
          labelValue.forEach(l => allLabels.add(String(l)));
        } else {
          allLabels.add(String(labelValue));
        }
      });
  
      const uniqueLabels = [...allLabels].sort();
      const labelCount = uniqueLabels.length;
  
      if (labelCount < 2) {
        let errorMessage = `Class overlap analysis requires at least 2 classes.\n\n`;
        if (labelCount === 0) {
          errorMessage = `No class labels found in your dataset. Please upload a labeled dataset.`;
        } else if (labelCount === 1) {
          errorMessage += `Your dataset has only 1 class: ${uniqueLabels[0]}\n\n`;
          errorMessage += `Tip: You need at least 2 different classes for overlap analysis.`;
        }
        alert('' + errorMessage);
        return;
      }
  
      const multiClassNotice = document.getElementById('multiClassNotice');
      if (multiClassNotice) {
        multiClassNotice.style.display = labelCount > 2 ? 'block' : 'none';
      }
  
      createClassOverlapTabs(uniqueLabels);
      const classToAnalyze = currentActiveClass || uniqueLabels[0];
      updateClassOverlapForClass(classToAnalyze);
    }
  
    // Expose public API
    window.analyzeMultiClassOverlap = analyzeMultiClassOverlap;
    window.createMultiClassOverlapBarChart = createMultiClassOverlapBarChart;
    window.createMultiClassOverlapPieChart = createMultiClassOverlapPieChart;
    window.createClassOverlapTabs = createClassOverlapTabs;
    window.updateClassOverlapForClass = updateClassOverlapForClass;
    window.updateClassOverlap = updateClassOverlap;
    // Read-only accessor for currentActiveClass
    Object.defineProperty(window, 'currentActiveClass', {
      get: () => currentActiveClass,
      set: (v) => { currentActiveClass = v; },
      configurable: true
    });
  })();