/**
 * Label distribution bar chart (Chart.js).
 * Renders class label counts for labeled CSV data.
 *
 * Consolidates two duplicate implementations:
 *   - generateLabelDistribution (Chunk 1)
 *   - renderLabelDistributionChart (Chunk 5, defined inside DOMContentLoaded)
 * into a single canonical function.
 */
(function () {
    'use strict';
  
    /**
     * Render label distribution from labeled-text lines like "[label0] text..."
     * Handles multi-label format (label0+label1) by counting each label separately.
     *
     * @param {string[]} labeledLines
     */
    function renderLabelDistributionChart(labeledLines) {
      const ctx = document.getElementById('labelChart');
      if (!ctx) return;
  
      const labelCounts = {};
  
      labeledLines.forEach(line => {
        const match = line.match(/^\[([^\]]+)\]/);
        if (!match) return;
        const labelPart = match[1];
        if (labelPart.includes('+')) {
          labelPart.split('+').map(l => l.trim()).forEach(label => {
            labelCounts[label] = (labelCounts[label] || 0) + 1;
          });
        } else {
          labelCounts[labelPart] = (labelCounts[labelPart] || 0) + 1;
        }
      });
  
      const labels = Object.keys(labelCounts).sort();
      const values = labels.map(label => labelCounts[label]);
      // Values stay keyed by the raw label; only the axis shows class names.
      const displayLabels = labels.map(l => (typeof window.classDisplayName === 'function')
        ? window.classDisplayName(l) : l);
  
      // Destroy previous chart instance to avoid Chart.js "Canvas already in use" warning
      if (window.labelChart && typeof window.labelChart.destroy === 'function') {
        window.labelChart.destroy();
      }
  
      const axisTitle = window.axisTitle || (text => ({ display: true, text }));
  
      window.labelChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: displayLabels,
          datasets: [{
            label: 'Count per Class Label',
            data: values,
            backgroundColor: labels.map((_, i) => `hsl(${(i * 45) % 360}, 70%, 60%)`)
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            title: { display: false }
          },
          scales: {
            x: { title: axisTitle('Class Label') },
            y: { beginAtZero: true, title: axisTitle('Count') }
          }
        }
      });
    }
  
    /**
     * Server-backed label distribution rendering.
     * Posts data to /api/label_distribution and renders the response.
     *
     * @param {string[]} lines
     * @returns {Promise<void>}
     */
    async function generateLabelDistribution(lines) {
      const ctx = document.getElementById('labelChart');
      if (!ctx) return;
  
      let labelCounts = {};
      try {
        labelCounts = await window.postJSON('/api/label_distribution', { lines });
      } catch (err) {
        console.error('Label distribution fetch failed:', err);
        return;
      }
  
      const labels = Object.keys(labelCounts);
      const values = labels.map(label => labelCounts[label]);
      const displayLabels = labels.map(l => (typeof window.classDisplayName === 'function')
        ? window.classDisplayName(l) : l);
  
      if (window.labelChart && typeof window.labelChart.destroy === 'function') {
        window.labelChart.destroy();
      }
  
      const axisTitle = window.axisTitle || (text => ({ display: true, text }));
  
      window.labelChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: displayLabels,
          datasets: [{
            label: 'Samples per Label',
            data: values,
            backgroundColor: labels.map((_, i) => `hsl(${i * 40}, 70%, 60%)`)
          }]
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            title: { display: false }
          },
          scales: {
            x: { title: axisTitle('Class Label') },
            y: { beginAtZero: true, title: axisTitle('Count') }
          }
        }
      });
    }
  
    window.renderLabelDistributionChart = renderLabelDistributionChart;
    window.generateLabelDistribution = generateLabelDistribution;
  })();