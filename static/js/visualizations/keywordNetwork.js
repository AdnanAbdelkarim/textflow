/**
 * Keyword cooccurrence network module.
 *
 * Backend: /api/cooccurrence
 * Renders D3 force-directed graph of word cooccurrences.
 */
(function () {
    'use strict';
  
    const MIN_LINK_WEIGHT = 10;
    const MAX_LINKS = 120;
  
    // Module-scoped abort controller and call tracking
    let networkCtrl = null;
    let lastNetworkCall = { className: null, timestamp: null, stack: null };
  
    /**
     * Fetch cooccurrence data and render keyword network.
     *
     * @param {string[]} rows
     * @param {boolean} includeStopwords
     * @param {number} topN
     * @param {number} minCooccurrence
     * @param {string} [className=''] - empty for unlabeled, class name for labeled
     */
    async function fetchAndRenderCooccurrence(rows, includeStopwords, topN, minCooccurrence, className) {
      className = className || '';
  
      if (networkCtrl) {
        try { networkCtrl.abort(); } catch (_) {}
      }
      networkCtrl = new AbortController();
  
      const slim = (typeof window.slimRows === 'function')
        ? window.slimRows(rows, 2000, 2000)
        : (rows || []).slice(0, 2000).map(t => (t || '').toString().slice(0, 2000));
  
      try {
        const payload = {
          rows: slim,
          includeStopwords: !!includeStopwords,
          topN: Number(topN) || 100,
          minCooccurrence: Number(minCooccurrence) || 2
        };
  
        // Check sessionStorage cache before fetching - network is the bottleneck here
        if (window.sessionCache) {
          const scKey = window.sessionCache.vizKey('net', className, includeStopwords, payload.topN, payload.minCooccurrence);
          if (!window.sessionCache.isStale(scKey)) {
            const entry = window.sessionCache.get(scKey);
            if (entry && entry.data) {
              if (className) {
                renderKeywordNetworkForClass(entry.data, className);
              } else {
                renderKeywordNetwork(entry.data, className ? `cooccurrenceNetwork-${className}` : 'cooccurrenceNetwork');
              }
              return;
            }
          }
        }
  
        const res = await fetch('/api/cooccurrence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: networkCtrl.signal,
          cache: 'no-store'
        });
        if (!res.ok) throw new Error(`/api/cooccurrence ${res.status}`);
        const net = await res.json();

        // Normalize link weight
        // Normalize link weight
        if (Array.isArray(net.links)) {
          for (const L of net.links) if (L.weight == null && L.value != null) L.weight = L.value;
        }

        // Drop nodes left without any edge.
        // A node with no edges passed the top-N filter but failed
        // the min co-occurrence threshold with every other node
        if (Array.isArray(net.nodes) && Array.isArray(net.links)) {
          const connectedIds = new Set(
            net.links.flatMap(l => [l.source, l.target])
          );
          const before = net.nodes.length;
          net.nodes = net.nodes.filter(n => connectedIds.has(n.id));
          const removed = before - net.nodes.length;
          if (removed > 0) {
            console.log(`[NETWORK] Removed ${removed} isolated node(s) with no edges`);
          }
        }

        // Persist to sessionStorage before rendering
        if (window.sessionCache && net.nodes && net.nodes.length) {
          const scKey = window.sessionCache.vizKey('net', className, includeStopwords, payload.topN, payload.minCooccurrence);
          window.sessionCache.set(scKey, net);
        }
  
        const containerId = className ? `cooccurrenceNetwork-${className}` : 'cooccurrenceNetwork';
  
        if (!window.netSimState) window.netSimState = {};
        if (!window.pinnedState) window.pinnedState = {};
  
        if (window.pinnedState[containerId]) {
          window.pinnedState[containerId].clear();
        } else {
          window.pinnedState[containerId] = new Set();
        }
  
        if (window.netSimState[containerId] && typeof window.netSimState[containerId].stop === 'function') {
          window.netSimState[containerId].stop();
        }
  
        lastNetworkCall = { className, timestamp: new Date().toISOString(), stack: new Error().stack };
  
        if (className) {
          renderKeywordNetworkForClass(net, className);
        } else {
          renderKeywordNetwork(net, containerId);
        }
      } catch (err) {
        if (window.isAbortError && window.isAbortError(err)) return;
        console.error('Keyword network failed:', err);
  
        const containerId = className ? `cooccurrenceNetwork-${className}` : 'cooccurrenceNetwork';
        const svg = d3.select(`#${containerId}`);
        svg.selectAll('*').remove();
        const w = 900, h = 600;
        svg.attr('viewBox', `0 0 ${w} ${h}`)
           .append('text').attr('x', w / 2).attr('y', h / 2)
           .attr('text-anchor', 'middle').style('fill', 'crimson')
           .text('Failed to load keyword network (check /api/cooccurrence).');
      } finally {
        networkCtrl = null;
      }
    }
  
    /**
     * Build SVG container for a class-specific network and render.
     */
    function renderKeywordNetworkForClass(graph, className) {
      const networkContainer = document.querySelector('#networkContainer .class-tabs-content');
      if (!networkContainer) {
        console.error('No network content container found');
        return;
      }
  
      const displayTitle = className === 'all' ? 'All Data' : `Class ${typeof window.classDisplayName === 'function' ? window.classDisplayName(className) : className}`;
      networkContainer.innerHTML = `<h5 style="margin-top: 20px;text-align: center;">${displayTitle}</h5>`;
  
      const svgContainer = document.createElement('div');
      svgContainer.className = 'keyword-network-container';
      svgContainer.style.width = '100%';
      svgContainer.style.minHeight = '700px';
      svgContainer.style.position = 'relative';
  
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const svgId = `cooccurrenceNetwork-${className}`;
      svg.setAttribute('id', svgId);
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '700');
      svg.setAttribute('viewBox', '0 0 1200 700');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.style.display = 'block';
      svg.style.border = '1px solid #e5e7eb';
      svg.style.borderRadius = '8px';
      svg.style.background = '#ffffff';
  
      svgContainer.appendChild(svg);
      networkContainer.appendChild(svgContainer);
  
      if (!window.netSimState) window.netSimState = {};
      if (!window.pinnedState) window.pinnedState = {};
  
      if (window.netSimState[svgId]) {
        try { window.netSimState[svgId].stop(); } catch (_) {}
        window.netSimState[svgId] = null;
      }
      window.pinnedState[svgId] = new Set();
  
      renderKeywordNetwork(graph, svgId);
    }
  
    /**
     * Core D3 force-directed graph renderer.
     */
    function renderKeywordNetwork(graph, containerId) {
      containerId = containerId || 'cooccurrenceNetwork';
      const svg = d3.select(`#${containerId}`);
  
      if (!window.netSimState) window.netSimState = {};
      if (!window.pinnedState) window.pinnedState = {};
      if (!window.pinnedState[containerId]) window.pinnedState[containerId] = new Set();
  
      const pinned = window.pinnedState[containerId];
  
      if (!graph || !graph.nodes || !graph.nodes.length || !graph.links || !graph.links.length) {
        svg.selectAll('*').remove();
        const viewBox = svg.attr('viewBox')?.split(' ') || [0, 0, 1200, 700];
        const w = +viewBox[2];
        const h = +viewBox[3];
        svg.append('text').attr('x', w / 2).attr('y', h / 2)
           .attr('text-anchor', 'middle').style('font-size', '16px').style('fill', 'crimson')
           .text('No results for current settings.');
        return;
      }
  
      if (window.netSimState[containerId]) {
        try { window.netSimState[containerId].stop(); } catch (_) {}
      }
  
      svg.selectAll('*').remove();
  
      const viewBox = svg.attr('viewBox')?.split(' ') || [0, 0, 1200, 700];
      const w = +viewBox[2];
      const h = +viewBox[3];
      const padding = 40;
  
      const links = graph.links
        .sort((a, b) => (b.value ?? b.weight ?? 1) - (a.value ?? a.weight ?? 1))
        .slice(0, MAX_LINKS)
        .map(d => ({ ...d, value: d.value ?? d.weight ?? 1 }));

      // Slicing links can orphan nodes; keep only those still connected.
      // MAX_LINKS slice can cut a node's only edges, leaving it isolated
      const connectedIds = new Set(links.flatMap(l => [
        typeof l.source === 'object' ? l.source.id : l.source,
        typeof l.target === 'object' ? l.target.id : l.target
      ]));
      const nodes = graph.nodes
        .filter(d => connectedIds.has(d.id))
        .map(d => ({ ...d }));
  
      nodes.forEach(n => {
        n.x = padding + Math.random() * (w - 2 * padding);
        n.y = padding + Math.random() * (h - 2 * padding);
      });
  
      const degree = new Map(nodes.map(n => [n.id, 0]));
      links.forEach(l => {
        const s = l.source?.id || l.source;
        const t = l.target?.id || l.target;
        degree.set(s, (degree.get(s) || 0) + 1);
        degree.set(t, (degree.get(t) || 0) + 1);
      });
  
      const baseSize = d3.scaleSqrt()
        .domain(d3.extent(nodes, d => degree.get(d.id) || 1))
        .range([18, 40]);
  
      function nodeR(d) {
        const degreeSize = baseSize(degree.get(d.id) || 1);
        const textWidth = d.id.length * 6;
        const textRadius = textWidth / 2 + 14;
        return Math.max(degreeSize, textRadius);
      }
  
      const minCo = d3.min(links, d => d.value) || 1;
      const maxCo = d3.max(links, d => d.value) || 1;
      const edgeScale = d3.scaleLinear().domain([minCo, maxCo]).range([1, 6]);
  
      const root = svg.append('g');
      root.append('rect').attr('class', 'zoom-catcher')
        .attr('x', 0).attr('y', 0).attr('width', w).attr('height', h)
        .style('fill', 'none').style('pointer-events', 'all');
  
      const g = root.append('g');
  
      const link = g.append('g').selectAll('line').data(links).enter().append('line')
        .attr('stroke', '#999').attr('stroke-opacity', 0.25)
        .attr('stroke-width', d => edgeScale(d.value))
        .style('pointer-events', 'none');
  
      const nodeGroups = g.selectAll('g.node-group').data(nodes).enter().append('g')
        .attr('class', 'node-group').style('cursor', 'pointer');
  
      const circles = nodeGroups.append('circle')
        .attr('r', d => nodeR(d))
        .attr('fill', '#3b82f6').attr('stroke', '#fff').attr('stroke-width', 2);
  
      const labels = nodeGroups.append('text')
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-weight', 'bold').attr('font-size', 16).attr('fill', '#111')
        .style('user-select', 'none').style('pointer-events', 'none')
        .text(d => d.id);
  
      let selectedNode = null;
      let connectedNodes = new Set();
  
      function highlightSelection(node) {
        connectedNodes.clear();
        if (node) {
          connectedNodes.add(node.id);
          links.forEach(l => {
            const s = l.source.id || l.source;
            const t = l.target.id || l.target;
            if (s === node.id) connectedNodes.add(t);
            if (t === node.id) connectedNodes.add(s);
          });
        }
        circles
          .attr('fill', d => connectedNodes.has(d.id) ? '#10b981' : '#3b82f6')
          .attr('opacity', d => !node || connectedNodes.has(d.id) ? 1 : 0.25);
        labels.attr('opacity', d => !node || connectedNodes.has(d.id) ? 1 : 0.25);
        link
          .attr('stroke', d => {
            if (!node) return '#999';
            const s = d.source.id || d.source;
            const t = d.target.id || d.target;
            return (connectedNodes.has(s) && connectedNodes.has(t)) ? '#10b981' : '#999';
          })
          .attr('stroke-opacity', d => {
            if (!node) return 0.25;
            const s = d.source.id || d.source;
            const t = d.target.id || d.target;
            return (connectedNodes.has(s) && connectedNodes.has(t)) ? 0.9 : 0.05;
          });
      }
  
      nodeGroups.on('click', function (event, d) {
        event.stopPropagation();
        selectedNode = (selectedNode === d) ? null : d;
        highlightSelection(selectedNode);
      });
  
      root.select('rect.zoom-catcher').on('click', function () {
        selectedNode = null;
        highlightSelection(null);
      });
  
      const linkForce = d3.forceLink(links).id(d => d.id)
        .distance(l => {
          const v = +l.value || 1;
          return Math.max(220, 380 - 25 * Math.log1p(v));
        })
        .strength(0.01);
  
      const sim = d3.forceSimulation(nodes)
        .alpha(0.1).alphaDecay(0.05).velocityDecay(0.9)
        .force('link', linkForce)
        .force('charge', d3.forceManyBody().strength(-80))
        .force('collide', d3.forceCollide().radius(d => nodeR(d) + 12))
        .on('tick', ticked);
  
      window.netSimState[containerId] = sim;
  
      function ticked() {
        link
          .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        nodeGroups.attr('transform', d => `translate(${d.x},${d.y})`);
      }
  
      const zoom = d3.zoom().scaleExtent([0.4, 4])
        .on('zoom', e => g.attr('transform', e.transform));
      root.select('rect.zoom-catcher').call(zoom);
  
      const drag = d3.drag()
        .on('start', (event, d) => {
          if (!event.active) sim.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => {
          if (!event.active) sim.alphaTarget(0);
          pinned.add(d.id);
        });
  
      nodeGroups.call(drag);
    }
  
    // Expose public API
    window.fetchAndRenderCooccurrence = fetchAndRenderCooccurrence;
    window.renderKeywordNetwork = renderKeywordNetwork;
    window.renderKeywordNetworkForClass = renderKeywordNetworkForClass;
  })();