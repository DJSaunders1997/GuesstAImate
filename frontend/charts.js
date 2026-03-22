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
const TARGET_DEFAULTS = { calories: 2000, protein: 50, carbs: 260, fat: 70, fibre: 30 };

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
  const single = timestamps.length === 1;

  // X range: span the timestamps when multiple entries exist.
  const ms     = timestamps.map(t => t.getTime());
  const minT   = ms[0];
  const maxT   = ms[ms.length - 1];
  const tRange = maxT - minT || 1;
  const times  = ms;
  const xOf    = t => single ? PAD.left + cW / 2 : PAD.left + ((t - minT) / tRange) * cW;

  // Cumulative totals per series.
  const cumSeries = series.map(s => {
    let acc = 0;
    return s.values.map(v => { acc += v || 0; return acc; });
  });

  // Scale the y-axis to fit both data and target reference lines.
  const dataMax    = Math.max(...cumSeries.map(cum => cum[cum.length - 1]));
  const targetMax  = Math.max(0, ...series.map(s => s.target || 0));
  const overallMax = Math.max(dataMax, targetMax);
  const yOf        = v => PAD.top + cH - (v / (overallMax * 1.15 || 1)) * cH;

  // Grid lines and y-axis labels.
  ctx.strokeStyle = BORDER;
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 3; i++) {
    const v = Math.round((overallMax * 1.15 / 3) * i);
    const y = yOf(v);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.font      = '10px system-ui,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(v + (unit || ''), PAD.left - 6, y + 3);
  }

  // X-axis time labels.
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  timestamps.forEach((t, i) => {
    const lbl = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    ctx.fillText(lbl, xOf(times[i]), H - PAD.bottom + 14);
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
    };

    // Filled area under the step path.
    ctx.beginPath();
    buildStepPath();
    ctx.lineTo(xOf(times[times.length - 1]), yOf(0));
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
        ctx.fillStyle   = colour.line;
        ctx.font        = 'bold 10px system-ui,sans-serif';
        ctx.textAlign   = 'center';
        ctx.fillText(v.toLocaleString(), x, y - 8);
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
