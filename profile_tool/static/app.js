const form = document.getElementById("profile-form");
const chooseFolder = document.getElementById("choose-folder");
const outputFolder = document.getElementById("output-folder");
const statusBox = document.getElementById("status");
const generateButton = document.getElementById("generate");
const resultPanel = document.getElementById("result-panel");
const outputPath = document.getElementById("output-path");
const copyPath = document.getElementById("copy-path");
const summaryBody = document.getElementById("summary-body");
const metricRows = document.getElementById("metric-rows");
const metricYears = document.getElementById("metric-years");
const metricPeriods = document.getElementById("metric-periods");
const metricOutput = document.getElementById("metric-output");
const chartShell = document.getElementById("chart-shell");
const chartCanvas = document.getElementById("profile-chart");
const chartTooltip = document.getElementById("chart-tooltip");
const legendRow = document.getElementById("legend-row");
const resetChart = document.getElementById("reset-chart");
const expandChart = document.getElementById("expand-chart");

const SERIES_COLORS = [
  "#1f75ff",
  "#14a38b",
  "#f97316",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#84cc16",
  "#c026d3",
  "#ca8a04",
  "#2563eb",
  "#059669",
  "#e11d48",
];

let lastOutputPath = "";
let chartState = {
  years: [],
  selectedYearIndex: 0,
  series: [],
  viewMin: 0,
  viewMax: 1,
  hover: null,
  dragging: false,
  dragStartX: 0,
  dragStartMin: 0,
  dragStartMax: 1,
  plot: null,
};

function setStatus(message, kind = "") {
  statusBox.textContent = message;
  statusBox.className = `status ${kind}`.trim();
}

function numberFormat(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatPercent(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return `${numberFormat(numeric, digits)}%`;
}

function shortPath(path) {
  if (!path) return "Waiting";
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function setRunning(isRunning) {
  generateButton.disabled = isRunning;
  generateButton.classList.toggle("is-running", isRunning);
}

document.querySelectorAll("[data-file-tile]").forEach((tile) => {
  const input = tile.querySelector("input[type='file']");
  const name = tile.querySelector("[data-file-name]");
  input.addEventListener("change", () => {
    const fileName = input.files && input.files[0] ? input.files[0].name : "Choose CSV";
    name.textContent = fileName;
    tile.classList.toggle("has-file", Boolean(input.files && input.files[0]));
  });
});

chooseFolder.addEventListener("click", async () => {
  setStatus("Opening folder picker...");
  chooseFolder.disabled = true;
  try {
    const response = await fetch("/choose-output-folder");
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || "Folder picker failed.");
    if (payload.path) {
      outputFolder.value = payload.path;
      setStatus("Output folder selected.", "ok");
    } else {
      setStatus("Folder selection cancelled.");
    }
  } catch (error) {
    setStatus(error.message, "bad");
  } finally {
    chooseFolder.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resultPanel.hidden = true;
  chartShell.hidden = true;
  summaryBody.innerHTML = "";
  metricRows.textContent = "-";
  metricYears.textContent = "-";
  metricPeriods.textContent = "-";
  metricOutput.textContent = "Running";
  setStatus("Generating projected profile...");
  setRunning(true);

  try {
    const data = new FormData(form);
    const response = await fetch("/generate", {
      method: "POST",
      body: data,
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || "Generation failed.");

    lastOutputPath = payload.output_path;
    outputPath.textContent = payload.output_path;
    renderSummary(payload.summaries);
    renderMetrics(payload);
    setupChart(payload.graph);
    resultPanel.hidden = false;
    chartShell.hidden = false;
    requestAnimationFrame(resizeAndDrawChart);
    setStatus(`Done. Wrote ${numberFormat(payload.rows_written)} rows.`, "ok");
  } catch (error) {
    setStatus(error.message, "bad");
    metricOutput.textContent = "Error";
  } finally {
    setRunning(false);
  }
});

function renderSummary(summaries) {
  for (const item of summaries) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.financial_year || item.projection_year}</td>
      <td>${numberFormat(item.row_count)}</td>
      <td>${numberFormat(item.achieved_peak_mw)}</td>
      <td>${numberFormat(item.achieved_energy_gwh, 3)}</td>
      <td>${formatPercent(item.peak_growth_percent, 2)}</td>
      <td>${formatPercent(item.energy_growth_percent, 2)}</td>
    `;
    summaryBody.appendChild(tr);
  }
}

function renderMetrics(payload) {
  const summaries = payload.summaries || [];
  const periods = summaries[0] ? summaries[0].periods_per_day : "-";
  metricRows.textContent = numberFormat(payload.rows_written);
  metricYears.textContent = summaries.length ? `${summaries[0].financial_year || summaries[0].projection_year} to ${summaries[summaries.length - 1].financial_year || summaries[summaries.length - 1].projection_year}` : "-";
  metricPeriods.textContent = periods;
  metricOutput.textContent = shortPath(payload.output_path);
}

copyPath.addEventListener("click", async () => {
  if (!lastOutputPath) return;
  try {
    await navigator.clipboard.writeText(lastOutputPath);
    setStatus("Output path copied.", "ok");
  } catch {
    setStatus("Could not copy path.");
  }
});

function setupChart(graph) {
  chartState.years = graph.years || [];
  chartState.selectedYearIndex = 0;
  chartState.viewMin = 0;
  chartState.viewMax = 1;
  chartState.hover = null;
  selectChartYear(0, true);
}

function selectChartYear(index, resetView = false) {
  if (!chartState.years.length) {
    chartState.series = [];
    renderLegend();
    drawChart();
    return;
  }
  chartState.selectedYearIndex = Math.max(0, Math.min(chartState.years.length - 1, index));
  const year = chartState.years[chartState.selectedYearIndex];
  chartState.series = [
    {
      id: `mapped-base-${year.year}`,
      label: "Mapped base",
      color: "#101828",
      points: year.mapped_base.points,
      visible: true,
      width: 2.0,
      dash: [7, 5],
    },
    {
      id: `projected-${year.year}`,
      label: "Projected",
      color: SERIES_COLORS[0],
      points: year.projected.points,
      visible: true,
      width: 2.0,
      dash: [],
    },
  ];
  if (resetView) {
    chartState.viewMin = 0;
    chartState.viewMax = 1;
  }
  chartState.hover = null;
  chartTooltip.hidden = true;
  renderLegend();
  drawChart();
}

function renderLegend() {
  legendRow.innerHTML = "";
  for (const [index, year] of chartState.years.entries()) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `legend-chip ${index === chartState.selectedYearIndex ? "active" : ""}`.trim();
    chip.innerHTML = `
      <span class="legend-dot" style="background:${SERIES_COLORS[index % SERIES_COLORS.length]}"></span>
      <span>${year.label}</span>
    `;
    chip.addEventListener("click", () => {
      selectChartYear(index, true);
    });
    legendRow.appendChild(chip);
  }

  if (chartState.years.length) {
    const lineLegend = document.createElement("div");
    lineLegend.className = "line-legend";
    lineLegend.innerHTML = `
      <span><i class="line-sample dashed"></i>Mapped base</span>
      <span><i class="line-sample solid"></i>Projected</span>
    `;
    legendRow.appendChild(lineLegend);
  }
}

function resizeAndDrawChart() {
  const rect = chartCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (chartCanvas.width !== width || chartCanvas.height !== height) {
    chartCanvas.width = width;
    chartCanvas.height = height;
  }
  drawChart();
}

function drawChart() {
  const ctx = chartCanvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = chartCanvas.width / dpr;
  const height = chartCanvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const plot = {
    left: 48,
    right: width - 18,
    top: 18,
    bottom: height - 34,
  };
  plot.width = Math.max(20, plot.right - plot.left);
  plot.height = Math.max(20, plot.bottom - plot.top);
  chartState.plot = plot;

  drawGrid(ctx, plot);
  for (const series of chartState.series) {
    if (series.visible) drawSeries(ctx, plot, series);
  }
  drawAxes(ctx, plot);
  if (chartState.hover) drawHover(ctx, plot);
}

function drawGrid(ctx, plot) {
  ctx.save();
  ctx.strokeStyle = "rgba(102, 112, 133, 0.16)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "rgba(255, 255, 255, 0.26)";
  ctx.fillRect(plot.left, plot.top, plot.width, plot.height);

  for (let i = 0; i <= 4; i += 1) {
    const y = plot.top + (plot.height * i) / 4;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 5; i += 1) {
    const x = plot.left + (plot.width * i) / 5;
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.bottom);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAxes(ctx, plot) {
  ctx.save();
  ctx.fillStyle = "#667085";
  ctx.font = "12px Segoe UI, Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i += 1) {
    const value = 1 - i / 4;
    const y = plot.top + (plot.height * i) / 4;
    ctx.fillText(value.toFixed(2), plot.left - 8, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i <= 5; i += 1) {
    const position = chartState.viewMin + ((chartState.viewMax - chartState.viewMin) * i) / 5;
    const x = plot.left + (plot.width * i) / 5;
    ctx.fillText(formatDateAtPosition(position), x, plot.bottom + 10);
  }
  ctx.restore();
}

function selectedChartYear() {
  return chartState.years[chartState.selectedYearIndex] || null;
}

function formatDateAtPosition(position) {
  const year = selectedChartYear();
  if (!year || !chartState.series.length) return `${Math.round(position * 100)}%`;
  const pointCount = chartState.series[0].points.length;
  const index = Math.max(0, Math.min(pointCount - 1, Math.round(position * (pointCount - 1))));
  return formatDateForIndex(year, index);
}

function dateAndPeriodForPosition(position) {
  const year = selectedChartYear();
  if (!year || !chartState.series.length) {
    return { dateLabel: `${Math.round(position * 1000) / 10}%`, period: "-" };
  }
  const pointCount = chartState.series[0].points.length;
  const index = Math.max(0, Math.min(pointCount - 1, Math.round(position * (pointCount - 1))));
  const periods = Number(year.periods_per_day) || 24;
  return {
    dateLabel: formatDateForIndex(year, index),
    period: (index % periods) + 1,
  };
}

function formatDateForIndex(year, index) {
  const periods = Number(year.periods_per_day) || 24;
  const dayOffset = Math.floor(index / periods);
  const date = new Date(`${year.start_date}T00:00:00`);
  date.setDate(date.getDate() + dayOffset);
  const day = String(date.getDate()).padStart(2, "0");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day}-${months[date.getMonth()]}-${date.getFullYear()}`;
}

function drawSeries(ctx, plot, series) {
  const points = series.points || [];
  if (points.length < 2) return;
  const start = Math.max(0, Math.floor(chartState.viewMin * (points.length - 1)));
  const end = Math.min(points.length - 1, Math.ceil(chartState.viewMax * (points.length - 1)));
  if (end <= start) return;
  const visible = end - start + 1;

  ctx.save();
  ctx.strokeStyle = series.color;
  ctx.lineWidth = series.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(series.dash || []);
  ctx.globalAlpha = series.dash && series.dash.length ? 0.78 : 0.92;

  if (visible <= plot.width * 1.8) {
    ctx.beginPath();
    for (let i = start; i <= end; i += 1) {
      const x = xForIndex(i, points.length, plot);
      const y = yForValue(points[i], plot);
      if (i === start) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else {
    ctx.beginPath();
    const pixelCount = Math.max(1, Math.floor(plot.width));
    for (let px = 0; px <= pixelCount; px += 1) {
      const x = plot.left + px;
      const p0 = chartState.viewMin + ((chartState.viewMax - chartState.viewMin) * px) / pixelCount;
      const p1 = chartState.viewMin + ((chartState.viewMax - chartState.viewMin) * (px + 1)) / pixelCount;
      const i0 = Math.max(0, Math.floor(p0 * (points.length - 1)));
      const i1 = Math.min(points.length - 1, Math.max(i0, Math.ceil(p1 * (points.length - 1))));
      let min = points[i0];
      let max = points[i0];
      for (let i = i0 + 1; i <= i1; i += 1) {
        if (points[i] < min) min = points[i];
        if (points[i] > max) max = points[i];
      }
      ctx.moveTo(x, yForValue(min, plot));
      ctx.lineTo(x, yForValue(max, plot));
    }
    ctx.stroke();
  }
  ctx.restore();
}

function xForIndex(index, length, plot) {
  const position = length <= 1 ? 0 : index / (length - 1);
  const visiblePosition = (position - chartState.viewMin) / (chartState.viewMax - chartState.viewMin);
  return plot.left + visiblePosition * plot.width;
}

function yForValue(value, plot) {
  const clamped = Math.max(0, Math.min(1, Number(value)));
  return plot.bottom - clamped * plot.height;
}

function drawHover(ctx, plot) {
  const hover = chartState.hover;
  if (!hover) return;
  const x = plot.left + ((hover.position - chartState.viewMin) / (chartState.viewMax - chartState.viewMin)) * plot.width;
  if (x < plot.left || x > plot.right) return;

  ctx.save();
  ctx.strokeStyle = "rgba(24, 34, 48, 0.34)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, plot.top);
  ctx.lineTo(x, plot.bottom);
  ctx.stroke();
  ctx.restore();

  updateTooltip(x, hover);
}

function updateTooltip(x, hover) {
  const positionDetail = dateAndPeriodForPosition(hover.position);
  const rows = chartState.series
    .filter((series) => series.visible)
    .map((series) => {
      const index = Math.max(0, Math.min(series.points.length - 1, Math.round(hover.position * (series.points.length - 1))));
      const value = series.points[index];
      return `
        <div class="tooltip-row">
          <span style="display:flex;align-items:center;gap:7px;">
            <span class="tooltip-swatch" style="background:${series.color}"></span>
            ${series.label}
          </span>
          <b>${Number(value).toFixed(3)}</b>
        </div>
      `;
    })
    .join("");
  chartTooltip.innerHTML = `<strong>${positionDetail.dateLabel}, Period ${positionDetail.period}</strong>${rows}`;
  chartTooltip.hidden = false;
  const frame = chartCanvas.getBoundingClientRect();
  const tooltipWidth = 300;
  const left = x > frame.width - tooltipWidth - 24 ? x - tooltipWidth - 12 : x + 12;
  chartTooltip.style.left = `${Math.max(12, left)}px`;
  chartTooltip.style.top = "18px";
}

function pointerPosition(event) {
  const rect = chartCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function positionFromX(x) {
  const plot = chartState.plot;
  if (!plot) return 0;
  const ratio = Math.max(0, Math.min(1, (x - plot.left) / plot.width));
  return chartState.viewMin + ratio * (chartState.viewMax - chartState.viewMin);
}

function clampView(min, max) {
  const span = max - min;
  if (span >= 1) return [0, 1];
  if (min < 0) return [0, span];
  if (max > 1) return [1 - span, 1];
  return [min, max];
}

chartCanvas.addEventListener("wheel", (event) => {
  if (!chartState.series.length) return;
  event.preventDefault();
  const pointer = pointerPosition(event);
  const anchor = positionFromX(pointer.x);
  const currentSpan = chartState.viewMax - chartState.viewMin;
  const zoom = event.deltaY < 0 ? 0.82 : 1.22;
  const nextSpan = Math.max(0.002, Math.min(1, currentSpan * zoom));
  const anchorRatio = (anchor - chartState.viewMin) / currentSpan;
  let nextMin = anchor - nextSpan * anchorRatio;
  let nextMax = nextMin + nextSpan;
  [nextMin, nextMax] = clampView(nextMin, nextMax);
  chartState.viewMin = nextMin;
  chartState.viewMax = nextMax;
  drawChart();
}, { passive: false });

chartCanvas.addEventListener("mousedown", (event) => {
  if (!chartState.series.length) return;
  chartState.dragging = true;
  chartState.dragStartX = pointerPosition(event).x;
  chartState.dragStartMin = chartState.viewMin;
  chartState.dragStartMax = chartState.viewMax;
  chartCanvas.style.cursor = "grabbing";
});

window.addEventListener("mousemove", (event) => {
  if (!chartState.series.length) return;
  const pointer = pointerPosition(event);
  const plot = chartState.plot;
  if (!plot) return;

  if (chartState.dragging) {
    const span = chartState.dragStartMax - chartState.dragStartMin;
    const dx = (pointer.x - chartState.dragStartX) / plot.width;
    let nextMin = chartState.dragStartMin - dx * span;
    let nextMax = chartState.dragStartMax - dx * span;
    [nextMin, nextMax] = clampView(nextMin, nextMax);
    chartState.viewMin = nextMin;
    chartState.viewMax = nextMax;
    drawChart();
    return;
  }

  if (pointer.x >= plot.left && pointer.x <= plot.right && pointer.y >= plot.top && pointer.y <= plot.bottom) {
    chartState.hover = { position: positionFromX(pointer.x) };
    drawChart();
  } else {
    chartState.hover = null;
    chartTooltip.hidden = true;
    drawChart();
  }
});

window.addEventListener("mouseup", () => {
  chartState.dragging = false;
  chartCanvas.style.cursor = "crosshair";
});

chartCanvas.addEventListener("mouseleave", () => {
  if (!chartState.dragging) {
    chartState.hover = null;
    chartTooltip.hidden = true;
    drawChart();
  }
});

chartCanvas.addEventListener("dblclick", () => {
  chartState.viewMin = 0;
  chartState.viewMax = 1;
  drawChart();
});

resetChart.addEventListener("click", () => {
  chartState.viewMin = 0;
  chartState.viewMax = 1;
  drawChart();
});

expandChart.addEventListener("click", () => {
  const expanded = chartShell.classList.toggle("expanded");
  document.body.classList.toggle("chart-expanded", expanded);
  expandChart.textContent = expanded ? "Close" : "Fullscreen";
  requestAnimationFrame(resizeAndDrawChart);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && chartShell.classList.contains("expanded")) {
    chartShell.classList.remove("expanded");
    document.body.classList.remove("chart-expanded");
    expandChart.textContent = "Fullscreen";
    requestAnimationFrame(resizeAndDrawChart);
  }
});

window.addEventListener("resize", resizeAndDrawChart);
