// predictive.js - Unified Results Display Version

// --- resilient POST helper (retries 502/503/504) ---
async function postJSONRetry(url, body, {retries=2, backoff=600} = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if ([502,503,504].includes(res.status) && i < retries) {
          await new Promise(r => setTimeout(r, backoff * (i+1)));
          continue;
        }
        const text = await res.text().catch(() => "");
        throw new Error(`${url} ${res.status} ${text}`.trim());
      }
      return res.json();
    } catch (err) {
      if (i < retries) {
        await new Promise(r => setTimeout(r, backoff * (i+1)));
        continue;
      }
      throw err;
    }
  }
}

// Global variables for results storage
let allModelResults = {};
let unifiedROCChart = null;

document.addEventListener("DOMContentLoaded", function () {
  if (!window.isDatasetLabeled()) {
    window.showLabeledDatasetRequiredModal('Predictive Modeling');
    return;
  }
  initializeUI();
  loadPreprocessingInfo();
  initializeEventListeners();
});

function initializeUI() {
  const testSizeSlider = document.getElementById('testSize');
  const testSizeValue = document.getElementById('testSizeValue');
  
  testSizeSlider.addEventListener('input', (e) => {
    testSizeValue.textContent = `${e.target.value}%`;
  });

  testSizeValue.textContent = `${testSizeSlider.value}%`;
  
  // Add this line to toggle models based on Word2Vec
  toggleTransformerModels();
}

function loadPreprocessingInfo() {
  try {
    const preprocessingSettings = sessionStorage.getItem("preprocessingSettings");
    const preprocessingInfo = sessionStorage.getItem("preprocessingInfo");
    const preprocessingApplied = sessionStorage.getItem("preprocessingApplied");
    
    const infoCard = document.getElementById('preprocessingInfo');
    
    if ((preprocessingSettings || preprocessingApplied) && preprocessingInfo) {
      const settings = preprocessingSettings ? JSON.parse(preprocessingSettings) : {};
      const info = JSON.parse(preprocessingInfo);
      
      infoCard.innerHTML = `
        <div class="preprocessing-active">
          <div class="preprocessing-header">
            <span class="status-badge">Preprocessing Applied</span>
            <button id="changePreprocessing" class="change-button">Change</button>
          </div>
          <div class="preprocessing-details">
            <div class="detail-item">
              <strong>Methods:</strong> ${info.methods || getMethodsString(settings)}
            </div>
            <div class="detail-item">
              <strong>Vocabulary:</strong> ${info.vocabularySize ? info.vocabularySize.toLocaleString() : 'N/A'} words
            </div>
            <div class="detail-item">
              <strong>Vector Size:</strong> ${info.vectorSize ? info.vectorSize.toLocaleString() : 'N/A'} features
            </div>
            <div class="detail-item">
              <strong>Documents:</strong> ${info.documentCount ? info.documentCount.toLocaleString() : 'N/A'}
            </div>
          </div>
        </div>
      `;

      document.getElementById('changePreprocessing').addEventListener('click', () => {
        window.location.href = "/preprocessing";
      });

    } else if (preprocessingApplied) {
      infoCard.innerHTML = `
        <div class="preprocessing-active">
          <div class="preprocessing-header">
            <span class="status-badge">Preprocessing Applied</span>
            <button id="changePreprocessing" class="change-button">Change</button>
          </div>
          <div class="preprocessing-details">
            <div class="detail-item">Preprocessing has been applied to your data</div>
          </div>
        </div>
      `;

      document.getElementById('changePreprocessing').addEventListener('click', () => {
        window.location.href = "/preprocessing";
      });

    } else {
      infoCard.innerHTML = `
        <div class="preprocessing-warning">
          <div class="warning-content">
            <strong>No preprocessing applied</strong>
            <p>For better results, consider preprocessing your data first</p>
          </div>
          <button id="goToPreprocessing" class="styled-button btn-secondary btn-small">
            Go to Preprocessing
          </button>
        </div>
      `;

      document.getElementById('goToPreprocessing').addEventListener('click', () => {
        window.location.href = "/preprocessing";
      });
    }
    
    // Add this line to update model visibility based on Word2Vec
    toggleTransformerModels();
    
  } catch (error) {
    console.error("Error loading preprocessing info:", error);
  }
}

function getMethodsString(settings) {
  const methods = [];
  if (settings.useStemming) methods.push('Stemming');
  if (settings.useLemmatization) methods.push('Lemmatization');
  if (settings.useTF) methods.push('TF');
  if (settings.useTFIDF) methods.push('TF-IDF');
  if (settings.useWord2Vec) methods.push('Word2Vec');
  if (settings.useSMOTE) methods.push('SMOTE');
  if (settings.useOversampling) methods.push('Oversampling');
  if (settings.useUndersampling) methods.push('Undersampling');
  return methods.join(', ') || 'Raw Text';
}

function initializeEventListeners() {
  const runBtn = document.getElementById("runModel");
  if (runBtn) {
    runBtn.addEventListener("click", runSelectedModels);
  }

  document.querySelectorAll('.checkbox-card input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const card = e.target.closest('.checkbox-card');
      if (e.target.checked) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
    });
  });
}

function showPreprocessingRequiredModal() {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.className = 'preprocessing-required-modal';
  modal.innerHTML = `
    <div class="modal-overlay"></div>
    <div class="modal-content-centered">
      <div class="modal-header">
        <span class="modal-icon"></span>
        <h3>Preprocessing Required</h3>
      </div>
      <div class="modal-body">
        <p>For optimal model performance, data preprocessing is required before training models.</p>
        <p><strong>Preprocessing includes:</strong></p>
        <ul>
          <li>Text cleaning and normalization</li>
          <li>Stemming or Lemmatization</li>
          <li>TF-IDF vectorization</li>
        </ul>
      </div>
      <div class="modal-footer">
        <button class="styled-button btn-secondary" id="modalBack">
          <span>←</span> Back
        </button>
        <button class="styled-button primary" id="modalGoToPreprocessing">
          Go to Preprocessing <span>→</span>
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Prevent body scroll
  document.body.style.overflow = 'hidden';
  
  // Add event listeners
  document.getElementById('modalBack').addEventListener('click', () => {
    document.body.style.overflow = '';
    modal.remove();
  });
  
  document.getElementById('modalGoToPreprocessing').addEventListener('click', () => {
    window.location.href = "/preprocessing";
  });
  
  // Close on overlay click
  modal.querySelector('.modal-overlay').addEventListener('click', () => {
    document.body.style.overflow = '';
    modal.remove();
  });
  
  // Close on Escape key
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      document.body.style.overflow = '';
      modal.remove();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

async function runSelectedModels() {
  const runBtn = document.getElementById("runModel");
  const originalBtnText = runBtn.innerHTML;
  
  try {
    runBtn.disabled = true;
    runBtn.innerHTML = '<span class="button-icon"></span> Running Models...';
    
    // Check if preprocessing has been applied
    const preprocessingApplied = sessionStorage.getItem("preprocessingApplied");
    const preprocessedData = sessionStorage.getItem("preprocessedData");
    
    if (!preprocessingApplied && !preprocessedData) {
      showNotification('Preprocessing required before running models', 'warning');
      showPreprocessingRequiredModal();
      return;
    }
    
    clearPreviousResults();
    
    const selectedModels = getSelectedModels();
    if (selectedModels.length === 0) {
      showNotification('Please select at least one model to run', 'warning');
      return;
    }
    
    // Run all selected models
    for (const model of selectedModels) {
      await runServerModel(model);
    }
    
    // Display unified results
    displayUnifiedResults(selectedModels);
    
    showNotification('Model training complete', 'success');
    
  } catch (error) {
    console.error("Error running models:", error);
    showNotification('Error running models: ' + error.message, 'error');
  } finally {
    runBtn.disabled = false;
    runBtn.innerHTML = originalBtnText;
  }
}

function getSelectedModels() {
  const selectedModels = [];
  const word2VecUsed = checkWord2VecPreprocessing();
  
  // Traditional ML models - use GDA instead of NB when Word2Vec is used
  if (word2VecUsed) {
    if (document.getElementById("gdaModel")?.checked) selectedModels.push("gda");
  } else {
    if (document.getElementById("nbModel")?.checked) selectedModels.push("nb");
  }
  
  if (document.getElementById("lrModel")?.checked) selectedModels.push("lr");
  if (document.getElementById("knnModel")?.checked) selectedModels.push("knn");
  if (document.getElementById("svmModel")?.checked) selectedModels.push("svm");
  
  // Transformer models - only show if Word2Vec is used
  if (word2VecUsed) {
    if (document.getElementById("bertTinyModel")?.checked) selectedModels.push("bert-tiny");
    if (document.getElementById("bertSmallModel")?.checked) selectedModels.push("bert-small");
    if (document.getElementById("distilbertModel")?.checked) selectedModels.push("distilbert");
    if (document.getElementById("bertModel")?.checked) selectedModels.push("bert");
  }
  
  return selectedModels;
}

function clearPreviousResults() {
  allModelResults = {};
  
  if (unifiedROCChart) {
    unifiedROCChart.destroy();
    unifiedROCChart = null;
  }
  
  // Clear all content areas
  ['accuracyContent', 'reportContent', 'matrixContent', 'rocContent', 'misclassifiedContent'].forEach(id => {
    const elem = document.getElementById(id);
    if (elem) elem.innerHTML = '';
  });
  
  // Hide unified results container
  const unifiedResults = document.getElementById('unifiedResults');
  if (unifiedResults) unifiedResults.style.display = 'none';
}

async function runServerModel(modelType) {
  try {
      const testSize = parseInt(document.getElementById("testSize").value) / 100;
      const randomState = parseInt(document.getElementById("randomState").value);
      
      const preprocessingSettings = JSON.parse(sessionStorage.getItem("preprocessingSettings") || '{}');
      const preprocessingApplied = sessionStorage.getItem("preprocessingApplied") === "true";
      
      const rawData = await loadOriginalData();
      
      if (!rawData || rawData.length === 0) {
          throw new Error('No data available');
      }
      
      const isTransformer = ['bert-tiny', 'bert-small', 'distilbert', 'bert'].includes(modelType);
      
      if (isTransformer) {
          // Use streaming for transformer models
          return await runTransformerWithProgress(modelType, rawData, testSize, randomState, preprocessingApplied, preprocessingSettings);
      } else {
          // Use regular endpoint for traditional ML
          const endpoint = "/api/predict";
          const requestData = {
              rows: rawData,
              model: modelType,
              testSize: testSize,
              randomState: randomState,
              usePreprocessed: preprocessingApplied && Object.keys(preprocessingSettings).length > 0,
              preprocessingSettings: preprocessingSettings
          };
          
          const result = await postJSONRetry(endpoint, requestData, {retries: 2});
          allModelResults[modelType] = result;
          return result;
      }
      
  } catch (error) {
      console.error(`runServerModel failed for ${modelType}:`, error);
      showNotification(`Failed to run ${modelType.toUpperCase()}: ${error.message}`, 'error');
      throw error;
  }
}

async function runTransformerWithProgress(modelType, rawData, testSize, randomState, preprocessingApplied, preprocessingSettings) {
  return new Promise((resolve, reject) => {
      // Create progress modal
      showProgressModal(modelType);
      
      const requestData = {
          rows: rawData,
          model: modelType,
          testSize: testSize,
          randomState: randomState,
          usePreprocessed: preprocessingApplied && Object.keys(preprocessingSettings).length > 0,
          preprocessingSettings: preprocessingSettings
      };
      
      // Use fetch with streaming
      fetch("/api/predict_transformer_stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestData)
      }).then(response => {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          
          function readStream() {
              reader.read().then(({ done, value }) => {
                  if (done) {
                      hideProgressModal();
                      return;
                  }
                  
                  const text = decoder.decode(value);
                  const lines = text.split('\n');
                  
                  for (const line of lines) {
                      if (line.startsWith('data: ')) {
                          const data = JSON.parse(line.substring(6));
                          
                          if (data.error) {
                              hideProgressModal();
                              reject(new Error(data.error));
                              return;
                          }
                          
                          if (data.progress !== undefined) {
                              updateProgressModal(data.progress, data.status);
                          }
                          
                          if (data.result) {
                              allModelResults[modelType] = data.result;
                              hideProgressModal();
                              resolve(data.result);
                              return;
                          }
                      }
                  }
                  
                  readStream();
              });
          }
          
          readStream();
      }).catch(error => {
          hideProgressModal();
          reject(error);
      });
  });
}

function showProgressModal(modelType) {
  const modal = document.createElement('div');
  modal.id = 'trainingProgressModal';
  modal.className = 'training-progress-modal';
  modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content">
          <h3>Training ${getModelName(modelType)}</h3>
          <div class="progress-container">
              <div class="progress-bar">
                  <div class="progress-fill" id="progressFill" style="width: 0%"></div>
              </div>
              <div class="progress-text">
                  <span id="progressPercent">0%</span>
                  <span id="progressStatus">Starting...</span>
              </div>
          </div>
      </div>
  `;
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
}

function updateProgressModal(progress, status) {
  const progressFill = document.getElementById('progressFill');
  const progressPercent = document.getElementById('progressPercent');
  const progressStatus = document.getElementById('progressStatus');
  
  if (progressFill) progressFill.style.width = `${progress}%`;
  if (progressPercent) progressPercent.textContent = `${progress}%`;
  if (progressStatus) progressStatus.textContent = status;
}

function hideProgressModal() {
  const modal = document.getElementById('trainingProgressModal');
  if (modal) {
      modal.remove();
      document.body.style.overflow = '';
  }
}

async function loadOriginalData() {
  return new Promise((resolve, reject) => {
    // FIRST: Try to get multi-label data from sessionStorage
    const storedMultiLabelData = sessionStorage.getItem("lastCSVData");
    if (storedMultiLabelData) {
      try {
        const multiLabelData = JSON.parse(storedMultiLabelData);
        console.log("Predictive Modeling: Using multi-label data from sessionStorage");
        
        // Multi-label rows carry one entry per active label for the same
        // document, so they must be collapsed back to one row per document.
        // Single-label rows must NOT be deduplicated: two documents with
        // identical text are two training examples, and dropping them
        // silently discards data.
        const processed = [];
        // A multi-label document appears once per active label, so the labels
        // are collected back into one row carrying all of them.
        const multiLabelByText = new Map();

        multiLabelData.forEach(row => {
          if (row.text && row.labelNames && Array.isArray(row.labelNames) && row.labelNames.length > 0) {
            const text = row.text.toString().trim();
            if (!multiLabelByText.has(text)) {
              const entry = { text: text, labels: [] };
              multiLabelByText.set(text, entry);
              processed.push(entry);
            }
            const entry = multiLabelByText.get(text);
            row.labelNames.forEach(name => {
              const clean = name.toString().trim();
              if (clean && !entry.labels.includes(clean)) entry.labels.push(clean);
            });
          } else if (row.text && row.label && row.label !== "-1") {
            processed.push({
              text: row.text.toString().trim(),
              label: row.label.toString().trim()
            });
          }
        });

        const filtered = processed.filter(row => row.text && (row.label || (row.labels && row.labels.length)));
        console.log(`Predictive Modeling: ${filtered.length} documents ` +
                    `(${multiLabelByText.size} multi-label documents)`);
        
        // Debug: Show all unique labels found
        const uniqueLabels = [...new Set(filtered.map(row => row.label))];
        console.log(`Unique labels in predictive modeling:`, uniqueLabels);
        console.log(`Label counts:`, uniqueLabels.map(label => ({
          label,
          count: filtered.filter(row => row.label === label).length
        })));
        
        if (filtered.length === 0) {
          reject(new Error("No valid multi-label data found after processing"));
          return;
        }
        
        resolve(filtered);
        return;
        
      } catch (e) {
        console.error("Error parsing multi-label data:", e);
        // Fall through to CSV parsing
      }
    }

    // FALLBACK: Regular CSV parsing (single-label)
    console.log("Predictive Modeling: Falling back to CSV parsing");
    const csvText = sessionStorage.getItem("uploadedCSV");
    if (!csvText) {
      reject(new Error("No data found in session storage"));
      return;
    }

    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: function(results) {
        const data = results.data || [];
        const textCol = sessionStorage.getItem("detectedTextCol");
        const labelCol = sessionStorage.getItem("detectedLabelCol");
        
        if (!textCol || !labelCol || !data.length) {
          reject(new Error("Could not detect text and label columns"));
          return;
        }

        const processed = data.map(row => ({
          text: row[textCol]?.toString().trim(),
          label: row[labelCol]?.toString().trim()
        })).filter(row => row.text && row.label);
        
        console.log(`CSV fallback: ${processed.length} entries`);
        console.log(`CSV unique labels:`, [...new Set(processed.map(row => row.label))]);
        
        resolve(processed);
      },
      error: function(error) {
        reject(error);
      }
    });
  });
}

// ===== UNIFIED RESULTS DISPLAY =====

function displayUnifiedResults(selectedModels) {
  const unifiedResults = document.getElementById('unifiedResults');
  if (!unifiedResults) return;
  
  // Show the unified results container
  unifiedResults.style.display = 'flex';
  
  // Populate each section with model subsections
  populateAccuracyMetrics(selectedModels);
  populateClassificationReports(selectedModels);
  populateConfusionMatrices(selectedModels);
  populateUnifiedROC(selectedModels);
  populateMisclassifiedDocuments(selectedModels);
  
}

// Multi-label results report Hamming loss and F1 averages rather than
// accuracy, because a prediction can be partly correct.
function renderMultiLabelMetrics(model, modelName, result) {
  const m = result.metrics;
  const stats = result.label_statistics || {};
  const note = (result.resampling && result.resampling.note)
    ? `<div class="info-box" style="margin-top:10px;">${result.resampling.note}</div>` : '';
  return `
      <div class="model-subsection">
          <div class="model-subsection-header" onclick="toggleSubsection(this)">
              <h5 style="color: ${getModelColor(model)};">
                  <span class="model-icon">●</span> ${modelName}
              </h5>
              <span class="collapse-icon">▼</span>
          </div>
          <div class="model-subsection-content">
              <div class="metrics-grid">
                  <div class="metric-card primary">
                      <div class="metric-value">${m.hamming_loss.toFixed(4)}</div>
                      <div class="metric-label">Hamming Loss (lower is better)</div>
                  </div>
                  <div class="metric-card success">
                      <div class="metric-value">${(m.f1_macro * 100).toFixed(2)}%</div>
                      <div class="metric-label">F1-Macro</div>
                  </div>
                  <div class="metric-card warning">
                      <div class="metric-value">${(m.f1_micro * 100).toFixed(2)}%</div>
                      <div class="metric-label">F1-Micro</div>
                  </div>
                  <div class="metric-card info">
                      <div class="metric-value">${(m.subset_accuracy * 100).toFixed(2)}%</div>
                      <div class="metric-label">Exact Match</div>
                  </div>
              </div>
              <p style="margin-top:10px;color:#555;">
                ${result.labels.length} labels, ${stats.label_cardinality ? stats.label_cardinality.toFixed(2) : '-'}
                labels per document on average. ${result.model_implementation}.
              </p>
              ${note}
          </div>
      </div>`;
}

function renderPerLabelTable(result) {
  const rows = (result.per_label || []).map(p => `
      <tr>
        <td style="padding:4px 10px;">${p.label}</td>
        <td style="padding:4px 10px;text-align:right;">${(p.precision * 100).toFixed(1)}%</td>
        <td style="padding:4px 10px;text-align:right;">${(p.recall * 100).toFixed(1)}%</td>
        <td style="padding:4px 10px;text-align:right;">${(p.f1 * 100).toFixed(1)}%</td>
        <td style="padding:4px 10px;text-align:right;">${p.support}</td>
      </tr>`).join('');
  return `
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:2px solid #ddd;text-align:left;">
          <th style="padding:6px 10px;">Label</th>
          <th style="padding:6px 10px;text-align:right;">Precision</th>
          <th style="padding:6px 10px;text-align:right;">Recall</th>
          <th style="padding:6px 10px;text-align:right;">F1</th>
          <th style="padding:6px 10px;text-align:right;">Support</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
}

function multiLabelNotice(what) {
  return `<div class="info-box">${what} is defined for single-label
          classification. This dataset is multi-label, so the per-label scores
          are shown under Classification Report instead.</div>`;
}

function populateAccuracyMetrics(selectedModels) {
  const container = document.getElementById('accuracyContent');
  if (!container) return;
  
  let html = '';
  selectedModels.forEach(model => {
      const result = allModelResults[model];
      if (!result) return;
      
      const modelName = getModelName(model);

      if (result.task === 'multilabel') {
        html += renderMultiLabelMetrics(model, modelName, result);
        return;
      }

      const accuracy = (result.metrics.accuracy * 100).toFixed(2);
      const precision = (result.metrics.precision * 100).toFixed(2);
      const recall = (result.metrics.recall * 100).toFixed(2);
      const f1 = (result.metrics.f1 * 100).toFixed(2);
      
      html += `
          <div class="model-subsection">
              <div class="model-subsection-header" onclick="toggleSubsection(this)">
                  <h5 style="color: ${getModelColor(model)};">
                      <span class="model-icon">●</span> ${modelName}
                  </h5>
                  <span class="collapse-icon">▼</span>
              </div>
              <div class="model-subsection-content">
                  <div class="metrics-grid">
                      <div class="metric-card primary">
                          <div class="metric-value">${accuracy}%</div>
                          <div class="metric-label">Accuracy</div>
                      </div>
                      <div class="metric-card success">
                          <div class="metric-value">${precision}%</div>
                          <div class="metric-label">Precision</div>
                      </div>
                      <div class="metric-card warning">
                          <div class="metric-value">${recall}%</div>
                          <div class="metric-label">Recall</div>
                      </div>
                      <div class="metric-card info">
                          <div class="metric-value">${f1}%</div>
                          <div class="metric-label">F1-Score</div>
                      </div>
                  </div>
              </div>
          </div>
      `;
  });
  
  container.innerHTML = html;
}

function populateClassificationReports(selectedModels) {
  const container = document.getElementById('reportContent');
  if (!container) return;
  
  let html = '';
  selectedModels.forEach(model => {
      const result = allModelResults[model];
      if (!result) return;
      if (result.task === 'multilabel') {
        html += `<div class="model-subsection">` +
                `<div class="model-subsection-header">` +
                `<h5 style="color: ${getModelColor(model)};">` +
                `<span class="model-icon">\u25cf</span> ${getModelName(model)}</h5></div>` +
                `<div class="model-subsection-content">${renderPerLabelTable(result)}</div></div>`;
        return;
      }
      
      const modelName = getModelName(model);
      
      html += `
          <div class="model-subsection">
              <div class="model-subsection-header" onclick="toggleSubsection(this)">
                  <h5 style="color: ${getModelColor(model)};">
                      <span class="model-icon">●</span> ${modelName}
                  </h5>
                  <span class="collapse-icon">▼</span>
              </div>
              <div class="model-subsection-content">
                  <div class="classification-report">
                      ${renderClassificationReport(result.classification_report)}
                  </div>
              </div>
          </div>
      `;
  });
  
  container.innerHTML = html;
}

function populateConfusionMatrices(selectedModels) {
  const container = document.getElementById('matrixContent');
  if (!container) return;
  
  container.innerHTML = '';
  
  selectedModels.forEach(model => {
      const result = allModelResults[model];
      if (!result) return;
      if (result.task === 'multilabel') {
        container.insertAdjacentHTML('beforeend', multiLabelNotice('A confusion matrix'));
        return;
      }

      const modelName = getModelName(model);
      const sortedLabels = sortLabels([...new Set([...result.y_true, ...result.y_pred])]);
      const matrix = buildConfusionMatrix(result.y_true, result.y_pred, sortedLabels);
      
      const subsection = document.createElement('div');
      subsection.className = 'model-subsection';
      
      const header = document.createElement('div');
      header.className = 'model-subsection-header';
      header.onclick = function() { toggleSubsection(this); };
      header.innerHTML = `
          <h5 style="color: ${getModelColor(model)};">
              <span class="model-icon">●</span> ${modelName}
          </h5>
          <span class="collapse-icon">▼</span>
      `;
      subsection.appendChild(header);
      
      const content = document.createElement('div');
      content.className = 'model-subsection-content';
      
      const matrixWrapper = document.createElement('div');
      matrixWrapper.className = 'matrix-wrapper';
      content.appendChild(matrixWrapper);
      
      subsection.appendChild(content);
      
      renderConfusionMatrix(matrix, sortedLabels, matrixWrapper);
      
      container.appendChild(subsection);
  });
}

function populateUnifiedROC(selectedModels) {
  console.log('populateUnifiedROC called with models:', selectedModels);
  const container = document.getElementById('rocContent');
  if (!container) {
      console.error('rocContent container not found');
      return;
  }
  
  container.innerHTML = '';

  // An ROC curve needs one score per document against one positive class,
  // which a multi-label prediction does not provide.
  if (selectedModels.some(m => allModelResults[m] && allModelResults[m].task === 'multilabel')) {
      container.innerHTML = multiLabelNotice('An ROC curve');
      return;
  }

  const binaryModels = selectedModels.filter(model => {
      const result = allModelResults[model];
      if (!result) return false;
      const uniqueLabels = [...new Set(result.y_true)];
      return uniqueLabels.length === 2;
  });
  
  if (binaryModels.length === 0) {
      container.innerHTML = `
          <div class="roc-notice">
              <p>ROC curves require binary classification. The selected models have multi-class outputs.</p>
          </div>
      `;
      return;
  }
  
  binaryModels.forEach((model, index) => {
      const result = allModelResults[model];
      const modelName = getModelName(model);
      
      const subsection = document.createElement('div');
      subsection.className = 'model-subsection';
      subsection.style.width = '100%';
      subsection.style.marginBottom = '15px';
      
      const header = document.createElement('div');
      header.className = 'model-subsection-header';
      header.onclick = function() { toggleSubsection(this); };
      
      header.innerHTML = `
          <h5 style="color: ${getModelColor(model)};">
              <span class="model-icon">●</span> ${modelName}
          </h5>
          <span class="collapse-icon">▼</span>
      `;
      subsection.appendChild(header);
      
      const content = document.createElement('div');
      content.className = 'model-subsection-content';
      
      const canvasWrapper = document.createElement('div');
      canvasWrapper.className = 'roc-canvas-wrapper';
      canvasWrapper.style.width = '100%';
      canvasWrapper.style.height = '500px';
      canvasWrapper.style.position = 'relative';
      
      const canvas = document.createElement('canvas');
      canvas.id = `rocChart_${model}`;
      canvasWrapper.appendChild(canvas);
      
      content.appendChild(canvasWrapper);
      subsection.appendChild(content);
      container.appendChild(subsection);
      
      // Render chart after DOM is ready
      setTimeout(() => {
          renderIndividualROCChart(canvas, model);
      }, 100);
  });
}

function renderUnifiedROCChart(canvas, models) {
  console.log('renderUnifiedROCChart called with models:', models);
  
  const ctx = canvas.getContext('2d');
  
  if (unifiedROCChart) {
    unifiedROCChart.destroy();
  }

  // Build datasets with better point styling
  const datasets = [];
  
  models.forEach(model => {
    const result = allModelResults[model];
    const color = getModelColor(model);
    const auc = calculateAUC(result);
    const modelName = getModelName(model);
    const points = calculateROCPoints(result);
    const { tpr, fpr } = calculateKeyMetrics(result);
    
    console.log(`${modelName} - Points count:`, points.length);
    console.log(`${modelName} - Points:`, points);

    datasets.push({
      label: `${modelName} (AUC: ${auc.toFixed(3)})`,
      data: points,
      borderColor: color,
      backgroundColor: color + '40', // Semi-transparent fill
      borderWidth: 3,
      pointRadius: points.map((point, index) => {
        // Make key points larger (start, end, and middle points)
        return index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2) ? 6 : 2;
      }),
      pointHoverRadius: 8,
      pointBackgroundColor: color,
      pointBorderColor: '#fff',
      pointBorderWidth: 1,
      tension: 0.2,
      fill: false,
      showLine: true
    });
  });

  console.log('Final datasets:', datasets);

  unifiedROCChart = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          position: 'bottom',
          title: {
            display: true,
            text: 'False Positive Rate',
            font: {
              size: 16,
              weight: 'bold'
            },
            color: '#333'
          },
          min: 0,
          max: 1,
          grid: {
            color: '#e3e5e2',
            lineWidth: 1
          },
          ticks: {
            font: {
              size: 12
            },
            stepSize: 0.2,
            color: '#666'
          }
        },
        y: {
          type: 'linear',
          title: {
            display: true,
            text: 'True Positive Rate',
            font: {
              size: 16,
              weight: 'bold'
            },
            color: '#333'
          },
          min: 0,
          max: 1,
          grid: {
            color: '#e3e5e2',
            lineWidth: 1
          },
          ticks: {
            font: {
              size: 12
            },
            stepSize: 0.2,
            color: '#666'
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: 'ROC Curves - Model Comparison',
          font: {
            size: 20,
            weight: 'bold'
          },
          padding: 20,
          color: '#333'
        },
        legend: {
          position: 'bottom',
          labels: {
            font: {
              size: 14
            },
            padding: 15,
            usePointStyle: true,
            pointStyle: 'circle',
            color: '#333'
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleFont: {
            size: 14
          },
          bodyFont: {
            size: 13
          },
          padding: 12,
          callbacks: {
            label: function(context) {
              const dataset = context.dataset;
              const point = dataset.data[context.dataIndex];
              const modelName = dataset.label.split(' (')[0];
              return `${modelName}: FPR = ${point.x.toFixed(3)}, TPR = ${point.y.toFixed(3)}`;
            }
          }
        }
      },
      interaction: {
        intersect: false,
        mode: 'nearest'
      }
    }
  });
}

function populateMisclassifiedDocuments(selectedModels) {
  const container = document.getElementById('misclassifiedContent');
  if (!container) return;
  
  container.innerHTML = '';
  
  selectedModels.forEach(model => {
      const result = allModelResults[model];
      if (!result) return;
      if (result.task === 'multilabel') {
        container.insertAdjacentHTML('beforeend',
          multiLabelNotice('Misclassified document inspection'));
        return;
      }

      const sortedLabels = sortLabels([...new Set([...result.y_true, ...result.y_pred])]);
      
      // Only show misclassified for binary classification
      if (sortedLabels.length !== 2) return;
      
      const modelName = getModelName(model);
      
      const subsection = document.createElement('div');
      subsection.className = 'model-subsection';
      
      const header = document.createElement('div');
      header.className = 'model-subsection-header';
      header.onclick = function() { toggleSubsection(this); };
      header.innerHTML = `
          <h5 style="color: ${getModelColor(model)};">
              <span class="model-icon">●</span> ${modelName}
          </h5>
          <span class="collapse-icon">▼</span>
      `;
      subsection.appendChild(header);
      
      const content = document.createElement('div');
      content.className = 'model-subsection-content';
      subsection.appendChild(content);
      
      // Pass model type to addMisclassifiedSection
      addMisclassifiedSection(content, result, model);
      
      container.appendChild(subsection);
  });
  
  // If no binary models, show message
  if (container.children.length === 0) {
      container.innerHTML = `
          <div class="roc-notice">
              <p>Misclassified documents analysis is only available for binary classification.</p>
          </div>
      `;
  }
}

// Render individual ROC chart for a single model (for collapsible sections)
function renderIndividualROCChart(canvas, model) {
  const result = allModelResults[model];
  const ctx = canvas.getContext('2d');
  
  const color = getModelColor(model);
  const auc = calculateAUC(result);
  const modelName = getModelName(model);
  const points = calculateROCPoints(result);

  if (window[`rocChart_${model}`] && typeof window[`rocChart_${model}`].destroy === 'function') {
    window[`rocChart_${model}`].destroy();
    window[`rocChart_${model}`] = null;
  }

  // Held on window so a re-render can destroy the previous instance.
  window[`rocChart_${model}`] = new Chart(ctx, {
      type: 'scatter',
      data: {
          datasets: [{
              label: `${modelName} (AUC: ${auc.toFixed(3)})`,
              data: points,
              borderColor: color,
              backgroundColor: color + '40',
              borderWidth: 3,
              pointRadius: points.map((point, index) => {
                  return index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2) ? 6 : 2;
              }),
              pointHoverRadius: 8,
              pointBackgroundColor: color,
              pointBorderColor: '#fff',
              pointBorderWidth: 1,
              tension: 0.2,
              fill: false,
              showLine: true
          }]
      },
      options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
              x: {
                  type: 'linear',
                  position: 'bottom',
                  title: {
                      display: true,
                      text: 'False Positive Rate',
                      font: {
                          size: 16,
                          weight: 'bold'
                      },
                      color: '#333'
                  },
                  min: 0,
                  max: 1,
                  grid: {
                      color: '#e3e5e2',
                      lineWidth: 1
                  },
                  ticks: {
                      font: {
                          size: 13
                      },
                      stepSize: 0.2,
                      color: '#666'
                  }
              },
              y: {
                  type: 'linear',
                  title: {
                      display: true,
                      text: 'True Positive Rate',
                      font: {
                          size: 16,
                          weight: 'bold'
                      },
                      color: '#333'
                  },
                  min: 0,
                  max: 1,
                  grid: {
                      color: '#e3e5e2',
                      lineWidth: 1
                  },
                  ticks: {
                      font: {
                          size: 13
                      },
                      stepSize: 0.2,
                      color: '#666'
                  }
              }
          },
          plugins: {
              title: {
                  display: true,
                  text: `ROC Curve - ${modelName}`,
                  font: {
                      size: 18,
                      weight: 'bold'
                  },
                  padding: 20,
                  color: '#333'
              },
              legend: {
                  position: 'bottom',
                  labels: {
                      font: {
                          size: 14
                      },
                      padding: 15,
                      usePointStyle: true,
                      pointStyle: 'circle',
                      color: '#333'
                  }
              },
              tooltip: {
                  backgroundColor: 'rgba(0, 0, 0, 0.8)',
                  titleFont: {
                      size: 14
                  },
                  bodyFont: {
                      size: 13
                  },
                  padding: 12,
                  callbacks: {
                      label: function(context) {
                          const point = context.raw;
                          return `FPR: ${point.x.toFixed(3)}, TPR: ${point.y.toFixed(3)}`;
                      }
                  }
              }
          },
          interaction: {
              intersect: false,
              mode: 'nearest'
          }
      }
  });
}

// Add this helper function to calculate key metrics
function calculateKeyMetrics(result) {
  if (!result || !result.y_true || !result.y_pred) {
    return { tpr: 'N/A', fpr: 'N/A' };
  }
  
  let tp = 0, fp = 0, tn = 0, fn = 0;
  
  for (let i = 0; i < result.y_true.length; i++) {
    const actual = result.y_true[i];
    const predicted = result.y_pred[i];
    
    if (actual === "1" && predicted === "1") tp++;
    else if (actual === "0" && predicted === "1") fp++;
    else if (actual === "0" && predicted === "0") tn++;
    else if (actual === "1" && predicted === "0") fn++;
  }
  
  const tpr = (tp + fn) > 0 ? (tp / (tp + fn)).toFixed(3) : '0.000';
  const fpr = (fp + tn) > 0 ? (fp / (fp + tn)).toFixed(3) : '0.000';
  
  return { tpr, fpr };
}





// ===== UTILITY FUNCTIONS =====

function sortLabels(labels) {
  return [...labels].sort((a, b) => {
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    
    if (!isNaN(numA) && isNaN(numB)) return -1;
    if (isNaN(numA) && !isNaN(numB)) return 1;
    
    return a.localeCompare(b);
  });
}

function buildConfusionMatrix(actual, predicted, labels) {
  // Map lookup is O(1); indexOf over the label list is O(n) per document.
  const indexMap = new Map(labels.map((label, idx) => [label, idx]));
  const matrix = Array.from({ length: labels.length }, () => Array(labels.length).fill(0));

  actual.forEach((a, i) => {
    const ai = indexMap.get(a);
    const pi = indexMap.get(predicted[i]);
    if (ai !== undefined && pi !== undefined) {
      matrix[ai][pi]++;
    }
  });

  return matrix;
}

function renderConfusionMatrix(matrix, labels, container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'confusion-matrix-section';
  
  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'matrix-table-wrapper';
  
  const table = document.createElement('table');
  table.className = 'confusion-matrix interactive-matrix';
  
  // Header row
  const headerRow = document.createElement('tr');
  headerRow.appendChild(createMatrixCell('Actual \\ Predicted', 'header corner'));
  labels.forEach(label => {
    headerRow.appendChild(createMatrixCell(`Pred: ${label}`, 'header'));
  });
  table.appendChild(headerRow);
  
  // Data rows
  const maxVal = Math.max(...matrix.flat());
  matrix.forEach((row, rowIndex) => {
    const dataRow = document.createElement('tr');
    dataRow.appendChild(createMatrixCell(`Actual: ${labels[rowIndex]}`, 'row-header'));
    
    row.forEach((cellValue, colIndex) => {
      const cellElement = createMatrixCell(cellValue, 'data');
      cellElement.dataset.row = rowIndex;
      cellElement.dataset.col = colIndex;
      cellElement.dataset.actual = labels[rowIndex];
      cellElement.dataset.predicted = labels[colIndex];
      cellElement.dataset.count = cellValue;
      
      const isDiagonal = rowIndex === colIndex;
      if (isDiagonal) {
        cellElement.classList.add('correct-prediction');
      } else {
        cellElement.classList.add('incorrect-prediction');
      }
      
      // Add intensity styling
      const intensity = maxVal > 0 ? cellValue / maxVal : 0;
      if (isDiagonal) {
        cellElement.style.background = `rgba(46, 125, 50, ${0.2 + intensity * 0.8})`;
      } else {
        cellElement.style.background = `rgba(211, 47, 47, ${0.1 + intensity * 0.7})`;
      }
      
      // Add interactivity
      cellElement.style.cursor = 'pointer';
      cellElement.style.transition = 'all 0.2s ease';
      
      cellElement.addEventListener('click', function(e) {
        e.preventDefault(); // Prevent default click behavior
        this.blur(); // Remove focus from the element
        highlightMatrixCell(table, this);
      });
      
      cellElement.addEventListener('mouseenter', function() {
        this.style.transform = 'scale(1.1)';
        this.style.zIndex = '10';
        this.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
      });
      
      cellElement.addEventListener('mouseleave', function() {
        if (!this.classList.contains('highlighted')) {
          this.style.transform = 'scale(1)';
          this.style.zIndex = '1';
          this.style.boxShadow = 'none';
        }
      });
      
      dataRow.appendChild(cellElement);
    });
    table.appendChild(dataRow);
  });
  
  tableWrapper.appendChild(table);
  wrapper.appendChild(tableWrapper);
  
  // Add legend
  const legend = document.createElement('div');
  legend.className = 'matrix-legend';
  legend.innerHTML = `
    <div class="legend-item">
      <div class="legend-box correct"></div>
      <span>Correct Predictions (Diagonal)</span>
    </div>
    <div class="legend-item">
      <div class="legend-box incorrect"></div>
      <span>Misclassifications (Off-diagonal)</span>
    </div>
  `;
  wrapper.appendChild(legend);
  
  container.appendChild(wrapper);
}

function highlightMatrixCell(table, clickedCell) {
  const row = clickedCell.dataset.row;
  const col = clickedCell.dataset.col;
  const actual = clickedCell.dataset.actual;
  const predicted = clickedCell.dataset.predicted;
  const count = clickedCell.dataset.count;
  
  // Remove previous highlights
  const allCells = table.querySelectorAll('.data');
  allCells.forEach(cell => {
    cell.classList.remove('highlighted', 'row-highlight', 'col-highlight');
    if (!cell.classList.contains('highlighted')) {
      cell.style.transform = 'scale(1)';
      cell.style.zIndex = '1';
      cell.style.boxShadow = 'none';
    }
  });
  
  // Add new highlights
  clickedCell.classList.add('highlighted');
  clickedCell.style.transform = 'scale(1.15)';
  clickedCell.style.zIndex = '20';
  clickedCell.style.boxShadow = '0 0 0 3px #1f4e79';
  
  allCells.forEach(cell => {
    if (cell.dataset.row === row && cell !== clickedCell) {
      cell.classList.add('row-highlight');
      cell.style.opacity = '0.6';
    }
    if (cell.dataset.col === col && cell !== clickedCell) {
      cell.classList.add('col-highlight');
      cell.style.opacity = '0.6';
    }
  });
  
  // Show info toast
  showMatrixInfo(actual, predicted, count);
}

function showMatrixInfo(actual, predicted, count) {
  const existingToast = document.querySelector('.matrix-info-toast');
  if (existingToast) existingToast.remove();
  
  const toast = document.createElement('div');
  toast.className = 'matrix-info-toast';
  toast.innerHTML = `
    <strong>${count}</strong> document${count != 1 ? 's' : ''}
    <div class="toast-detail">Actual: <span class="highlight-text">${actual}</span></div>
    <div class="toast-detail">Predicted: <span class="highlight-text">${predicted}</span></div>
  `;
  
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function createMatrixCell(content, className) {
  const cell = document.createElement('td');
  cell.className = `matrix-cell ${className}`;
  cell.textContent = content;
  return cell;
}

function renderClassificationReport(reportText) {
  if (!reportText || typeof reportText !== 'string') {
    return '<div class="report-error">Classification report not available</div>';
  }
  
  const lines = reportText.split('\n').filter(line => line.trim());
  
  let html = '<div class="classification-report-section">';
  html += '<div class="report-table-wrapper">';
  html += '<div class="report-table">';
  
  lines.forEach((line, index) => {
    if (index === 0) {
      // Header row - split by multiple spaces to preserve column alignment
      const headers = line.trim().split(/\s{2,}/).filter(cell => cell.trim());
      html += '<div class="report-row header-row">';
      html += `<span class="report-cell header-cell">Class</span>`;
      headers.forEach(header => {
        html += `<span class="report-cell header-cell">${header.trim()}</span>`;
      });
      html += '</div>';
    } else {
      // Split by 2+ spaces to preserve multi-word labels
      const parts = line.trim().split(/\s{2,}/);
      if (parts.length >= 4) {
        const label = parts[0].trim();
        const values = parts.slice(1);
        
        const isAverageRow = label.toLowerCase().includes('avg') || 
                            label.toLowerCase().includes('macro') || 
                            label.toLowerCase().includes('weighted') ||
                            label.toLowerCase().includes('accuracy');
        
        html += `<div class="report-row ${isAverageRow ? 'avg-row' : ''}">`;
        html += `<span class="report-cell label-cell">${label}</span>`;
        
        values.forEach(value => {
          html += `<span class="report-cell value-cell">${value.trim()}</span>`;
        });
        
        html += '</div>';
      }
    }
  });
  
  html += '</div>'; // report-table
  html += '</div>'; // report-table-wrapper
  html += '</div>'; // classification-report-section
  return html;
}

function renderErrorList(errors, modelType, errorType) {
  return `
    <ul class="doc-list">
      ${errors.map((error, idx) => {
        // Create unique ID using model type and error type
        const uniqueId = `${modelType}-${errorType}-${idx}`;
        return `
        <li class="doc-item" data-doc-index="${uniqueId}">
          <div class="doc-header">
            <span class="doc-number">Doc ${error.index}</span>
            <span class="doc-badge">
              <span class="badge-label">Predicted:</span>
              <span class="badge-value predicted">${error.predicted}</span>
              <span class="badge-separator">→</span>
              <span class="badge-label">Actual:</span>
              <span class="badge-value actual">${error.actual}</span>
            </span>
            <button class="expand-btn" data-doc-index="${uniqueId}">
              <svg class="expand-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" fill="none"/>
              </svg>
            </button>
          </div>
          <div class="doc-content" id="doc-content-${uniqueId}" style="display: none;">
            <div class="doc-text-container">
              <div class="doc-text-label">Document Text:</div>
              <div class="doc-text">${error.text}</div>
            </div>
          </div>
        </li>
      `}).join('')}
    </ul>
  `;
}

function addMisclassifiedSection(container, result, modelType) {
  const type1Errors = [];  // False Positives: Predicted 1, Actual 0
  const type2Errors = [];  // False Negatives: Predicted 0, Actual 1
  
  // Check if we have misclassified document texts
  if (result.misclassified && result.misclassified.length > 0) {
    // If misclassified texts are provided, match them with predictions
    let misclassifiedIndex = 0;
    result.y_true.forEach((actual, i) => {
      const predicted = result.y_pred[i];
      
      // Only process actually misclassified instances
      if (actual !== predicted) {
        const errorData = {
          index: i + 1,
          text: result.misclassified[misclassifiedIndex] || `Instance ${i + 1}`,
          actual: actual,
          predicted: predicted
        };
        
        // Type I Error (False Positive): Predicted 1, Actual 0
        if (predicted === "1" && actual === "0") {
          type1Errors.push(errorData);
        } 
        // Type II Error (False Negative): Predicted 0, Actual 1
        else if (predicted === "0" && actual === "1") {
          type2Errors.push(errorData);
        } 
        // Multi-class misclassification
        else {
          type1Errors.push(errorData);
        }
        
        misclassifiedIndex++;
      }
    });
  } else {
    // No misclassified texts provided; fall back to indices.
    result.y_true.forEach((actual, i) => {
      const predicted = result.y_pred[i];
      
      // Only process actually misclassified instances
      if (actual !== predicted) {
        const errorData = {
          index: i + 1,
          text: `Document ${i + 1} - Predicted: ${predicted}, Actual: ${actual}`,
          actual: actual,
          predicted: predicted
        };
        
        // Type I Error (False Positive): Predicted 1, Actual 0
        if (predicted === "1" && actual === "0") {
          type1Errors.push(errorData);
        } 
        // Type II Error (False Negative): Predicted 0, Actual 1
        else if (predicted === "0" && actual === "1") {
          type2Errors.push(errorData);
        } 
        // Multi-class misclassification
        else {
          type1Errors.push(errorData);
        }
      }
    });
  }
  
  const totalErrors = type1Errors.length + type2Errors.length;
  
  const misclassifiedDiv = document.createElement('div');
  misclassifiedDiv.className = 'misclassified-content-wrapper';
  
  if (totalErrors === 0) {
    misclassifiedDiv.innerHTML = `
      <div class="success-message">
        <span class="success-icon"></span>
        <span>No misclassified documents.</span>
      </div>
    `;
  } else {
    misclassifiedDiv.innerHTML = `
      <div class="error-analysis">
        <div class="error-type">
          <h5>Type I Errors (False Positives): ${type1Errors.length}</h5>
          <p style="color: #666; font-size: 0.9em; margin: 5px 0 15px 0;">Model predicted positive (1) but actual was negative (0)</p>
          <div class="error-list">
            ${type1Errors.length > 0 ? renderErrorList(type1Errors, modelType, 'type1') : '<p class="no-errors">No Type I errors</p>'}
          </div>
        </div>
        <div class="error-type">
          <h5>Type II Errors (False Negatives): ${type2Errors.length}</h5>
          <p style="color: #666; font-size: 0.9em; margin: 5px 0 15px 0;">Model predicted negative (0) but actual was positive (1)</p>
          <div class="error-list">
            ${type2Errors.length > 0 ? renderErrorList(type2Errors, modelType, 'type2') : '<p class="no-errors">No Type II errors</p>'}
          </div>
        </div>
      </div>
    `;
    
    // Add click handlers
    setTimeout(() => attachMisclassifiedHandlers(misclassifiedDiv), 100);
  }
  
  container.appendChild(misclassifiedDiv);
}

function attachMisclassifiedHandlers(container) {
  const expandButtons = container.querySelectorAll('.expand-btn');
  
  expandButtons.forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleDocument(this);
    });
  });
  
  const docItems = container.querySelectorAll('.doc-item');
  docItems.forEach(item => {
    item.addEventListener('click', function(e) {
      // Don't trigger if clicking on the button itself or inside doc-content
      if (e.target.classList.contains('expand-btn') || 
          e.target.closest('.expand-btn') || 
          e.target.closest('.doc-content')) {
        return;
      }
      const btn = this.querySelector('.expand-btn');
      if (btn) {
        toggleDocument(btn);
      }
    });
  });
}

function toggleDocument(btn) {
  const docIndex = btn.dataset.docIndex;
  const content = document.getElementById(`doc-content-${docIndex}`);
  const icon = btn.querySelector('.expand-icon');
  const docItem = btn.closest('.doc-item');
  
  if (!content) {
    console.error(`Content not found for doc-content-${docIndex}`);
    return;
  }
  
  if (content.style.display === 'none') {
    content.style.display = 'block';
    icon.style.transform = 'rotate(180deg)';
    docItem.classList.add('expanded');
  } else {
    content.style.display = 'none';
    icon.style.transform = 'rotate(0deg)';
    docItem.classList.remove('expanded');
  }
}

function calculateROCPoints(result) {
  console.log('=== calculateROCPoints Debug ===');
  console.log('Result object:', result);
  
  if (!result || !result.y_true || !result.y_pred) {
    console.error('Missing y_true or y_pred');
    return [{x: 0, y: 0}, {x: 1, y: 1}];
  }
  
  const uniqueLabels = [...new Set(result.y_true)];
  console.log('Unique labels:', uniqueLabels);
  
  if (uniqueLabels.length !== 2) {
    console.log('Not binary classification, returning diagonal');
    return [{x: 0, y: 0}, {x: 1, y: 1}];
  }

  let scores;
  if (result.y_prob && Array.isArray(result.y_prob)) {
    console.log('Using provided y_prob from backend');
    scores = result.y_prob;
  } else {
    console.warn('WARNING: No y_prob provided by backend. ROC curve will be simulated (INACCURATE).');
    console.warn('Backend must return predict_proba() results for accurate ROC curves.');
    // Simulation fallback
    scores = result.y_pred.map((pred, i) => {
      const isCorrect = pred === result.y_true[i];
      return isCorrect ? 0.8 + Math.random() * 0.2 : Math.random() * 0.2;
    });
  }

  console.log('Score range:', Math.min(...scores), 'to', Math.max(...scores));

  // Sort once and sweep, O(n log n), rather than scanning every threshold.
  const y_true_binary = result.y_true.map(label => label === "1" ? 1 : 0);
  
  // Sort samples by score (descending)
  const sortedIndices = scores
    .map((score, idx) => ({ score, idx }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.idx);
  
  const points = [{x: 0, y: 0}];  // Start at origin
  
  let tp = 0, fp = 0;
  const totalPositives = y_true_binary.reduce((sum, val) => sum + val, 0);
  const totalNegatives = y_true_binary.length - totalPositives;
  
  // Single pass through sorted samples
  sortedIndices.forEach(idx => {
    if (y_true_binary[idx] === 1) {
      tp++;
    } else {
      fp++;
    }
    
    const tpr = totalPositives > 0 ? tp / totalPositives : 0;
    const fpr = totalNegatives > 0 ? fp / totalNegatives : 0;
    points.push({x: fpr, y: tpr});
  });
  
  // Remove consecutive duplicate points
  const uniquePoints = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = uniquePoints[uniquePoints.length - 1];
    const curr = points[i];
    if (curr.x !== prev.x || curr.y !== prev.y) {
      uniquePoints.push(curr);
    }
  }

  console.log('Generated', uniquePoints.length, 'ROC points');
  return uniquePoints;
}

function calculateAUC(result) {
  const points = calculateROCPoints(result);
  let auc = 0;
  
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    
    // Trapezoidal rule for AUC calculation
    const width = curr.x - prev.x;
    const avgHeight = (prev.y + curr.y) / 2;
    auc += width * avgHeight;
  }
  
  return Math.max(0, Math.min(1, auc)); // Clamp between 0 and 1
}

function getModelColor(model) {
  const colors = {
    // Traditional ML
    nb: '#2d6ca8',      // Blue
    gda: '#2d6ca8',     // Same blue for GDA (replacement for NB)
    lr: '#1e6b4f',      // Green
    knn: '#8a5a16',     // Orange
    svm: '#8b5cf6',     // Purple
    // Transformers
    'bert-tiny': '#ec4899',    // Pink
    'bert-small': '#06b6d4',   // Cyan
    'distilbert': '#14b8a6',   // Teal
    'bert': '#f43f5e'          // Red
  };
  return colors[model] || '#5a6169';
}

function getModelName(model) {
  const names = {
    // Traditional ML
    nb: 'Naive Bayes',
    gda: 'Gaussian Discriminant Analysis',  // Add GDA
    lr: 'Logistic Regression',
    knn: 'K-Nearest Neighbors',
    svm: 'Support Vector Machine',
    // Transformers
    'bert-tiny': 'BERT-Tiny',
    'bert-small': 'BERT-Small',
    'distilbert': 'DistilBERT',
    'bert': 'BERT'
  };
  return names[model] || model.toUpperCase();
}

function expandSection(sectionName) {
  // Remove active class from all headers
  document.querySelectorAll('.tabs-header-container .section-header').forEach(header => {
    header.classList.remove('active');
  });
  
  // Hide all content panels
  document.querySelectorAll('.section-content-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  
  // Add active class to clicked header
  const activeHeader = document.querySelector(`[data-section="${sectionName}"]`);
  if (activeHeader) {
    activeHeader.classList.add('active');
  }
  
  // Show corresponding content panel
  const activePanel = document.getElementById(`${sectionName}-content`);
  if (activePanel) {
    activePanel.classList.add('active');
  }
  
  // If ROC section, trigger chart resize
  if (sectionName === 'roc') {
    setTimeout(() => {
      document.querySelectorAll('canvas[id^="rocChart_"]').forEach(canvas => {
        const chartId = canvas.id.replace('rocChart_', '');
        const chart = window[`rocChart_${chartId}`];
        if (chart && typeof chart.resize === 'function') {
          chart.resize();
        }
      });
    }, 400);
  }
}

// Initialize first tab as active
document.addEventListener('DOMContentLoaded', function() {
  expandSection('accuracy');
  
  // Fallback binding for pages where the delegated handler is not installed.
  const runBtn = document.getElementById("runModel");
  if (runBtn) {
    runBtn.addEventListener("click", async function() {
      await runSelectedModels();
    });
  }

  const testSizeSlider = document.getElementById('testSize');
  const testSizeValue = document.getElementById('testSizeValue');
  if (testSizeSlider && testSizeValue) {
    testSizeSlider.addEventListener('input', function(e) {
      testSizeValue.textContent = `${e.target.value}%`;
    });
    // Set initial display value
    testSizeValue.textContent = `${testSizeSlider.value}%`;
  }
});

// ===== UI HELPER FUNCTIONS =====

function toggleSection(header) {
  const content = header.nextElementSibling;
  const icon = header.querySelector('.toggle-icon');
  
  if (content.style.display === 'block') {
    content.style.display = 'none';
    icon.textContent = '▶';
    header.classList.add('collapsed');
  } else {
    content.style.display = 'block';
    icon.textContent = '▼';
    header.classList.remove('collapsed');
  }
}

function toggleSubsection(headerElement) {
  const content = headerElement.nextElementSibling;
  const icon = headerElement.querySelector('.collapse-icon');
  
  // Toggle active class
  const isActive = content.classList.contains('active');
  
  if (isActive) {
    content.classList.remove('active');
    icon.style.transform = 'rotate(0deg)';
  } else {
    content.classList.add('active');
    icon.style.transform = 'rotate(180deg)';
    
    // If this is a ROC chart subsection, ensure chart renders properly
    const canvas = content.querySelector('canvas[id^="rocChart_"]');
    if (canvas && canvas.id) {
      setTimeout(() => {
        const model = canvas.id.replace('rocChart_', '');
        const chart = window[`rocChart_${model}`];
        if (chart && typeof chart.resize === 'function') {
          chart.resize();
        }
      }, 400);
    }
  }
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <span class="notification-message">${message}</span>
    <button class="notification-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 5000);
}

// Add this function to check if Word2Vec was used
function checkWord2VecPreprocessing() {
  try {
    const preprocessingSettings = sessionStorage.getItem("preprocessingSettings");
    if (!preprocessingSettings) return false;
    
    const settings = JSON.parse(preprocessingSettings);
    return settings.useWord2Vec === true;
  } catch (error) {
    console.error("Error checking Word2Vec preprocessing:", error);
    return false;
  }
}
function toggleModelBasedOnWord2Vec() {
  const word2VecUsed = checkWord2VecPreprocessing();
  const nbCheckbox = document.getElementById("nbModel");
  const nbCard = nbCheckbox?.closest('.checkbox-card');
  
  if (nbCheckbox && nbCard) {
    if (word2VecUsed) {
      // Replace Naive Bayes with Gaussian Discriminant Analysis
      const checkboxContent = nbCard.querySelector('.checkbox-content');
      if (checkboxContent) {
        checkboxContent.innerHTML = `
          <span class="model-name">Gaussian Discriminant Analysis</span>
          <span class="model-desc">For continuous features (Word2Vec)</span>
        `;
      }
      // Update the ID and data model type
      nbCheckbox.id = "gdaModel";
      nbCheckbox.dataset.modelType = "gda";
    } else {
      // Restore Naive Bayes
      const checkboxContent = nbCard.querySelector('.checkbox-content');
      if (checkboxContent) {
        checkboxContent.innerHTML = `
          <span class="model-name">Naive Bayes</span>
          <span class="model-desc">Fast, works well with text data</span>
        `;
      }
      // Restore the ID and data model type
      nbCheckbox.id = "nbModel";
      nbCheckbox.dataset.modelType = "nb";
    }
  }
}
// Transformer availability and the NB/GDA swap.
//
// Transformers are always available. They tokenize the raw text with their own
// subword tokenizer and never consume the TF / TF-IDF / Word2Vec matrix - the
// backend branches around vectorization entirely for these models - so gating
// them behind a Word2Vec selection hid them from every user who chose TF-IDF
// for no methodological reason.
//
// The NB -> GDA swap below is genuine: MultinomialNB needs non-negative counts
// and cannot consume Word2Vec embeddings, while GDA needs dense continuous
// features and cannot consume sparse TF/TF-IDF.
function toggleTransformerModels() {
  const word2VecUsed = checkWord2VecPreprocessing();
  const transformerColumn = document.querySelector('.model-column:last-child');
  const transformerCheckboxes = document.querySelectorAll('#bertTinyModel, #bertSmallModel, #distilbertModel, #bertModel');

  if (transformerColumn) {
    transformerColumn.style.display = 'block';
  }

  transformerCheckboxes.forEach(checkbox => {
    checkbox.disabled = false;
    const card = checkbox.closest('.checkbox-card');
    if (card) {
      card.style.opacity = '1';
    }
  });

  // Transform NB model to GDA model based on Word2Vec usage
  const nbCheckbox = document.getElementById("nbModel");
  const nbCard = nbCheckbox?.closest('.checkbox-card');
  
  if (nbCheckbox && nbCard) {
    if (word2VecUsed) {
      // Replace Naive Bayes with Gaussian Discriminant Analysis
      const checkboxContent = nbCard.querySelector('.checkbox-content');
      if (checkboxContent) {
        checkboxContent.innerHTML = `
          <span class="model-name">Gaussian Discriminant Analysis</span>
          <span class="model-desc">For continuous features (Word2Vec)</span>
        `;
      }
      // Update the ID and data model type
      nbCheckbox.id = "gdaModel";
      nbCheckbox.dataset.modelType = "gda";
    } else {
      // Restore Naive Bayes
      const checkboxContent = nbCard.querySelector('.checkbox-content');
      if (checkboxContent) {
        checkboxContent.innerHTML = `
          <span class="model-name">Naive Bayes</span>
          <span class="model-desc">Fast, works well with text data</span>
        `;
      }
      // Restore the ID and data model type
      nbCheckbox.id = "nbModel";
      nbCheckbox.dataset.modelType = "nb";
    }
  }
}

  // ------------------------------------------------------------------
  // Optional features
  // ------------------------------------------------------------------

  /**
   * Hide BERT fine-tuning when the build does not include it.
   *
   * The hosted deployment omits the transformer stack to stay within the
   * memory a free host provides. Offering the option there and failing once
   * training starts would waste the user's time, so the column is replaced
   * with a note pointing at the container that does support it.
   */
  async function applyBuildCapabilities() {
    let caps;
    try {
      const response = await fetch('/api/capabilities');
      caps = await response.json();
    } catch (e) {
      return;                       // leave the interface as authored
    }
    if (caps.transformers) return;

    ['bertTinyModel', 'bertSmallModel', 'distilbertModel', 'bertModel']
      .forEach(id => {
        const box = document.getElementById(id);
        if (box) { box.checked = false; box.disabled = true; }
      });

    const column = document.getElementById('bertTinyModel')?.closest('.model-column');
    const list = column?.querySelector('.model-checkboxes');
    if (!list) return;
    list.style.opacity = '0.55';
    const note = document.createElement('p');
    note.style.cssText = 'margin-top:10px;font-size:13px;color:#5a6169;line-height:1.5;';
    note.textContent = 'Transformer fine-tuning needs a GPU and is not part of '
      + 'this online version. It is included in the downloadable container.';
    list.parentNode.appendChild(note);
  }

  document.addEventListener('DOMContentLoaded', applyBuildCapabilities);
