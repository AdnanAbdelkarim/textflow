/**
 * Advanced page initializer.
 *
 * Wires up the advanced page (NER, Sentiment, Topic Modeling, Classification).
 * Runs after page load on /advanced.
 */
(function () {
    'use strict';
  
    function initializeAdvancedPage() {
      // Stop background word cloud renders - they compete with NER/topic modeling
      if (typeof window.cancelAllPreRenders === 'function') {
        window.cancelAllPreRenders();
      }
  
      const saved = sessionStorage.getItem('textData');
      if (!saved) return;
  
      let parsed;
      try { parsed = JSON.parse(saved); } catch (_) { return; }
      const text = parsed.text;
      if (!text) return;
  
      // Restore lastCSVData if needed (idempotent)
      if (typeof window.restoreSessionData === 'function') {
        window.restoreSessionData();
      }
  
      // If still no lastCSVData, reconstruct from text (multi-label TXT files)
      if (!window.lastCSVData) {
        const lines = text.split(/\n/).filter(Boolean);
        const isLabeled = /^\[([^\]]+)\]/.test(lines[0] || '');
  
        if (isLabeled) {
          const reconstructed = lines.map(line => {
            const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
            if (!match) return null;
            const labelPart = match[1];
            const textContent = match[2];
            const labelNames = labelPart.includes('+')
              ? labelPart.split('+').map(l => l.trim())
              : [labelPart];
            return { label: labelNames[0], text: textContent, labelNames, class: labelNames[0] };
          }).filter(Boolean);
  
          if (typeof window.setLastCSVData === 'function') {
            window.setLastCSVData(reconstructed, true);
          } else {
            window.lastCSVData = reconstructed;
          }
        }
      }
  
      const sc = window.sessionCache;
  
      // ---- NER ----
      if (typeof window.displayNER === 'function') {
        if (sc) {
          const nerKey = sc.textKey('ner', text, 'both');
          const cached = sc.isStale(nerKey) ? null : sc.get(nerKey);
          if (cached && cached.data) {
            // Inject cached HTML directly - no API call
            const container = document.getElementById('nerResults');
            if (container) container.innerHTML = cached.data;
          } else {
            // Fetch and intercept result to cache the rendered HTML
            window.displayNER(text).then(() => {
              const container = document.getElementById('nerResults');
              if (container && container.innerHTML && sc) {
                sc.set(nerKey, container.innerHTML, { ttl: 15 * 60 * 1000 });
              }
            }).catch(() => {});
          }
        } else {
          window.displayNER(text);
        }
      }
  
      // ---- Classification ----
      if (typeof window.displayClassification === 'function') {
        window.displayClassification(text);
      }
  
      // ---- Sentiment ----
      if (typeof window.loadAFINN === 'function' && typeof window.displaySentenceLevelSentiment === 'function') {
        if (sc) {
          const sentKey = sc.textKey('sentiment', text);
          const cached = sc.isStale(sentKey) ? null : sc.get(sentKey);
          if (cached && cached.data) {
            const container = document.getElementById('sentimentResults');
            if (container) container.innerHTML = cached.data;
          } else {
            window.loadAFINN()
              .then(() => window.displaySentenceLevelSentiment(text))
              .then(() => {
                const container = document.getElementById('sentimentResults');
                if (container && container.innerHTML && sc) {
                  sc.set(sentKey, container.innerHTML, { ttl: 15 * 60 * 1000 });
                }
              })
              .catch(() => {
                const el = document.getElementById('sentimentResults');
                if (el) el.innerHTML = '<i>Sentiment lexicon failed to load.</i>';
              });
          }
        } else {
          window.loadAFINN()
            .then(() => window.displaySentenceLevelSentiment(text))
            .catch(() => {
              const el = document.getElementById('sentimentResults');
              if (el) el.innerHTML = '<i>Sentiment lexicon failed to load.</i>';
            });
        }
      }
  
      // ---- Topic Modeling ----
      if (typeof window.displayTopics === 'function') {
        if (sc) {
          const fp = sc.currentDataFingerprint();
          const isLabeled = window.isDatasetLabeled();
          const topicsKey = `topics:${fp}:${isLabeled ? '1' : '0'}`;
          const cached = sc.isStale(topicsKey, fp) ? null : sc.get(topicsKey);
          if (cached && cached.data) {
            const container = document.getElementById('topicModeling');
            if (container) container.innerHTML = cached.data;
          } else {
            window.displayTopics(text).then(() => {
              const container = document.getElementById('topicModeling');
              if (container && container.innerHTML && sc) {
                sc.set(topicsKey, container.innerHTML, {
                  ttl: 20 * 60 * 1000,
                  dataFingerprint: fp
                });
              }
            }).catch(() => {});
          }
        } else {
          window.displayTopics(text);
        }
      }

      // N-gram exploration renders from its own controls and does not depend
      // on the topic-modeling branch above.
      if (typeof window.initNgrams === 'function') {
        window.initNgrams();
      }
    }
  
    window.initializeAdvancedPage = initializeAdvancedPage;
  })();