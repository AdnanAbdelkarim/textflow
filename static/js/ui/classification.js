/**
 * Classification display module.
 * Renders the dataset classification panel on the advanced page,
 * showing class count, distribution, and dataset type.
 */
(function () {
    'use strict';
  
    /**
     * Build a simple horizontal-bar distribution chart for class counts.
     * Bars are capped at 90% width for visual clarity.
     *
     * @param {Object<string, number>} distribution - class -> count
     * @param {number} total - total document count
     * @param {number} maxCount - maximum count across all classes (for scaling)
     * @returns {string} HTML string
     */
    function createDistributionChart(distribution, total, maxCount) {
      const classes = Object.keys(distribution).sort();
      return `
        <div class="distribution-chart">
          ${classes.map(className => {
            const count = distribution[className];
            const percentage = ((count / total) * 100).toFixed(1);
            const width = Math.min(90, (count / maxCount) * 90);
            return `
              <div class="distribution-item">
                <div class="distribution-label">
                  <span class="class-name">Class ${typeof window.classDisplayName === 'function'
                    ? window.classDisplayName(className) : className}</span>
                  <span class="class-stats">${count} (${percentage}%)</span>
                </div>
                <div class="distribution-bar">
                  <div class="bar-fill" style="width: ${width}%"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }
  
    /**
     * Display dataset classification analysis on the advanced page.
     *
     * @param {string} text - the labeled text data (lines starting with [label])
     */
    function displayClassification(text) {
      const container = document.getElementById('classification');
      if (!container) return;
  
      const hasLabels = /^\[([^\]]+)\]/m.test(text);
  
      if (!hasLabels) {
        _renderUnlabeledState(container);
        return;
      }
  
      const classSet = new Set();
      const classDistribution = {};
      const lines = text.split(/\n+/);
  
      lines.forEach(line => {
        const match = line.match(/^\[([^\]]+)\]/);
        if (!match) return;
        const labelPart = match[1];
        if (labelPart.includes('+')) {
          labelPart.split('+').map(l => l.trim()).forEach(label => {
            classSet.add(label);
            classDistribution[label] = (classDistribution[label] || 0) + 1;
          });
        } else {
          classSet.add(labelPart);
          classDistribution[labelPart] = (classDistribution[labelPart] || 0) + 1;
        }
      });
  
      const classCount = classSet.size;
      const totalDocuments = lines.filter(line => /^\[([^\]]+)\]/m.test(line)).length;
      const classificationType = classCount === 2
        ? 'Binary Classification'
        : (classCount > 2 ? 'Multi-class Classification' : 'Single Class');
      const maxCount = Math.max(...Object.values(classDistribution));
  
      container.innerHTML = `
        <details class="classification-section">
          <summary style="font-weight:bold; color:#1f4e79; font-size: 1.1em; cursor: pointer; padding: 10px; background: #f9f9f9; border-radius: 6px;">
            Classification - ${classCount} Class${classCount === 1 ? '' : 'es'} Detected
          </summary>
          <div style="max-height: 700px; overflow-y: auto; padding: 1.5rem; margin-top: 10px;">
            <div class="classification-card">
              <div class="classification-header">
                <div class="classification-badge">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  Document Classification
                </div>
                <div class="classification-status labeled">${classificationType}</div>
              </div>
              <div class="classification-content">
                <div class="classification-summary">
                  <div class="summary-item">
                    <div class="summary-value">${classCount}</div>
                    <div class="summary-label">Classes</div>
                  </div>
                  <div class="summary-item">
                    <div class="summary-value">${totalDocuments}</div>
                    <div class="summary-label">Documents</div>
                  </div>
                  <div class="summary-item">
                    <div class="summary-value">${Math.round(totalDocuments / classCount)}</div>
                    <div class="summary-label">Avg per Class</div>
                  </div>
                </div>
                <div class="class-distribution">
                  <h4>Class Distribution</h4>
                  ${createDistributionChart(classDistribution, totalDocuments, maxCount)}
                </div>
                <div class="classification-details">
                  <div class="detail-item">
                    <span class="detail-label">Dataset Type:</span>
                    <span class="detail-value">${classificationType}</span>
                  </div>
                  <div class="detail-item">
                    <span class="detail-label">Analysis:</span>
                    <span class="detail-value">Ready for Predictive Modeling</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </details>
      `;
    }
  
    function _renderUnlabeledState(container) {
      container.innerHTML = `
        <details class="classification-section">
          <summary style="font-weight: bold; font-size: 1.2em; cursor: pointer; padding: 12px; background: #fafaf8; border-radius: 8px; border: 1px solid #e3e5e2; color: #1b4470;">
            Classification - No Labels Detected
          </summary>
          <div style="max-height: 700px; overflow-y: auto; padding: 1.5rem; margin-top: 10px;">
            <div class="classification-card">
              <div class="classification-header">
                <div class="classification-badge">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/>
                  </svg>
                  Document Classification
                </div>
                <div class="classification-status unlabeled">Unlabeled Document</div>
              </div>
              <div class="classification-content">
                <div class="unlabeled-message">
                  <div class="message-icon"></div>
                  <div class="message-content">
                    <h4>Single Document Analysis</h4>
                    <p>This document is not labeled for classification. To perform predictive modeling, upload a labeled dataset with multiple classes.</p>
                  </div>
                </div>
                <div class="classification-actions">
                  <button class="btn btn-secondary" onclick="showUploadHelp()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 16v-4m0 8h.01M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10z"/>
                    </svg>
                    Upload Requirements
                  </button>
                </div>
              </div>
            </div>
          </div>
        </details>
      `;
    }
  
    window.displayClassification = displayClassification;
    window.createDistributionChart = createDistributionChart;
  })();