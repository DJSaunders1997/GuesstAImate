/**
 * charts.js — Canvas chart rendering and daily target management.
 *
 * Draws cumulative step charts for calories and macros using the Canvas 2D API.
 * Also owns the targets overlay dialog (open/close/save).
 *
 * Globals consumed: selectedDate (main.js), renderLogs (render.js).
 */

/** Colour palette for each tracked nutrient. */
const MACRO_COLOURS = {
  calories: { line: '#22c55e', fill: 'rgba(34,197,94,0.12)'   },
  protein:  { line: '#60a5fa', fill: 'rgba(96,165,250,0.12)'  },
  carbs:    { line: '#fbbf24', fill: 'rgba(251,191,36,0.12)'  },
  fat:      { line: '#f87171', fill: 'rgba(248,113,113,0.12)' },
  fibre:    { line: '#a78bfa', fill: 'rgba(167,139,250,0.12)' },
};

/** General adult daily targets — used when the user has not customised them. */
const TARGET_DEFAULTS = { calories: 1900, protein: 165, carbs: 164, fat: 65, fibre: 38 };

/** Active daily targets, merged from defaults and any user-saved overrides. */
let DAILY_TARGETS = Object.assign({}, TARGET_DEFAULTS,
  JSON.parse(localStorage.getItem('guesstaimate_targets') || 'null'));

/**
 * Opens the targets overlay dialog and pre-fills it with the current targets.
 */
function openTargets() {
  document.getElementById('t-calories').value = DAILY_TARGETS.calories;
  document.getElementById('t-protein').value  = DAILY_TARGETS.protein;
  document.getElementById('t-carbs').value    = DAILY_TARGETS.carbs;
  document.getElementById('t-fat').value      = DAILY_TARGETS.fat;
  document.getElementById('t-fibre').value    = DAILY_TARGETS.fibre;
  document.getElementById('targets-overlay').classList.add('open');
  document.getElementById('targets-dialog').classList.add('open');
}

/**
 * Closes the targets overlay dialog without saving any changes.
 */
function closeTargets() {
  document.getElementById('targets-overlay').classList.remove('open');
  document.getElementById('targets-dialog').classList.remove('open');
}

/**
 * Reads the targets form, validates and saves the values to localStorage,
 * closes the dialog, and re-renders the charts with the new targets.
 */
function saveTargets() {
  const parse = (id, fallback) => {
    const v = parseFloat(document.getElementById(id).value);
    return isNaN(v) ? fallback : v;
  };
  DAILY_TARGETS = {
    calories: parse('t-calories', TARGET_DEFAULTS.calories),
    protein:  parse('t-protein',  TARGET_DEFAULTS.protein),
    carbs:    parse('t-carbs',    TARGET_DEFAULTS.carbs),
    fat:      parse('t-fat',      TARGET_DEFAULTS.fat),
    fibre:    parse('t-fibre',    TARGET_DEFAULTS.fibre),
  };
  localStorage.setItem('guesstaimate_targets', JSON.stringify(DAILY_TARGETS));
  closeTargets();
  renderLogs(); // redraw charts with new targets
}

/**
 * Draws one or more cumulative step-chart series onto a canvas element.
 *
 * Each series value is accumulated left-to-right, stepping up vertically at
 * each timestamp (discrete calorie additions, not interpolated).
 *
 * @param {HTMLCanvasElement} canvas     - The canvas to draw on.
 * @param {Date[]}            timestamps - Ordered entry timestamps (one per data point).
 * @param {Array<{
 *   label:   string,
 *   colour:  {line: string, fill: string},
 *   values:  number[],
 *   target?: number
 * }>} series - One or more data series to overlay on the same chart.
 * @param {string} unit - Unit label appended to y-axis numbers (e.g. 'g' or '').
 */
function drawCumulativeChart(canvas, timestamps, series, unit) {
  if (!canvas) return;
  canvas.style.display = 'block';

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || canvas.parentElement?.clientWidth || 300;
  const H   = 150;
  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const MUTED  = '#94a3b8';
  const BORDER = '#334155';
  const PAD    = { top: 12, right: 48, bottom: 28, left: 48 };
  const cW     = W - PAD.left - PAD.right;
  const cH     = H - PAD.top  - PAD.bottom;

  const hasData = timestamps.length > 0;
  if (!hasData) { canvas.style.display = 'none'; return; }

  // X range: always show 07:00–24:00 so the axis is stable across entries.
  // Extend the left edge earlier only if an entry falls before 07:00.
  const dayBase  = new Date(timestamps[0]);
  dayBase.setHours(0, 0, 0, 0);
  const default07 = new Date(dayBase); default07.setHours(7,  0, 0, 0);
  const default24 = new Date(dayBase); default24.setHours(24, 0, 0, 0);

  const ms    = timestamps.map(t => t.getTime());
  const minT  = Math.min(default07.getTime(), ...ms);
  const maxT  = default24.getTime();
  const tRange = maxT - minT;
  const times  = ms;
  const xOf    = t => PAD.left + ((t - minT) / tRange) * cW;

  // For today's chart, the flat tail ends at now; for past days it goes to 24:00.
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
  const isToday = dayBase.getTime() === todayMidnight.getTime();
  const rightEdgeT = isToday ? Math.min(Date.now(), maxT) : maxT;
  const rightEdgeX = Math.max(PAD.left, Math.min(PAD.left + cW, xOf(rightEdgeT)));

  // Cumulative totals per series.
  const cumSeries = series.map(s => {
    let acc = 0;
    return s.values.map(v => { acc += v || 0; return acc; });
  });

  // Scale the y-axis to fit both data and target reference lines.
  const dataMax    = Math.max(...cumSeries.map(cum => cum[cum.length - 1]));
  const targetMax  = Math.max(0, ...series.map(s => s.target || 0));
  const overallMax = Math.max(dataMax, targetMax);
  // Round the y-axis ceiling to a "nice" number so grid labels land on clean values.
  const _niceMax = (v) => {
    if (v <= 0) return 10;
    const mag  = Math.pow(10, Math.floor(Math.log10(v)));
    const step = mag >= 500 ? mag : mag / 2;
    return Math.ceil((v * 1.15) / step) * step;
  };
  const yAxisMax = _niceMax(overallMax);
  const yOf      = v => PAD.top + cH - (v / (yAxisMax || 1)) * cH;

  // Grid lines and y-axis labels.
  ctx.strokeStyle = BORDER;
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 3; i++) {
    const v = Math.round((yAxisMax / 3) * i);
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.font      = '10px system-ui,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(v + (unit || ''), PAD.left - 6, y + 3);
  }

  // X-axis: fixed hour markers across the 07:00–24:00 window.
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  ctx.font      = '10px system-ui,sans-serif';
  const tickHours = [7, 10, 13, 16, 19, 22, 24];
  tickHours.forEach(h => {
    const t = new Date(dayBase); t.setHours(h, 0, 0, 0);
    if (t.getTime() < minT) return; // skip if axis was extended earlier
    const x   = xOf(t.getTime());
    const lbl = h === 24 ? '00:00' : `${String(h).padStart(2, '0')}:00`;
    ctx.fillText(lbl, x, H - PAD.bottom + 14);
  });

  // Target reference lines (dashed, always drawn even with no data).
  series.forEach(s => {
    if (!s.target) return;
    const y = yOf(s.target);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = s.colour.line;
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.restore();
    ctx.fillStyle   = s.colour.line;
    ctx.font        = series.length > 1 ? 'bold 8px system-ui,sans-serif' : 'bold 10px system-ui,sans-serif';
    ctx.textAlign   = 'left';
    ctx.globalAlpha = 0.85;
    const lbl = series.length > 1 ? s.label[0] : s.target.toLocaleString() + (unit || '');
    ctx.fillText(lbl, PAD.left + cW + 4, y + 4);
    ctx.globalAlpha = 1;
  });

  // Draw each data series.
  series.forEach((s, si) => {
    const cum    = cumSeries[si];
    const colour = s.colour;

    /**
     * Builds the step path: holds y flat between entries then steps up
     * vertically at each timestamp — correct for discrete calorie additions.
     */
    const buildStepPath = () => {
      ctx.moveTo(xOf(times[0]), yOf(0));
      ctx.lineTo(xOf(times[0]), yOf(cum[0]));
      for (let i = 1; i < cum.length; i++) {
        ctx.lineTo(xOf(times[i]), yOf(cum[i - 1])); // hold flat
        ctx.lineTo(xOf(times[i]), yOf(cum[i]));     // step up
      }
      // Extend flat to the right edge (24:00 for past days, now for today).
      ctx.lineTo(rightEdgeX, yOf(cum[cum.length - 1]));
    };

    // Filled area under the step path.
    ctx.beginPath();
    buildStepPath();
    ctx.lineTo(rightEdgeX, yOf(0));
    ctx.closePath();
    ctx.fillStyle = colour.fill;
    ctx.fill();

    // Step line.
    ctx.beginPath();
    ctx.strokeStyle = colour.line;
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    buildStepPath();
    ctx.stroke();

    // Dots and value labels.
    if (series.length === 1) {
      cum.forEach((v, i) => {
        const x = xOf(times[i]), y = yOf(v);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle   = colour.line; ctx.fill();
        ctx.strokeStyle = '#0f172a';   ctx.lineWidth = 1.5; ctx.stroke();
        // Only label the last (most recent) entry to reduce clutter.
        if (i === cum.length - 1) {
          ctx.fillStyle = colour.line;
          ctx.font      = 'bold 10px system-ui,sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(v.toLocaleString(), x, y - 8);
        }
      });
    } else {
      cum.forEach((v, i) => {
        const x = xOf(times[i]), y = yOf(v);
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle   = colour.line; ctx.fill();
        ctx.strokeStyle = '#0f172a';   ctx.lineWidth = 1; ctx.stroke();
      });
    }
  });

  // Legend for multi-series charts.
  if (series.length > 1) {
    let legendY = PAD.top + 2;
    series.forEach(s => {
      ctx.fillStyle = s.colour.line;
      ctx.font      = 'bold 9px system-ui,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(s.label, PAD.left, legendY);
      legendY += 11;
    });
  }
}

/**
 * Renders the calorie chart and all four macro charts for the given day's logs.
 * Shows or hides the chart sections depending on whether any entries exist.
 * @param {Array<Object>} dayLogs - Log entries for the currently viewed day.
 */
function renderCharts(dayLogs) {
  const timestamps = dayLogs.map(l => new Date(l.timestamp));

  // Calorie chart.
  drawCumulativeChart(
    document.getElementById('cal-chart'),
    timestamps,
    [{ label: 'kcal', colour: MACRO_COLOURS.calories, values: dayLogs.map(l => l.calories || 0), target: DAILY_TARGETS.calories }],
    ''
  );

  // Individual macro charts (protein, carbs, fat, fibre).
  const macros = [
    { id: 'chart-protein', label: 'Protein', key: 'protein', colour: MACRO_COLOURS.protein },
    { id: 'chart-carbs',   label: 'Carbs',   key: 'carbs',   colour: MACRO_COLOURS.carbs   },
    { id: 'chart-fat',     label: 'Fat',     key: 'fat',     colour: MACRO_COLOURS.fat     },
    { id: 'chart-fibre',   label: 'Fibre',   key: 'fibre',   colour: MACRO_COLOURS.fibre   },
  ];
  macros.forEach(m => {
    drawCumulativeChart(
      document.getElementById(m.id),
      timestamps,
      [{ label: m.label, colour: m.colour, values: dayLogs.map(l => l[m.key] || 0), target: DAILY_TARGETS[m.key] }],
      'g'
    );
  });

  // Show chart sections only when there is at least one entry.
  const hasSeries = timestamps.length >= 1;
  document.querySelectorAll('.chart-section').forEach(el => {
    el.style.display = hasSeries ? '' : 'none';
  });
}

// ── TRENDS PANEL ─────────────────────────────────────────────────────────────

let _trendsPeriod = 7;
let _trendsMetric = 'calories';

function openTrends() {
  document.getElementById('trends-overlay').classList.add('open');
  document.getElementById('trends-panel').classList.add('open');
  renderTrends(_trendsPeriod);
}

function closeTrends() {
  document.getElementById('trends-overlay').classList.remove('open');
  document.getElementById('trends-panel').classList.remove('open');
}

function selectTrendsPeriod(nDays, btn) {
  _trendsPeriod = nDays;
  document.querySelectorAll('.trends-period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTrends(nDays);
}

function selectTrendsMetric(key, btn) {
  _trendsMetric = key;
  document.querySelectorAll('.trends-metric-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTrends(_trendsPeriod);
}

function toggleTrendsHint(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = !el.hidden;
}

function renderTrends(nDays) {
  const key    = _trendsMetric;
  const target = DAILY_TARGETS[key];
  const unit   = key === 'calories' ? ' kcal' : 'g';
  const totals = getDailyTotals(nDays);

  // Stats computation.
  const loggedDays = totals.filter(d => d.logged);
  const avgVal = loggedDays.length
    ? Math.round(loggedDays.reduce((s, d) => s + d[key], 0) / loggedDays.length)
    : 0;

  // Cumulative bank: (value - target) for logged days, flat on unlogged.
  let bank = 0;
  for (const d of totals) {
    if (d.logged) bank += d[key] - target;
  }

  // Update chart section titles.
  const metricLabel = key === 'calories' ? 'Calories' : key.charAt(0).toUpperCase() + key.slice(1);
  const barTitleEl     = document.getElementById('trends-bar-title');
  const deficitTitleEl = document.getElementById('trends-deficit-title');
  if (barTitleEl)     barTitleEl.textContent     = `Daily ${metricLabel}`;
  if (deficitTitleEl) deficitTitleEl.textContent = `${metricLabel} Bank`;

  // Render stats cards (no streak — already visible in the header).
  const statsEl  = document.getElementById('trends-stats');
  const bankClass = bank <= 0 ? 'positive' : 'negative';
  const bankAbs   = Math.abs(Math.round(bank));
  const bankShort = bankAbs > 9999 ? (bankAbs / 1000).toFixed(1) + 'k' : bankAbs.toLocaleString();
  const bankStr   = loggedDays.length ? `${bank <= 0 ? '−' : '+'}${bankShort}${unit}` : '—';
  const avgStr    = avgVal > 0 ? `${avgVal.toLocaleString()}<span class="trends-stat-unit">${unit}</span>` : '—';

  statsEl.innerHTML = `
    <div class="trends-stat-card">
      <div class="trends-stat-label">Avg / day</div>
      <div class="trends-stat-value">${avgStr}</div>
    </div>
    <div class="trends-stat-card">
      <div class="trends-stat-label">Days logged</div>
      <div class="trends-stat-value">${loggedDays.length}<span class="trends-stat-unit"> / ${nDays}</span></div>
    </div>
    <div class="trends-stat-card">
      <div class="trends-stat-label">${bank <= 0 ? 'Deficit' : 'Surplus'}</div>
      <div class="trends-stat-value ${bankClass}">${bankStr}</div>
    </div>
  `;

  drawDailyBarChart(document.getElementById('trends-bar-chart'), totals, key, unit.trim());
  drawCumulativeDeficit(document.getElementById('trends-deficit-chart'), totals, key, unit.trim());
  drawConsistencyHeatmap(document.getElementById('trends-heatmap'), totals, key);
  drawDailyRhythmChart(document.getElementById('trends-rhythm-chart'), nDays);
}

/**
 * Draws a bar-per-day chart coloured by vs-target distance, with a dashed
 * target line and a rolling 7-day average line overlay.
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{date:Date,calories:number,logged:boolean}>} totals - oldest first
 * @param {string} key  - nutrient field name ('calories'|'protein'|'carbs'|'fat'|'fibre')
 * @param {string} unit - display unit suffix ('kcal'|'g')
 */
function drawDailyBarChart(canvas, totals, key, unit) {
  if (!canvas) return;
  const target = DAILY_TARGETS[key];
  const nDays = totals.length;
  const dpr   = window.devicePixelRatio || 1;
  const W     = canvas.offsetWidth || canvas.parentElement?.clientWidth || 300;
  const H     = nDays <= 7 ? 160 : 200;
  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const MUTED  = '#94a3b8';
  const BORDER = '#334155';
  const PAD    = { top: 14, right: 12, bottom: 30, left: 48 };
  const cW     = W - PAD.left - PAD.right;
  const cH     = H - PAD.top  - PAD.bottom;

  const maxCal    = Math.max(target * 1.1, ...totals.map(d => d[key]));
  const yScale    = cH / (maxCal * 1.1 || 1);
  const yOf       = v => PAD.top + cH - v * yScale;
  const barW      = Math.max(2, (cW / nDays) * 0.7);
  const slotW     = cW / nDays;

  // Grid lines + y-axis labels.
  ctx.strokeStyle = BORDER;
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 3; i++) {
    const v = Math.round((maxCal * 1.1 / 3) * i);
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.font      = '10px system-ui,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(v > 999 ? (v / 1000).toFixed(1) + 'k' : v, PAD.left - 5, y + 3);
  }

  // Bars.
  totals.forEach((d, i) => {
    const x = PAD.left + i * slotW + (slotW - barW) / 2;
    if (!d.logged) {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(x, PAD.top, barW, cH);
      return;
    }
    const ratio = d[key] / target;
    const barH  = Math.max(2, d[key] * yScale);
    const barY  = PAD.top + cH - barH;
    ctx.fillStyle = ratio <= 1 ? '#22c55e' : ratio <= 1.2 ? '#f59e0b' : '#ef4444';
    ctx.fillRect(x, barY, barW, barH);

    // Value labels only for 7-day view.
    if (nDays <= 7) {
      ctx.fillStyle = MUTED;
      ctx.font      = 'bold 9px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(d[key].toLocaleString(), x + barW / 2, barY - 3);
    }
  });

  // Dashed target line.
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = MACRO_COLOURS[key] ? MACRO_COLOURS[key].line : MACRO_COLOURS.calories.line;
  ctx.lineWidth   = 1.5;
  ctx.globalAlpha = 0.7;
  const ty = yOf(target);
  ctx.beginPath(); ctx.moveTo(PAD.left, ty); ctx.lineTo(PAD.left + cW, ty); ctx.stroke();
  ctx.restore();

  // Rolling 7-day average line.
  const avgPoints = [];
  for (let i = 0; i < nDays; i++) {
    const window = totals.slice(Math.max(0, i - 6), i + 1).filter(d => d.logged);
    if (window.length >= 2) {
      const avg = window.reduce((s, d) => s + d[key], 0) / window.length;
      avgPoints.push({ x: PAD.left + i * slotW + slotW / 2, y: yOf(avg) });
    } else {
      avgPoints.push(null);
    }
  }
  ctx.save();
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.setLineDash([]);
  let inPath = false;
  for (const pt of avgPoints) {
    if (!pt) { inPath = false; continue; }
    if (!inPath) { ctx.beginPath(); ctx.moveTo(pt.x, pt.y); inPath = true; }
    else ctx.lineTo(pt.x, pt.y);
  }
  if (inPath) ctx.stroke();
  ctx.restore();

  // X-axis labels.
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  ctx.font      = '9px system-ui,sans-serif';
  totals.forEach((d, i) => {
    if (nDays <= 7 || i % Math.ceil(nDays / 10) === 0 || i === nDays - 1) {
      const x   = PAD.left + i * slotW + slotW / 2;
      const lbl = nDays <= 7
        ? d.date.toLocaleDateString([], { weekday: 'short' })
        : d.date.toLocaleDateString([], { day: 'numeric', month: 'numeric' });
      ctx.fillText(lbl, x, H - PAD.bottom + 12);
    }
  });
}

/**
 * Draws a cumulative nutrient bank chart.
 * Running sum of (value - target) for logged days; unlogged days hold flat.
 * Below-zero fill = green (deficit), above-zero fill = red (surplus).
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{date:Date,calories:number,logged:boolean}>} totals - oldest first
 * @param {string} key  - nutrient field name
 * @param {string} unit - display unit suffix
 */
function drawCumulativeDeficit(canvas, totals, key, unit) {
  if (!canvas) return;
  const target = DAILY_TARGETS[key];
  const nDays = totals.length;
  const dpr   = window.devicePixelRatio || 1;
  const W     = canvas.offsetWidth || canvas.parentElement?.clientWidth || 300;
  const H     = 150;
  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const MUTED  = '#94a3b8';
  const BORDER = '#334155';
  const PAD    = { top: 14, right: 64, bottom: 28, left: 48 };
  const cW     = W - PAD.left - PAD.right;
  const cH     = H - PAD.top  - PAD.bottom;

  // Build cumulative array (unlogged = carry forward).
  const points = [];
  let acc = 0;
  for (const d of totals) {
    if (d.logged) acc += d[key] - target;
    points.push(acc);
  }

  if (points.every(p => p === 0)) {
    ctx.fillStyle = MUTED;
    ctx.font      = '11px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Log some days to see your ${key} bank`, W / 2, H / 2);
    return;
  }

  const maxAbs = Math.max(Math.abs(Math.min(...points)), Math.abs(Math.max(...points)), 1);
  const yZero  = PAD.top + cH / 2;
  const yScale = (cH / 2) / (maxAbs * 1.15);
  const yOf    = v => yZero - v * yScale;
  const xOf    = i => PAD.left + (i / (nDays - 1 || 1)) * cW;

  // Grid.
  ctx.strokeStyle = BORDER;
  ctx.lineWidth   = 1;
  [-1, 0, 1].forEach(frac => {
    const v = maxAbs * 1.15 * frac;
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    if (frac !== 0) {
      ctx.fillStyle = MUTED;
      ctx.font      = '9px system-ui,sans-serif';
      ctx.textAlign = 'right';
      const label = Math.round(Math.abs(v));
      ctx.fillText((frac < 0 ? '+' : '-') + (label > 999 ? (label/1000).toFixed(1)+'k' : label), PAD.left - 5, y + 3);
    }
  });

  // Zero line.
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = MUTED;
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(PAD.left, yZero); ctx.lineTo(PAD.left + cW, yZero); ctx.stroke();
  ctx.restore();

  // Build path.
  const buildPath = () => {
    ctx.moveTo(xOf(0), yOf(points[0]));
    for (let i = 1; i < points.length; i++) ctx.lineTo(xOf(i), yOf(points[i]));
  };

  // Deficit fill (below zero = negative value = good).
  ctx.save();
  ctx.beginPath();
  buildPath();
  ctx.lineTo(xOf(points.length - 1), yZero);
  ctx.lineTo(xOf(0), yZero);
  ctx.closePath();
  ctx.fillStyle = 'rgba(34,197,94,0.18)';
  ctx.fill();
  ctx.restore();

  // Surplus fill (above zero = positive value = bad).
  ctx.save();
  ctx.beginPath();
  buildPath();
  ctx.lineTo(xOf(points.length - 1), yZero);
  ctx.lineTo(xOf(0), yZero);
  ctx.closePath();
  ctx.fillStyle = 'rgba(239,68,68,0.15)';
  // Clip to above zero.
  ctx.rect(PAD.left, PAD.top, cW, yZero - PAD.top);
  ctx.fill();
  ctx.restore();

  // Line.
  ctx.beginPath();
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  buildPath();
  ctx.stroke();

  // Final value annotation.
  const finalVal = points[points.length - 1];
  const annotX   = xOf(points.length - 1) + 6;
  const annotY   = yOf(finalVal);
  const isDeficit = finalVal <= 0;
  ctx.fillStyle   = isDeficit ? '#22c55e' : '#ef4444';
  ctx.font        = 'bold 9px system-ui,sans-serif';
  ctx.textAlign   = 'left';
  const abs   = Math.abs(Math.round(finalVal));
  const short = abs > 999 ? (abs / 1000).toFixed(1) + 'k' : abs;
  ctx.fillText(
    (isDeficit ? '\u2212' : '+') + short + (unit || 'kcal'),
    annotX, Math.max(PAD.top + 8, Math.min(H - PAD.bottom - 4, annotY))
  );

  // X-axis labels.
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  ctx.font      = '9px system-ui,sans-serif';
  [0, Math.floor(nDays / 2), nDays - 1].forEach(i => {
    const d   = totals[i];
    if (!d) return;
    const lbl = d.date.toLocaleDateString([], { day: 'numeric', month: 'numeric' });
    ctx.fillText(lbl, xOf(i), H - PAD.bottom + 12);
  });
}

/**
 * Draws a GitHub-style consistency heatmap (7-column weekly grid).
 * Colour per cell: not logged = dark grey, on/under target = green,
 * slightly over = amber, well over = red.
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{date:Date,calories:number,logged:boolean}>} totals - oldest first
 * @param {string} key - nutrient field name
 */
function drawConsistencyHeatmap(canvas, totals, key) {
  if (!canvas) return;
  const target = DAILY_TARGETS[key];
  const nDays = totals.length;
  const dpr   = window.devicePixelRatio || 1;
  const W     = canvas.offsetWidth || canvas.parentElement?.clientWidth || 300;

  // Align start to Monday (pad the beginning of the first week).
  const firstDay    = totals[0].date.getDay(); // 0=Sun...6=Sat
  const leadingPad  = (firstDay === 0 ? 6 : firstDay - 1); // days before first Monday
  const totalCells  = leadingPad + nDays;
  const nWeeks      = Math.ceil(totalCells / 7);
  const CELL        = Math.min(22, Math.floor((W - 40) / nWeeks));
  const H           = CELL * 7 + 40;

  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD    = { top: 20, left: 24, right: 8, bottom: 20 };
  const MUTED  = '#94a3b8';

  // Day-of-week labels.
  ctx.fillStyle = MUTED;
  ctx.font      = '9px system-ui,sans-serif';
  ctx.textAlign = 'right';
  ['M','T','W','T','F','S','S'].forEach((lbl, row) => {
    ctx.fillText(lbl, PAD.left - 4, PAD.top + row * CELL + CELL * 0.75);
  });

  // Draw cells.
  for (let ci = 0; ci < totalCells; ci++) {
    const col  = Math.floor(ci / 7);
    const row  = ci % 7;
    const x    = PAD.left + col * CELL + 1;
    const y    = PAD.top  + row * CELL + 1;
    const size = CELL - 3;

    const dataIdx = ci - leadingPad;
    if (dataIdx < 0 || dataIdx >= nDays) {
      // Padding cell.
      ctx.fillStyle = '#1a2332';
      ctx.beginPath();
      ctx.roundRect(x, y, size, size, 3);
      ctx.fill();
      continue;
    }

    const d = totals[dataIdx];
    let colour;
    if (!d.logged) {
      colour = '#1e293b';
    } else {
      const ratio = d[key] / target;
      if (ratio <= 1)        colour = '#16a34a';
      else if (ratio <= 1.2) colour = '#d97706';
      else                   colour = '#b91c1c';
    }

    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 3);
    ctx.fill();
  }

  // Legend.
  const legendItems = [
    { colour: '#1e293b', label: 'Not logged' },
    { colour: '#16a34a', label: '≤ target' },
    { colour: '#d97706', label: '≤ 120%' },
    { colour: '#b91c1c', label: '> 120%' },
  ];
  const legendY = PAD.top + 7 * CELL + 8;
  let legendX   = PAD.left;
  ctx.font      = '9px system-ui,sans-serif';
  ctx.textAlign = 'left';
  legendItems.forEach(item => {
    ctx.fillStyle = item.colour;
    ctx.beginPath();
    ctx.roundRect(legendX, legendY, 9, 9, 2);
    ctx.fill();
    ctx.fillStyle = MUTED;
    ctx.fillText(item.label, legendX + 12, legendY + 8);
    legendX += ctx.measureText(item.label).width + 22;
  });
}

/**
 * Draws a "daily rhythm" chart: each logged day overlaid as a cumulative
 * calorie step-curve through the hours of the day. A bold average line is
 * drawn on top, making it easy to spot patterns like lunch spikes or
 * late-night eating.
 *
 * Always uses calories (the most meaningful metric for time-of-day patterns).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} nDays - How many past days to include (matches trends period).
 */
function drawDailyRhythmChart(canvas, nDays) {
  if (!canvas) return;

  const MUTED  = '#94a3b8';
  const BORDER = '#334155';

  const logs   = getLogs();
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (nDays - 1));

  // Group entries by calendar day as {minuteOfDay, calories}.
  const byDay = {};
  for (const l of logs) {
    const d = new Date(l.timestamp);
    if (d < cutoff) continue;
    const key = d.toDateString();
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push({ minuteOfDay: d.getHours() * 60 + d.getMinutes(), calories: l.calories || 0 });
  }
  const dayEntries = Object.values(byDay);
  dayEntries.forEach(d => d.sort((a, b) => a.minuteOfDay - b.minuteOfDay));

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || canvas.parentElement?.clientWidth || 300;
  const H   = 180;
  canvas.width        = W * dpr;
  canvas.height       = H * dpr;
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  if (dayEntries.length === 0) {
    ctx.fillStyle = MUTED;
    ctx.font      = '11px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Log a few days to see your eating pattern', W / 2, H / 2);
    return;
  }

  const PAD = { top: 12, right: 12, bottom: 28, left: 48 };
  const cW  = W - PAD.left - PAD.right;
  const cH  = H - PAD.top  - PAD.bottom;

  // X axis: 06:00–24:00, extended left only if an entry falls before 06:00.
  const allMinutes = dayEntries.flatMap(d => d.map(e => e.minuteOfDay));
  const minMinute  = Math.min(360, ...allMinutes); // 06:00 default
  const maxMinute  = 1440;                         // 24:00
  const tRange     = maxMinute - minMinute;
  const xOf        = m => PAD.left + ((m - minMinute) / tRange) * cW;

  // Y axis: scale to highest day total or target.
  const dayTotals = dayEntries.map(d => d.reduce((s, e) => s + e.calories, 0));
  const maxY      = Math.max(DAILY_TARGETS.calories * 1.1, ...dayTotals);
  const yOf       = v => PAD.top + cH - (v / (maxY * 1.15 || 1)) * cH;

  // Grid lines + y labels.
  ctx.strokeStyle = BORDER;
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 3; i++) {
    const v = Math.round((maxY * 1.15 / 3) * i);
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.font      = '10px system-ui,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(v > 999 ? (v / 1000).toFixed(1) + 'k' : v, PAD.left - 6, y + 3);
  }

  // X-axis hour labels.
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  ctx.font      = '10px system-ui,sans-serif';
  [6, 9, 12, 15, 18, 21, 24].forEach(h => {
    const m = h * 60;
    if (m < minMinute) return;
    const x   = xOf(m);
    const lbl = h === 24 ? '00:00' : `${String(h).padStart(2, '0')}:00`;
    ctx.fillText(lbl, x, H - PAD.bottom + 14);
  });

  // Dashed calorie target line.
  const ty = yOf(DAILY_TARGETS.calories);
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = MACRO_COLOURS.calories.line;
  ctx.lineWidth   = 1.5;
  ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.moveTo(PAD.left, ty); ctx.lineTo(PAD.left + cW, ty); ctx.stroke();
  ctx.restore();

  // Draw each individual day as a faint step line.
  const n     = dayEntries.length;
  const alpha = n <= 3 ? 0.4 : Math.max(0.08, 0.4 - (n - 3) * 0.025);
  dayEntries.forEach(entries => {
    ctx.save();
    ctx.strokeStyle  = MACRO_COLOURS.calories.line;
    ctx.lineWidth    = 1.5;
    ctx.globalAlpha  = alpha;
    ctx.lineJoin     = 'round';
    ctx.beginPath();
    ctx.moveTo(PAD.left, yOf(0));
    let cum = 0;
    for (const e of entries) {
      const x = Math.max(PAD.left, Math.min(PAD.left + cW, xOf(e.minuteOfDay)));
      ctx.lineTo(x, yOf(cum));   // hold flat until this moment
      cum += e.calories;
      ctx.lineTo(x, yOf(cum));   // step up
    }
    ctx.lineTo(PAD.left + cW, yOf(cum)); // flat tail
    ctx.stroke();
    ctx.restore();
  });

  // Compute average cumulative at every 30-minute mark and draw as bold line.
  const avgPoints = [];
  for (let m = minMinute; m <= maxMinute; m += 30) {
    const cumPerDay = dayEntries.map(entries =>
      entries.filter(e => e.minuteOfDay <= m).reduce((s, e) => s + e.calories, 0)
    );
    avgPoints.push({ m, avg: cumPerDay.reduce((s, v) => s + v, 0) / cumPerDay.length });
  }

  // Fill under average.
  ctx.save();
  ctx.beginPath();
  avgPoints.forEach(({ m, avg }, i) => {
    i === 0 ? ctx.moveTo(xOf(m), yOf(avg)) : ctx.lineTo(xOf(m), yOf(avg));
  });
  ctx.lineTo(xOf(avgPoints[avgPoints.length - 1].m), yOf(0));
  ctx.lineTo(xOf(avgPoints[0].m), yOf(0));
  ctx.closePath();
  ctx.fillStyle = MACRO_COLOURS.calories.fill;
  ctx.fill();
  ctx.restore();

  // Average line.
  ctx.save();
  ctx.strokeStyle = MACRO_COLOURS.calories.line;
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.beginPath();
  avgPoints.forEach(({ m, avg }, i) => {
    i === 0 ? ctx.moveTo(xOf(m), yOf(avg)) : ctx.lineTo(xOf(m), yOf(avg));
  });
  ctx.stroke();
  ctx.restore();

  // Legend (top-left of chart area).
  ctx.save();
  ctx.font      = '9px system-ui,sans-serif';
  ctx.textAlign = 'left';
  const lx = PAD.left + 4;
  const ly = PAD.top + 7;

  ctx.globalAlpha  = 0.45;
  ctx.strokeStyle  = MACRO_COLOURS.calories.line;
  ctx.lineWidth    = 1.5;
  ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 16, ly); ctx.stroke();
  ctx.globalAlpha  = 1;
  ctx.fillStyle    = MUTED;
  ctx.fillText(`each day (${n})`, lx + 20, ly + 3);

  ctx.strokeStyle  = MACRO_COLOURS.calories.line;
  ctx.lineWidth    = 2.5;
  ctx.beginPath(); ctx.moveTo(lx + 100, ly); ctx.lineTo(lx + 116, ly); ctx.stroke();
  ctx.fillStyle    = MUTED;
  ctx.fillText('average', lx + 120, ly + 3);
  ctx.restore();
}
