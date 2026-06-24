// Charts and Visual Heatmap Calendar Renderer using SVG
const Charts = {
  
  // Render a responsive SVG Bar Chart
  renderBarChart(containerId, data, xKey, yKey, unit = 'm') {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!data || data.length === 0) {
      container.innerHTML = '<p class="placeholder-text">No study data available for this chart period.</p>';
      return;
    }

    const width = container.clientWidth || 500;
    const height = container.clientHeight || 250;
    const paddingLeft = 40;
    const paddingBottom = 30;
    const paddingTop = 20;
    const paddingRight = 20;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    // Find max Y value
    const maxVal = Math.max(...data.map(d => d[yKey])) || 10;
    const yMax = Math.ceil(maxVal * 1.15); // Add 15% headroom

    // Create SVG element
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    // Y-axis gridlines & labels
    const gridLinesCount = 4;
    for (let i = 0; i <= gridLinesCount; i++) {
      const ratio = i / gridLinesCount;
      const yVal = Math.round(ratio * yMax);
      const yPos = height - paddingBottom - (ratio * chartHeight);

      // Label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', paddingLeft - 8);
      text.setAttribute('y', yPos + 4);
      text.setAttribute('text-anchor', 'end');
      text.setAttribute('font-size', '10');
      text.setAttribute('fill', 'var(--color-text-muted)');
      text.textContent = yVal + unit;
      svg.appendChild(text);

      // Gridline (skip baseline line)
      if (i > 0) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', paddingLeft);
        line.setAttribute('y1', yPos);
        line.setAttribute('x2', width - paddingRight);
        line.setAttribute('y2', yPos);
        line.setAttribute('stroke', 'var(--color-divider)');
        line.setAttribute('stroke-dasharray', '2,2');
        svg.appendChild(line);
      }
    }

    // X Axis line
    const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    axis.setAttribute('x1', paddingLeft);
    axis.setAttribute('y1', height - paddingBottom);
    axis.setAttribute('x2', width - paddingRight);
    axis.setAttribute('y2', height - paddingBottom);
    axis.setAttribute('stroke', 'var(--color-divider)');
    svg.appendChild(axis);

    // Render Bars
    const barSpacing = chartWidth / data.length;
    const barWidth = Math.max(8, barSpacing * 0.55);

    data.forEach((item, idx) => {
      const val = item[yKey];
      const barHeight = (val / yMax) * chartHeight;
      const xPos = paddingLeft + (idx * barSpacing) + (barSpacing - barWidth) / 2;
      const yPos = height - paddingBottom - barHeight;

      // Create Group for hover states
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      
      // Bar Rect
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', xPos);
      rect.setAttribute('y', yPos);
      rect.setAttribute('width', barWidth);
      rect.setAttribute('height', Math.max(2, barHeight));
      rect.setAttribute('rx', '4');
      rect.setAttribute('fill', 'var(--color-primary)');
      rect.setAttribute('style', 'transition: all 0.3s;');
      
      // Bar Hover Effect
      rect.addEventListener('mouseenter', () => {
        rect.setAttribute('fill', 'var(--color-secondary)');
      });
      rect.addEventListener('mouseleave', () => {
        rect.setAttribute('fill', 'var(--color-primary)');
      });

      // SVG Tooltip title
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${val}${unit} studied on ${item[xKey]}`;
      rect.appendChild(title);

      group.appendChild(rect);

      // X Label
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', xPos + barWidth / 2);
      label.setAttribute('y', height - paddingBottom + 16);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '9');
      label.setAttribute('fill', 'var(--color-text-muted)');
      
      // Shorten label for cleaner looks
      let labelText = item[xKey];
      if (labelText.includes('-')) {
        // Just show Day/Month for YYYY-MM-DD
        const parts = labelText.split('-');
        labelText = `${parts[1]}/${parts[2]}`;
      }
      label.textContent = labelText;
      group.appendChild(label);

      svg.appendChild(group);
    });

    container.appendChild(svg);
  },

  // Render a GitHub contribution-style Heatmap Calendar (Past 90 Days / 13 Weeks)
  renderHeatmap(containerId, activeSessions) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const weeksCount = 13;
    const daysCount = 7;
    const totalDays = weeksCount * daysCount;

    // Build map of study durations per date
    const studyMap = {};
    activeSessions.forEach(s => {
      // s is { date: 'YYYY-MM-DD', count: minutes }
      studyMap[s.date] = s.count;
    });

    const now = new Date();
    // Align starting day to Sunday 13 weeks ago
    const startDate = new Date();
    startDate.setDate(now.getDate() - totalDays + 1);
    const dayOfWeek = startDate.getDay();
    // Adjust start date back to the nearest Sunday
    startDate.setDate(startDate.getDate() - dayOfWeek);

    for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
      const cellDate = new Date(startDate);
      cellDate.setDate(startDate.getDate() + dayOffset);
      const dateStr = cellDate.toISOString().split('T')[0];
      const minutesStudied = studyMap[dateStr] || 0;

      // Determine activity level (lvl-0 to lvl-4)
      let level = 0;
      if (minutesStudied > 0 && minutesStudied < 15) level = 1;
      else if (minutesStudied >= 15 && minutesStudied < 45) level = 2;
      else if (minutesStudied >= 45 && minutesStudied < 90) level = 3;
      else if (minutesStudied >= 90) level = 4;

      const dayDiv = document.createElement('div');
      dayDiv.className = `heatmap-day lvl-${level}`;
      dayDiv.setAttribute('data-date', dateStr);
      
      const formattedDate = cellDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      dayDiv.setAttribute('data-tooltip', `${minutesStudied}m studied on ${formattedDate}`);
      
      container.appendChild(dayDiv);
    }
  }
};

window.Charts = Charts;
