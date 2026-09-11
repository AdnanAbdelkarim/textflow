/**
 * Overview page initializer.
 * Computes basic stats (total words, unique words, vocab diversity)
 * from the labeled or unlabeled text data and displays them.
 */
(function () {
    'use strict';
  
    function initializeOverviewPage() {
      const saved = sessionStorage.getItem('textData');
      if (!saved) return;
  
      let parsed;
      try { parsed = JSON.parse(saved); } catch (_) { return; }
      const text = parsed.text || '';
      if (!text) return;
  
      // Strip [label] prefixes if labeled
      const lines = text.trim().split(/\n/).filter(Boolean);
      const isLabeled = /^\[([^\]]+)\]/.test(lines[0] || '');
  
      let cleanText = text;
      if (isLabeled) {
        cleanText = lines.map(line => {
          const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
          return match ? match[2] : line;
        }).join(' ');
      }
  
      const words = cleanText.trim().split(/\s+/).filter(Boolean);
      const totalWords = words.length;
      const uniqueWords = new Set(words.map(w => w.toLowerCase())).size;
  
      // Update DOM (defensive - elements may not all exist)
      const totalEl    = document.getElementById('totalWords');
      const uniqueEl   = document.getElementById('uniqueWords');
      const sentimentEl = document.getElementById('sentimentScore');
      const vocabEl    = document.getElementById('vocabStats');
  
      if (totalEl)  totalEl.textContent = totalWords;
      if (uniqueEl) uniqueEl.textContent = uniqueWords;
  
      // Sentiment: mean AFINN valence per scored token, from the same lexicon
      // the Advanced Analysis tab uses. Reported as the mean score over tokens
      // that appear in AFINN, so the figure does not shrink as the corpus grows.
      if (sentimentEl) {
        sentimentEl.textContent = 'computing...';
        const renderSentiment = (lexicon) => {
          let total = 0, scored = 0;
          for (const w of words) {
            const key = w.toLowerCase().replace(/[^a-z']/g, '');
            if (key && Object.prototype.hasOwnProperty.call(lexicon, key)) {
              total += lexicon[key];
              scored += 1;
            }
          }
          if (!scored) {
            sentimentEl.textContent = 'n/a (no scored terms)';
            return;
          }
          const mean = total / scored;
          // AFINN valence runs -5..+5. The neutral band is +/-0.05 of a
          // valence point, which is narrow enough that a corpus with any
          // consistent polarity falls outside it.
          let label = 'Neutral';
          if (mean > 0.05) label = 'Positive';
          else if (mean < -0.05) label = 'Negative';
          sentimentEl.textContent = `${mean.toFixed(2)} (${label})`;
          sentimentEl.title =
            `Mean AFINN valence over ${scored} scored tokens of ${totalWords} ` +
            `total. Range -5 (most negative) to +5 (most positive).`;
        };

        if (typeof window.loadAFINN === 'function') {
          window.loadAFINN()
            .then(renderSentiment)
            .catch(() => { sentimentEl.textContent = 'unavailable'; });
        } else {
          fetch('/static/js/afinn.json')
            .then(r => r.json())
            .then(renderSentiment)
            .catch(() => { sentimentEl.textContent = 'unavailable'; });
        }
      }

      // Lexical diversity: type-token ratio (unique types / total tokens).
      // TTR falls as a corpus grows, so the qualitative band is defined
      // against published ranges for running text rather than an arbitrary
      // cut-off: >= 0.40 diverse, 0.15-0.40 moderate, < 0.15 repetitive.
      if (vocabEl) {
        const ttr = totalWords ? uniqueWords / totalWords : 0;
        let vocabLabel = 'Moderate';
        if (ttr >= 0.40) vocabLabel = 'Diverse';
        else if (ttr < 0.15) vocabLabel = 'Repetitive';
        vocabEl.textContent = `${ttr.toFixed(3)} (${vocabLabel})`;
        vocabEl.title =
          `Type-token ratio: ${uniqueWords} unique types / ${totalWords} ` +
          `tokens. TTR decreases as corpus size grows, so compare only ` +
          `corpora of similar length.`;
      }
    }
  
    window.initializeOverviewPage = initializeOverviewPage;
  })();