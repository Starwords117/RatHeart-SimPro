import { DRUGS, NERVE_PATHWAYS, doseList } from "./catalog.js";
import { MODEL_VERSION, DEFAULT_WINDOW_POINTS } from "./core.js";
const $ = (selector) => document.querySelector(selector);
const worker = new Worker(new URL("./simulation.worker.js", import.meta.url), { type: "module" });
const canvas = $("#trace-canvas");
const context = canvas.getContext("2d");
const dialog = $("#information-dialog");
let state;
let frames = [], events = [];
let activeDrugs = [];
let category = "agonist";
let windowPoints = DEFAULT_WINDOW_POINTS;
let cursorTime = null;
let hoverTime = null;
let historyEnd = null;
let dirty = true;
let toastTimer;
let broadcasting = false;
const INK = "#202428", GRID = "#e7eaee", GRID_BASE = "#aab3bc", MUTED = "#606970";
const CHANNEL_COLORS = { abp: "#b03a2e", lvp: "#245e9c", vbp: "#2e8b74", hf: "#b06f2e", hr: "#3a7d44" };
const CHANNEL_LABELS = { abp: "ABP \u52A8\u8109\u8840\u538B mmHg", lvp: "LVP \u5DE6\u5BA4\u5185\u538B mmHg", vbp: "VBP \u9759\u8109\u538B mmHg", hf: "HF \u5FC3\u6536\u7F29\u529B", hr: "HR \u5FC3\u7387 bpm" };
const CHANNEL_KEYS = ["abp", "lvp", "vbp", "hf", "hr"];
const CHANNEL_DEFAULT_MAX = { abp: 220, lvp: 220, vbp: 20, hf: 20, hr: 400 };
const EVENT_COLORS = { dose: "#78818a", stimulus: "#8b7552", death: "#b03a2e", import: "#9aa4ad" };
let currentRange = { start: 0, end: 4e3, left: 46, right: 12, top: 8, bottom: 30, width: 800, height: 420 };
function send(type, data = {}) {
  worker.postMessage({ type, ...data });
}
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.opacity = "0";
  }, 3200);
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4e3);
}
function filename(ext) {
  const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace(/:/g, "-");
  return `RatHeart-SimPro_${stamp}.${ext}`;
}
function time(value, decimals = false) {
  const m = Math.floor(value / 60);
  const s = value - m * 60;
  return decimals ? `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}` : `${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}`;
}
function populateDrugs() {
  const select = $("#drug-select");
  const list = DRUGS.filter((d) => !d.hidden && d.group === category);
  select.innerHTML = "";
  for (const drug of list) {
    const option = document.createElement("option");
    option.value = drug.id;
    option.textContent = `${drug.name}\uFF08${drug.short}\uFF09`;
    select.appendChild(option);
  }
  updateDrug();
}
function updateDrug() {
  const drug = DRUGS.find((d) => d.id === $("#drug-select").value);
  $("#drug-english").textContent = drug.english;
  $("#drug-mechanism").textContent = drug.mechanism;
  const doseSelect = $("#dose-select");
  doseSelect.innerHTML = "";
  for (const option of doseList(drug)) {
    const el = document.createElement("option");
    el.value = String(option.value);
    el.textContent = option.label;
    doseSelect.appendChild(el);
  }
  doseSelect.selectedIndex = 0;
}
function selectedDose() {
  return Number($("#dose-select").value);
}
function renderState() {
  const s = state;
  $("#abp-value").innerHTML = `${s.art.meanP > 0 ? s.art.meanP.toFixed(1) : "\u2013"}<small>mmHg</small>`;
  $("#hr-value").innerHTML = `${s.heart.rate > 1 ? Math.round(s.heart.rate) : "\u2013"}<small>bpm</small>`;
  $("#time-value").textContent = time(s.time, true);
  $("#recording-status").textContent = s.dead ? "\u5927\u9F20\u6B7B\u4EA1" : s.historyOnly ? "\u5386\u53F2\u8BB0\u5F55\u56DE\u770B" : s.running ? "\u8BB0\u5F55\u4E2D" : s.points > 0 ? "\u5DF2\u6682\u505C" : "\u5B9E\u9A8C\u5C31\u7EEA";
  $("#live-indicator").classList.toggle("running", s.running && !s.historyOnly);
  $("#chart-model").textContent = s.pithed ? "\u53BB\u8111\u5927\u9F20" : "\u6B63\u5E38\u5927\u9F20";
  const runLabel = $("#run-label");
  runLabel.textContent = s.running ? "\u6682\u505C\u8BB0\u5F55" : s.historyOnly ? "\u5386\u53F2\u8BB0\u5F55\uFF08\u53EA\u8BFB\uFF09" : "\u5F00\u59CB\u8BB0\u5F55";
  const modelRow = $("#model-radios");
  const modelLocked = s.recorderStarted || s.historyOnly;
  modelRow.classList.toggle("disabled", modelLocked);
  modelRow.title = modelLocked ? "\u52A8\u7269\u6A21\u578B\u5DF2\u9501\u5B9A\uFF1A\u70B9\u51FB\u300C\u65B0\u5EFA\u5B9E\u9A8C\u300D\u540E\u53EF\u91CD\u65B0\u9009\u62E9" : "\u5F00\u59CB\u8BB0\u5F55\u540E\u6A21\u578B\u4E0D\u53EF\u5207\u6362\uFF1B\u70B9\u51FB\u300C\u65B0\u5EFA\u5B9E\u9A8C\u300D\u540E\u53EF\u91CD\u65B0\u9009\u62E9";
  $("#model-note").textContent = modelLocked ? "\u52A8\u7269\u6A21\u578B\u5DF2\u9501\u5B9A\uFF08\u8BB0\u5F55\u5F00\u59CB\u540E\u4E0D\u53EF\u5207\u6362\uFF0C\u4E0E\u539F\u7248\u4E00\u81F4\uFF09\u3002\u70B9\u51FB\u300C\u65B0\u5EFA\u5B9E\u9A8C\u300D\u5F00\u59CB\u65B0\u5B9E\u9A8C\u540E\u53EF\u91CD\u65B0\u9009\u62E9\u6A21\u578B\u3002" : "\u53BB\u8111\u5927\u9F20\u65E0\u4E2D\u67A2\u795E\u7ECF\u53CD\u5C04\uFF0C\u662F\u6807\u51C6\u836F\u7406\u7B5B\u9009\u5236\u5907\uFF1B\u6B63\u5E38\u5927\u9F20\u4FDD\u7559\u538B\u529B\u611F\u53D7\u5668\u53CD\u9988\u4E0E\u57FA\u7840\u4EA4\u611F\u5F20\u529B\u3002\u5F00\u59CB\u8BB0\u5F55\u540E\u4E0D\u53EF\u5207\u6362\u3002";
  $("#radio-pithed").checked = s.pithed;
  $("#radio-normal").checked = !s.pithed;
  const latest = events.at(-1);
  if (latest) $("#last-operation").textContent = latest.text;
  renderHistory();
}
function renderHistory() {
  const wrap = $("#history-scroll");
  const slider = $("#history-position");
  if (frames.length > windowPoints) {
    wrap.classList.remove("hidden");
    slider.max = String(frames.length - 1);
    slider.value = String(historyEnd ?? frames.length - 1);
  } else {
    wrap.classList.add("hidden");
    historyEnd = null;
  }
}
function renderEvents() {
  const list = $("#event-list");
  list.innerHTML = "";
  $("#event-count").textContent = String(events.length);
  for (const event of events.slice(-60).reverse()) {
    const item = document.createElement("div");
    item.className = "event-item";
    const color = EVENT_COLORS[event.kind] ?? "#78818a";
    item.innerHTML = `<span class="event-dot" style="background:${color}"></span><span class="event-time">${time(event.t, true)}</span><span class="event-text"></span>`;
    item.querySelector(".event-text").textContent = event.text;
    list.appendChild(item);
  }
}
function drawChart() {
  const wrap = $("#plot-wrap");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = wrap.clientWidth, height = wrap.clientHeight;
  if (width < 10 || height < 10) return;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  const window = windowPoints > 0 ? windowPoints : frames.length;
  const end = historyEnd ?? frames.length;
  const start = Math.max(0, end - window);
  if (frames.length < 2 || end - start < 2) return;
  const left = 46, right = 12, top = 8, bottom = 30;
  const plotW = width - left - right, plotH = height - top - bottom;
  const bandGap = 18;
  const bandH = (plotH - bandGap * (CHANNEL_KEYS.length - 1)) / CHANNEL_KEYS.length;
  currentRange = { start, end, left, right, top, bottom, width, height };
  const visibleCount = end - start;
  const stride = Math.max(1, Math.floor(visibleCount / (plotW * 2)));
  context.save();
  context.beginPath();
  context.rect(left, top, plotW, plotH);
  context.clip();
  const tAt = (i) => frames[Math.min(frames.length - 1, Math.max(0, i))].t;
  const xAt = (t) => {
    const t02 = tAt(start), t12 = tAt(end - 1);
    return t12 > t02 ? left + (t - t02) / (t12 - t02) * plotW : left;
  };
  let labelRow = 0, lastLabelX = -1e9;
  const CHART_KINDS = /* @__PURE__ */ new Set(["dose", "stimulus", "death", "import"]);
  for (const event of events) {
    if (!CHART_KINDS.has(event.kind)) continue;
    if (event.t < tAt(start) || event.t > tAt(end - 1)) continue;
    const x = xAt(event.t);
    context.strokeStyle = "#c6cdd3";
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, top + plotH);
    context.stroke();
    context.setLineDash([]);
    if (x - lastLabelX > 72) {
      context.fillStyle = EVENT_COLORS[event.kind] ?? "#78818a";
      context.font = "11px Consolas, monospace";
      context.textAlign = "left";
      context.fillText(event.text, Math.min(x + 3, width - right - 90), top + 15 + labelRow * 13);
      lastLabelX = x;
      labelRow = 1 - labelRow;
    }
  }
  context.restore();
  CHANNEL_KEYS.forEach((key, ch) => {
    const bandTop = top + ch * (bandH + bandGap);
    let ymax = CHANNEL_DEFAULT_MAX[key];
    for (let i = start; i < end; i += stride) {
      const v = frames[i][key];
      if (v > ymax) ymax = v * 1.15;
    }
    if (key === "hr") ymax = Math.max(ymax, 400);
    const ymin = 0;
    const yOf = (v) => bandTop + bandH - (v - ymin) / (ymax - ymin) * bandH;
    context.font = "10px Consolas, monospace";
    context.textAlign = "right";
    for (let g = 0; g <= 4; g++) {
      const y = bandTop + g / 4 * bandH;
      const isEdge = g === 0 || g === 4;
      context.strokeStyle = isEdge ? GRID_BASE : GRID;
      context.lineWidth = isEdge ? 1.6 : 1;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
      context.lineWidth = 1;
      const value = ymax - g / 4 * (ymax - ymin);
      context.fillStyle = MUTED;
      context.fillText(Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(value % 1 === 0 ? 0 : 1), left - 4, y + 3);
    }
    context.textAlign = "left";
    context.fillStyle = MUTED;
    context.font = '10px "Microsoft YaHei", sans-serif';
    context.fillText(CHANNEL_LABELS[key], left + 6, bandTop + 12);
    const lastVisible = frames[Math.min(end, frames.length) - 1];
    if (lastVisible) {
      context.fillStyle = CHANNEL_COLORS[key];
      context.font = "11px Consolas, monospace";
      const value = lastVisible[key];
      context.fillText(value.toFixed(key === "hr" || key === "abp" ? 0 : 1), width - right - 38, bandTop + 12);
    }
    context.save();
    context.beginPath();
    context.rect(left, bandTop, plotW, bandH);
    context.clip();
    context.strokeStyle = CHANNEL_COLORS[key];
    context.lineWidth = 1.4;
    context.beginPath();
    let pen = false;
    for (let i = start; i < end; i += stride) {
      const stop = Math.min(end, i + stride);
      let min = frames[i][key], max = min, minI = i, maxI = i;
      for (let j = i; j < stop; j++) {
        const v = frames[j][key];
        if (v < min) {
          min = v;
          minI = j;
        }
        if (v > max) {
          max = v;
          maxI = j;
        }
      }
      const first = Math.min(minI, maxI), second = Math.max(minI, maxI);
      for (const idx of stride > 1 ? [first, second] : [i]) {
        const x = left + (idx - start) / (visibleCount - 1) * plotW;
        if (!pen) {
          context.moveTo(x, yOf(frames[idx][key]));
          pen = true;
        } else context.lineTo(x, yOf(frames[idx][key]));
      }
    }
    context.stroke();
    context.restore();
  });
  context.fillStyle = MUTED;
  context.font = "10px Consolas, monospace";
  context.textAlign = "center";
  const t0 = frames[start].t, t1 = frames[end - 1].t;
  const ticks = width < 450 ? 4 : 6;
  for (let g = 0; g <= ticks; g++) {
    const x = left + g / ticks * plotW;
    const t = t0 + g / ticks * (t1 - t0);
    context.fillText(time(t), x, height - bottom + 14);
  }
  context.fillText("\u65F6\u95F4\uFF08\u751F\u7406\uFF09", width - right - 4, height - 6);
  context.textAlign = "left";
  context.fillText("(s)", left - 30, height - 6);
  $("#plot-empty").classList.toggle("hidden", frames.length > 1);
  if (hoverTime !== null && hoverTime >= t0 && hoverTime <= t1) {
    const x = xAt(hoverTime);
    context.strokeStyle = "#9aa4ad";
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, top + plotH);
    context.stroke();
    context.setLineDash([]);
  }
  if (cursorTime !== null && cursorTime >= t0 && cursorTime <= t1) {
    const x = xAt(cursorTime);
    context.strokeStyle = "#2f9e44";
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, top + plotH);
    context.stroke();
  }
}
function animate() {
  if (dirty) {
    drawChart();
    dirty = false;
  }
  requestAnimationFrame(animate);
}
new ResizeObserver(() => {
  dirty = true;
}).observe($("#plot-wrap"));
requestAnimationFrame(animate);
function frameAtTime(t) {
  if (!frames.length) return null;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = frames[lo], b = frames[Math.max(0, lo - 1)];
  return Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
}
function readoutText(frame) {
  return `t ${frame.t.toFixed(2)} s \xB7 ABP ${frame.abp.toFixed(1)} \xB7 LVP ${frame.lvp.toFixed(1)} \xB7 VBP ${frame.vbp.toFixed(1)} \xB7 HF ${frame.hf.toFixed(1)} \xB7 HR ${frame.hr.toFixed(0)} bpm`;
}
const tooltip = $("#cursor-tooltip");
function pointerT(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const { start, end, left, right, width } = currentRange;
  if (x < left - 4 || x > width - right + 4) return null;
  const t0 = frames[start]?.t, t1 = frames[Math.min(end, frames.length) - 1]?.t;
  if (t0 === void 0 || t1 === void 0 || t1 <= t0) return null;
  return t0 + (x - left) / (width - left - right) * (t1 - t0);
}
canvas.addEventListener("pointermove", (event) => {
  if (!frames.length) return;
  const t = pointerT(event);
  hoverTime = t;
  if (t === null) {
    tooltip.classList.add("hidden");
    dirty = true;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const frame = frameAtTime(t);
  if (frame) {
    tooltip.textContent = readoutText(frame);
    tooltip.style.left = `${Math.min(event.clientX - rect.left + 12, rect.width - 250)}px`;
    tooltip.style.top = `${event.clientY - rect.top + 14}px`;
    tooltip.classList.remove("hidden");
  }
  dirty = true;
});
canvas.addEventListener("pointerdown", (event) => {
  const t = pointerT(event);
  if (t !== null) {
    cursorTime = t;
    const frame = frameAtTime(t);
    if (frame) $("#cursor-readout").textContent = readoutText(frame);
  }
  dirty = true;
});
canvas.addEventListener("pointerleave", () => {
  hoverTime = null;
  tooltip.classList.add("hidden");
  dirty = true;
});
worker.onmessage = (event) => {
  const m = event.data;
  switch (m.type) {
    case "update":
      state = m.state;
      activeDrugs = m.activeDrugs;
      if (m.replace) {
        frames = m.frames;
        events = m.events;
        historyEnd = null;
        cursorTime = null;
      } else {
        frames.push(...m.frames);
        events.push(...m.events);
      }
      renderState();
      if (m.frames.length || m.events.length || m.replace) renderEvents();
      dirty = true;
      break;
    case "broadcast":
      broadcasting = m.on;
      updateBroadcastButton(m.followers ?? 0, m.error);
      break;
    case "snapshot": {
      const snapshot = m.snapshot;
      if (m.purpose === "autosave") {
        const trimmed = { ...snapshot, trace: snapshot.trace.slice(-96e3).map(roundFrame) };
        try {
          localStorage.setItem("ratheart-simpro-session-v1", JSON.stringify(trimmed));
        } catch {
        }
      } else {
        download(new Blob([JSON.stringify(snapshot, null, 1)], { type: "application/json" }), filename("json"));
      }
      break;
    }
    case "csv": {
      const rows = ["\u65F6\u95F4_s,ABP_mmHg,LVP_mmHg,VBP_mmHg,HF,HR_bpm,\u4E8B\u4EF6"];
      const byTime = /* @__PURE__ */ new Map();
      for (const e of m.events) {
        const key = e.t.toFixed(2);
        (byTime.get(key) ?? byTime.set(key, []).get(key)).push(e.text);
      }
      for (const f of m.trace) {
        const key = f.t.toFixed(2);
        const texts = byTime.get(key);
        rows.push(`${key},${f.abp.toFixed(3)},${f.lvp.toFixed(3)},${f.vbp.toFixed(3)},${f.hf.toFixed(3)},${f.hr.toFixed(1)}${texts ? `,"${texts.join(" | ").replaceAll('"', '""')}"` : ""}`);
      }
      download(new Blob(["\uFEFF" + rows.join("\r\n")], { type: "text/csv" }), filename("csv"));
      break;
    }
    case "rat":
      download(new Blob([m.buffer], { type: "application/octet-stream" }), filename("rat"));
      break;
    case "file-error":
      toast("\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25\uFF1A\u683C\u5F0F\u4E0D\u6B63\u786E\u6216\u5DF2\u635F\u574F\u3002");
      break;
  }
  dirty = true;
};
function roundFrame(f) {
  return { t: Math.round(f.t * 1e5) / 1e5, abp: Math.round(f.abp * 1e3) / 1e3, lvp: Math.round(f.lvp * 1e3) / 1e3, vbp: Math.round(f.vbp * 1e3) / 1e3, hf: Math.round(f.hf * 1e3) / 1e3, hr: Math.round(f.hr * 100) / 100 };
}
function updateBroadcastButton(followers, error = false) {
  const button = $("#broadcast-button");
  button.textContent = broadcasting ? error ? "\u5E7F\u64AD\u4E2D\u65AD\uFF08\u5DF2\u505C\u6B62\uFF09" : `\u505C\u6B62\u6388\u8BFE\u5E7F\u64AD \xB7 ${followers} \u4EBA\u8DDF\u968F` : "\u5F00\u59CB\u6388\u8BFE\u5E7F\u64AD";
}
$("#drug-select").addEventListener("change", updateDrug);
for (const button of document.querySelectorAll(".drug-categories button")) {
  button.addEventListener("click", () => {
    for (const b of document.querySelectorAll(".drug-categories button")) b.classList.remove("active");
    button.classList.add("active");
    category = button.dataset.group;
    populateDrugs();
  });
}
$("#inject-button").addEventListener("click", () => {
  send("dose", { drugId: $("#drug-select").value, dose: selectedDose() });
});
const nerveHint = $("#nerve-hint");
function updateNerveHint() {
  const pathway = document.querySelector('input[name="nerve-pathway"]:checked').value;
  nerveHint.textContent = NERVE_PATHWAYS.find((p) => p.id === pathway)?.hint ?? "";
}
for (const radio of document.querySelectorAll('input[name="nerve-pathway"]')) {
  radio.addEventListener("change", updateNerveHint);
}
updateNerveHint();
$("#stimulate-button").addEventListener("click", () => {
  const pathway = document.querySelector('input[name="nerve-pathway"]:checked').value;
  send("stimulate", { pathway });
});
for (const radio of document.querySelectorAll('input[name="rat-model"]')) {
  radio.addEventListener("change", () => {
    if (state && (state.recorderStarted || state.historyOnly)) {
      toast(state.historyOnly ? "\u5BFC\u5165\u7684\u5386\u53F2\u8BB0\u5F55\u53EA\u8BFB\uFF1B\u70B9\u51FB\u300C\u65B0\u5EFA\u5B9E\u9A8C\u300D\u540E\u53EF\u91CD\u65B0\u9009\u62E9\u52A8\u7269\u6A21\u578B\u3002" : "\u52A8\u7269\u6A21\u578B\u5DF2\u9501\u5B9A\uFF1A\u8BB0\u5F55\u5F00\u59CB\u540E\u4E0D\u53EF\u5207\u6362\uFF08\u4E0E\u539F\u7248\u4E00\u81F4\uFF09\u3002\u70B9\u51FB\u300C\u65B0\u5EFA\u5B9E\u9A8C\u300D\u5F00\u59CB\u65B0\u5B9E\u9A8C\u540E\u53EF\u91CD\u65B0\u9009\u62E9\u3002");
      renderState();
      return;
    }
    send("model", { value: radio.value === "pithed" });
  });
}
$("#new-experiment-button").addEventListener("click", () => {
  if (!confirm("\u65B0\u5EFA\u5B9E\u9A8C\uFF01\u5F53\u524D\u8BB0\u5F55\u5C06\u88AB\u6E05\u9664\uFF0C\u786E\u5B9A\u5417\uFF1F")) return;
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  send("reset", { pithed: state?.pithed ?? true, seed });
});
$("#run-button").addEventListener("click", () => {
  if (state.historyOnly) {
    toast("\u5BFC\u5165\u7684\u5386\u53F2\u8BB0\u5F55\u53EA\u8BFB\uFF0C\u8BF7\u65B0\u5EFA\u5B9E\u9A8C\u540E\u5F00\u59CB\u8BB0\u5F55\u3002");
    return;
  }
  send(state.running ? "pause" : "run");
});
$("#advance-button").addEventListener("click", () => send("advance", { seconds: 30 }));
$("#speed-select").addEventListener("change", (event) => send("speed", { value: Number(event.target.value) }));
function setWindow(points) {
  windowPoints = points === 0 ? 0 : Math.max(500, points);
  const select = $("#window-select");
  if (windowPoints > 0) {
    const match = Array.from(select.options).find((o) => Number(o.value) === windowPoints);
    if (!match) {
      const option = document.createElement("option");
      option.value = String(windowPoints);
      option.textContent = `${(windowPoints * 625e-5).toFixed(1).replace(/\.0$/, "")} s`;
      select.appendChild(option);
    }
  }
  select.value = String(windowPoints);
  renderHistory();
  dirty = true;
}
$("#window-select").addEventListener("change", (event) => setWindow(Number(event.target.value)));
$("#window-double").addEventListener("click", () => setWindow(windowPoints === 0 ? 0 : Math.round(windowPoints * 2)));
$("#window-half").addEventListener("click", () => setWindow(windowPoints === 0 ? 0 : Math.round(windowPoints / 2)));
$("#history-position").addEventListener("input", (event) => {
  historyEnd = Number(event.target.value);
  dirty = true;
});
$("#latest-button").addEventListener("click", () => {
  historyEnd = null;
  renderHistory();
  dirty = true;
});
$("#load-button").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", async (event) => {
  const input = event.target;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.name.toLowerCase().endsWith(".json")) {
    try {
      const snapshot = JSON.parse(await file.text());
      if (snapshot.format !== "ratheart-simpro" || snapshot.version !== 1) throw new Error("format");
      send("restore", { snapshot });
    } catch {
      toast("\u5B9E\u9A8C\u6587\u4EF6\u683C\u5F0F\u4E0D\u6B63\u786E\u3002");
    }
  } else {
    const buffer = await file.arrayBuffer();
    worker.postMessage({ type: "rat", buffer }, [buffer]);
  }
});
$("#save-button").addEventListener("click", () => send("snapshot", { purpose: "download" }));
$("#csv-button").addEventListener("click", () => send("csv"));
$("#png-button").addEventListener("click", () => canvas.toBlob((blob) => blob && download(blob, filename("png")), "image/png"));
$("#rat-button").addEventListener("click", () => send("rat-export"));
$("#concentration-button").addEventListener("click", () => {
  const rows = activeDrugs.map((d) => `<tr><td>${d.name}\uFF08${d.short}\uFF09</td><td>\u8840\u836F ${d.dose.toExponential(2)} mg/kg</td><td>\u6CE8\u5C04\u6B8B\u4F59 ${d.injected.toExponential(2)}</td></tr>`).join("");
  openDialog("\u5FAA\u73AF\u836F\u7269\u6D53\u5EA6", `<p>\u5F53\u524D\u5FAA\u73AF\u4E2D\u7684\u836F\u7269\uFF08\u5242\u91CF\u5355\u4F4D mg/kg\uFF0C\u8840\u836F\u6D53\u5EA6\u6309\u4E00\u9636\u52A8\u529B\u5B66\u8870\u51CF\uFF09\uFF1A</p><table class="drug-table"><thead><tr><th>\u836F\u7269</th><th>\u8840\u836F\u6D53\u5EA6</th><th>\u6CE8\u5C04 compartment \u6B8B\u4F59</th></tr></thead><tbody>${rows || '<tr><td colspan="3">\u65E0</td></tr>'}</tbody></table>`);
});
const broadcastButton = $("#broadcast-button");
if (location.protocol.startsWith("http")) {
  broadcastButton.classList.remove("hidden");
  broadcastButton.textContent = "\u5F00\u59CB\u6388\u8BFE\u5E7F\u64AD";
  broadcastButton.addEventListener("click", () => send(broadcasting ? "broadcast-off" : "broadcast-on"));
}
function openDialog(title, content) {
  $("#dialog-title").textContent = title;
  $("#dialog-content").innerHTML = content;
  dialog.showModal();
}
$("#close-dialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
$("#help-button").addEventListener("click", () => openDialog("\u4F7F\u7528\u8BF4\u660E", HELP_HTML));
$("#model-button").addEventListener("click", renderSettingsDialog);
const HELP_HTML = `
<p><strong>\u5B9E\u9A8C\u6D41\u7A0B\uFF08\u5BF9\u5E94\u539F\u7248 RatCVS User Guide\uFF09</strong></p>
<ol>
  <li>\u5728\u300C\u52A8\u7269\u6A21\u578B\u300D\u9009\u62E9<strong>\u53BB\u8111\u5927\u9F20</strong>\uFF08\u65E0\u795E\u7ECF\u53CD\u5C04\uFF0C\u6807\u51C6\u5236\u5907\uFF09\u6216<strong>\u6B63\u5E38\u5927\u9F20</strong>\uFF08\u4FDD\u7559\u538B\u529B\u611F\u53D7\u5668\u53CD\u5C04\u4E0E\u57FA\u7840\u4EA4\u611F\u5F20\u529B\uFF09\uFF0C\u70B9\u51FB\u300C\u65B0\u5EFA\u5B9E\u9A8C\u300D\u3002</li>
  <li>\u70B9\u51FB\u300C\u5F00\u59CB\u8BB0\u5F55\u300D\uFF0C\u56FE\u7EB8\u5F00\u59CB\u8D70\u52A8\u3002</li>
  <li>\u5728\u300C\u7ED9\u836F\u6CE8\u5C04\u300D\u9009\u62E9\u836F\u7269\u4E0E\u5242\u91CF\uFF0C\u70B9\u51FB\u300C\u6CE8\u5C04\u836F\u7269\u300D\u2014\u2014\u6CE8\u5C04\u4FE1\u606F\u81EA\u52A8\u6807\u6CE8\u5728\u66F2\u7EBF\u4E0A\u3002</li>
  <li>\u5982\u9700\u523A\u6FC0\u795E\u7ECF\uFF0C\u5728\u300C\u795E\u7ECF\u523A\u6FC0\u300D\u9009\u62E9\u901A\u8DEF\u540E\u70B9\u51FB\u300C\u523A\u6FC0\u795E\u7ECF\u300D\u3002</li>
  <li>\u91CD\u590D\u6CE8\u5C04\u53EF\u7ED8\u5236<strong>\u91CF\u6548\u66F2\u7EBF</strong>\uFF1B\u5148\u7ED9\u62EE\u6297\u836F\u518D\u7ED9\u6FC0\u52A8\u836F\u53EF\u5224\u522B<strong>\u4F5C\u7528\u53D7\u4F53</strong>\u3002</li>
  <li>\u70B9\u51FB\u66F2\u7EBF\u653E\u7F6E\u7EFF\u8272\u6D4B\u91CF\u5149\u6807\uFF0C\u8BFB\u53D6\u5404\u901A\u9053\u6570\u503C\uFF1B\u62D6\u52A8\u300C\u56DE\u770B\u65F6\u95F4\u300D\u6ED1\u5757\u56DE\u770B\u5386\u53F2\u3002</li>
  <li>\u300C\u5FEB\u8FDB 30 s\u300D\u53EF\u8DF3\u8FC7\u836F\u7269\u8D77\u6548\u7B49\u5F85\uFF08\u901F\u5EA6\u9ED8\u8BA4 0.25\xD7\uFF0C\u4E0E\u539F\u7248\u8D70\u7EB8\u901F\u5EA6\u4E00\u81F4\uFF0C\u53EF\u8C03\u9AD8\uFF09\u3002</li>
</ol>
<p><strong>\u4E94\u6761\u901A\u9053</strong>\uFF1AABP \u52A8\u8109\u8840\u538B\u3001LVP \u5DE6\u5FC3\u5BA4\u5185\u538B\u3001VBP \u4E2D\u5FC3\u9759\u8109\u538B\u3001HF \u5FC3\u6536\u7F29\u529B\u3001HR \u5FC3\u7387\u3002</p>
<p><strong>\u6559\u5B66\u63D0\u793A</strong>\uFF1A\u52A8\u8109\u538B\u957F\u65F6\u95F4\u4F4E\u4E8E 20 mmHg \u4F1A\u5BFC\u81F4\u5927\u9F20\u6B7B\u4EA1\uFF1B\u5927\u5242\u91CF\u5730\u9AD8\u8F9B\uFF08\u226510 mg/kg\uFF09\u4F1A\u8BF1\u53D1\u5FC3\u5BA4\u98A4\u52A8\uFF0C\u5FC3\u810F\u505C\u6B62\u5C04\u8840\u3002\u300C\u672A\u77E5\u836F\u300DA\u2013K \u4F9B\u76F2\u68C0\u7EC3\u4E60\u2014\u2014\u5148\u6D4B\u5176\u4F5C\u7528\uFF0C\u518D\u7528\u5DF2\u77E5\u836F\u7269\u9274\u522B\u3002</p>
`;
let settingsHtml = "";
function renderSettingsDialog() {
  settingsHtml = `  <p><strong>\u6A21\u578B\u7ED3\u6784</strong>\uFF1A\u4E09\u5BA4\u96C6\u603B\u53C2\u6570\u6A21\u578B\uFF08\u5FC3\u810F\u3001\u52A8\u8109\u3001\u9759\u8109\uFF09+ \u4E24\u4E2A\u5355\u5411\u9600\u3002\u5FC3\u810F\u6536\u7F29\u5F39\u6027\u4E3A\u9AD8\u65AF\u8109\u51B2\uFF0C\u79EF\u5206\u6B65\u957F 0.125 ms\uFF0C\u6BCF 12.5 ms \u8F93\u51FA\u4E00\u4E2A\u663E\u793A\u70B9\uFF082 \u4E2A\u5B50\u6837\u672C\uFF09\uFF1B\u53D7\u4F53\u6FC0\u6D3B\u4E0E\u8840\u836F\u52A8\u529B\u5B66\u6BCF 5 ms \u66F4\u65B0\u3002</p>
  <p><strong>\u53D7\u4F53\u65B9\u7A0B</strong>\uFF08\u7ADE\u4E89\u6027\u5360\u9886\uFF09\uFF1A\u6FC0\u6D3B\u91CF = \u03A3(\u6548\u80FD\u1D62\xB7x\u1D62)/(1+\u03A3x\u1D62)\uFF0C\u5176\u4E2D x\u1D62 = \u5242\u91CF\u1D62/(\u6548\u529B\u1D62\xD7 potencyShift)\uFF1B\u62EE\u6297\u836F\u6548\u80FD 0\u3002PDE \u6291\u5236\u4F7F \u03B2 \u6548\u529B shift = 1 \u2212 PDE\xD70.5\u3002</p>
  <p><strong>\u8840\u836F\u52A8\u529B\u5B66</strong>\uFF1AdDose/dt = k_on\xB7(Injected\u2212Dose) \u2212 k_off\xB7Dose\uFF1B\u6CE8\u5C04\u5242\u91CF\u5E26 \xB110% \u968F\u673A\u6CE2\u52A8\uFF0C\u6548\u529B\u53C2\u6570\u5E26 \xB150% \u4E2A\u4F53\u5DEE\u5F02\uFF08\u4E0E\u539F\u7248\u4E00\u81F4\uFF09\u3002</p>
  <p><strong>\u538B\u529B\u611F\u53D7\u5668\u53CD\u5C04</strong>\uFF08\u4EC5\u6B63\u5E38\u5927\u9F20\uFF09\uFF1A\u8FF7\u8D70\u5F20\u529B = 5/(1+e^(\u2212(MAP\u2212130)/8))\uFF1B\u57FA\u7840\u4EA4\u611F\u5F20\u529B\u6052\u5B9A\u3002</p>
  <div class="setting-row"><div><strong>\u7ED9\u836F\u6CE2\u52A8\u4E0E\u8BB0\u5F55\u566A\u58F0</strong><small>\u5173\u95ED\u540E\u6548\u529B\u53C2\u6570\u53D6\u540D\u4E49\u503C\u3001\u6CE8\u5C04\u4E0E\u5FC3\u7387\u65E0\u968F\u673A\u6CE2\u52A8\uFF08\u7528\u4E8E\u7CBE\u786E\u590D\u73B0\u5B9E\u9A8C\uFF09</small></div><input id="noise-toggle" type="checkbox" ${state?.noise ? "checked" : ""}></div>
  <div class="setting-row"><div><strong>\u968F\u673A\u79CD\u5B50</strong><small>\u4FEE\u6539\u540E\u70B9\u51FB\u300C\u5E94\u7528\u300D\u4EE5\u65B0\u79CD\u5B50\u91CD\u5EFA\u5B9E\u9A8C</small></div><input id="seed-input" class="seed-input" type="number" value="${state?.seed ?? 0}"></div>
  <button id="apply-settings" class="button primary" type="button">\u5E94\u7528\uFF08\u91CD\u5EFA\u5B9E\u9A8C\uFF09</button>
  <p class="model-note">\u6A21\u578B\u7248\u672C ${MODEL_VERSION} \xB7 \u79FB\u690D\u81EA RatCVS 3.3.7 (30.07.20) \xB7 \u539F\u7248 (c) J. Dempster, University of Strathclyde\u3002\u539F\u7248\u201C\u523A\u6FC0\u5FC3\u4EA4\u611F\u795E\u7ECF\u201D\u56E0 iSympHeart \u672A\u8D4B\u503C\u5B9E\u9645\u6CE8\u5165\u80BE\u4E0A\u817A\u7D20\uFF0C\u672C\u7248\u6309\u539F\u7248\u884C\u4E3A\u590D\u523B\u3002</p>`;
  openDialog("\u539F\u7406\u4E0E\u8BBE\u7F6E", settingsHtml);
  $("#noise-toggle").addEventListener("change", (event) => send("noise", { value: event.target.checked }));
  $("#apply-settings").addEventListener("click", () => {
    const seed = Number($("#seed-input").value) >>> 0;
    if (!confirm("\u4EE5\u65B0\u79CD\u5B50\u91CD\u5EFA\u5B9E\u9A8C\uFF1F\u5F53\u524D\u8BB0\u5F55\u5C06\u88AB\u6E05\u9664\u3002")) return;
    send("reset", { pithed: state?.pithed ?? true, seed, noise: state?.noise ?? true });
    dialog.close();
  });
}
setInterval(() => {
  if (state && state.points > 0) send("snapshot", { purpose: "autosave" });
}, 2e4);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && state && state.points > 0) send("snapshot", { purpose: "autosave" });
});
(function restoreAutosave() {
  const saved = localStorage.getItem("ratheart-simpro-session-v1");
  if (!saved) return;
  try {
    const snapshot = JSON.parse(saved);
    if (snapshot.format !== "ratheart-simpro" || snapshot.version !== 1) return;
    send("restore", { snapshot });
    toast(snapshot.state?.recorderStarted ? "\u5DF2\u6062\u590D\u4E0A\u6B21\u81EA\u52A8\u4FDD\u5B58\u7684\u5B9E\u9A8C\uFF08\u8BB0\u5F55\u5DF2\u5F00\u59CB\uFF1A\u52A8\u7269\u6A21\u578B\u5DF2\u9501\u5B9A\uFF0C\u70B9\u51FB\u300C\u65B0\u5EFA\u5B9E\u9A8C\u300D\u53EF\u91CD\u65B0\u5F00\u59CB\uFF09\u3002" : "\u5DF2\u6062\u590D\u4E0A\u6B21\u81EA\u52A8\u4FDD\u5B58\u7684\u5B9E\u9A8C\u3002");
  } catch {
  }
})();
populateDrugs();
send("init");
