/**
 * Zipf's Law plot module.
 *
 * Backend: /api/zipf, /api/word_frequency
 * Renders log-log rank vs frequency with least-squares fit and coverage markers.
 */
(function () {
    'use strict';
  
    let zipfCtrl = null;
  
    /**
     * Fetch and render Zipf plot for unlabeled data (whole corpus).
     */
    async function generateZipfPlotServer(rows, includeStopwords) {
      if (includeStopwords === undefined) includeStopwords = true;
      try {
        const data = await postJSON('/api/zipf', { rows, includeStopwords });
        drawZipfPlot(data);
      } catch (err) {
        console.error('Zipf plot fetch failed:', err);
        d3.select('#zipfPlot').html("<p style='color:red'> Failed to load Zipf plot.</p>");
      }
    }
  
    /**
     * Fetch and render Zipf plot for a specific class (labeled data path).
     * Uses AbortController for safe re-rendering - see F28.
     */
    async function renderZipfForClass(rows, includeStopwords, className) {
      if (zipfCtrl) {
        try { zipfCtrl.abort(); } catch (_) {}
      }
      zipfCtrl = new AbortController();
      const signal = zipfCtrl.signal;
  
      const container = document.querySelector('.zipf-flex .class-tabs-content');
      if (!container) {
        console.error('renderZipfForClass: .class-tabs-content not found');
        return;
      }
  
      if (!rows || rows.length === 0) {
        container.innerHTML = `<div style='text-align:center;padding:40px;'> No data available for Zipf plot.</div>`;
        return;
      }
  
      const displayLabel = className === 'all' ? 'All Data' : `Class ${typeof window.classDisplayName === 'function' ? window.classDisplayName(className) : className}`;
      container.innerHTML = `<h5 style="margin-top: 20px;text-align: center;">${displayLabel}</h5>`;
  
      const plotWrapper = document.createElement('div');
      plotWrapper.id = `zipfPlot-${className}`;
      plotWrapper.style.cssText = 'position: relative; width: 100%; min-height: 650px;';
      container.appendChild(plotWrapper);
  
      try {
        // Check sessionStorage cache before fetching
        let freq = null;
        const scKey = window.sessionCache
          ? window.sessionCache.vizKey('zipf', className, includeStopwords)
          : null;
  
        if (scKey && !window.sessionCache.isStale(scKey)) {
          const entry = window.sessionCache.get(scKey);
          if (entry && entry.data) {
            freq = entry.data;
          }
        }
  
        if (!freq) {
          const slim = (typeof window.slimRows === 'function')
            ? window.slimRows(rows, 2000, 2000)
            : (rows || []).map(r => String(typeof r === 'string' ? r : (r.text || '')).slice(0, 2000)).filter(t => t.trim());
  
          freq = await postJSON('/api/word_frequency', {
            rows: slim,
            includeStopwords: !!includeStopwords
          }, { signal });
  
          if (scKey && freq && freq.length) {
            window.sessionCache.set(scKey, freq);
          }
        }
  
        if (!Array.isArray(freq) || !freq.length) {
          plotWrapper.innerHTML = "<div style='text-align:center;padding:40px;'> No data for Zipf plot.</div>";
          return;
        }
  
        freq.sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
        const zipfData = freq.map((item, index) => ({
          rank: index + 1,
          freq: item.frequency || 0
        }));
  
        const vocabularySize = freq.length;
        const fitEndRank = Math.min(5000, vocabularySize);
  
        const drawOpts = {
          fitStartRank: 50, fitEndRank, showTopDots: true, coverageSteps: [50, 80, 90]
        };

        const measuredWidth = plotWrapper.getBoundingClientRect().width
                           || plotWrapper.clientWidth
                           || 0;

        if (measuredWidth === 0) {
          // Container hidden on first render - wait for real width
          const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
              if (entry.contentRect.width > 0) {
                observer.disconnect();
                if (signal.aborted) return;
                _drawZipfPlotInto(plotWrapper, zipfData, drawOpts);
                break;
              }
            }
          });
          observer.observe(plotWrapper);
        } else {
          // Container already visible - render immediately
          _drawZipfPlotInto(plotWrapper, zipfData, drawOpts);
        }
      } catch (err) {
        if (window.isAbortError && window.isAbortError(err)) return;
        console.error('Zipf fetch failed:', err);
        plotWrapper.innerHTML = "<div style='text-align:center;padding:40px;'> Failed to load Zipf plot.</div>";
      }
    }
  
    /**
     * Render Zipf plot into the main #zipfPlot container (unlabeled path).
     */
    function drawZipfPlot(data, opts) {
      const root = document.getElementById('zipfPlot');
      if (!root) return;
      root.innerHTML = '';
      _drawZipfPlotInto(root, data, opts || {});
    }
  
    // ============================================================
    // INTERNAL: unified Zipf plot renderer (replaces old duplicate)
    // ============================================================
  
    function _drawZipfPlotInto(containerElement, data, opts) {
      opts = opts || {};
      const fitStartRank = +opts.fitStartRank || 50;
      const fitEndRank   = +opts.fitEndRank   || 5000;
      const showTopDots  = opts.showTopDots ?? true;
      const coverageSteps = opts.coverageSteps || [50, 80, 90];
  
      data = (data || [])
        .map(d => ({ rank: +d.rank, freq: +d.freq }))
        .filter(d => d.rank > 0 && d.freq > 0 && Number.isFinite(d.rank) && Number.isFinite(d.freq))
        .sort((a, b) => a.rank - b.rank);
  
      const root = d3.select(containerElement);
      root.html('');
  
      if (!data.length) {
        root.append('div').style('color', 'crimson').text('No valid data for Zipf plot.');
        return;
      }
  
      const containerWidth = opts.containerWidth
                          || containerElement.getBoundingClientRect().width
                          || containerElement.clientWidth
                          || 1250;

      console.log('[ZIPF SIZE]', {
          containerWidth,
          clientWidth:        containerElement.clientWidth,
          boundingWidth:      containerElement.getBoundingClientRect().width,
          offsetWidth:        containerElement.offsetWidth,
          parentClientWidth:  containerElement.parentElement?.clientWidth,
          parentBounding:     containerElement.parentElement?.getBoundingClientRect().width,
          svgWidth:           containerWidth - 56 - 22 - 60,
          svgHeight:          430
      });
      const margin = { top: 28, right: 22, bottom: 46, left: 56 };
      const width  = containerWidth - margin.left - margin.right - 60;
      const height = 430 - margin.top - margin.bottom;
  
      const svg = root.append('svg')
        .attr('width', '100%')
        .attr('height', height + margin.top + margin.bottom)
        .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .style('display', 'block')
        .style('max-width', '100%');
  
      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  
      g.append('text')
        .attr('x', width / 2).attr('y', -8)
        .attr('text-anchor', 'middle').attr('font-weight', 600).attr('font-size', 14)
  
      const x = d3.scaleLog().domain([1, d3.max(data, d => d.rank)]).range([0, width]);
      const y = d3.scaleLog().domain([1, d3.max(data, d => d.freq)]).range([height, 0]);
  
      g.append('g').call(d3.axisLeft(y).ticks(6, '~s'));
      g.append('g').attr('transform', `translate(0,${height})`).call(d3.axisBottom(x).ticks(6, '~s'));
  
      g.append('text')
        .attr('x', width / 2).attr('y', height + 38)
        .attr('text-anchor', 'middle').attr('font-size', 18)
        .attr('font-weight', 'bold').attr('fill', '#000')
        .text('Log(Rank)');
  
      g.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2).attr('y', -48)
        .attr('text-anchor', 'middle').attr('font-size', 18)
        .attr('font-weight', 'bold').attr('fill', '#000')
        .text('Log(Frequency)');
  
      const line = d3.line().x(d => x(d.rank)).y(d => y(d.freq));
      g.append('path').datum(data).attr('fill', 'none').attr('stroke', '#1e90ff')
        .attr('stroke-width', 2.5).attr('d', line);
  
      const totalTokens = d3.sum(data, d => d.freq);
      let cum = 0;
      const withCum = data.map(d => {
        cum += d.freq;
        return { ...d, cumPct: 100 * (cum / totalTokens) };
      });
      const rankAtCoverage = t => (withCum.find(d => d.cumPct >= t) || withCum[withCum.length - 1]).rank;
  
      const covGroup = g.append('g').attr('class', 'coverage-markers');
      coverageSteps.forEach(step => {
        const r = rankAtCoverage(step);
        covGroup.append('line')
          .attr('x1', x(r)).attr('x2', x(r))
          .attr('y1', height - 18).attr('y2', height)
          .attr('stroke', '#7c848d').attr('stroke-dasharray', '4,4').attr('stroke-width', 1);
        covGroup.append('text')
          .attr('x', x(r)).attr('y', height - 22).attr('text-anchor', 'middle')
          .attr('font-size', 10).attr('fill', '#5a6169').text(`${step}%`);
      });
  
      const hapaxCount = data.filter(d => d.freq === 1).length;
      const hapaxPctTypes = 100 * (hapaxCount / data.length);
      const hapax = data.find(d => d.freq === 1);
      let hapaxRank = null;
      if (hapax) {
        hapaxRank = hapax.rank;
        g.append('line')
          .attr('x1', x(hapaxRank)).attr('x2', x(hapaxRank))
          .attr('y1', 0).attr('y2', height)
          .attr('stroke', '#a32b22').attr('stroke-dasharray', '6,4')
          .attr('stroke-width', 1.5).attr('opacity', 0.6);
      }
  
      // Least-squares fit
      const start = Math.max(+fitStartRank, 1);
      const end   = Math.min(+fitEndRank, data[data.length - 1].rank);
      const fitData = data.filter(d => d.rank >= start && d.rank <= end);
      const log10 = v => Math.log10(v);
      let a = NaN, b = NaN, r2 = NaN;
      if (fitData.length >= 3) {
        const xs = fitData.map(d => log10(d.rank));
        const ys = fitData.map(d => log10(d.freq));
        const n = xs.length;
        const xbar = d3.mean(xs), ybar = d3.mean(ys);
        const Sxx = d3.sum(xs, v => (v - xbar) ** 2);
        const Sxy = d3.sum(d3.range(n), i => (xs[i] - xbar) * (ys[i] - ybar));
        b = Sxy / Sxx;
        a = ybar - b * xbar;
        const yhat = xs.map(xi => a + b * xi);
        const SSE = d3.sum(d3.range(n), i => (ys[i] - yhat[i]) ** 2);
        const SST = d3.sum(ys, yi => (yi - ybar) ** 2);
        r2 = 1 - SSE / SST;
  
        const fitX1 = start, fitX2 = end;
        const fitY1 = 10 ** (a + b * log10(fitX1));
        const fitY2 = 10 ** (a + b * log10(fitX2));
        g.append('line')
          .attr('x1', x(fitX1)).attr('x2', x(fitX2))
          .attr('y1', y(fitY1)).attr('y2', y(fitY2))
          .attr('stroke', '#111').attr('stroke-width', 2).attr('stroke-dasharray', '6,4');
  
        g.append('line')
          .attr('x1', x(start)).attr('x2', x(start))
          .attr('y1', 0).attr('y2', height)
          .attr('stroke', '#5a6169').attr('stroke-dasharray', '4,4').attr('opacity', 0.7);
  
        g.append('line')
          .attr('x1', x(end)).attr('x2', x(end))
          .attr('y1', 0).attr('y2', height)
          .attr('stroke', '#5a6169').attr('stroke-dasharray', '4,4').attr('opacity', 0.7);
      }
  
      if (showTopDots) {
        [1, 10, 100].forEach(k => {
          const d = data.find(d => d.rank === k);
          if (!d) return;
          g.append('circle').attr('cx', x(d.rank)).attr('cy', y(d.freq))
            .attr('r', 3.5).attr('fill', '#1e90ff').attr('stroke', '#fff').attr('stroke-width', 1);
        });
      }
  
      // Tooltip
      const tipContainer = d3.select(containerElement.parentElement || containerElement);
      tipContainer.style('position', 'relative');
      const tip = tipContainer.append('div')
        .attr('class', 'zipf-tip')
        .style('position', 'absolute').style('pointer-events', 'none')
        .style('background', 'rgba(17,24,39,0.9)').style('color', '#fff')
        .style('padding', '6px 8px').style('border-radius', '6px')
        .style('font-size', '12px').style('opacity', 0).style('z-index', 1000);
  
      g.append('path').datum(data).attr('fill', 'none').attr('stroke', 'transparent')
        .attr('stroke-width', 16).attr('d', line)
        .on('mousemove', (event) => {
          const [mx] = d3.pointer(event);
          const rankGuess = x.invert(mx);
          const idx = d3.bisector(d => d.rank).left(data, rankGuess);
          const i = Math.max(0, Math.min(data.length - 1, idx));
          const d = data[i];
          tip
            .style('left', `${event.offsetX + 12}px`)
            .style('top', `${event.offsetY - 24}px`)
            .style('opacity', 1)
            .html(
              `<div><b>rank</b> ${d.rank.toLocaleString()}</div>
               <div><b>freq</b> ${d.freq.toLocaleString()}</div>
               <div><b>rel%</b> ${(100 * d.freq / totalTokens).toFixed(3)}%</div>
               <div><b>cum%</b> ${withCum[i].cumPct.toFixed(2)}%</div>`
            );
        })
        .on('mouseleave', () => tip.style('opacity', 0));
  
      // DOM legend
      const legendContainerEl = containerElement.parentElement || containerElement;
      if (getComputedStyle(legendContainerEl).position === 'static') {
        legendContainerEl.style.position = 'relative';
      }
      legendContainerEl.querySelectorAll('.zipf-legend-dom').forEach(n => n.remove());
  
      const legend = document.createElement('div');
      legend.className = 'zipf-legend-dom';
      Object.assign(legend.style, {
        position: 'absolute', top: '6px', right: '8px', maxWidth: '560px',
        background: 'rgba(255,255,255,0.95)', border: '1px dashed #a7aeb6',
        borderRadius: '8px', padding: '10px 12px', fontSize: '12px',
        lineHeight: '1.35', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', zIndex: 10
      });
  
      const tokens = totalTokens.toLocaleString();
      const types  = data.length.toLocaleString();
      const ttr    = (data.length / totalTokens).toFixed(3);
      const herdan = (Math.log(data.length) / Math.log(totalTokens)).toFixed(3);
      const slopeB = Number.isFinite(b)  ? b.toFixed(3)  : 'n/a';
      const expoS  = Number.isFinite(b)  ? (-b).toFixed(3) : 'n/a';
      const r2txt  = Number.isFinite(r2) ? r2.toFixed(3) : 'n/a';
      const k50    = rankAtCoverage(50).toLocaleString();
      const k80    = rankAtCoverage(80).toLocaleString();
      const k90    = rankAtCoverage(90).toLocaleString();
  
      legend.innerHTML = `
        <div style="font-weight:600;margin-bottom:6px;">How to read this chart</div>
        <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
          <span style="width:36px;height:0;border-top:3px solid #1e90ff;display:inline-block;"></span>
          <span><b>Blue line</b>: empirical log-log curve of word frequency vs. rank.</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
          <span style="width:36px;height:0;border-top:2px dashed #111;display:inline-block;"></span>
          <span><b>Black dashed</b>: least-squares Zipf fit on ranks <b>${fitStartRank}</b>-<b>${fitEndRank}</b>
            (slope <b>b=${slopeB}</b>, exponent <b>s=${expoS}</b>, R²=<b>${r2txt}</b>).</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
          <span style="width:0;height:16px;border-left:2px dashed #e11d48;display:inline-block;"></span>
          <span><b>Red dashed</b>: hapax cutoff - first rank where frequency = 1${
            hapaxRank ? ` (rank <b>${hapaxRank.toLocaleString()}</b>; ${hapaxCount.toLocaleString()} types, ${hapaxPctTypes.toFixed(1)}% of vocabulary).` : '.'
          }</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
          <span style="width:0;height:16px;border-left:2px dashed #5a6169;display:inline-block;"></span>
          <span><b>Gray dashed</b>: boundaries of the fit window. Bottom ticks mark coverage:
            k<sub>50</sub>=${k50}, k<sub>80</sub>=${k80}, k<sub>90</sub>=${k90}.</span>
        </div>
        <hr style="border:none;border-top:1px dotted #e3e5e2;margin:8px 0;">
        <div><b>Corpus</b>: Tokens N=${tokens}; Types V=${types}; TTR=${ttr}; Herdan C=${herdan}</div>
      `;
      legendContainerEl.appendChild(legend);
    }
  
    // Expose public API
    window.generateZipfPlotServer = generateZipfPlotServer;
    window.renderZipfForClass = renderZipfForClass;
    window.drawZipfPlot = drawZipfPlot;
  })();