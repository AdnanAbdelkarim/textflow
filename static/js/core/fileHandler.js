/**
 * File upload handler module.
 *
 * Wires up file input + URL fetch on the input page (index.html).
 * Handles TXT/CSV/XLSX/PDF/DOCX uploads + URL-based file fetching.
 * Detects labeled vs unlabeled, multi-label binary vs single-label formats.
 *
 * Public API:
 *   initializeFileHandler() - call from input page DOMContentLoaded
 */
(function () {
    'use strict';
  
    /**
     * Initialize file upload + URL fetch handlers.
     * Idempotent - safe to call multiple times.
     */
    function initializeFileHandler() {
      const fileInput = document.getElementById('fileInput');
      const textArea = document.getElementById('textInput');
      const analyzeBtn = document.getElementById('analyzeButton') || document.getElementById('analyzeBtn');
      const wordCountDisplay = document.getElementById('liveWordCount');
      const fetchFromUrlBtn = document.getElementById('fetchFromUrlBtn');
      const fileUrlInput = document.getElementById('fileUrlInput');
  
      // Local helper: word count update with closure over textArea/wordCountDisplay
      function updateLocalWordCount() {
        if (!textArea || !wordCountDisplay) return;
        const text = textArea.value.trim();
        const wordCount = text ? text.split(/\s+/).length : 0;
        wordCountDisplay.textContent = `Words: ${wordCount} / 1,000,000`;
      }
  
      // ---- File input change ----
      if (fileInput && textArea) {
        fileInput.addEventListener('change', _handleFileChange);
      }
  
      // ---- Analyze button ----
      if (analyzeBtn && textArea) {
        analyzeBtn.addEventListener('click', () => {
          const userText = textArea.value.trim();
          if (!userText) {
            alert('Please enter or upload text before analyzing.');
            return;
          }
          sessionStorage.setItem('textData', JSON.stringify({ text: userText }));
          window.location.href = '/overview';
        });
      }
  
      // ---- Live word count ----
      if (textArea && wordCountDisplay) {
        textArea.addEventListener('input', updateLocalWordCount);
      }
  
      // ---- Fetch from URL ----
      if (fetchFromUrlBtn && fileUrlInput) {
        fetchFromUrlBtn.addEventListener('click', async () => {
          const url = fileUrlInput.value.trim();
          if (!url) {
            alert('Please enter a valid URL.');
            return;
          }
          const ext = url.split('.').pop().toLowerCase();
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Network response was not ok');
  
            if (ext === 'txt') {
              const text = await response.text();
              textArea.value = text;
              sessionStorage.setItem('textData', JSON.stringify({ text }));
              _clearLabeledKeys();
              sessionStorage.setItem('mode', 'unlabeled');
              updateLocalWordCount();
            } else if (ext === 'docx') {
              const arrayBuffer = await response.arrayBuffer();
              const doc = await window.docx.parseDocx(arrayBuffer);
              const text = (doc.children || [])
                .map(p => (p.children || []).map(run => run.text).join(''))
                .join('\n');
              textArea.value = text;
              sessionStorage.setItem('textData', JSON.stringify({ text }));
              _clearLabeledKeys();
              sessionStorage.setItem('mode', 'unlabeled');
              updateLocalWordCount();
            } else {
              alert('Unsupported file format. Only .txt or .docx URLs are allowed.');
            }
          } catch (err) {
            console.error('Error fetching file:', err);
            alert('Failed to fetch and read the file. Check the URL or file type.');
          }
        });
      }
  
      // Inner handler for fileInput change
      function _handleFileChange(event) {
        // Reset state for new upload
        window.lastCSVData = null;
  
        // Invalidate ALL session caches - new file means all computed data is stale
        if (window.sessionCache) {
          window.sessionCache.clear();
        }
  
        // Clear all labeled session data centrally
        if (typeof window.clearLabeledSessionData === 'function') {
          window.clearLabeledSessionData();
        } else {
          _clearLabeledKeys();
          sessionStorage.removeItem('preprocessingSettings');
          sessionStorage.removeItem('preprocessingApplied');
          sessionStorage.removeItem('preprocessingInfo');
          sessionStorage.removeItem('preprocessedData');
        }
  
        // Notify backend to clear preprocessing
        fetch('/api/clear_preprocessing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => {});
  
        // Clear advanced page result panels
        ['nerResults', 'sentimentResults', 'topicModelingResults', 'classificationResults']
          .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
          });
  
        const file = event.target.files[0];
        if (!file) return;
  
        const maxSize = 500 * 1024 * 1024; // 500 MB
        if (file.size > maxSize) {
          alert('File is too large. Please upload a file under 100 MB.');
          event.target.value = '';
          return;
        }
  
        const ext = file.name.split('.').pop().toLowerCase();
  
        if (ext === 'txt')      _handleTXT(file, textArea, updateLocalWordCount);
        else if (ext === 'docx') _handleDOCX(file, textArea, updateLocalWordCount);
        else if (ext === 'pdf')  _handlePDF(file, textArea, updateLocalWordCount);
        else if (ext === 'csv')  _handleCSV(file);
        else if (ext === 'xlsx') _handleXLSX(file);
        else alert('Unsupported file format. Please upload a .txt, .docx, .pdf, .csv, or .xlsx file.');
      }
    }
  
    // ============================================================
    // INTERNAL: per-format handlers
    // ============================================================
  
    function _handleTXT(file, textArea, updateLocalWordCount) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const text = e.target.result.trim();
        const lines = text.split('\n').filter(line => line.trim());
        if (lines.length === 0) {
          alert('File is empty.');
          return;
        }
  
        // Detect labeled multi-binary format
        const detection = _detectMultiLabelTXT(lines);
  
        if (detection.isLabeled && detection.parsedData) {
          _processLabeledTXT(detection);
        } else {
          // Unlabeled - auto-redirect, same as CSV/DOCX/PDF
          _storeUnlabeledTextAndRedirect(text);
        }
      };
      reader.readAsText(file);
    }
  
    function _detectMultiLabelTXT(lines) {
      const firstLine = lines[0];
      const tabParts   = firstLine.split('\t');
      const commaParts = firstLine.split(',');
  
      let separator = null;
      let parts = null;
  
      if (tabParts.length > 1) { separator = '\t'; parts = tabParts; }
      else if (commaParts.length > 1) { separator = ','; parts = commaParts; }
  
      if (!separator || !parts) return { isLabeled: false };
  
      let labelColumnCount = 0;
      let labelColumns = [];
  
      for (let i = 0; i < parts.length - 1; i++) {
        const cleanVal = parts[i].trim().replace(/^["']|["']$/g, '');
        const isBinaryValue = cleanVal === '0' || cleanVal === '1';
        const looksLikeLabelName = !isBinaryValue && cleanVal.length < 20 && !cleanVal.includes(' ');
  
        if (isBinaryValue || looksLikeLabelName) {
          labelColumnCount++;
          labelColumns.push(cleanVal);
        } else {
          break;
        }
      }
  
      const secondLine = lines.length > 1 ? lines[1] : null;
      let hasHeader = false;
      if (secondLine && labelColumnCount > 0) {
        const secondParts = secondLine.split(separator);
        const firstColSecondRow = secondParts[0]?.trim().replace(/^["']|["']$/g, '');
        if (labelColumns.every(v => v !== '0' && v !== '1') &&
            (firstColSecondRow === '0' || firstColSecondRow === '1')) {
          hasHeader = true;
        }
      }
  
      const lastColumn = parts[parts.length - 1].trim();
      const hasTextColumn = lastColumn.length > 20 || lastColumn.startsWith('"');
  
      if (labelColumnCount < 1 || !hasTextColumn) return { isLabeled: false };
  
      const startIdx = hasHeader ? 1 : 0;
      if (!hasHeader) {
        labelColumns = Array.from({ length: labelColumnCount }, (_, i) => `label${i}`);
      }
  
      const parsedData = [];
      lines.slice(startIdx).forEach(line => {
        const columns = line.split(separator);
        const labels = columns.slice(0, labelColumnCount).map(l => l.trim().replace(/^["']|["']$/g, ''));
        let textContent = columns.slice(labelColumnCount).join(separator).trim();
        textContent = textContent.replace(/^["']|["']$/g, '');
  
        if (!textContent || textContent.length === 0) return;
  
        const activeLabels = [];
        labels.forEach((val, idx) => {
          if (val === '1') activeLabels.push(idx);
        });
  
        if (activeLabels.length === 0) {
          parsedData.push({
            label: '-1', text: textContent,
            originalLabels: labels, activeIndices: [],
            labelNames: [], isMultiLabel: false
          });
          return;
        }
  
        activeLabels.forEach(idx => {
          parsedData.push({
            label: idx.toString(), text: textContent,
            originalLabels: labels, activeIndices: [idx],
            labelNames: [labelColumns[idx]],
            isMultiLabel: activeLabels.length > 1
          });
        });
      });
  
      if (parsedData.length === 0) return { isLabeled: false };
  
      return {
        isLabeled: true,
        parsedData, labelColumns, labelColumnCount, separator, hasHeader
      };
    }
  
    function _processLabeledTXT(detection) {
      const { parsedData, labelColumns, labelColumnCount } = detection;
  
      sessionStorage.setItem('labelColumns', JSON.stringify(labelColumns));
      sessionStorage.setItem('labelColumnCount', labelColumnCount.toString());
  
      const csvHeader = labelColumns.join(',') + ',text\n';
      const csvRows = parsedData.map(row => {
        const labelCols = row.originalLabels.map(l => `"${l}"`).join(',');
        const textCol = `"${row.text.replace(/"/g, '""')}"`;
        return `${labelCols},${textCol}`;
      });
      sessionStorage.setItem('uploadedCSV', csvHeader + csvRows.join('\n'));
  
      const labeledData = parsedData.map(row => {
        const labelDisplay = row.labelNames.length > 0 ? row.labelNames.join('+') : row.label;
        return `[${labelDisplay}] ${row.text}`;
      });
      sessionStorage.setItem('textData', JSON.stringify({ text: labeledData.join('\n') }));
      sessionStorage.setItem('detectedTextCol', 'text');
      sessionStorage.setItem('detectedLabelCol', labelColumns[0]);
  
      const rowsText = parsedData.map(row => row.text);
      sessionStorage.setItem('lastCSVTextRows', JSON.stringify(rowsText));
  
      // Group by text content to combine labels
      const textToLabels = {};
      parsedData.forEach(row => {
        const text = row.text;
        if (!textToLabels[text]) {
          textToLabels[text] = {
            text, labelNames: new Set(),
            originalLabels: row.originalLabels, activeIndices: new Set()
          };
        }
        row.activeIndices.forEach(idx => {
          textToLabels[text].labelNames.add(labelColumns[idx]);
          textToLabels[text].activeIndices.add(idx);
        });
      });
  
      const processedData = [];
      Object.values(textToLabels).forEach(item => {
        if (item.activeIndices.size > 0) {
          const allLabels = Array.from(item.activeIndices).map(idx => labelColumns[idx]);
          processedData.push({
            label: Array.from(item.activeIndices)[0].toString(),
            text: item.text,
            labelNames: Array.from(item.labelNames),
            originalLabels: item.originalLabels,
            activeIndices: Array.from(item.activeIndices),
            isMultiLabel: item.activeIndices.size > 1,
            allLabels,
            allLabelIndices: Array.from(item.activeIndices)
          });
        }
      });
  
      if (typeof window.setLastCSVData === 'function') {
        window.setLastCSVData(processedData, true);
      } else {
        window.lastCSVData = processedData;
        sessionStorage.setItem('lastCSVData', JSON.stringify(processedData));
      }
  
      const allUniqueLabels = labelColumns.filter((_, index) =>
        processedData.some(row => row.activeIndices.includes(index))
      );
      sessionStorage.setItem('uniqueLabels', JSON.stringify(allUniqueLabels));
  
      window.location.href = '/overview';
    }
  
    /**
     * Shared storage + redirect handler for all unlabeled file formats
     * (TXT unlabeled path, DOCX, PDF). Builds lastCSVData/lastCSVTextRows
     * so visualizations have the same data shape as an unlabeled CSV upload,
     * then redirects to /overview automatically - no Analyze button needed.
     */
    function _storeUnlabeledTextAndRedirect(text) {
      const MAX_ROWS = 5000;

      const lines = text.split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

      if (lines.length === 0) {
        alert('No usable text found in this file.');
        return;
      }

      const storedLines = lines.length > MAX_ROWS
        ? lines.slice(0, MAX_ROWS)
        : lines;

      if (lines.length > MAX_ROWS) {
        console.warn(`[TextFlow] File has ${lines.length} lines - storing first ${MAX_ROWS}.`);
      }

      if (typeof window.clearLabeledSessionData === 'function') {
        window.clearLabeledSessionData();
      }

      try {
        sessionStorage.setItem('textData', JSON.stringify({ text: storedLines.join('\n') }));
      } catch (e) {
        const fallback = storedLines.slice(0, Math.floor(MAX_ROWS / 5));
        sessionStorage.setItem('textData', JSON.stringify({ text: fallback.join('\n') }));
        console.warn('[TextFlow] textData too large - truncated further.');
      }

      sessionStorage.setItem('detectedTextCol', 'text');

      try {
        sessionStorage.setItem('lastCSVTextRows', JSON.stringify(storedLines));
      } catch (e) {
        const fallback = storedLines.slice(0, Math.floor(MAX_ROWS / 5));
        sessionStorage.setItem('lastCSVTextRows', JSON.stringify(fallback));
        console.warn('[TextFlow] lastCSVTextRows too large - truncated further.');
      }

      const lastCSVData = storedLines.map(line => ({ text: line }));
      window.lastCSVData = lastCSVData;
      try {
        sessionStorage.setItem('lastCSVData', JSON.stringify(lastCSVData));
      } catch (e) {
        console.warn('[TextFlow] lastCSVData too large for sessionStorage - in-memory only.');
      }

      window.location.href = '/overview';
    }

    function _handleDOCX(file, textArea, updateLocalWordCount) {
      const reader = new FileReader();
      reader.onload = function (e) {
        if (typeof window.showLoadingBar === 'function') {
          window.showLoadingBar('Reading document...', [
            'Extracting text from Word document...',
            'Preparing for analysis...'
          ]);
        }
        mammoth.extractRawText({ arrayBuffer: e.target.result }).then(result => {
          const text = result.value.trim();
          if (!text) {
            alert('No readable text found in this DOCX file.');
            return;
          }
          _storeUnlabeledTextAndRedirect(text);
        }).catch(err => {
          alert('Failed to extract text from DOCX.');
          console.error(err);
        });
      };
      reader.readAsArrayBuffer(file);
    }
  
    function _handlePDF(file, textArea, updateLocalWordCount) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const typedarray = new Uint8Array(e.target.result);
        pdfjsLib.getDocument({ data: typedarray }).promise.then(pdf => {
          const textPromises = [];
          for (let i = 1; i <= pdf.numPages; i++) {
            textPromises.push(
              pdf.getPage(i).then(page =>
                page.getTextContent().then(tc =>
                  tc.items.map(item => item.str).join(' ')
                )
              )
            );
          }
          if (typeof window.showLoadingBar === 'function') {
            window.showLoadingBar('Reading document...', [
              `Extracting text from ${pdf.numPages} page(s)...`,
              'Preparing for analysis...'
            ]);
          }
          Promise.all(textPromises).then(texts => {
            const text = texts.join('\n\n').trim();
            if (!text) {
              alert('No readable text found in this PDF file.');
              return;
            }
            _storeUnlabeledTextAndRedirect(text);
          });
        }).catch(err => alert('Error reading PDF: ' + err.message));
      };
      reader.readAsArrayBuffer(file);
    }
  
    function _handleCSV(file) {
      file.text().then(csvText => _parseCSVText(csvText));
    }

    function _parseCSVText(rawText) {
      // Normalise the upload before anything reads it. The shared reader
      // detects the separator, survives unescaped quotes inside a field and
      // only treats the first row as column names when it reads like names.
      // Papa's defaults silently discarded 737 of the 5,574 messages in the
      // SMS Spam Collection and turned the first message into a header.
      //
      // Everything downstream, here and in the Preprocessing and Predictive
      // tabs, then works from one clean, properly quoted CSV.
      const parsed = window.parseDelimitedText(rawText);
      console.info('[TextFlow] read upload: ' + parsed.describe());
      const csvText = window.toCleanCSV(parsed);

      return Promise.resolve().then(() => {
        // Only store raw CSV for labeled datasets - Preprocessing and
        // Predictive (the only consumers of uploadedCSV) are blocked for
        // unlabeled data. Storing large CSVs unconditionally causes
        // QuotaExceededError before we even know if the dataset is labeled.
        // We store it after detection instead, inside the labeled path only.
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: function (results) {
            const data = results.data;
            if (!data.length) {
              alert('CSV is empty or invalid.');
              return;
            }
  
            // Normalize column names (trim whitespace)
            data.forEach(row => {
              Object.keys(row).forEach(key => {
                const cleanKey = key.trim();
                if (cleanKey !== key) {
                  row[cleanKey] = row[key];
                  delete row[key];
                }
              });
            });
  
            const allColumns = Object.keys(data[0]);
  
            // Detect multi-label binary format
            let labelColumnCount = 0;
            for (let i = 0; i < allColumns.length - 1; i++) {
              const col = allColumns[i];
              const values = data.map(row => row[col]).filter(Boolean);
              const isBinary = values.every(v => v === '0' || v === '1' || v === 0 || v === 1);
              if (isBinary) labelColumnCount++;
              else break;
            }
  
            if (labelColumnCount > 0) {
              // Labeled - safe to store uploadedCSV now
              try { sessionStorage.setItem('uploadedCSV', csvText); } catch (e) {
                console.warn('uploadedCSV too large for sessionStorage - skipping.');
              }
              _processMultiLabelCSV(data, allColumns, labelColumnCount);
            } else {
              _processSingleLabelCSV(data, allColumns, csvText);
            }
          }
        });
      });
    }
  
    function _processMultiLabelCSV(data, allColumns, labelColumnCount) {
      const textCol = allColumns[allColumns.length - 1];
      const labelColumns = allColumns.slice(0, labelColumnCount);
  
      sessionStorage.setItem('labelColumns', JSON.stringify(labelColumns));
      sessionStorage.setItem('labelColumnCount', labelColumnCount.toString());
  
      const processedData = [];
      data.forEach(row => {
        const text = row[textCol]?.toString().trim();
        if (!text) return;
  
        const activeLabels = labelColumns.filter(col => {
          const val = row[col];
          return val === '1' || val === 1;
        });
  
        if (activeLabels.length === 0) {
          processedData.push({
            label: '-1', text,
            originalLabels: labelColumns.map(col => row[col]),
            labelNames: []
          });
          return;
        }
  
        activeLabels.forEach(labelName => {
          const labelIndex = labelColumns.indexOf(labelName);
          processedData.push({
            label: labelIndex.toString(), text,
            originalLabels: labelColumns.map(col => row[col]),
            labelNames: [labelName],
            isMultiLabel: activeLabels.length > 1
          });
        });
      });
  
      if (typeof window.setLastCSVData === 'function') {
        window.setLastCSVData(processedData, true);
      } else {
        window.lastCSVData = processedData;
        sessionStorage.setItem('lastCSVData', JSON.stringify(processedData));
      }
  
      const allUniqueLabels = [...new Set(processedData.map(row => row.label))]
        .filter(l => l !== '-1').sort();
      sessionStorage.setItem('uniqueLabels', JSON.stringify(allUniqueLabels));
  
      const labeledData = processedData.map(row => {
        const labelDisplay = row.labelNames.length > 0 ? row.labelNames.join('+') : row.label;
        return `[${labelDisplay}] ${row.text}`;
      });
      sessionStorage.setItem('textData', JSON.stringify({ text: labeledData.join('\n') }));
      sessionStorage.setItem('detectedTextCol', textCol);
      sessionStorage.setItem('detectedLabelCol', labelColumns[0]);

      // Labels are encoded to their column index above. Only the single-label
      // path recorded the names, so a multi-label dataset showed every class
      // as a bare index throughout the interface.
      const multiLabelNameMap = {};
      labelColumns.forEach((col, i) => { multiLabelNameMap[String(i)] = col; });
      sessionStorage.setItem('labelNameMap', JSON.stringify(multiLabelNameMap));

      const rowsText = processedData.map(row => row.text);
      sessionStorage.setItem('lastCSVTextRows', JSON.stringify(rowsText));
  
      window.location.href = '/overview';
    }
  
    function _processSingleLabelCSV(data, allColumns, csvText) {
      let textCol = null;
      let labelCol = null;

      const TEXT_COLUMN_NAME_HINTS = ['text', 'content', 'message', 'review', 'comment', 'body', 'description', 'sentence', 'document', 'email', 'tweet', 'sms'];
      const LABEL_COLUMN_NAME_HINTS = ['label', 'labels', 'class', 'classes', 'category', 'categories', 'target', 'sentiment', 'topic', 'tag', 'y'];

      // A categorical label column has low cardinality relative to the number
      // of rows and short, repeated values. String class names such as
      // positive/negative or named topic classes qualify; a free-text column
      // does not.
      const MAX_LABEL_VALUE_LENGTH = 50;
      const MAX_LABEL_CARDINALITY = 50;
      const nRows = data.length;

      function classifyColumn(col) {
        const values = data.map(row => row[col]);
        const nonEmpty = values.map(v => String(v ?? '').trim()).filter(Boolean);
        const unique = [...new Set(nonEmpty)];

        const colNameLower = col.trim().toLowerCase();
        const isNameHintedText = TEXT_COLUMN_NAME_HINTS.includes(colNameLower);
        const isNameHintedLabel = LABEL_COLUMN_NAME_HINTS.includes(colNameLower);
        const isLongText = values.some(v => typeof v === 'string' && v.length > 20);

        // Cardinality ceiling: at most 50 distinct values, and at most 20% of
        // rows. The proportional term keeps a small file (say 20 rows) from
        // treating a free-text column as 20 distinct "labels".
        const cardinalityCeiling = Math.max(
          2, Math.min(MAX_LABEL_CARDINALITY, Math.ceil(nRows * 0.2))
        );
        const allValuesShort = nonEmpty.every(v => v.length <= MAX_LABEL_VALUE_LENGTH);
        const lowCardinality = unique.length >= 1 &&
                               unique.length <= cardinalityCeiling;

        const isLabel = allValuesShort && lowCardinality &&
                        (isNameHintedLabel || !isNameHintedText);

        return { isLabel, isNameHintedLabel, isNameHintedText, isLongText,
                 nUnique: unique.length };
      }

      const profiles = {};
      allColumns.forEach(col => { profiles[col] = classifyColumn(col); });

      // Label column: an explicitly named one wins; otherwise the lowest
      // cardinality qualifying column.
      const labelCandidates = allColumns.filter(c => profiles[c].isLabel);
      const namedLabel = labelCandidates.find(c => profiles[c].isNameHintedLabel);
      if (namedLabel) {
        labelCol = namedLabel;
      } else if (labelCandidates.length) {
        labelCol = labelCandidates
          .slice()
          .sort((a, b) => profiles[a].nUnique - profiles[b].nUnique)[0];
      }

      // Text column: an explicitly named one wins, then any long-text column.
      // The label column is never also the text column.
      const textCandidates = allColumns.filter(
        c => c !== labelCol && (profiles[c].isNameHintedText || profiles[c].isLongText)
      );
      const namedText = textCandidates.find(c => profiles[c].isNameHintedText);
      textCol = namedText || textCandidates[0] || null;
  
      // Short-text datasets (tweets, headlines, single sentences) can
      // fail the length heuristic entirely. If nothing matched but exactly
      // one non-label column remains, it's almost certainly the text column.
      if (!textCol) {
        const remaining = allColumns.filter(c => c !== labelCol);
        if (remaining.length === 1) {
          textCol = remaining[0];
        }
      }
  
      if (!textCol) {
        alert('Could not auto-detect a text column in this CSV.');
        return;
      }
  
      if (!labelCol) {
        const textOnly = data
          .map(row => row[textCol]?.toString().trim())
          .filter(Boolean);
  
        if (textOnly.length === 0) {
          alert('No usable text found in the detected text column.');
          return;
        }
  
        if (typeof window.clearLabeledSessionData === 'function') {
          window.clearLabeledSessionData();
        }
  
        // Cap rows written to sessionStorage - browser limit is ~5MB.
        // 5000 rows is sufficient for all NLP analyses; beyond this,
        // sessionStorage throws QuotaExceededError on large datasets.
        const MAX_ROWS = 5000;
        const storedRows = textOnly.length > MAX_ROWS
          ? textOnly.slice(0, MAX_ROWS)
          : textOnly;

        if (textOnly.length > MAX_ROWS) {
          console.warn(`[TextFlow] Dataset has ${textOnly.length} rows - storing first ${MAX_ROWS} for analysis.`);
        }

        try {
          sessionStorage.setItem('textData', JSON.stringify({ text: storedRows.join('\n') }));
        } catch (e) {
          // Still too large - halve again as last resort
          const fallback = storedRows.slice(0, Math.floor(MAX_ROWS / 5));
          sessionStorage.setItem('textData', JSON.stringify({ text: fallback.join('\n') }));
          console.warn('[TextFlow] textData still too large - truncated to', fallback.length, 'rows.');
        }

        sessionStorage.setItem('detectedTextCol', textCol);

        try {
          sessionStorage.setItem('lastCSVTextRows', JSON.stringify(storedRows));
        } catch (e) {
          const fallback = storedRows.slice(0, Math.floor(MAX_ROWS / 5));
          sessionStorage.setItem('lastCSVTextRows', JSON.stringify(fallback));
          console.warn('[TextFlow] lastCSVTextRows still too large - truncated to', fallback.length, 'rows.');
        }

        // Visualizations page always expects lastCSVData on load.
        // For unlabeled data, build simple {text} objects - no label keys.
        const unlabeledCSVData = storedRows.map(text => ({ text }));
        window.lastCSVData = unlabeledCSVData;
        try {
          sessionStorage.setItem('lastCSVData', JSON.stringify(unlabeledCSVData));
        } catch (e) {
          console.warn('[TextFlow] lastCSVData too large for sessionStorage - in-memory only.');
        }

        window.location.href = '/overview';
        return;
      }
  
      const labelMap = {};
      let labelIndex = 0;

      const singleLabelData = data.map(row => {
        const rawLabel = row[labelCol]?.toString().trim();
        const text = row[textCol]?.toString().trim();
        if (!rawLabel || !text) return null;
        const label = !isNaN(rawLabel) ? rawLabel : (
          labelMap[rawLabel] ?? (labelMap[rawLabel] = labelIndex++)
        );
        return { label: String(label), text };
      }).filter(Boolean);

      // String class names are encoded to numeric indices above, because the
      // "[n] text" corpus format and several endpoints match on \d+. Keep the
      // index -> original name mapping so the interface can still show the
      // user's own class names instead of "label0"/"label1".
      const labelNameMap = {};
      Object.entries(labelMap).forEach(([name, idx]) => {
        labelNameMap[String(idx)] = name;
      });
      // Numeric labels were passed through unchanged and map to themselves.
      singleLabelData.forEach(row => {
        if (!(row.label in labelNameMap)) labelNameMap[row.label] = row.label;
      });
      sessionStorage.setItem('labelNameMap', JSON.stringify(labelNameMap));
  
      if (typeof window.setLastCSVData === 'function') {
        window.setLastCSVData(singleLabelData, true);
      } else {
        window.lastCSVData = singleLabelData;
        sessionStorage.setItem('lastCSVData', JSON.stringify(singleLabelData));
      }
  
      const labeledData = singleLabelData.map(row => `[${row.label}] ${row.text}`);
      sessionStorage.setItem('textData', JSON.stringify({ text: labeledData.join('\n') }));
      sessionStorage.setItem('detectedTextCol', textCol);
      sessionStorage.setItem('detectedLabelCol', labelCol);

      // Store uploadedCSV for labeled datasets only
      if (csvText) {
        try { sessionStorage.setItem('uploadedCSV', csvText); } catch (e) {
          console.warn('uploadedCSV too large for sessionStorage - skipping.');
        }
      }
  
      const rowsText = singleLabelData.map(row => row.text);
      sessionStorage.setItem('lastCSVTextRows', JSON.stringify(rowsText));
  
      window.location.href = '/overview';
    }
  
    function _handleXLSX(file) {
      // A spreadsheet is a table with a header row, so it is converted to CSV
      // and handed to the CSV path. That path already detects the text and
      // label columns, encodes class names, stores the corpus and moves the
      // user on to the Overview tab. Parsing the sheet separately meant XLSX
      // uploads stopped at the Input tab with none of that done.
      const reader = new FileReader();
      reader.onload = function (e) {
        if (typeof XLSX === 'undefined') {
          alert('The spreadsheet reader failed to load. Check your connection '
                + 'and reload the page, or save the file as .csv.');
          return;
        }
        const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) {
          alert('This workbook has no sheets.');
          return;
        }
        const csvText = XLSX.utils.sheet_to_csv(sheet);
        if (!csvText.trim()) {
          alert('File is empty or has no readable rows.');
          return;
        }
        _parseCSVText(csvText);
      };
      reader.readAsArrayBuffer(file);
    }

    // ============================================================
    // INTERNAL: session key cleanup
    // ============================================================
  
    function _clearLabeledKeys() {
      [
        'detectedTextCol', 'detectedLabelCol', 'lastCSVTextRows',
        'labelColumns', 'labelColumnCount', 'isLabeled'
      ].forEach(key => sessionStorage.removeItem(key));
    }
  
    // Expose public API
    window.initializeFileHandler = initializeFileHandler;
  })();