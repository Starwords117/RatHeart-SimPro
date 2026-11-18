import { DRUGS, NERVE_PATHWAYS, doseList } from "./catalog.js";
import { MODEL_VERSION, DEFAULT_WINDOW_POINTS, MIN_WINDOW_POINTS, MAX_WINDOW_POINTS, CH_SCALE, SAMPLE_DT } from "./core.js";
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
let currentRange = { start: 0, end: DEFAULT_WINDOW_POINTS, left: 46, right: 12, top: 8, bottom: 30, width: 800, height: 420 };
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
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
function download(blob, name) {
  if (IN_TAURI) {
    void blob.arrayBuffer().then(async (buf) => {
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) {
        toast("\u684C\u9762\u5BFC\u51FA\u6865\u4E0D\u53EF\u7528");
        return;
      }
      try {
        await invoke("save_export", { name, b64: btoa(bin) });
      } catch (err) {
        if (String(err) !== "\u5DF2\u53D6\u6D88") toast(`\u5BFC\u51FA\u5931\u8D25:${err}`);
      }
    });
    return;
  }
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
  const window2 = windowPoints > 0 ? windowPoints : frames.length;
  const end = historyEnd ?? frames.length;
  const start = Math.max(0, end - window2);
  if (frames.length < 2 || end - start < 2) return;
  const left = 46, right = 12, top = 8, bottom = 30;
  const plotW = width - left - right, plotH = height - top - bottom;
  const bandGap = 18;
  const bandH = (plotH - bandGap * (CHANNEL_KEYS.length - 1)) / CHANNEL_KEYS.length;
  currentRange = { start, end, left, right, top, bottom, width, height };
  globalThis.__chartRange = { start, end, frames: frames.length };
  const visibleCount = end - start;
  const stride = Math.max(1, Math.floor(visibleCount / (plotW * 2)));
  const ovDur = () => (frames[Math.min(end, frames.length) - 1]?.t ?? 0) - (frames[start]?.t ?? 0);
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
    for (const ov of overlays) {
      for (const f of ov.frames) if (f[key] > ymax) ymax = f[key] * 1.15;
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
    if (overlays.length) {
      const dur = ovDur();
      if (dur > 0) {
        context.save();
        context.globalAlpha = 0.4;
        context.lineWidth = 1.2;
        for (const ov of overlays) {
          const yOfO = (v) => bandTop + bandH - (v - ymin) / (ymax - ymin) * bandH;
          context.strokeStyle = ov.color;
          context.beginPath();
          ov.frames.forEach((f, i) => {
            const x = left + f.t / dur * plotW;
            const y = yOfO(f[key]);
            if (i === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          context.stroke();
        }
        context.globalAlpha = 1;
        context.lineWidth = 1;
        context.restore();
      }
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
  const reg = dragRegion ?? (regionStats ? { t0: regionStats.t0, t1: regionStats.t1 } : null);
  if (reg) {
    const xa = xAt(Math.max(reg.t0, t0)), xb = xAt(Math.min(reg.t1, t1));
    if (xb > xa) {
      context.fillStyle = "rgba(46,134,193,0.14)";
      context.fillRect(xa, top, xb - xa, plotH);
      context.strokeStyle = "#2E86C1";
      context.lineWidth = 1.2;
      context.setLineDash([4, 3]);
      for (const xx of [xa, xb]) {
        context.beginPath();
        context.moveTo(xx, top);
        context.lineTo(xx, top + plotH);
        context.stroke();
      }
      context.setLineDash([]);
    }
  }
}
function animate() {
  if (dirty) {
    drawChart();
    dirty = false;
  }
  requestAnimationFrame(animate);
}
const OVERLAY_COLORS = ["#8b5cf6", "#d97706", "#0d9488", "#dc2626", "#65a30d"];
let overlays = [];
let overlaySeq = 0;
$("#overlay-capture")?.addEventListener("click", () => {
  const { start, end } = currentRange;
  if (!frames.length || end - start < 10) {
    toast("\u6682\u65E0\u53EF\u622A\u53D6\u7684\u66F2\u7EBF");
    return;
  }
  const slice = frames.slice(start, end);
  const stride = Math.max(1, Math.floor(slice.length / 2e3));
  const cap = [];
  for (let i = 0; i < slice.length; i += stride) cap.push(slice[i]);
  overlaySeq += 1;
  const ov = { id: overlaySeq, label: `\u5BF9\u6BD4 ${overlaySeq}`, color: OVERLAY_COLORS[(overlaySeq - 1) % OVERLAY_COLORS.length], frames: cap.map((f) => ({ ...f, t: f.t - slice[0].t })) };
  overlays.push(ov);
  renderOverlayChips();
  toast(`\u5DF2\u4FDD\u5B58\u300C${ov.label}\u300D\u2014\u2014\u534A\u900F\u660E\u53E0\u52A0\u663E\u793A,\u53EF\u53E0\u52A0\u591A\u7EC4\u5BF9\u6BD4\u7ED9\u836F\u524D\u540E`);
  dirty = true;
});
function renderOverlayChips() {
  const box = $("#overlay-chips");
  box.classList.toggle("hidden", overlays.length === 0);
  box.innerHTML = overlays.map((o) => `<span class="overlay-chip" style="border-color:${o.color};color:${o.color}">${o.label} <button data-id="${o.id}" aria-label="\u79FB\u9664">\xD7</button></span>`).join("");
  box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    overlays = overlays.filter((o) => o.id !== Number(b.dataset.id));
    renderOverlayChips();
    dirty = true;
  }));
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
let dragAnchor = null;
let dragRegion = null;
let regionStats = null;
function frameIndexAt(t) {
  let lo = 0, hi = frames.length;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function hideRegionTip() {
  document.getElementById("region-tooltip")?.classList.add("hidden");
}
function clearRegion() {
  regionStats = null;
  hideRegionTip();
  dirty = true;
}
function showRegionTip() {
  if (!regionStats) return;
  let el = document.getElementById("region-tooltip");
  if (!el) {
    el = document.createElement("div");
    el.id = "region-tooltip";
    $("#plot-wrap").appendChild(el);
  }
  const a = regionStats.avg;
  el.innerHTML = `
    <div class="rt-title">\u533A\u95F4\u5747\u503C ${regionStats.t0.toFixed(2)}\u2013${regionStats.t1.toFixed(2)} s(n=${regionStats.n})</div>
    <div class="rt-row"><i style="background:#b03a2e"></i>ABP ${a.abp.toFixed(1)} mmHg</div>
    <div class="rt-row"><i style="background:#245e9c"></i>LVP ${a.lvp.toFixed(1)} mmHg</div>
    <div class="rt-row"><i style="background:#2e8b74"></i>VBP ${a.vbp.toFixed(1)} mmHg</div>
    <div class="rt-row"><i style="background:#b06f2e"></i>HF ${a.hf.toFixed(1)}</div>
    <div class="rt-row"><i style="background:#3a7d44"></i>HR ${a.hr.toFixed(0)} bpm</div>
    <div class="rt-actions"><button data-act="copy" type="button">\u590D\u5236</button><button data-act="work" type="button">\u52A0\u5165\u5DE5\u4F5C\u8868</button></div>`;
  el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const s = regionStats;
    if (!s) return;
    if (b.dataset.act === "copy") {
      const text = `\u533A\u95F4 ${s.t0.toFixed(2)}\u2013${s.t1.toFixed(2)} s(n=${s.n})
ABP ${s.avg.abp.toFixed(1)} mmHg
LVP ${s.avg.lvp.toFixed(1)} mmHg
VBP ${s.avg.vbp.toFixed(1)} mmHg
HF ${s.avg.hf.toFixed(1)}
HR ${s.avg.hr.toFixed(0)} bpm`;
      navigator.clipboard?.writeText(text).then(() => toast("\u533A\u95F4\u5747\u503C\u5DF2\u590D\u5236")).catch(() => toast("\u590D\u5236\u5931\u8D25,\u8BF7\u624B\u52A8\u9009\u62E9\u6587\u672C"));
    } else {
      workRows.push({ t: (s.t0 + s.t1) / 2, abp: s.avg.abp, lvp: s.avg.lvp, vbp: s.avg.vbp, hf: s.avg.hf, hr: s.avg.hr });
      const body = document.querySelector("#work-body");
      if (body) body.innerHTML = workRows.map((r, i) => `<tr><td>${i + 1}</td><td class="num">${r.t.toFixed(2)}</td><td class="num">${r.abp.toFixed(1)}</td><td class="num">${r.lvp.toFixed(1)}</td><td class="num">${r.vbp.toFixed(1)}</td><td class="num">${r.hf.toFixed(1)}</td><td class="num">${r.hr.toFixed(0)}</td></tr>`).join("");
      toast("\u533A\u95F4\u5747\u503C\u5DF2\u52A0\u5165\u5DE5\u4F5C\u8868");
    }
  }));
  const rect = canvas.getBoundingClientRect();
  const { start, end, left, right, width } = currentRange;
  const tA = frames[start]?.t ?? 0, tB = frames[Math.min(end, frames.length) - 1]?.t ?? 1;
  const xMid = tB > tA ? left + (regionStats.t1 - tA) / (tB - tA) * (width - left - right) : rect.width / 2;
  el.style.left = `${Math.max(8, Math.min(xMid - 115, rect.width - 238))}px`;
  el.style.top = `42px`;
  el.classList.remove("hidden");
}
function computeRegion(t0, t1) {
  const a = Math.min(t0, t1), b = Math.max(t0, t1);
  const i0 = frameIndexAt(a), i1 = Math.min(frames.length, frameIndexAt(b));
  const n = i1 - i0;
  if (n < 2) {
    toast("\u9009\u533A\u592A\u5C0F,\u65E0\u6CD5\u7EDF\u8BA1\u5747\u503C");
    return;
  }
  const sum = { abp: 0, lvp: 0, vbp: 0, hf: 0, hr: 0 };
  for (let i = i0; i < i1; i++) {
    const f = frames[i];
    sum.abp += f.abp;
    sum.lvp += f.lvp;
    sum.vbp += f.vbp;
    sum.hf += f.hf;
    sum.hr += f.hr;
  }
  regionStats = { t0: a, t1: b, n, avg: { t: a, abp: sum.abp / n, lvp: sum.lvp / n, vbp: sum.vbp / n, hf: sum.hf / n, hr: sum.hr / n } };
  showRegionTip();
  dirty = true;
}
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
  if (dragAnchor) {
    const rect2 = canvas.getBoundingClientRect();
    if (Math.abs(event.clientX - rect2.left - dragAnchor.x) > 5) {
      if (t !== null) dragRegion = { t0: Math.min(dragAnchor.t, t), t1: Math.max(dragAnchor.t, t) };
      tooltip.classList.add("hidden");
      dirty = true;
      return;
    }
  }
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
  if (event.button !== 0) return;
  const t = pointerT(event);
  if (t === null) {
    dragAnchor = null;
    return;
  }
  dragAnchor = { x: event.clientX - canvas.getBoundingClientRect().left, t };
  canvas.setPointerCapture(event.pointerId);
  dirty = true;
});
canvas.addEventListener("pointerup", (event) => {
  if (dragAnchor) {
    if (dragRegion) {
      computeRegion(dragRegion.t0, dragRegion.t1);
      cursorTime = null;
    } else {
      clearRegion();
      const t = pointerT(event);
      if (t !== null) {
        cursorTime = t;
        const frame = frameAtTime(t);
        if (frame) $("#cursor-readout").textContent = readoutText(frame);
      }
    }
  }
  dragAnchor = null;
  dragRegion = null;
  dirty = true;
});
canvas.addEventListener("pointercancel", () => {
  dragAnchor = null;
  dragRegion = null;
});
canvas.addEventListener("pointerleave", () => {
  hoverTime = null;
  if (!dragRegion) tooltip.classList.add("hidden");
  dirty = true;
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && regionStats) clearRegion();
});
worker.onmessage = (event) => {
  const m = event.data;
  switch (m.type) {
    case "update":
      state = m.state;
      globalThis.__simTime = state.time;
      globalThis.__simSpeed = state.speed;
      activeDrugs = m.activeDrugs;
      if (m.replace) {
        frames = m.frames;
        events = m.events;
        historyEnd = null;
        cursorTime = null;
        clearRegion();
      } else {
        frames.push(...m.frames);
        events.push(...m.events);
      }
      renderState();
      if (m.frames.length || m.events.length || m.replace) renderEvents();
      dirty = true;
      break;
    case "broadcast": {
      const was = broadcasting;
      broadcasting = m.on;
      updateBroadcastButton(m.followers ?? 0, m.error);
      if (m.error) toast(`\u5E7F\u64AD\u542F\u52A8\u5931\u8D25:${m.detail ?? "\u7F51\u7EDC\u6216\u670D\u52A1\u4E0D\u53EF\u8FBE"}`);
      if (!was && broadcasting && lanInfo?.primaryFollow) {
        toast(`\u6388\u8BFE\u5E7F\u64AD\u5DF2\u5F00\u542F,\u540C\u5B66\u6D4F\u89C8\u5668\u8BBF\u95EE:${lanInfo.primaryFollow}`);
      }
      break;
    }
    case "broadcast-ipc": {
      const inv = globalThis.__TAURI_INTERNALS__?.invoke;
      if (!inv) break;
      inv("api_call", { method: "POST", path: m.path, body: m.body }).then((res) => worker.postMessage({ type: "broadcast-ipc-result", status: res[0], body: res[1] })).catch((e) => worker.postMessage({ type: "broadcast-ipc-result", status: 0, body: String(e) }));
      break;
    }
    case "snapshot": {
      const snapshot = m.snapshot;
      if (m.purpose === "autosave") {
        const n = Math.min(snapshot.trace.length, 96e3);
        const trace = snapshot.trace.slice(-n);
        const buf = new Int16Array(n * 5);
        const put = (i, j, v) => {
          buf[i * 5 + j] = Math.max(-32768, Math.min(32767, Math.round(v)));
        };
        trace.forEach((f, i) => {
          put(i, 0, f.abp / CH_SCALE.abp);
          put(i, 1, f.lvp / CH_SCALE.lvp);
          put(i, 2, f.vbp / CH_SCALE.vbp);
          put(i, 3, f.hf / CH_SCALE.hf);
          put(i, 4, f.hr / CH_SCALE.hr);
        });
        const u8 = new Uint8Array(buf.buffer);
        let bin = "";
        for (let i = 0; i < u8.length; i += 32768) {
          bin += String.fromCharCode(...u8.subarray(i, i + 32768));
        }
        const payload = {
          format: "ratheart-autosave",
          version: 2,
          modelVersion: snapshot.modelVersion,
          savedAt: snapshot.savedAt,
          state: snapshot.state,
          events: snapshot.events,
          traceLen: n,
          traceB64: btoa(bin)
        };
        try {
          localStorage.setItem("ratheart-simpro-session-v1", JSON.stringify(payload));
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
let lanInfo = null;
let lastHintHtml = "";
function renderHint(hint, html) {
  if (lastHintHtml === html) return;
  lastHintHtml = html;
  hint.innerHTML = html;
  hint.querySelector("#ip-toggle")?.addEventListener("click", () => {
    hint.querySelector(".ip-alt")?.classList.toggle("hidden");
  });
  hint.querySelectorAll("code.copy-url").forEach((el) => {
    el.addEventListener("click", () => void copyText(el.textContent ?? ""));
  });
}
async function copyText(text) {
  const okMsg = "\u5730\u5740\u5DF2\u590D\u5236,\u7C98\u8D34\u5230\u540C\u5B66\u6D4F\u89C8\u5668\u5373\u53EF";
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
    return;
  } catch {
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
  }
  ta.remove();
  toast(ok ? okMsg : "\u81EA\u52A8\u590D\u5236\u5931\u8D25,\u8BF7\u624B\u52A8\u9009\u4E2D\u5730\u5740\u590D\u5236");
}
function updateBroadcastButton(followers, error = false) {
  const button = $("#broadcast-button");
  button.textContent = broadcasting ? error ? "\u5E7F\u64AD\u4E2D\u65AD\uFF08\u5DF2\u505C\u6B62\uFF09" : `\u505C\u6B62\u6388\u8BFE\u5E7F\u64AD \xB7 ${followers} \u4EBA\u8DDF\u968F` : "\u5F00\u59CB\u6388\u8BFE\u5E7F\u64AD";
  const hint = $("#broadcast-hint");
  if (!broadcasting || error) {
    hint.classList.add("hidden");
    lastHintHtml = "";
    return;
  }
  hint.classList.remove("hidden");
  if (!lanInfo) {
    hint.textContent = "\u6B63\u5728\u83B7\u53D6\u5C40\u57DF\u7F51\u5730\u5740\u2026";
    return;
  }
  if (!lanInfo.lan || !lanInfo.follow.length) {
    hint.textContent = "\u5F53\u524D\u672A\u5F00\u653E\u5C40\u57DF\u7F51\uFF1A\u8BF7\u5728\u6559\u5B66\u673A\u4EE5 npm start -- --lan \u91CD\u65B0\u542F\u52A8,\u540C\u5B66\u624D\u80FD\u8BBF\u95EE\u3002";
    return;
  }
  if (lanInfo.primaryFollow) {
    const info = lanInfo;
    const roomQS = broadcastRoom ? `?room=${broadcastRoom}` : "";
    const others = info.follow.filter((u) => u !== info.primaryFollow);
    const html = `\u540C\u5B66\u6D4F\u89C8\u5668\u6253\u5F00:<code class="copy-url" title="\u70B9\u51FB\u590D\u5236">${info.primaryFollow}${roomQS}</code>(\u540C\u4E00 Wi-Fi,\u5B9E\u65F6\u8DDF\u968F,\u70B9\u51FB\u5730\u5740\u53EF\u590D\u5236)` + (others.length ? ` <span class="ip-toggle" id="ip-toggle" title="\u5176\u4ED6\u53EF\u80FD\u7684\u5730\u5740">?</span><span class="ip-alt hidden">${others.map((u) => `<code class="copy-url" title="\u70B9\u51FB\u590D\u5236">${u}${roomQS}</code>`).join("\u3001")}</span>` : "");
    renderHint(hint, html);
  } else {
    const roomQS = broadcastRoom ? `?room=${broadcastRoom}` : "";
    const html = `\u540C\u5B66\u6D4F\u89C8\u5668\u6253\u5F00(\u591A\u9009\u4E00,\u4F18\u5148\u7B2C\u4E00\u4E2A):${lanInfo.follow.map((u) => `<code class="copy-url" title="\u70B9\u51FB\u590D\u5236">${u}${roomQS}</code>`).join("\u3001")}(\u540C\u4E00 Wi-Fi,\u5B9E\u65F6\u8DDF\u968F)`;
    renderHint(hint, html);
  }
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
  windowPoints = points === 0 ? 0 : Math.min(MAX_WINDOW_POINTS, Math.max(MIN_WINDOW_POINTS, points));
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
const DESKTOP_API_BASE = (() => {
  const p = new URLSearchParams(location.search).get("api") ?? "";
  return p ? `http://127.0.0.1:${p}` : "";
})();
const api = (p) => DESKTOP_API_BASE + p;
const callApi = async (path) => {
  if (IN_TAURI) {
    const inv = globalThis.__TAURI_INTERNALS__?.invoke;
    if (!inv) throw new Error("IPC \u4E0D\u53EF\u7528");
    const res = await inv("api_call", { method: "GET", path });
    return JSON.parse(res[1]);
  }
  return (await fetch(path, { cache: "no-store" })).json();
};
const BROADCAST_CAPABLE = location.protocol.startsWith("http") || location.protocol === "ratheart:" || IN_TAURI;
const broadcastButton = $("#broadcast-button");
let broadcastRoom = localStorage.getItem("ratheart-room") ?? "";
let broadcastToken = "";
function genRoom() {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => abc[b % abc.length]).join("");
}
function genToken() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
if (BROADCAST_CAPABLE) {
  broadcastButton.classList.remove("hidden");
  broadcastButton.textContent = "\u5F00\u59CB\u6388\u8BFE\u5E7F\u64AD";
  broadcastButton.addEventListener("click", () => {
    if (broadcasting) {
      send("broadcast-off", { base: DESKTOP_API_BASE, mode: IN_TAURI ? "ipc" : "http" });
    } else {
      if (!broadcastRoom) {
        broadcastRoom = genRoom();
        localStorage.setItem("ratheart-room", broadcastRoom);
      }
      broadcastToken = genToken();
      send("broadcast-on", { room: broadcastRoom, token: broadcastToken, base: DESKTOP_API_BASE, mode: IN_TAURI ? "ipc" : "http" });
    }
  });
  callApi("/api/lan").then((d) => {
    lanInfo = d;
    updateBroadcastButton(0);
  }).catch(() => {
  });
}
let lastSessionLive = false;
let liveBannerDismissed = false;
function pollLiveSession() {
  if (!BROADCAST_CAPABLE) return;
  callApi("/api/session").then((data) => {
    if (lastSessionLive === false && data.live) liveBannerDismissed = false;
    lastSessionLive = !!data.live;
    $("#live-banner").classList.toggle("hidden", !(data.live && !broadcasting && !liveBannerDismissed));
  }).catch(() => {
  });
}
$("#live-banner-close").addEventListener("click", () => {
  liveBannerDismissed = true;
  $("#live-banner").classList.add("hidden");
});
setInterval(pollLiveSession, 1e4);
pollLiveSession();
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
<p><strong>\u6559\u5B66\u5DE5\u5177</strong>\uFF1A\u300C\uFF0B\u5BF9\u6BD4\u300D\u628A\u5F53\u524D\u7A97\u53E3\u5B58\u4E3A\u534A\u900F\u660E\u53E0\u52A0\u66F2\u7EBF(\u7ED9\u836F\u524D\u540E\u5BF9\u7167);\u300C\u91CF\u6548\u66F2\u7EBF\u300D\u81EA\u52A8\u6C47\u603B\u5404\u5242\u91CF\u7684\u8840\u538B\u53CD\u5E94;\u300C\u6D4B\u91CF\u5DE5\u4F5C\u8868\u300D\u5149\u6807\u53D6\u6570\u586B\u8868\u5BFC\u51FA CSV\u3002\u53EF\u5728\u300C\u539F\u7406\u4E0E\u8BBE\u7F6E\u300D\u5F00\u542F\u6B7B\u4EA1\u540E\u66F2\u7EBF\u62C9\u5E73\u3002</p>
<p><strong>\u6559\u5B66\u63D0\u793A</strong>\uFF1A\u52A8\u8109\u538B\u957F\u65F6\u95F4\u4F4E\u4E8E 20 mmHg \u4F1A\u5BFC\u81F4\u5927\u9F20\u6B7B\u4EA1\uFF1B\u5927\u5242\u91CF\u5730\u9AD8\u8F9B\uFF08\u226510 mg/kg\uFF09\u4F1A\u8BF1\u53D1\u5FC3\u5BA4\u98A4\u52A8\uFF0C\u5FC3\u810F\u505C\u6B62\u5C04\u8840\u3002\u300C\u672A\u77E5\u836F\u300DA\u2013K \u4F9B\u76F2\u68C0\u7EC3\u4E60\u2014\u2014\u5148\u6D4B\u5176\u4F5C\u7528\uFF0C\u518D\u7528\u5DF2\u77E5\u836F\u7269\u9274\u522B\u3002</p>
<p><strong>\u6388\u8BFE\u5E7F\u64AD</strong>\uFF08\u4EC5\u7F51\u9875\u6A21\u5F0F\uFF09\uFF1A\u6559\u5B66\u673A\u4EE5 <code>npm start -- --lan</code> \u542F\u52A8\u540E\uFF0C\u70B9\u51FB\u300C\u5F00\u59CB\u6388\u8BFE\u5E7F\u64AD\u300D\uFF0C\u754C\u9762\u4F1A\u663E\u793A\u5C40\u57DF\u7F51\u5730\u5740\u2014\u2014\u540C\u5B66\u6D4F\u89C8\u5668\u6253\u5F00\u8BE5\u5730\u5740\u7684 <code>/follow.html</code>\uFF08\u6CE8\u610F\u4E0D\u662F\u4E3B\u9875\uFF09\uFF0C\u5373\u53EF\u5B9E\u65F6\u8DDF\u968F\u89C2\u770B\uFF1B\u5B66\u751F\u5C31\u7B97\u8BEF\u5F00\u4E3B\u9875\uFF0C\u4E5F\u4F1A\u770B\u5230\u300C\u8FDB\u5165\u8DDF\u968F\u9875\u300D\u7684\u63D0\u793A\u6A2A\u5E45\u3002\u505C\u6B62\u5E7F\u64AD\u540E\u8DDF\u968F\u9875\u56DE\u5230\u7B49\u5F85\u72B6\u6001\u3002</p>
`;
let settingsHtml = "";
function renderSettingsDialog() {
  settingsHtml = `  <p><strong>\u6A21\u578B\u7ED3\u6784</strong>\uFF1A\u4E09\u5BA4\u96C6\u603B\u53C2\u6570\u6A21\u578B\uFF08\u5FC3\u810F\u3001\u52A8\u8109\u3001\u9759\u8109\uFF09+ \u4E24\u4E2A\u5355\u5411\u9600\u3002\u5FC3\u810F\u6536\u7F29\u5F39\u6027\u4E3A\u9AD8\u65AF\u8109\u51B2\uFF0C\u79EF\u5206\u6B65\u957F 0.125 ms\uFF0C\u6BCF 12.5 ms \u8F93\u51FA\u4E00\u4E2A\u663E\u793A\u70B9\uFF082 \u4E2A\u5B50\u6837\u672C\uFF09\uFF1B\u53D7\u4F53\u6FC0\u6D3B\u4E0E\u8840\u836F\u52A8\u529B\u5B66\u6BCF 5 ms \u66F4\u65B0\u3002</p>
  <p><strong>\u53D7\u4F53\u65B9\u7A0B</strong>\uFF08\u7ADE\u4E89\u6027\u5360\u9886\uFF09\uFF1A\u6FC0\u6D3B\u91CF = \u03A3(\u6548\u80FD\u1D62\xB7x\u1D62)/(1+\u03A3x\u1D62)\uFF0C\u5176\u4E2D x\u1D62 = \u5242\u91CF\u1D62/(\u6548\u529B\u1D62\xD7 potencyShift)\uFF1B\u62EE\u6297\u836F\u6548\u80FD 0\u3002PDE \u6291\u5236\u4F7F \u03B2 \u6548\u529B shift = 1 \u2212 PDE\xD70.5\u3002</p>
  <p><strong>\u8840\u836F\u52A8\u529B\u5B66</strong>\uFF1AdDose/dt = k_on\xB7(Injected\u2212Dose) \u2212 k_off\xB7Dose\uFF1B\u6CE8\u5C04\u5242\u91CF\u5E26 \xB110% \u968F\u673A\u6CE2\u52A8\uFF0C\u6548\u529B\u53C2\u6570\u5E26 \xB150% \u4E2A\u4F53\u5DEE\u5F02\uFF08\u4E0E\u539F\u7248\u4E00\u81F4\uFF09\u3002</p>
  <p><strong>\u538B\u529B\u611F\u53D7\u5668\u53CD\u5C04</strong>\uFF08\u4EC5\u6B63\u5E38\u5927\u9F20\uFF09\uFF1A\u8FF7\u8D70\u5F20\u529B = 5/(1+e^(\u2212(MAP\u2212130)/8))\uFF1B\u57FA\u7840\u4EA4\u611F\u5F20\u529B\u6052\u5B9A\u3002</p>
  <div class="setting-row"><div><strong>\u7ED9\u836F\u6CE2\u52A8\u4E0E\u8BB0\u5F55\u566A\u58F0</strong><small>\u5173\u95ED\u540E\u6548\u529B\u53C2\u6570\u53D6\u540D\u4E49\u503C\u3001\u6CE8\u5C04\u4E0E\u5FC3\u7387\u65E0\u968F\u673A\u6CE2\u52A8\uFF08\u7528\u4E8E\u7CBE\u786E\u590D\u73B0\u5B9E\u9A8C\uFF09</small></div><input id="noise-toggle" type="checkbox" ${state?.noise ? "checked" : ""}></div>
  <div class="setting-row"><div><strong>\u6B7B\u4EA1\u540E\u66F2\u7EBF\u62C9\u5E73</strong><small>\u9ED8\u8BA4\u4FDD\u6301\u539F\u7248\u5BA4\u98A4\u884C\u4E3A\uFF08\u6B7B\u4EA1\u540E\u5FC3\u6536\u7F29\u529B\u4ECD\u663E\u793A\u6742\u4E71\u6CE2\u52A8\uFF09\uFF1B\u5F00\u542F\u540E\u6B7B\u4EA1\u77AC\u95F4 LVP/HF/HR \u5168\u901A\u9053\u62C9\u5E73\uFF0C\u6559\u5B66\u4E0A\u66F4\u76F4\u89C2\uFF0C\u4F46\u504F\u79BB\u539F\u7248</small></div><input id="flatten-toggle" type="checkbox" ${state?.flattenAfterDeath ? "checked" : ""}></div>
  <div class="setting-row"><div><strong>\u968F\u673A\u79CD\u5B50</strong><small>\u4FEE\u6539\u540E\u70B9\u51FB\u300C\u5E94\u7528\u300D\u4EE5\u65B0\u79CD\u5B50\u91CD\u5EFA\u5B9E\u9A8C</small></div><input id="seed-input" class="seed-input" type="number" value="${state?.seed ?? 0}"></div>
  <button id="apply-settings" class="button primary" type="button">\u5E94\u7528\uFF08\u91CD\u5EFA\u5B9E\u9A8C\uFF09</button>
  <p class="model-note">\u6A21\u578B\u7248\u672C ${MODEL_VERSION} \xB7 \u79FB\u690D\u81EA RatCVS 3.3.7 (30.07.20) \xB7 \u539F\u7248 (c) J. Dempster, University of Strathclyde\u3002\u539F\u7248\u201C\u523A\u6FC0\u5FC3\u4EA4\u611F\u795E\u7ECF\u201D\u56E0 iSympHeart \u672A\u8D4B\u503C\u5B9E\u9645\u6CE8\u5165\u80BE\u4E0A\u817A\u7D20\uFF0C\u672C\u7248\u6309\u539F\u7248\u884C\u4E3A\u590D\u523B\u3002</p>`;
  openDialog("\u539F\u7406\u4E0E\u8BBE\u7F6E", settingsHtml);
  $("#noise-toggle").addEventListener("change", (event) => send("noise", { value: event.target.checked }));
  $("#flatten-toggle").addEventListener("change", (event) => send("flatten", { value: event.target.checked }));
  $("#apply-settings").addEventListener("click", () => {
    const seed = Number($("#seed-input").value) >>> 0;
    if (!confirm("\u4EE5\u65B0\u79CD\u5B50\u91CD\u5EFA\u5B9E\u9A8C\uFF1F\u5F53\u524D\u8BB0\u5F55\u5C06\u88AB\u6E05\u9664\u3002")) return;
    send("reset", { pithed: state?.pithed ?? true, seed, noise: state?.noise ?? true });
    dialog.close();
  });
}
function parseDose(text) {
  const m = text.match(/([A-Za-z0-9]+) ([\d.]+) (ug|mg)\/kg/);
  if (!m) return null;
  return { short: m[1], mgkg: Number(m[2]) * (m[3] === "ug" ? 1e-3 : 1) };
}
function computeDoseResponse() {
  const doseEvents = events.filter((e) => e.kind === "dose" && parseDose(e.text));
  const rows = [];
  doseEvents.forEach((ev, i) => {
    const parsed = parseDose(ev.text);
    const nextT = doseEvents[i + 1]?.t ?? frames.at(-1)?.t ?? ev.t;
    const winPre = frames.filter((f) => f.t >= ev.t - 3 && f.t <= ev.t);
    const winPost = frames.filter((f) => f.t >= ev.t + 3 && f.t <= Math.min(nextT, ev.t + 20));
    if (!winPre.length || !winPost.length) return;
    const mean = (arr, k) => arr.reduce((a, f) => a + f[k], 0) / arr.length;
    const pre = mean(winPre, "abp");
    const post = mean(winPost, "abp");
    rows.push({
      drug: parsed.short,
      dose: parsed.mgkg,
      t: ev.t,
      pre: Math.round(pre * 10) / 10,
      post: Math.round(post * 10) / 10,
      peak: Math.round(Math.max(...winPost.map((f) => f.abp)) * 10) / 10,
      dAbp: Math.round((post - pre) * 10) / 10,
      hrPre: Math.round(mean(winPre, "hr")),
      hrPost: Math.round(mean(winPost, "hr"))
    });
  });
  return rows;
}
$("#dose-tool-button")?.addEventListener("click", () => {
  const rows = computeDoseResponse();
  const fmtDose = (mg) => mg < 1 ? `${+(mg * 1e3).toFixed(1)} \xB5g/kg` : `${mg} mg/kg`;
  const table = rows.map((r) => `<tr><td>${r.drug}</td><td class="num">${fmtDose(r.dose)}</td><td class="num">${r.pre}</td><td class="num">${r.post}</td><td class="num">${r.peak}</td><td class="num">${r.dAbp > 0 ? "+" : ""}${r.dAbp}</td><td class="num">${r.hrPre}\u2192${r.hrPost}</td></tr>`).join("");
  openDialog("\u91CF\u6548\u66F2\u7EBF", `
    <p>\u6309\u7ED9\u836F\u4E8B\u4EF6\u81EA\u52A8\u8BA1\u7B97:\u7ED9\u836F\u524D 3 s \u5747\u503C \u2192 \u7ED9\u836F\u540E 3~20 s \u5747\u503C/\u5CF0\u503C(\u0394ABP = \u540E-\u524D)\u3002\u540C\u4E00\u5242\u91CF\u591A\u6B21\u7ED9\u836F\u9010\u884C\u5217\u51FA\u3002</p>
    <table class="work-table"><thead><tr><th>\u836F\u7269</th><th>\u5242\u91CF</th><th>\u7ED9\u836F\u524D ABP</th><th>\u7ED9\u836F\u540E ABP</th><th>\u5CF0\u503C</th><th>\u0394ABP</th><th>HR \u524D\u2192\u540E</th></tr></thead><tbody>${rows.map((r) => r).length ? table : '<tr><td colspan="7">\u672C\u6B21\u5B9E\u9A8C\u5C1A\u65E0\u7ED9\u836F\u8BB0\u5F55</td></tr>'}</tbody></table>
    <div class="dose-plot-wrap"><canvas id="dose-canvas" width="720" height="260"></canvas></div>
    <p class="micro-note">\u6A2A\u8F74\u4E3A\u5BF9\u6570\u5242\u91CF,\u7EB5\u8F74\u4E3A \u0394ABP;\u6563\u70B9\u6765\u81EA\u4E0A\u8868\u3002\u5242\u91CF\u76F8\u540C\u89C6\u4E3A\u91CD\u590D\u70B9\u3002</p>
    <button id="dose-csv-button" class="button secondary" type="button">\u5BFC\u51FA\u91CF\u6548\u6570\u636E CSV</button>`);
  const cv = document.querySelector("#dose-canvas");
  if (cv && rows.length) {
    const c2 = cv.getContext("2d");
    c2.fillStyle = "#fff";
    c2.fillRect(0, 0, 720, 260);
    const usable = rows.filter((r) => r.dose > 0);
    const logMin = Math.log10(Math.min(...usable.map((r) => r.dose))) - 0.2;
    const logMax = Math.log10(Math.max(...usable.map((r) => r.dose))) + 0.2;
    const ys = rows.map((r) => r.dAbp);
    const yMin = Math.min(...ys, -5), yMax = Math.max(...ys, 5);
    const X = (d) => 50 + (Math.log10(d) - logMin) / (logMax - logMin) * 650;
    const Y = (v) => 230 - (v - yMin) / (yMax - yMin) * 200;
    c2.strokeStyle = "#aab3bc";
    c2.beginPath();
    c2.moveTo(40, Y(0));
    c2.lineTo(710, Y(0));
    c2.stroke();
    c2.fillStyle = "#606970";
    c2.font = "10px Consolas";
    c2.textAlign = "center";
    for (const r of usable) {
      const x = X(r.dose);
      c2.strokeStyle = "#e7eaee";
      c2.beginPath();
      c2.moveTo(x, 20);
      c2.lineTo(x, 235);
      c2.stroke();
      c2.fillText(fmtDose(r.dose).replace(" \xB5g/kg", "\xB5g").replace(" mg/kg", "mg"), x, 246);
    }
    for (const r of rows) if (r.dose > 0) {
      c2.fillStyle = "#b03a2e";
      c2.beginPath();
      c2.arc(X(r.dose), Y(r.dAbp), 5, 0, Math.PI * 2);
      c2.fill();
    }
    c2.fillStyle = "#606970";
    c2.textAlign = "left";
    c2.fillText("\u0394ABP mmHg", 8, 16);
  }
  document.querySelector("#dose-csv-button")?.addEventListener("click", () => {
    const csv = [
      "\u836F\u7269,\u5242\u91CF_mg/kg,\u7ED9\u836F\u524DABP,\u7ED9\u836F\u540EABP,\u5CF0\u503C,\u0394ABP,HR\u524D,HR\u540E",
      ...rows.map((r) => `${r.drug},${r.dose},${r.pre},${r.post},${r.peak},${r.dAbp},${r.hrPre},${r.hrPost}`)
    ].join("\r\n");
    download(new Blob(["\uFEFF" + csv], { type: "text/csv" }), filename("dose.csv"));
  });
});
let workRows = [];
function renderWorksheet() {
  const table = workRows.map((r, i) => `<tr><td>${i + 1}</td><td class="num">${r.t.toFixed(2)}</td><td class="num">${r.abp.toFixed(1)}</td><td class="num">${r.lvp.toFixed(1)}</td><td class="num">${r.vbp.toFixed(1)}</td><td class="num">${r.hf.toFixed(1)}</td><td class="num">${r.hr.toFixed(0)}</td></tr>`).join("");
  return void table;
}
$("#worksheet-button")?.addEventListener("click", () => {
  openDialog("\u6D4B\u91CF\u5DE5\u4F5C\u8868", `
    <p>\u70B9\u51FB\u66F2\u7EBF\u653E\u7F6E\u7EFF\u8272\u5149\u6807,\u518D\u70B9\u300C\u52A0\u5165\u5149\u6807\u8BFB\u6570\u300D\u9010\u884C\u8BB0\u5F55;\u5BFC\u51FA CSV \u4EA4\u4F5C\u4E1A\u6216\u4F5C\u56FE\u3002</p>
    <table class="work-table"><thead><tr><th>#</th><th>\u65F6\u95F4 s</th><th>ABP</th><th>LVP</th><th>VBP</th><th>HF</th><th>HR</th></tr></thead><tbody id="work-body">${workRows.map((r, i) => `<tr><td>${i + 1}</td><td class="num">${r.t.toFixed(2)}</td><td class="num">${r.abp.toFixed(1)}</td><td class="num">${r.lvp.toFixed(1)}</td><td class="num">${r.vbp.toFixed(1)}</td><td class="num">${r.hf.toFixed(1)}</td><td class="num">${r.hr.toFixed(0)}</td></tr>`).join("") || '<tr><td colspan="7">\u6682\u65E0\u8BB0\u5F55</td></tr>'}</tbody></table>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button id="work-add" class="button secondary" type="button">\u52A0\u5165\u5149\u6807\u8BFB\u6570</button>
      <button id="work-clear" class="button ghost" type="button">\u6E05\u7A7A</button>
      <button id="work-csv" class="button primary" type="button">\u5BFC\u51FA CSV</button>
    </div>`);
  const refresh = () => {
    document.querySelector("#work-body").innerHTML = workRows.map((r, i) => `<tr><td>${i + 1}</td><td class="num">${r.t.toFixed(2)}</td><td class="num">${r.abp.toFixed(1)}</td><td class="num">${r.lvp.toFixed(1)}</td><td class="num">${r.vbp.toFixed(1)}</td><td class="num">${r.hf.toFixed(1)}</td><td class="num">${r.hr.toFixed(0)}</td></tr>`).join("");
  };
  document.querySelector("#work-add")?.addEventListener("click", () => {
    const t = cursorTime ?? frames.at(-1)?.t;
    if (t === void 0) {
      toast("\u8BF7\u5148\u70B9\u51FB\u66F2\u7EBF\u653E\u7F6E\u6D4B\u91CF\u5149\u6807");
      return;
    }
    const f = frameAtTime(t);
    if (f) {
      workRows.push(f);
      refresh();
    }
  });
  document.querySelector("#work-clear")?.addEventListener("click", () => {
    workRows = [];
    refresh();
  });
  document.querySelector("#work-csv")?.addEventListener("click", () => {
    if (!workRows.length) {
      toast("\u5DE5\u4F5C\u8868\u4E3A\u7A7A");
      return;
    }
    const csv = [
      "\u5E8F\u53F7,\u65F6\u95F4_s,ABP_mmHg,LVP_mmHg,VBP_mmHg,HF,HR_bpm",
      ...workRows.map((r, i) => `${i + 1},${r.t.toFixed(2)},${r.abp.toFixed(1)},${r.lvp.toFixed(1)},${r.vbp.toFixed(1)},${r.hf.toFixed(1)},${r.hr.toFixed(0)}`)
    ].join("\r\n");
    download(new Blob(["\uFEFF" + csv], { type: "text/csv" }), filename("worksheet.csv"));
  });
});
setInterval(() => {
  if (state && state.points > 0) send("snapshot", { purpose: "autosave" });
}, 2e4);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && state && state.points > 0) send("snapshot", { purpose: "autosave" });
});
function decodeAutosave(data) {
  try {
    if (data.format !== "ratheart-autosave" || data.version !== 2) return null;
    const bin = atob(data.traceB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const buf = new Int16Array(bytes.buffer);
    const n = Math.min(data.traceLen, buf.length / 5 | 0);
    const t0 = (data.state.points - n) * SAMPLE_DT;
    const trace = [];
    for (let i = 0; i < n; i++) {
      trace.push({
        t: t0 + i * SAMPLE_DT,
        abp: buf[i * 5] * CH_SCALE.abp,
        lvp: buf[i * 5 + 1] * CH_SCALE.lvp,
        vbp: buf[i * 5 + 2] * CH_SCALE.vbp,
        hf: buf[i * 5 + 3] * CH_SCALE.hf,
        hr: buf[i * 5 + 4] * CH_SCALE.hr
      });
    }
    return {
      format: "ratheart-simpro",
      version: 1,
      modelVersion: data.modelVersion,
      savedAt: data.savedAt,
      state: data.state,
      trace,
      events: data.events ?? []
    };
  } catch {
    return null;
  }
}
(function restoreAutosave() {
  const saved = localStorage.getItem("ratheart-simpro-session-v1");
  if (!saved) return;
  try {
    const data = JSON.parse(saved);
    let snapshot;
    if (data.format === "ratheart-autosave") {
      const decoded = decodeAutosave(data);
      if (!decoded) return;
      snapshot = decoded;
    } else {
      snapshot = data;
    }
    if (snapshot.format !== "ratheart-simpro" || snapshot.version !== 1) return;
    send("restore", { snapshot });
    toast(snapshot.state?.recorderStarted ? "\u5DF2\u6062\u590D\u4E0A\u6B21\u81EA\u52A8\u4FDD\u5B58\u7684\u5B9E\u9A8C\uFF08\u8BB0\u5F55\u5DF2\u5F00\u59CB\uFF1A\u52A8\u7269\u6A21\u578B\u5DF2\u9501\u5B9A\uFF0C\u70B9\u51FB\u300C\u65B0\u5EFA\u5B9E\u9A8C\u300D\u53EF\u91CD\u65B0\u5F00\u59CB\uFF09\u3002" : "\u5DF2\u6062\u590D\u4E0A\u6B21\u81EA\u52A8\u4FDD\u5B58\u7684\u5B9E\u9A8C\u3002");
  } catch {
  }
})();
populateDrugs();
send("init");
