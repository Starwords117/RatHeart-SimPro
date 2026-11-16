const $ = (selector) => document.querySelector(selector);
const canvas = $("#trace-canvas");
const context = canvas.getContext("2d");
let state = null;
let frames = [];
let events = [];
let dirty = true;
let lastRenderedEventCount = -1;
const CHANNEL_KEYS = ["abp", "lvp", "vbp", "hf", "hr"];
const CHANNEL_COLORS = { abp: "#b03a2e", lvp: "#245e9c", vbp: "#2e8b74", hf: "#b06f2e", hr: "#3a7d44" };
const CHANNEL_LABELS = { abp: "ABP", lvp: "LVP", vbp: "VBP", hf: "HF", hr: "HR" };
const CHANNEL_DEFAULT_MAX = { abp: 220, lvp: 220, vbp: 20, hf: 20, hr: 400 };
const EVENT_COLORS = { dose: "#78818a", stimulus: "#8b7552", death: "#b03a2e", import: "#9aa4ad" };
function time(value, decimals = false) {
  const minutes = Math.floor(value / 60), seconds = Math.max(0, value % 60);
  return `${String(minutes).padStart(2, "0")}:${decimals ? seconds.toFixed(1).padStart(4, "0") : String(Math.floor(seconds)).padStart(2, "0")}`;
}
function setStatus(text, live) {
  $("#follow-status").textContent = text;
  $("#follow-live").classList.toggle("running", live);
  $("#follow-live2").classList.toggle("running", live);
}
let replayIdx = 0;
let lastReplayAt = performance.now();
function tickReplay() {
  const now = performance.now();
  const rate = 160 * Math.max(0.05, state?.speed ?? 0.25);
  const elapsed = Math.min((now - lastReplayAt) / 1e3, 2);
  lastReplayAt = now;
  const water = frames.length;
  const advance = elapsed * rate;
  if (water - replayIdx > rate * 2) replayIdx = Math.max(0, water - Math.round(rate));
  replayIdx = Math.min(water, replayIdx + advance);
  if (replayIdx < water - rate * 2 - 1) lastReplayAt = now;
}
function replayEnd() {
  return Math.max(2, Math.min(Math.floor(replayIdx), frames.length));
}
function renderHeader() {
  if (!state) return;
  $("#chart-model").textContent = state.pithed ? "\u53BB\u8111\u5927\u9F20" : "\u6B63\u5E38\u5927\u9F20";
  $("#abp-value").innerHTML = `${state.art?.meanP > 0 ? state.art.meanP.toFixed(1) : "\u2013"}<small>mmHg</small>`;
  $("#hr-value").innerHTML = `${state.heart?.rate > 1 ? Math.round(state.heart.rate) : "\u2013"}<small>bpm</small>`;
  const idx = Math.max(0, Math.min(Math.floor(replayIdx), frames.length) - 1);
  $("#time-value").textContent = time(frames.length ? frames[idx].t : 0, true);
  $("#last-operation").textContent = events.at(-1)?.text ?? "\u2014";
}
function renderEvents() {
  if (events.length === lastRenderedEventCount) return;
  lastRenderedEventCount = events.length;
  $("#event-count").textContent = String(events.length);
  $("#event-list").replaceChildren(...events.slice(-35).reverse().map((event) => {
    const row = document.createElement("div");
    row.className = "event-item";
    const at = document.createElement("span");
    at.className = "event-time";
    at.textContent = time(event.t);
    const dot = document.createElement("span");
    dot.className = "event-dot";
    dot.style.background = EVENT_COLORS[event.kind] ?? "#78818a";
    const text = document.createElement("span");
    text.className = "event-text";
    text.textContent = event.text;
    row.append(at, dot, text);
    return row;
  }));
}
function drawChart() {
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(box.width, 240), height = Math.max(box.height, 220);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = context;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  $("#plot-empty").classList.toggle("hidden", frames.length > 1);
  if (frames.length < 2) return;
  const windowSamples = Number($("#window-select").value);
  const end = Math.min(historyEnd ?? replayEnd(), frames.length);
  const start = windowSamples > 0 ? Math.max(0, end - windowSamples) : 0;
  if (end - start < 2) return;
  const left = width < 480 ? 42 : 46, right = 12, top = 8, bottom = 30;
  const pw = width - left - right, ph = height - top - bottom;
  const bandGap = 18;
  const bandH = (ph - bandGap * (CHANNEL_KEYS.length - 1)) / CHANNEL_KEYS.length;
  const stride = Math.max(1, Math.floor((end - start) / (pw * 2)));
  const t0 = frames[start].t, t1 = frames[end - 1].t;
  const CHART_KINDS = /* @__PURE__ */ new Set(["dose", "stimulus", "death", "import"]);
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, pw, ph);
  ctx.clip();
  let lastLabelX = -1e9, labelRow = 0;
  for (const event of events) {
    if (!CHART_KINDS.has(event.kind)) continue;
    if (event.t < t0 || event.t > t1) continue;
    const xx = left + (event.t - t0) / (t1 - t0) * pw;
    ctx.strokeStyle = "#c6cdd3";
    ctx.lineWidth = 0.8;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xx, top);
    ctx.lineTo(xx, top + ph);
    ctx.stroke();
    ctx.setLineDash([]);
    if (xx - lastLabelX > 72) {
      ctx.fillStyle = EVENT_COLORS[event.kind] ?? "#78818a";
      ctx.textAlign = "left";
      ctx.font = "10px Consolas, monospace";
      ctx.fillText(event.text, xx + 3, top + 10 + labelRow * 12);
      lastLabelX = xx;
      labelRow = 1 - labelRow;
    }
  }
  ctx.restore();
  CHANNEL_KEYS.forEach((key, ch) => {
    const bandTop = top + ch * (bandH + bandGap);
    let ymax = CHANNEL_DEFAULT_MAX[key];
    for (let i = start; i < end; i += stride) if (frames[i][key] > ymax) ymax = frames[i][key] * 1.15;
    if (key === "hr") ymax = Math.max(ymax, 400);
    const ymin = 0;
    const yOf = (v) => bandTop + bandH - (v - ymin) / (ymax - ymin) * bandH;
    ctx.font = "10px Consolas, monospace";
    ctx.textAlign = "right";
    for (let g = 0; g <= 4; g++) {
      const yy = bandTop + g / 4 * bandH;
      const isEdge = g === 0 || g === 4;
      ctx.strokeStyle = isEdge ? "#aab3bc" : "#e7eaee";
      ctx.lineWidth = isEdge ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(left, yy);
      ctx.lineTo(width - right, yy);
      ctx.stroke();
      ctx.lineWidth = 1;
      const value = ymax - g / 4 * (ymax - ymin);
      ctx.fillStyle = "#626d77";
      ctx.fillText(value.toFixed(value % 1 === 0 || Math.abs(value) >= 100 ? 0 : 1), left - 4, yy + 3);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = "#626d77";
    ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.fillText(`${CHANNEL_LABELS[key]}  ${key === "hr" ? "bpm" : key === "hf" ? "" : "mmHg"}`, left + 6, bandTop + 12);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, bandTop, pw, bandH);
    ctx.clip();
    ctx.strokeStyle = CHANNEL_COLORS[key];
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let pen = false;
    for (let i = start; i < end; i += stride) {
      const stop = Math.min(end, i + stride);
      let minI = i, maxI = i;
      for (let j = i; j < stop; j++) {
        if (frames[j][key] < frames[minI][key]) minI = j;
        if (frames[j][key] > frames[maxI][key]) maxI = j;
      }
      const first = Math.min(minI, maxI), second = Math.max(minI, maxI);
      for (const idx of stride > 1 ? [first, second] : [i]) {
        const xx = left + (idx - start) / (end - start - 1) * pw;
        if (!pen) {
          ctx.moveTo(xx, yOf(frames[idx][key]));
          pen = true;
        } else ctx.lineTo(xx, yOf(frames[idx][key]));
      }
    }
    ctx.stroke();
    ctx.restore();
  });
  ctx.fillStyle = "#626d77";
  ctx.font = "10px Consolas, monospace";
  ctx.textAlign = "center";
  const ticks = width < 450 ? 4 : 6;
  for (let g = 0; g <= ticks; g++) {
    const t = t0 + g / ticks * (t1 - t0);
    ctx.fillText(time(t), left + g / ticks * pw, height - bottom + 14);
  }
  $("#plot-empty").classList.toggle("hidden", frames.length > 1);
}
$("#window-select").addEventListener("change", () => {
  dirty = true;
});
new ResizeObserver(() => {
  dirty = true;
}).observe($("#plot-wrap"));
let historyEnd = null;
const slider = $("#history-position");
slider.addEventListener("input", () => {
  historyEnd = Number(slider.value);
  dirty = true;
});
$("#latest-button").addEventListener("click", () => {
  historyEnd = null;
  dirty = true;
});
function renderHistorySlider() {
  const wrap = $("#history-scroll");
  const windowSamples = Number($("#window-select").value);
  const show = frames.length > Math.max(windowSamples, 320);
  wrap.classList.toggle("hidden", !show);
  if (!show) {
    historyEnd = null;
    return;
  }
  if (document.activeElement !== slider) {
    slider.max = String(frames.length - 1);
    if (historyEnd === null) slider.value = slider.max;
  }
}
setInterval(() => {
  try {
    tickReplay();
    const stale = !!state && !!state.running && Date.now() - lastDataAt > 1e4;
    if (stale) setStatus("\u6559\u5E08\u7AEF\u8FDE\u63A5\u5DF2\u4E2D\u65AD\uFF0C\u7B49\u5F85\u6062\u590D\u2026", false);
    else if (state?.running) setStatus("\u5B9E\u65F6\u8DDF\u968F\u8001\u5E08\u7AEF", true);
    renderHistorySlider();
    renderHeader();
    renderEvents();
    drawChart();
  } catch (error) {
    window.__followError = String(error?.stack ?? error);
  }
}, 100);
function applyUpdate(reset, message) {
  state = message.state ?? state;
  if (reset) {
    frames = message.frames ?? [];
    events = message.events ?? [];
    lastRenderedEventCount = -1;
    replayIdx = frames.length;
    lastReplayAt = performance.now();
  } else {
    if (message.frames?.length) frames.push(...message.frames);
    if (message.events?.length) events.push(...message.events);
  }
  dirty = true;
}
const followRoom = new URLSearchParams(location.search).get("room") ?? "";
let seenSeq = -1, sentF = 0, sentE = 0, polling = false;
let pollTimer;
let pollIntervalMs = 1500;
let es = null;
let sseFailed = false;
let lastDataAt = Date.now();
let staleNotified = false;
function setPollInterval(ms) {
  if (pollIntervalMs === ms) return;
  pollIntervalMs = ms;
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, ms);
}
function sseHandle(m) {
  lastDataAt = Date.now();
  if (m.type === "off") {
    applyUpdate(true, { state: null, frames: [], events: [] });
    setStatus("\u8001\u5E08\u7AEF\u5C1A\u672A\u5F00\u59CB\u5E7F\u64AD\uFF0C\u7B49\u5F85\u4E2D\u2026", false);
    return;
  }
  applyUpdate(m.type === "full", m);
  setStatus("\u5B9E\u65F6\u8DDF\u968F\u8001\u5E08\u7AEF", true);
  staleNotified = false;
}
function connectSSE() {
  if (sseFailed || !followRoom || es) return;
  es = new EventSource(`/api/follow?room=${encodeURIComponent(followRoom)}`);
  es.addEventListener("backfill", (e) => sseHandle(JSON.parse(e.data)));
  es.addEventListener("chunk", (e) => sseHandle(JSON.parse(e.data)));
  es.onerror = () => {
    es?.close();
    es = null;
    sseFailed = true;
    setPollInterval(1e3);
    poll();
  };
}
async function poll() {
  if (polling) return;
  polling = true;
  const ctrl = new AbortController();
  const kill = setTimeout(() => ctrl.abort(), 3e3);
  try {
    const res = await fetch(`/api/poll?room=${encodeURIComponent(followRoom)}&f=${sentF}&e=${sentE}&seq=${seenSeq}`, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    seenSeq = data.seq;
    applyUpdate(!!data.reset || !data.state, data);
    sentF = data.totalAbs;
    sentE = data.totalE;
    lastDataAt = Date.now();
    if (data.state) {
      const stale = Date.now() - (data.updatedAt ?? 0) > 1e4;
      setStatus(stale ? "\u6559\u5E08\u7AEF\u8FDE\u63A5\u5DF2\u4E2D\u65AD\uFF0C\u7B49\u5F85\u6062\u590D\u2026" : "\u5B9E\u65F6\u8DDF\u968F\u8001\u5E08\u7AEF", !stale);
      setPollInterval(stale ? 1500 : 1e3);
    } else {
      setStatus("\u8001\u5E08\u7AEF\u5C1A\u672A\u5F00\u59CB\u5E7F\u64AD\uFF0C\u7B49\u5F85\u4E2D\u2026", false);
      setPollInterval(1500);
    }
  } catch {
    setStatus("\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u81EA\u52A8\u91CD\u8BD5\u4E2D\u2026", false);
    setPollInterval(200);
  } finally {
    clearTimeout(kill);
    polling = false;
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (es) {
      es.close();
      es = null;
    }
    setPollInterval(2e3);
  } else if (!sseFailed) {
    connectSSE();
    poll();
  } else {
    setPollInterval(1e3);
    poll();
  }
});
if (!followRoom) {
  setStatus("\u8BF7\u4F7F\u7528\u8001\u5E08\u5206\u4EAB\u7684\u8DDF\u968F\u94FE\u63A5\u8FDB\u5165\uFF08\u94FE\u63A5\u542B ?room= \u53C2\u6570\uFF09", false);
  $("#plot-empty").classList.add("hidden");
  $("#plot-empty").innerHTML = "<strong>\u672A\u6307\u5B9A\u8DDF\u968F\u623F\u95F4</strong><span>\u8BF7\u4ECE\u8001\u5E08\u5E7F\u64AD\u63D0\u793A\u7684\u94FE\u63A5\u8FDB\u5165,\u6216\u8BA9\u8001\u5E08\u91CD\u65B0\u5206\u4EAB\u8DDF\u968F\u5730\u5740\u3002</span>";
} else {
  connectSSE();
  poll();
}
