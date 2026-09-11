/**
 * UI form helpers for input/upload pages.
 */
(function () {
    'use strict';
  
    /**
     * Update the live word count display under the textarea.
     * Reads from #textInput, displays in #liveWordCount.
     */
    function updateLiveWordCount() {
      const textInput = document.getElementById('textInput');
      const wordCountDisplay = document.getElementById('liveWordCount');
      if (!textInput || !wordCountDisplay) return;
  
      const text = textInput.value.trim() || (window.uploadedText || '').trim();
      const wordCount = text ? text.split(/\s+/).length : 0;
      wordCountDisplay.textContent = `Words: ${wordCount} / 1,000,000`;
    }
  
    /**
     * Show CSV upload requirements as an alert.
     * (Phase 5 keeps the alert-based UX as-is; future improvement would be
     * a proper modal - that's a UX change, not a refactor.)
     */
    function showUploadHelp() {
      alert(
        'Upload Requirements for Classification:\n\n' +
        '• CSV file with at least 2 columns\n' +
        '• One column for text content\n' +
        '• One column for class labels\n' +
        '• Minimum 10 documents per class\n' +
        '• Supported formats: CSV, XLSX\n\n' +
        'Example structure:\n' +
        'text,label\n' +
        '"This is spam email",spam\n' +
        '"This is normal email",ham'
      );
    }
  
    window.updateLiveWordCount = updateLiveWordCount;
    window.showUploadHelp = showUploadHelp;
  })();