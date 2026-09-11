console.log('wordCloud.js loaded');
/**
 * Word cloud module.
 *
 * Renders class-specific word clouds with:
 *   - Frequency-based filtering (smart range slider + numeric input)
 *   - Auto-sizing based on container dimensions
 *   - Per-cloud zoom controls (no cross-cloud interference - see F3)
 *   - Container-scoped resize handling (no listener stacking - see F4)
 *   - Server-backed frequency computation with local fallback (F11)
 *   - Result caching keyed by class name
 *
 * Backend endpoints:
 *   /api/wordcloud_frequencies  - per-class frequency computation
 *   /api/extract_entities       - NER for multi-word entity tokenization
 */
(function () {
    'use strict';
    // In-memory cache of rendered SVG HTML per class + stopwords + range index.
    // Survives class tab switches within the same page load.
    // On page navigation, sessionCache repopulates this from sessionStorage.
    const _renderedSvgCache = new Map();
    // Tracks which classes currently have an active d3-cloud run.
    // Prevents duplicate renders when user switches away and back mid-render.
    const _classRenderState = new Map(); // {className -> true}
    // Persists the zoom level per class tab so switching tabs doesn't reset zoom
    const _zoomLevelPerClass = new Map(); // {className -> zoomLevel}
    // Controls background pre-rendering
    let _prerenderAborted = false;  // Set true on navigation to stop background renders
    // ============================================================
    // CACHE
    // ============================================================
    if (!window.wordCloudCache) {
      window.wordCloudCache = {
        cache: {},
        dataCache: {},
        allDataCache: null,
        has: function (className) { return Object.prototype.hasOwnProperty.call(this.cache, className); },
        get: function (className) { return this.cache[className]; },
        set: function (className, data) { this.cache[className] = data; },
        setAllData: function (freqArray) {
          this.allDataCache = { freqArray: freqArray, timestamp: Date.now() };
        },
        getAllData: function () { return this.allDataCache; },
        hasAllData: function () { return this.allDataCache !== null; },
        clear: function () {
          this.cache = {};
          this.dataCache = {};
          this.allDataCache = null;
        }
      };
    }
  
    // ============================================================
    // PUBLIC: render word cloud for a specific class
    // ============================================================
  
    /**
     * Render a word cloud for the given class. Uses cache if available,
     * otherwise fetches frequencies from the server.
     *
     * @param {Array<object>} data - lastCSVData
     * @param {string} className - 'all' or specific class name
     */
    async function renderWordCloudForClass(data, className) {
      const container = document.querySelector('.wordcloud-flex');
      if (!container) return;
  
      const includeStopwords = document.getElementById('includeStopwords')?.checked || false;
  
      // 0. If this class is actively rendering (user switched away mid-render),
      //    show a waiting state instead of starting a duplicate d3-cloud run.
      if (_classRenderState.has(className)) {
        const displayTitle = className === 'all' ? 'All Data' : `Class ${className}`;
        container.innerHTML = `
          <h5 style="margin-top:20px;text-align:center;">${displayTitle}</h5>
          <div style="text-align:center;padding:40px;color:#666;">
            <div class="spinner" style="width:36px;height:36px;border:4px solid #f3f3f3;border-top:4px solid #4f46e5;border-radius:50%;margin:0 auto 16px;animation:spin 0.8s linear infinite;"></div>
            <p style="font-size:13px;color:#6b7280;">Still rendering, almost done...</p>
          </div>
        `;
        // Poll until render completes, then re-call (will hit SVG cache instantly)
        const waitAndShow = setInterval(() => {
          if (!_classRenderState.has(className)) {
            clearInterval(waitAndShow);
            renderWordCloudForClass(data, className);
          }
        }, 250);
        return;
      }
      // 1a. In-memory cache hit (fastest - survives within same page load)
      if (window.wordCloudCache.has(className)) {
        const cached = window.wordCloudCache.get(className);
        _renderWordCloudFromFrequencies(container, className, cached.freqArray, cached.maxFreq, cached.minFreq);
        return;
      }

      // 1b. sessionStorage cache hit (survives page navigation)
      if (window.sessionCache) {
        const scKey = window.sessionCache.vizKey('wc', className, includeStopwords);
        if (!window.sessionCache.isStale(scKey)) {
          const entry = window.sessionCache.get(scKey);
          if (entry && entry.data) {
            const { freqArray, maxFreq, minFreq } = entry.data;
            // Repopulate in-memory cache too so subsequent switches in this session are instant
            window.wordCloudCache.set(className, {
              freqArray, maxFreq, minFreq,
              wordCount: freqArray.length, timestamp: Date.now(), source: 'sessionCache'
            });
            _renderWordCloudFromFrequencies(container, className, freqArray, maxFreq, minFreq);
            return;
          }
        }
      }
  
      // 2. Filter data for this class
      let classData;
      if (className === 'all') {
        classData = data;
      } else {
        const targetClassNum = String(className).replace('label', '');
        classData = data.filter(row => {
          if (Array.isArray(row.labelNames) && row.labelNames.length) {
            return row.labelNames.includes(className);
          }
          const rowClass = row.label !== undefined ? row.label : row.class;
          return String(rowClass == null ? 'Unlabeled' : rowClass) === targetClassNum;
        });
      }
  
      if (!classData || !classData.length) {
        const displayTitle = className === 'all' ? 'All Data' : `Class ${className}`;
        container.innerHTML = `<h5 style="margin-top: 20px;text-align: center;">${displayTitle}</h5>
                              <div style="color: #666; margin-top: 20px; text-align: center;">
                                No data available for this class.
                              </div>`;
        return;
      }
  
      // 3. Try filtering from cached "all data"
      if (className !== 'all' && window.wordCloudCache.hasAllData()) {
        const classTextData = classData.map(row => row.text || '').filter(text => text.trim());
        const classText = classTextData.join(' ');
  
        if (classText.trim()) {
          const allCached = window.wordCloudCache.getAllData();
          const allFreqArray = allCached.freqArray;
          const stops = window.STOPWORDS || window.stopwords || new Set();
  
          const classWords = new Set();
          classText.toLowerCase().split(/\W+/).forEach(w => {
            if (w.length > 2) {
              if (!includeStopwords && stops.has(w.replace(/_/g, ' '))) return;
              classWords.add(w);
            }
          });
  
          const classFreqArray = allFreqArray.filter(([word]) => classWords.has(word));
  
          if (classFreqArray.length > 0) {
            const maxFreq = classFreqArray[0][1];
            const minFreq = classFreqArray[classFreqArray.length - 1][1];
            window.wordCloudCache.set(className, {
              freqArray: classFreqArray, maxFreq, minFreq,
              wordCount: classTextData.length, timestamp: Date.now(), source: 'filtered'
            });
            _renderWordCloudFromFrequencies(container, className, classFreqArray, maxFreq, minFreq);
            return;
          }
        }
      }
  
      // 4. Fetch from API
      const textData = classData.map(row => row.text || '').filter(text => text.trim());
      const combinedText = textData.join(' ');
  
      const displayTitle = className === 'all' ? 'All Data' : `Class ${className}`;
      container.innerHTML = `
        <h5 style="margin-top: 20px;text-align: center;">${displayTitle}</h5>
        <div style="text-align: center; padding: 40px; color: #666;">
          <div class="spinner" style="width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; margin: 0 auto 20px; animation: spin 1s linear infinite;"></div>
          <p>Fetching word frequencies...</p>
          <p style="font-size: 0.9em; color: #999;">Word cloud will appear shortly.</p>
        </div>
      `;
  
      // Inject spinner CSS once
      if (!document.querySelector('#spinner-style')) {
        const style = document.createElement('style');
        style.id = 'spinner-style';
        style.textContent = `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
        document.head.appendChild(style);
      }
  
      try {
        const response = await fetch('/api/wordcloud_frequencies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: textData, includeStopwords, className })
        });
  
        const result = await response.json();
  
        if (result.frequencies && result.frequencies.length > 0) {
          const freqArray = result.frequencies;
          const maxFreq = freqArray[0][1];
          const minFreq = freqArray[freqArray.length - 1][1];
  
          window.wordCloudCache.set(className, {
            freqArray, maxFreq, minFreq,
            wordCount: textData.length, timestamp: Date.now(), source: 'api'
          });
  
          if (className === 'all') {
            window.wordCloudCache.setAllData(freqArray);
          }
  
          // Persist to sessionStorage so tab-switching and page navigation are instant
          if (window.sessionCache) {
            const scKey = window.sessionCache.vizKey('wc', className, includeStopwords);
            window.sessionCache.set(scKey, { freqArray, maxFreq, minFreq });
          }
  
          _renderWordCloudFromFrequencies(container, className, freqArray, maxFreq, minFreq);
        } else {
          container.innerHTML = `
            <h5 style="margin-top: 20px;text-align: center;">${displayTitle}</h5>
            <div style="color: #666; margin-top: 20px; text-align: center;">
              No words found for this class with current settings.
            </div>
          `;
        }
      } catch (error) {
        console.error('Word cloud API failed, attempting local fallback:', error);
        try {
          await _renderWordCloudLocally(container, className, combinedText, includeStopwords);
        } catch (localError) {
          console.error('Local word cloud fallback also failed:', localError);
          container.innerHTML = `
            <h5 style="margin-top: 20px;text-align: center;">${displayTitle}</h5>
            <div style="color: crimson; margin-top: 20px; text-align: center;">
               Failed to generate word cloud. Please try again.
            </div>
          `;
        }
      }
    }
  
    // ============================================================
    // PUBLIC: render from frequency object (unlabeled path) - F73
    // ============================================================
  
    /**
     * Render a word cloud from a frequency object/array (unlabeled data path).
     * Used when no labels exist.
     */
    function generateWordCloudFromFreq(freq) {
      const container = document.querySelector('#wordCloud .wordcloud-flex')
                     || document.getElementById('wordCloud');
      if (!container) {
        console.error('generateWordCloudFromFreq: no #wordCloud container found');
        return;
      }
  
      let freqArray;
      if (Array.isArray(freq)) {
        freqArray = freq
          .map(item => Array.isArray(item)
            ? [String(item[0]), Number(item[1])]
            : [String(item.term ?? item.word ?? ''), Number(item.frequency ?? item.count ?? 0)])
          .filter(([w, f]) => w && Number.isFinite(f) && f > 0);
      } else if (freq && typeof freq === 'object') {
        freqArray = Object.entries(freq)
          .map(([w, f]) => [String(w), Number(f)])
          .filter(([w, f]) => w && Number.isFinite(f) && f > 0);
      } else {
        freqArray = [];
      }
  
      freqArray.sort((a, b) => b[1] - a[1]);
  
      container.innerHTML = '';
  
      if (!freqArray.length) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:crimson;">No words to display.</div>';
        return;
      }
  
      const cloudContainer = document.createElement('div');
      cloudContainer.className = 'wordcloud-canvas-container';
      container.appendChild(cloudContainer);
  
      _generateWordCloudWithAutoSizing(cloudContainer, freqArray);
    }
  
    // ============================================================
    // PUBLIC: numeric input handler for frequency input
    // ============================================================
  
    /**
     * Handle numeric input with arrow keys and Enter validation.
     * Called via inline onkeydown - see F9 fix in Phase 3.
     */
    function handleFrequencyInput(event, className) {
      const input = event.target;
      const slider = document.getElementById(`freq-slider-${className}`);
      if (!slider) return;
  
      const max = parseInt(slider.max, 10);
      const min = parseInt(slider.min, 10) || 1;
  
      let newValue;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        newValue = parseInt(input.value, 10) + (event.key === 'ArrowUp' ? 1 : -1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        newValue = parseInt(input.value, 10);
        if (isNaN(newValue)) newValue = parseInt(slider.value, 10);
        input.blur();
      } else {
        return;
      }
  
      newValue = Math.max(min, Math.min(max, newValue));
      input.value = newValue;
      slider.value = newValue;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  
    // ============================================================
    // PUBLIC: clear cache
    // ============================================================
  
    function clearWordCloudCache() {
      if (window.wordCloudCache) window.wordCloudCache.clear();
      _renderedSvgCache.clear();
      _classRenderState.clear();
      if (window.sessionCache) window.sessionCache.invalidate('wc_svg:');
    }
  
    /** Cancel all background pre-renders (call when navigating away). */
    function cancelAllPreRenders() {
      _prerenderAborted = true;
    }
  
    /** Reset pre-render state (call when returning to visualizations page). */
    function resetPreRenderState() {
      _prerenderAborted = false;
    }
  
    // ============================================================
    // INTERNAL: render with auto-sizing (zoom controls, resize handling)
    // ============================================================
  
    function _generateWordCloudWithAutoSizing(container, freqArray) {
      const wordCount = freqArray.length;
      const isDark = document.body.classList.contains('dark-mode');
      const color = (window.d3 && d3.schemeCategory10 && d3.schemeCategory10.length)
        ? d3.scaleOrdinal(d3.schemeCategory10)
        : () => (isDark ? '#f0f0f0' : '#333');
  
      container.innerHTML = '';
      container.style.position = 'relative';
      container.style.width = '100%';
      container.style.minHeight = '600px';
  
      let currentZoomLevel = 1;
  
      function renderAtZoomLevel(zoomLevel) {
        currentZoomLevel = zoomLevel;
        const containerWidth = container.clientWidth || 1200;
        const containerHeight = Math.max(container.clientHeight, 600);
        const w = containerWidth;
        const h = containerHeight;
  
        const maxF = freqArray[0][1] || 1;
        const minF = freqArray[freqArray.length - 1][1] || 1;
        const baseFontSize = Math.max(10, Math.min(18, 200 / Math.sqrt(wordCount)));
        const minFont = Math.max(baseFontSize * zoomLevel, 10);
        const maxFont = Math.max(minFont * 6, 60 * zoomLevel);
        const fontScale = d3.scaleSqrt().domain([minF, maxF]).range([minFont, maxFont]);
  
        const words = freqArray.map(([text, freq]) => ({ text, size: fontScale(freq) }));
        container.innerHTML = '';
  
        const svg = d3.select(container).append('svg')
          .attr('width', '100%')
          .attr('height', '100%')
          .attr('viewBox', `0 0 ${w} ${h}`)
          .attr('preserveAspectRatio', 'xMidYMid meet')
          .style('display', 'block')
          .style('min-height', '600px')
          .style('background', isDark ? '#1a1a1a' : '#ffffff')
          .style('border', '1px solid #e5e7eb')
          .style('border-radius', '8px');
  
        const centerGroup = svg.append('g').attr('transform', `translate(${w / 2}, ${h / 2})`);
  
        function draw(placed) {
          const placedCount = placed.length;
          const totalCount = words.length;
          const percentage = Math.round((placedCount / totalCount) * 100);
          const feedbackDiv = document.createElement('div');
          feedbackDiv.style.cssText = 'text-align: center; padding: 8px; margin-bottom: 10px;';
  
          if (placedCount < totalCount) {
            const missing = totalCount - placedCount;
            feedbackDiv.style.cssText += 'color: #dc2626; font-size: 13px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px;';
            feedbackDiv.innerHTML = `Showing ${placedCount} of ${totalCount} words (${percentage}%) - <strong>${missing} words couldn't fit</strong>. Try zooming out to see more words.`;
          } else {
            feedbackDiv.style.cssText += 'color: #16a34a; font-size: 13px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px;';
            feedbackDiv.innerHTML = `Successfully showing <strong>all ${totalCount} words</strong> at ${Math.round(zoomLevel * 100)}% zoom`;
          }
  
          container.insertBefore(feedbackDiv, container.firstChild);
  
          centerGroup.selectAll('text')
            .data(placed)
            .enter().append('text')
            .attr('text-anchor', 'middle')
            .style('font-family', 'Arial, sans-serif')
            .style('font-weight', 'bold')
            .style('font-size', d => d.size + 'px')
            .style('fill', d => color(d.text))
            .style('cursor', 'pointer')
            .attr('transform', d => `translate(${d.x},${d.y}) rotate(${d.rotate})`)
            .text(d => d.text)
            .on('mouseover', function () {
              d3.select(this).style('opacity', 0.7).style('text-decoration', 'underline');
            })
            .on('mouseout', function () {
              d3.select(this).style('opacity', 1).style('text-decoration', 'none');
            });
        }
  
        if (window.d3 && d3.layout && typeof d3.layout.cloud === 'function') {
          d3.layout.cloud()
            .size([w, h])
            .words(words)
            .padding(Math.max(1, 3 * zoomLevel))
            .rotate(() => {
              const rand = Math.random();
              if (rand > 0.85) return 90;
              if (rand > 0.70) return -90;
              if (rand > 0.60) return 45;
              if (rand > 0.50) return -45;
              return 0;
            })
            .font('Arial, sans-serif')
            .fontSize(d => d.size)
            .fontWeight('bold')
            .spiral('archimedean')
            .timeInterval(10)
            .on('end', draw)
            .start();
        } else {
          const msg = document.createElement('div');
          msg.style.color = 'crimson';
          msg.style.fontSize = '14px';
          msg.style.padding = '20px';
          msg.textContent = 'Word Cloud unavailable: d3-cloud not loaded.';
          container.appendChild(msg);
        }
      }
  
      renderAtZoomLevel(1.0);
  
      // Zoom controls - uses class-based selectors scoped to this container (F3)
      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'zoom-controls';
      controlsDiv.style.cssText = 'text-align: center; padding: 12px; margin-top: 15px; background: linear-gradient(135deg, #f8fafc 0%, #e0f2fe 100%); border-radius: 8px; border: 1px solid #bae6fd;';
      controlsDiv.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; gap: 15px; flex-wrap: wrap;">
          <button class="zoom-out-btn" style="padding: 10px 20px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3); transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">- Zoom Out</button>
          <div style="display: flex; align-items: center; gap: 10px; background: white; padding: 8px 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <span style="color: #64748b; font-weight: 600; font-size: 13px;">Zoom:</span>
            <span class="zoom-display" style="font-weight: 700; font-size: 18px; color: #1e40af; min-width: 60px; display: inline-block; text-align: center;">100%</span>
          </div>
          <button class="zoom-in-btn" style="padding: 10px 20px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3); transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">+ Zoom In</button>
          <button class="zoom-reset-btn" style="padding: 10px 20px; background: linear-gradient(135deg, #64748b 0%, #475569 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; box-shadow: 0 2px 4px rgba(100, 116, 139, 0.3); transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">↺ Reset</button>
        </div>
        <div style="margin-top: 10px; font-size: 12px; color: #64748b; font-style: italic;">
           Zoom Out = Smaller words, more fit in view • Zoom In = Larger words, fewer fit • Use mouse wheel to zoom
        </div>
      `;
      container.appendChild(controlsDiv);
  
      let zoomTimeout;
      const zoomDisplay = controlsDiv.querySelector('.zoom-display');
      const zoomInBtn   = controlsDiv.querySelector('.zoom-in-btn');
      const zoomOutBtn  = controlsDiv.querySelector('.zoom-out-btn');
      const zoomResetBtn = controlsDiv.querySelector('.zoom-reset-btn');
  
      zoomInBtn.addEventListener('click', () => {
        clearTimeout(zoomTimeout);
        const newZoom = Math.min(currentZoomLevel * 1.25, 2.5);
        zoomDisplay.textContent = `${Math.round(newZoom * 100)}%`;
        zoomTimeout = setTimeout(() => renderAtZoomLevel(newZoom), 300);
      });
  
      zoomOutBtn.addEventListener('click', () => {
        clearTimeout(zoomTimeout);
        const newZoom = Math.max(currentZoomLevel / 1.25, 0.25);
        zoomDisplay.textContent = `${Math.round(newZoom * 100)}%`;
        zoomTimeout = setTimeout(() => renderAtZoomLevel(newZoom), 300);
      });
  
      zoomResetBtn.addEventListener('click', () => {
        clearTimeout(zoomTimeout);
        zoomDisplay.textContent = '100%';
        renderAtZoomLevel(1.0);
      });
  
      container.addEventListener('wheel', (e) => {
        e.preventDefault();
        clearTimeout(zoomTimeout);
        const delta = e.deltaY > 0 ? 0.95 : 1.05;
        const newZoom = Math.max(0.25, Math.min(2.5, currentZoomLevel * delta));
        zoomDisplay.textContent = `${Math.round(newZoom * 100)}%`;
        zoomTimeout = setTimeout(() => renderAtZoomLevel(newZoom), 400);
      }, { passive: false });
  
      // Container-scoped resize handler (F4)
      if (container._resizeHandler) {
        window.removeEventListener('resize', container._resizeHandler);
      }
      let resizeTimeout;
      container._resizeHandler = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => renderAtZoomLevel(currentZoomLevel), 500);
      };
      window.addEventListener('resize', container._resizeHandler);
    }
  
    // ============================================================
    // INTERNAL: render frequencies with slider
    // ============================================================
  
    function _renderWordCloudFromFrequencies(container, className, freqArray, maxFreq, minFreq) {
      container.innerHTML = '';
      const displayTitle = className === 'all' ? 'All Data' : `Class ${className}`;
      container.innerHTML = `<h5 style="margin-top: 20px;text-align: center;">${displayTitle}</h5>`;
  
      const frequencyRanges = _buildSmartFrequencyRanges(freqArray);
      if (!frequencyRanges.length) {
        container.innerHTML += '<div style="color: crimson; margin-top: 20px;">No words to display.</div>';
        return;
      }
  
      const currentRange = frequencyRanges[0];
      const sliderContainer = document.createElement('div');
      sliderContainer.className = 'word-cloud-slider-container';
      sliderContainer.style.cssText = 'margin: 20px auto; max-width: 600px; padding: 0 20px;';
  
      const rangeDisplay = (currentRange.min === currentRange.max)
        ? `<span id="freq-value-${className}" style="font-weight: 700; font-size: 1.5em; color: var(--primary-blue);">${currentRange.max}</span>`
        : `<span id="freq-value-${className}" style="font-weight: 700; font-size: 1.5em; color: var(--primary-blue);">${currentRange.min}-${currentRange.max}</span>`;
  
      sliderContainer.innerHTML = `
        <div style="text-align: center; margin-bottom: 12px;">${rangeDisplay}</div>
        <div style="display: flex; align-items: center; gap: 15px;">
          <input type="number" id="freq-input-${className}" min="1" max="${frequencyRanges.length}" value="1" step="1"
            style="width: 80px; padding: 8px 12px; border: 2px solid var(--neutral-300); border-radius: var(--radius-md); font-size: 1rem; font-weight: 600; text-align: center; background: white; color: var(--neutral-800);"
            onkeydown="handleFrequencyInput(event, '${className}')"
          >
          <input type="range" id="freq-slider-${className}" min="1" max="${frequencyRanges.length}" value="1" step="1"
            style="flex: 1; cursor: pointer;"
          >
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 12px; color: #666; margin-top: 4px;">
          <span>${minFreq} (All words)</span>
          <span>${maxFreq} (Top word only)</span>
        </div>
      `;
      container.appendChild(sliderContainer);
  
      const cloudContainer = document.createElement('div');
      cloudContainer.className = 'wordcloud-canvas-container';
      cloudContainer.id = `cloud-container-${className}`;
      cloudContainer.style.width = '100%';
      cloudContainer.style.minHeight = '650px';
      cloudContainer.style.overflow = 'hidden';  // Prevent words escaping container
      cloudContainer.style.position = 'relative';
      container.appendChild(cloudContainer);
  
      const slider = document.getElementById(`freq-slider-${className}`);
      const input  = document.getElementById(`freq-input-${className}`);
      const valueDisplay = document.getElementById(`freq-value-${className}`);

      if (slider && input && valueDisplay) {
        slider.min = 1; slider.max = frequencyRanges.length;
        input.min  = 1; input.max  = frequencyRanges.length;
        _updateSliderGradient(slider);

        // Stopwords key for cache keying (read from DOM - not in function scope)
        const _stopKey = document.getElementById('includeStopwords')?.checked ? '1' : '0';

        /**
         * Render the word cloud for a given frequency range index.
         * 1. Check in-memory SVG cache (instant within same page load)
         * 2. If miss, run d3-cloud and save result to both in-memory + sessionCache
         */
        function updateFrequency(rangeIndex) {
          const adjustedIndex = rangeIndex - 1;
          if (adjustedIndex < 0 || adjustedIndex >= frequencyRanges.length) return;
          const range = frequencyRanges[adjustedIndex];
          valueDisplay.innerHTML = (range.min === range.max) ? range.max : `${range.min}-${range.max}`;
          slider.value = rangeIndex;
          input.value = rangeIndex;
          _updateSliderGradient(slider);
      
          // Helper function to add info bar (used for both cache hits and new renders)
          function addInfoBar(placed, total) {
              // Remove any existing info bars
              if (cloudContainer.parentNode) {
                  const existingBars = cloudContainer.parentNode.querySelectorAll('.wc-info-bar');
                  existingBars.forEach(bar => bar.remove());
              }
      
              const skipped = total - placed;
              const infoBar = document.createElement('div');
              infoBar.className = 'wc-info-bar';
      
              if (skipped > 0) {
                  infoBar.innerHTML = `
                      <span style="font-weight: 600; color: #4f46e5;">${placed}</span> of top 
                      <span style="font-weight: 600;">${total}</span> words placed
                      <span style="margin-left: 8px; color: #9ca3af;"> - </span>
                      <span style="margin-left: 8px; font-size: 10px;">
                          ${skipped} larger words need more space
                      </span>
                  `;
              } else {
                  infoBar.innerHTML = `
                      All <span style="font-weight: 600; color: #10b981;">${placed}</span> top words placed
                  `;
              }
      
              if (cloudContainer.parentNode) {
                  cloudContainer.parentNode.appendChild(infoBar);
              }
          }
      
          // 1. In-memory cache check (survives class tab switches)
          const svgKey = `${className}:${_stopKey}:${rangeIndex}`;
          const cachedSvg = _renderedSvgCache.get(svgKey);
          if (cachedSvg) {
              cloudContainer.innerHTML = cachedSvg;
              
              // Get saved zoom level for this class
              const savedZoom = _zoomLevelPerClass.get(className) || 1.0;
              
              // Add zoom controls for cached render
              _addZoomControls(cloudContainer, freqArray, range.min, className);
              
              // Add info bar for cached render
              const tempDiv = document.createElement('div');
              tempDiv.innerHTML = cachedSvg;
              const wordCount = tempDiv.querySelectorAll('text').length;
              
              const filtered = freqArray.filter(([, freq]) => freq >= range.min);
              const cappedTotal = Math.min(filtered.length, 100);
              
              addInfoBar(wordCount, cappedTotal);
              return;
          }
      
          // 2. Render via d3-cloud with saved zoom level
          _classRenderState.set(className, true);
          
          // Get saved zoom level BEFORE calling render
          const savedZoom = _zoomLevelPerClass.get(className) || 1.0;
          
          // Pass zoomLevel as 5th parameter (signature: container, freqArray, minFreq, onRendered, zoomLevel)
          _generateWordCloudWithFreqFilter(
              cloudContainer, 
              freqArray, 
              range.min, 
              (svgHtml, placedCount, totalCount) => {
                  _classRenderState.delete(className);
                  if (!svgHtml) return;
                  
                  // Add zoom controls for new render
                  _addZoomControls(cloudContainer, freqArray, range.min, className);
                  
                  // Save to cache
                  _renderedSvgCache.set(svgKey, svgHtml);
                  if (window.sessionCache && rangeIndex === 1) {
                      window.sessionCache.set(
                          window.sessionCache.vizKey('wc_svg', className, _stopKey === '1', 1),
                          svgHtml
                      );
                  }
                  
                  // Add info bar for new render
                  addInfoBar(placedCount, totalCount);
              },
              savedZoom  // Pass the saved zoom level here (5th parameter)
          );
      }

        // Warm in-memory cache from sessionCache (handles /advanced -> back -> /visualizations)
        const svgKey1 = `${className}:${_stopKey}:1`;
        if (!_renderedSvgCache.has(svgKey1) && window.sessionCache) {
          const scKey = window.sessionCache.vizKey('wc_svg', className, _stopKey === '1', 1);
          if (!window.sessionCache.isStale(scKey)) {
            const entry = window.sessionCache.get(scKey);
            if (entry && entry.data) {
              _renderedSvgCache.set(svgKey1, entry.data);
            }
          }
        }

        slider.addEventListener('input', (e) => updateFrequency(parseInt(e.target.value, 10)));

        let inputTimeout;
        input.addEventListener('input', (e) => {
          clearTimeout(inputTimeout);
          inputTimeout = setTimeout(() => {
            let idx = parseInt(e.target.value, 10);
            if (isNaN(idx)) {
              idx = parseInt(slider.value, 10);
              input.value = idx;
              return;
            }
            idx = Math.max(parseInt(slider.min, 10), Math.min(parseInt(slider.max, 10), idx));
            updateFrequency(idx);
          }, 300);
        });

        // Initial render - will hit cache if available, otherwise show progress bar
        updateFrequency(1);
      }
    }
  
    function _updateSliderGradient(slider) {
      const progress = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
      slider.style.background = `linear-gradient(to right, #4f46e5 0%, #4f46e5 ${progress}%, #e5e7eb ${progress}%, #e5e7eb 100%)`;
    }
  
    // ============================================================
    // INTERNAL: build smart frequency ranges
    // ============================================================
  
    function _buildSmartFrequencyRanges(freqArray) {
      const ranges = [];
      const uniqueFreqs = [...new Set(freqArray.map(([, freq]) => freq))].sort((a, b) => a - b);
  
      for (let i = 0; i < uniqueFreqs.length; i++) {
        const currentFreq = uniqueFreqs[i];
        const wordsAtFreq = new Set(
          freqArray.filter(([, f]) => f >= currentFreq).map(([w]) => w)
        );
  
        let rangeEnd = currentFreq;
        for (let j = i + 1; j < uniqueFreqs.length; j++) {
          const nextFreq = uniqueFreqs[j];
          const wordsAtNext = new Set(
            freqArray.filter(([, f]) => f >= nextFreq).map(([w]) => w)
          );
          if (wordsAtNext.size !== wordsAtFreq.size ||
              [...wordsAtNext].some(w => !wordsAtFreq.has(w))) {
            break;
          }
          rangeEnd = nextFreq;
        }
  
        ranges.push({ min: currentFreq, max: rangeEnd, wordCount: wordsAtFreq.size });
  
        const nextIndex = uniqueFreqs.indexOf(rangeEnd) + 1;
        if (nextIndex < uniqueFreqs.length) {
          i = nextIndex - 1;
        } else {
          break;
        }
      }
      return ranges;
    }
  
    // ============================================================
    // INTERNAL: render with frequency filter (uses d3-cloud)
    // ============================================================
  
    /**
     * Render a word cloud using d3-cloud.
     * @param {HTMLElement} container
     * @param {Array} freqArray  - [[word, freq], ...]
     * @param {number} minFreq   - minimum frequency threshold (from slider)
     * @param {Function} [onRendered] - called with container.innerHTML when done
     * @param {number} [zoomLevel=1.0] - scales font sizes; zoom out = smaller fonts = more words fit
     */
    function _generateWordCloudWithFreqFilter(container, freqArray, minFreq, onRendered, zoomLevel) {
      zoomLevel = (typeof zoomLevel === 'number' && zoomLevel > 0) ? zoomLevel : 1.0;

      let filtered = freqArray.filter(([, freq]) => freq >= minFreq);

      // No arbitrary cap - show all words that meet the threshold.
      // Font scale adapts so they fit; user zooms out to make fonts smaller
      // allowing more words to be placed. Hard limit at 800 for performance.
      if (filtered.length > 100) filtered = filtered.slice(0, 100);

      if (!filtered.length) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#666;">No words meet this frequency threshold.</div>';
        if (typeof onRendered === 'function') onRendered('');
        return;
      }

      const w = Math.max((container.clientWidth || 900) - 40, 500);
      const h = 600;
      const wordCount = filtered.length;
      const maxF = filtered[0][1];
      const minF = filtered[filtered.length - 1][1];

      // MATCH FIRST RENDER EXACTLY
      const baseFontSize = Math.max(10, Math.min(18, 200 / Math.sqrt(wordCount)));
      const minFont = Math.max(baseFontSize * zoomLevel, 10);
      const maxFont = Math.max(minFont * 6, 60 * zoomLevel);
      const fontScale = d3.scaleSqrt().domain([minF, maxF]).range([minFont, maxFont]);

      const words = filtered.map(([text, freq]) => ({
        text: text.replace(/_/g, ' '),
        size: fontScale(freq),
        frequency: freq
      }));

      // Loading state with progress bar
      container.innerHTML = `
        <div class="wc-loading-state" style="text-align:center;padding:24px 40px;">
          <div style="display:inline-block;width:32px;height:32px;border:3px solid #e5e7eb;
                      border-top-color:#4f46e5;border-radius:50%;
                      animation:spin 0.8s linear infinite;margin-bottom:12px;"></div>
          <p style="font-size:13px;color:#6b7280;margin:0 0 10px;">
            Analyzing <strong>${filtered.length}</strong> words (showing top 100)...
            ${zoomLevel !== 1.0 ? `at ${Math.round(zoomLevel * 100)}% zoom` : ''} -
            <span class="wc-elapsed">0s</span>
          </p>
          <div style="background:#e5e7eb;border-radius:4px;height:6px;overflow:hidden;
                      max-width:260px;margin:0 auto;">
            <div class="wc-d3-bar" style="background:linear-gradient(90deg,#4f46e5,#7c3aed);
                                          height:100%;width:5%;border-radius:4px;
                                          transition:width 0.12s ease;"></div>
          </div>
        </div>
      `;

      const progressBar = container.querySelector('.wc-d3-bar');
      const elapsedEl = container.querySelector('.wc-elapsed');
      let pct = 5;
      let elapsedSec = 0;
      const anim = setInterval(() => {
        pct = Math.min(pct + 2, 85);
        if (progressBar) progressBar.style.width = pct + '%';
      }, 100);
      const elapsedTimer = setInterval(() => {
        elapsedSec++;
        if (elapsedEl) elapsedEl.textContent = `${elapsedSec}s`;
      }, 1000);

      const cloudContainer = document.createElement('div');
      cloudContainer.className = 'wordcloud-canvas-container';
      cloudContainer.style.cssText = `width:100%;height:${h}px;position:relative;overflow:hidden;`;

      if (window.d3 && d3.layout && typeof d3.layout.cloud === 'function') {
        try {
          d3.layout.cloud()
            .size([w, h])
            .words(words)
            .padding(4)
            .rotate(() => (Math.random() > 0.75 ? 90 : 0))
            .font('Arial, sans-serif')
            .fontSize(d => d.size)
            .fontWeight('bold')
            .spiral('rectangular')
            .timeInterval(5)
            .on('end', placedWords => {
              clearInterval(anim);
              container.innerHTML = '';
              container.appendChild(cloudContainer);
              _renderWordsAsHTML(cloudContainer, placedWords);
          
              // CRITICAL: Call onRendered callback FIRST (saves ONLY the cloud to cache)
              if (typeof onRendered === 'function') {
                  onRendered(cloudContainer.innerHTML);
              }
          
              // THEN add info bar AFTER caching (so it's never included in cached HTML)
              const placed = placedWords.length;
              const total = filtered.length;
              const skipped = total - placed;
          
              const infoBar = document.createElement('div');
              infoBar.className = 'wc-info-bar';
          
              if (skipped > 0) {
                  infoBar.innerHTML = `
                      <span style="font-weight: 600; color: #4f46e5;">${placed}</span> of top 
                      <span style="font-weight: 600;">${total}</span> words placed
                      <span style="margin-left: 8px; color: #9ca3af;"> - </span>
                      <span style="margin-left: 8px; font-size: 10px;">
                          ${skipped} larger words need more space
                      </span>
                  `;
              } else {
                  infoBar.innerHTML = `
                      All <span style="font-weight: 600; color: #10b981;">${placed}</span> top words placed
                  `;
              }
          
              // Remove any existing info bars in the parent container
              if (container.parentNode) {
                  const existingBars = container.parentNode.querySelectorAll('.wc-info-bar');
                  existingBars.forEach(bar => bar.remove());
                  
                  // Append to parent (outside the word cloud box)
                  container.parentNode.appendChild(infoBar);
              }
          })
            .start();
        } catch (d3Error) {
          // d3-cloud threw synchronously - fall back and always call onRendered
          clearInterval(anim);
          clearInterval(elapsedTimer);
          container.innerHTML = '';
          container.appendChild(cloudContainer);
          _renderSimpleWordGrid(cloudContainer, words);
          if (typeof onRendered === 'function') onRendered(container.innerHTML);
        }
      } else {
        clearInterval(anim);
        container.innerHTML = '';
        container.appendChild(cloudContainer);
        _renderSimpleWordGrid(cloudContainer, words);
        
        // Call callback FIRST (cache only the cloud)
        if (typeof onRendered === 'function') onRendered(cloudContainer.innerHTML);
        
        // THEN add info bar
        const infoBar = document.createElement('div');
        infoBar.className = 'wc-info-bar';
        infoBar.innerHTML = `Showing <span style="font-weight: 600;">${words.length}</span> words in grid layout`;
        
        if (container.parentNode) {
            const existingBars = container.parentNode.querySelectorAll('.wc-info-bar');
            existingBars.forEach(bar => bar.remove());
            container.parentNode.appendChild(infoBar);
        }
    }
    }
  
    function _renderWordsAsHTML(container, placedWords) {
      const colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
                      '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
  
      // Force layout reflow before reading dimensions
      void container.getBoundingClientRect();
      const w = container.clientWidth || 900;
      const h = container.clientHeight || 600;
  
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      // Use viewBox so the SVG scales to any container size
      // This means cached SVGs from off-screen (1200px) render correctly in any container
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.style.display = 'block';
      svg.style.overflow = 'hidden';
  
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${w / 2}, ${h / 2})`);
      svg.appendChild(g);
  
      placedWords.forEach((word, index) => {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('transform', `translate(${word.x},${word.y}) rotate(${word.rotate})`);
        text.style.fontFamily = 'Arial, sans-serif';
        text.style.fontWeight = 'bold';
        text.style.fontSize = word.size + 'px';
        text.style.fill = colors[index % colors.length];
        text.style.cursor = 'pointer';
        text.textContent = word.text;
  
        text.addEventListener('mouseenter', function () {
          this.style.opacity = '0.7';
        });
        text.addEventListener('mouseleave', function () {
          this.style.opacity = '1';
        });
  
        g.appendChild(text);
      });
  
      container.appendChild(svg);
    }
  
    function _renderSimpleWordGrid(container, words) {
      const colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd'];
      words.forEach((word, index) => {
        const span = document.createElement('span');
        span.textContent = word.text;
        span.style.display = 'inline-block';
        span.style.margin = '5px';
        span.style.fontFamily = 'Arial, sans-serif';
        span.style.fontWeight = 'bold';
        span.style.fontSize = word.size + 'px';
        span.style.color = colors[index % colors.length];
        span.style.cursor = 'pointer';
        span.style.userSelect = 'text';
        container.appendChild(span);
      });
    }
  
    // ============================================================
    // INTERNAL: local fallback for when API fails
    // ============================================================
  
    async function _renderWordCloudLocally(container, className, combinedText, includeStopwords) {
      const stops = window.STOPWORDS || window.stopwords || new Set();
      const entities = (typeof window.getEntitiesFromText === 'function')
        ? await window.getEntitiesFromText(combinedText)
        : [];
      const processedText = (typeof window.processTextWithNER === 'function')
        ? window.processTextWithNER(combinedText, entities)
        : combinedText;
  
      const words = [];
      processedText.toLowerCase().split(/\W+/).forEach(w => {
        if (w.length <= 2) return;
        if (!includeStopwords && stops.has(w.replace(/_/g, ' '))) return;
        words.push(w);
      });
  
      const freqMap = {};
      words.forEach(word => {
        freqMap[word] = (freqMap[word] || 0) + 1;
      });
  
      const freqArray = Object.entries(freqMap)
        .filter(([w, f]) => w && Number.isFinite(f) && f > 0)
        .sort((a, b) => b[1] - a[1]);
  
      if (!freqArray.length) {
        container.innerHTML = `<div style="color: crimson; margin-top: 20px;">No words to display.</div>`;
        return;
      }
  
      const maxFreq = freqArray[0][1];
      const minFreq = freqArray[freqArray.length - 1][1];
  
      if (window.wordCloudCache) {
        window.wordCloudCache.set(className, {
          freqArray, maxFreq, minFreq,
          wordCount: words.length, timestamp: Date.now(), source: 'local'
        });
      }
  
      _renderWordCloudFromFrequencies(container, className, freqArray, maxFreq, minFreq);
    }
  
    /**
     * Pre-render word clouds for all classes into an off-screen DOM element.
     * Called after the active class renders so subsequent tab switches are instant.
     *
     * Strategy:
     *   1. Create a hidden off-screen div (must be in DOM for d3-cloud text measurement)
     *   2. For each non-active class: fetch frequencies, run d3-cloud off-screen
     *   3. Save rendered SVG to _renderedSvgCache + sessionCache
     *   4. When user clicks tab: cache hit -> instant injection
     *
     * @param {Array} data - window.lastCSVData
     * @param {string[]} allClasses - all class names including 'all'
     * @param {string} activeClass - the class currently shown (skip it)
     */
    async function _preRenderAllClasses(data, allClasses, activeClass) {
      const includeStopwords = document.getElementById('includeStopwords')?.checked || false;
      const stopKey = includeStopwords ? '1' : '0';
  
      const toRender = allClasses.filter(cls => {
        if (cls === activeClass) return false;
        const svgKey = `${cls}:${stopKey}:1`;
        if (_renderedSvgCache.has(svgKey)) return false;
        if (window.sessionCache) {
          const scKey = window.sessionCache.vizKey('wc_svg', cls, includeStopwords, 1);
          if (!window.sessionCache.isStale(scKey)) {
            const entry = window.sessionCache.get(scKey);
            if (entry?.data) {
              _renderedSvgCache.set(svgKey, entry.data);
              return false;
            }
          }
        }
        return true;
      });
  
      if (!toRender.length) return;
  
      const offscreen = document.createElement('div');
      offscreen.setAttribute('aria-hidden', 'true');
      offscreen.style.cssText = [
        'position:fixed', 'left:-9999px', 'top:0',
        'width:1200px', 'height:650px',
        'overflow:hidden', 'pointer-events:none',
        'opacity:0', 'z-index:-9999'
      ].join(';');
      document.body.appendChild(offscreen);
  
      for (const className of toRender) {
        if (_prerenderAborted) break;
  
        // Pause while user has an active render - prevents CPU competition
        // Timeout after 15s to prevent infinite block if a render fails silently
        let waitedMs = 0;
        while (_classRenderState.size > 0 && !_prerenderAborted && waitedMs < 15000) {
          await new Promise(resolve => setTimeout(resolve, 200));
          waitedMs += 200;
        }
        if (waitedMs >= 15000) {
          _classRenderState.clear(); // Force-clear stuck renders
        }
        if (_prerenderAborted) break;
  
        const svgKey = `${className}:${stopKey}:1`;
        if (_renderedSvgCache.has(svgKey)) continue;
  
        // If user clicked this class while we were waiting, it's now rendering
        if (_classRenderState.has(className)) {
          await new Promise(resolve => {
            const wait = setInterval(() => {
              if (!_classRenderState.has(className)) { clearInterval(wait); resolve(); }
            }, 250);
          });
          continue;
        }
  
        // Fetch freq data
        let freqArray = null;
        if (window.wordCloudCache?.has(className)) {
          freqArray = window.wordCloudCache.get(className).freqArray;
        } else {
          const targetNum = String(className).replace('label', '');
          const classRows = (data || []).filter(row => {
            if (Array.isArray(row.labelNames) && row.labelNames.length) return row.labelNames.includes(className);
            const rowClass = row.label !== undefined ? row.label : row.class;
            return String(rowClass == null ? 'Unlabeled' : rowClass) === (className === 'all' ? String(rowClass) : targetNum);
          });
          const textData = (className === 'all' ? (data || []) : classRows)
            .map(r => r.text || '').filter(t => t.trim());
          if (!textData.length) continue;
          try {
            const res = await fetch('/api/wordcloud_frequencies', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rows: textData, includeStopwords, className })
            });
            const json = await res.json();
            if (json.frequencies?.length) {
              freqArray = json.frequencies;
              if (window.wordCloudCache) {
                window.wordCloudCache.set(className, {
                  freqArray, maxFreq: freqArray[0][1], minFreq: freqArray[freqArray.length - 1][1],
                  wordCount: textData.length, timestamp: Date.now(), source: 'prerender'
                });
              }
            }
          } catch (_) { continue; }
        }
  
        if (!freqArray?.length || _prerenderAborted) continue;
  
        // Yield to browser before heavy d3-cloud work
        await new Promise(resolve => {
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(resolve, { timeout: 3000 });
          } else {
            setTimeout(resolve, 100);
          }
        });
        if (_prerenderAborted) break;
  
        // Pre-render into off-screen div
        offscreen.innerHTML = '';
        const preContainer = document.createElement('div');
        preContainer.style.cssText = 'width:1200px;height:650px;overflow:hidden;position:relative;';
        offscreen.appendChild(preContainer);
        // Force layout reflow so clientWidth is accurate
        void preContainer.getBoundingClientRect();
  
        await new Promise(resolve => {
          _generateWordCloudWithFreqFilter(preContainer, freqArray, freqArray[0]?.[1] || 1, (svgHtml) => {
            if (svgHtml && !_prerenderAborted) {
              _renderedSvgCache.set(svgKey, svgHtml);
              if (window.sessionCache) {
                window.sessionCache.set(
                  window.sessionCache.vizKey('wc_svg', className, includeStopwords, 1),
                  svgHtml
                );
              }
            }
            resolve();
          });
        });
      }
  
      if (offscreen.parentNode) document.body.removeChild(offscreen);
    }

    /**
     * Public: trigger background pre-render for all word cloud classes.
     * Call after the active class has rendered.
     */
    async function preRenderAllWordClouds(data, allClasses, activeClass) {
      try {
        await _preRenderAllClasses(data, allClasses, activeClass);
      } catch (e) {
        // Non-critical - pre-rendering is a performance enhancement, not a requirement
        console.warn('preRenderAllWordClouds failed silently:', e.message);
      }
    }

    /**
     * Add zoom controls that RE-RUN d3-cloud with scaled fonts.
     * Zoom out = smaller fonts = more words fit in the same canvas.
     *
     * @param {HTMLElement} container  - the cloudContainer element
     * @param {Array} freqArray        - original frequency data for re-render
     * @param {number} minFreq         - current frequency threshold (from slider)
     */
    function _addZoomControls(container, freqArray, minFreq, className) {
      // Remove any existing zoom controls to prevent duplicates
      const parent = container.parentElement;
      if (parent) {
        parent.querySelectorAll('.wc-zoom-controls').forEach(el => el.remove());
      }

      let currentZoom = _zoomLevelPerClass.get(className) || 1.0;
      let zoomTimeout;

      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'wc-zoom-controls';
      controlsDiv.style.cssText = [
        'display:flex', 'justify-content:center', 'align-items:center',
        'gap:12px', 'padding:10px', 'margin-top:8px',
        'background:linear-gradient(135deg,#f8fafc,#e0f2fe)',
        'border-radius:8px', 'border:1px solid #bae6fd'
      ].join(';');

      const btnStyle = [
        'padding:7px 14px',
        'background:linear-gradient(135deg,#3b82f6,#2563eb)',
        'color:white', 'border:none', 'border-radius:8px',
        'cursor:pointer', 'font-weight:600', 'font-size:12px',
        'box-shadow:0 2px 4px rgba(59,130,246,0.3)',
      ].join(';');

      const resetStyle = btnStyle.replace(/#3b82f6,#2563eb/g, '#64748b,#475569')
                                .replace(/rgba\(59,130,246,0\.3\)/g, 'rgba(100,116,139,0.3)');

      controlsDiv.innerHTML = `
        <button class="wc-zoom-out" style="${btnStyle}">- Zoom Out</button>
        <div style="background:white;padding:5px 12px;border-radius:8px;
                    box-shadow:0 1px 3px rgba(0,0,0,0.1);
                    font-weight:700;font-size:15px;color:#1e40af;min-width:60px;text-align:center;">
          <span class="wc-zoom-display">100%</span>
        </div>
        <button class="wc-zoom-in" style="${btnStyle}">+ Zoom In</button>
        <button class="wc-zoom-reset" style="${resetStyle}">↺ Reset</button>
        <span style="font-size:11px;color:#94a3b8;margin-left:4px;">Zoom out adds more words</span>
      `;
      setTimeout(() => {
        const zd = controlsDiv.querySelector('.wc-zoom-display');
        if (zd) zd.textContent = Math.round(currentZoom * 100) + '%';
      }, 0);

      function rerender(zoom) {
        currentZoom = Math.max(0.25, Math.min(3.0, zoom));
        _zoomLevelPerClass.set(className, currentZoom); // Persist zoom for this class
        const zoomDisplay = controlsDiv.querySelector('.wc-zoom-display');
        if (zoomDisplay) zoomDisplay.textContent = Math.round(currentZoom * 100) + '%';

        // Debounce - avoid rapid successive re-renders
        clearTimeout(zoomTimeout);
        zoomTimeout = setTimeout(() => {
          _generateWordCloudWithFreqFilter(container, freqArray, minFreq, null, currentZoom);
        }, 300);
      }

      controlsDiv.querySelector('.wc-zoom-out').addEventListener('click', () => rerender(currentZoom / 1.35));
      controlsDiv.querySelector('.wc-zoom-in').addEventListener('click', () => rerender(currentZoom * 1.35));
      controlsDiv.querySelector('.wc-zoom-reset').addEventListener('click', () => rerender(1.0));

      // Mouse wheel zoom on the cloud container
      let wheelDebounce;
      container.addEventListener('wheel', (e) => {
        e.preventDefault();
        clearTimeout(wheelDebounce);
        wheelDebounce = setTimeout(() => {
          rerender(currentZoom * (e.deltaY > 0 ? 0.85 : 1.15));
        }, 80);
      }, { passive: false });

      // Insert controls above the cloud container
      if (parent) {
        parent.insertBefore(controlsDiv, container);
      }
    }
    // Expose public API on window
    window.renderWordCloudForClass = renderWordCloudForClass;
    window.preRenderAllWordClouds = preRenderAllWordClouds;
    window.cancelAllPreRenders = cancelAllPreRenders;
    window.resetPreRenderState = resetPreRenderState;
    window.generateWordCloudFromFreq = generateWordCloudFromFreq;
    window.handleFrequencyInput = handleFrequencyInput;
    window.clearWordCloudCache = clearWordCloudCache;
    // For backward-compat with internal callers in script.js that haven't been
    // migrated yet - these will be removed in 5E once all callers use the
    // public API above.
    window.generateWordCloudWithAutoSizing = _generateWordCloudWithAutoSizing;
    window.renderWordCloudFromFrequencies = _renderWordCloudFromFrequencies;
    window.renderWordCloudLocally = _renderWordCloudLocally;
    window.generateWordCloudWithFreqFilter = _generateWordCloudWithFreqFilter;
    window.renderWordsAsHTML = _renderWordsAsHTML;
    window.renderSimpleWordGrid = _renderSimpleWordGrid;
    window.buildSmartFrequencyRanges = _buildSmartFrequencyRanges;
    console.log('wordCloud.js functions exposed:', {
      renderWordCloudForClass: typeof window.renderWordCloudForClass,
      clearWordCloudCache: typeof window.clearWordCloudCache
    });
  })();