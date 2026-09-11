/**
 * SVG pie chart with legend and synchronized hover effects.
 * Used by topic modeling display.
 *
 * Hover handlers don't capture render-specific state - they re-query the DOM
 * each call, so subsequent pie charts work correctly (see F52).
 */
(function () {
    'use strict';
  
    const COLORS = [
      '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c',
      '#d97706', '#65a30d', '#059669', '#0891b2', '#4f46e5'
    ];
  
    /**
     * Build an SVG pie chart with a multi-column legend.
     * @param {Array<{label: string, percent: number}>} topics
     * @returns {string} HTML string
     */
    function createPieChart(topics) {
      const total = topics.reduce((sum, t) => sum + t.percent, 0);
      let currentAngle = -90; // start at top
  
      const segments = topics.map((topic, idx) => {
        const percent = (topic.percent / total) * 100;
        const angle = (percent / 100) * 360;
        const endAngle = currentAngle + angle;
        const largeArc = angle > 180 ? 1 : 0;
        const startX = 50 + 40 * Math.cos((currentAngle * Math.PI) / 180);
        const startY = 50 + 40 * Math.sin((currentAngle * Math.PI) / 180);
        const endX = 50 + 40 * Math.cos((endAngle * Math.PI) / 180);
        const endY = 50 + 40 * Math.sin((endAngle * Math.PI) / 180);
  
        const pathData = [
          'M 50 50',
          `L ${startX} ${startY}`,
          `A 40 40 0 ${largeArc} 1 ${endX} ${endY}`,
          'Z'
        ].join(' ');
  
        const result = {
          path: pathData,
          color: COLORS[idx % COLORS.length],
          label: topic.label,
          percent: topic.percent,
          index: idx
        };
        currentAngle = endAngle;
        return result;
      });
  
      // Hover handlers - DOM-live queries, no closure over segments
      const applyPieHover = (hoveredIndex) => {
        const paths = document.querySelectorAll('.pie-segment');
        const legendItems = document.querySelectorAll('.legend-item');
  
        paths.forEach((path, index) => {
          const isActive = index === hoveredIndex;
          path.style.opacity = isActive ? '0.9' : '0.6';
          path.style.transform = isActive ? 'scale(1.02)' : 'scale(1)';
        });
  
        legendItems.forEach((item, index) => {
          const isActive = index === hoveredIndex;
          item.style.background = isActive ? '#e0e7ff' : '#f8fafc';
          item.style.border = isActive ? '1px solid #3b82f6' : '1px solid transparent';
        });
      };
  
      const clearPieHover = () => {
        document.querySelectorAll('.pie-segment').forEach(path => {
          path.style.opacity = '1';
          path.style.transform = 'scale(1)';
        });
        document.querySelectorAll('.legend-item').forEach(item => {
          item.style.background = '#f8fafc';
          item.style.border = '1px solid transparent';
        });
      };
  
      // Always reassign - handlers don't capture render-specific state
      window.handlePieHover = applyPieHover;
      window.handlePieLeave = clearPieHover;
      window.handleLegendHover = applyPieHover;
      window.handleLegendLeave = clearPieHover;
  
      // Multi-column legend (10 items per column)
      const buildLegendColumns = () => {
        const itemsPerColumn = 9;
        const columns = [];
        for (let i = 0; i < segments.length; i += itemsPerColumn) {
          const columnItems = segments.slice(i, i + itemsPerColumn);
          const columnHTML = columnItems.map((seg, localIndex) => {
            const globalIndex = i + localIndex;
            return `
              <div class="legend-item"
                   style="display: flex; align-items: center; margin-bottom: 8px; padding: 6px 8px; border-radius: 6px; background: #f8fafc; transition: all 0.2s; cursor: pointer; border: 1px solid transparent;"
                   onmouseover="handleLegendHover(${globalIndex})"
                   onmouseout="handleLegendLeave()">
                <div style="width: 16px; height: 16px; background-color: ${seg.color}; border-radius: 4px; margin-right: 10px; flex-shrink: 0; box-shadow: 0 1px 2px rgba(0,0,0,0.1);"></div>
                <span style="font-size: 13px; flex: 1; line-height: 1.3;"><strong>${seg.label}</strong></span>
                <span style="font-size: 13px; color: #6366f1; font-weight: 600; margin-left: 6px; white-space: nowrap;">${seg.percent}%</span>
              </div>
            `;
          }).join('');
          columns.push(`<div style="flex: 1; min-width: 200px; margin-right: 1rem;">${columnHTML}</div>`);
        }
        return columns.join('');
      };
  
      const svgPaths = segments.map((seg, idx) => `
        <path
          class="pie-segment"
          data-index="${idx}"
          d="${seg.path}"
          fill="${seg.color}"
          stroke="white"
          stroke-width="1"
          style="transition: all 0.2s; cursor: pointer;"
          onmouseover="handlePieHover(${idx})"
          onmouseout="handlePieLeave()"
        />
      `).join('');
  
      return `
        <div style="display: flex; gap: 3rem; align-items: flex-start; justify-content: center; flex-wrap: wrap; margin: 2rem 0; padding: 2rem; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <div style="position: relative; flex-shrink: 0;">
            <svg viewBox="0 0 100 100" style="width: 320px; height: 320px; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.1));">
              ${svgPaths}
            </svg>
          </div>
          <div style="flex: 1; min-width: 300px; max-width: 800px;">
            <h4 style="margin-bottom: 1rem; font-size: 1.1rem; color: #1e293b;">Topics</h4>
            <div style="display: flex; flex-wrap: wrap; gap: 1rem; max-height: 400px; overflow-y: auto; padding-right: 10px;">
              ${buildLegendColumns()}
            </div>
          </div>
        </div>`;
    }
  
    window.createPieChart = createPieChart;
  })();