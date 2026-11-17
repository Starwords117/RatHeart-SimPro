// ============================================================
// RatCVS Web 界面：五通道 Canvas 记录仪、给药/神经刺激操作、
// 文件交互（JSON/CSV/PNG/.rat）与授课广播。
// ============================================================

import { DRUGS, NERVE_PATHWAYS, drugById, doseList } from './catalog.js';
import type { DrugDefinition } from './catalog.js';
import { MODEL_VERSION, DEFAULT_WINDOW_POINTS, MIN_WINDOW_POINTS, MAX_WINDOW_POINTS, CH_SCALE, SAMPLE_DT } from './core.js';
import type { Frame, ExperimentEvent, SessionState, Snapshot } from './core.js';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const worker = new Worker(new URL('./simulation.worker.js', import.meta.url), { type: 'module' });
const canvas = $<HTMLCanvasElement>('#trace-canvas');
const context = canvas.getContext('2d')!;
const dialog = $<HTMLDialogElement>('#information-dialog');

let state: SessionState;
let frames: Frame[] = [], events: ExperimentEvent[] = [];
let activeDrugs: { id: string; name: string; short: string; dose: number; injected: number }[] = [];
let category: DrugDefinition['group'] = 'agonist';
let windowPoints = DEFAULT_WINDOW_POINTS;
let cursorTime: number | null = null;
let hoverTime: number | null = null;
let historyEnd: number | null = null;
let dirty = true;
let toastTimer: ReturnType<typeof setTimeout>;
let broadcasting = false;

const INK = '#202428', GRID = '#e7eaee', GRID_BASE = '#aab3bc', MUTED = '#606970';
const CHANNEL_COLORS: Record<string, string> = { abp: '#b03a2e', lvp: '#245e9c', vbp: '#2e8b74', hf: '#b06f2e', hr: '#3a7d44' };
const CHANNEL_LABELS: Record<string, string> = { abp: 'ABP 动脉血压 mmHg', lvp: 'LVP 左室内压 mmHg', vbp: 'VBP 静脉压 mmHg', hf: 'HF 心收缩力', hr: 'HR 心率 bpm' };
const CHANNEL_KEYS = ['abp', 'lvp', 'vbp', 'hf', 'hr'] as const;
const CHANNEL_DEFAULT_MAX: Record<string, number> = { abp: 220, lvp: 220, vbp: 20, hf: 20, hr: 400 };
const EVENT_COLORS: Record<string, string> = { dose: '#78818a', stimulus: '#8b7552', death: '#b03a2e', import: '#9aa4ad' };
let currentRange = { start: 0, end: DEFAULT_WINDOW_POINTS, left: 46, right: 12, top: 8, bottom: 30, width: 800, height: 420 };

// ---------------- 基础工具 ----------------

function send(type: string, data: Record<string, unknown> = {}): void { worker.postMessage({ type, ...data }); }

function toast(message: string): void {
  const el = $('#toast');
  el.textContent = message;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 3200);
}

// Tauri 桌面环境检测(WKWebView/WebKitGTK 不支持 a[download],Blob 下载会静默失败)
const IN_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function download(blob: Blob, name: string): void {
  if (IN_TAURI) {
    // Tauri 导出桥:转 base64 调 Rust 原生保存对话框(save_export 命令)
    void blob.arrayBuffer().then(async buf => {
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const invoke = (window as any).__TAURI_INTERNALS__?.invoke as ((cmd: string, args: unknown) => Promise<string>) | undefined;
      if (!invoke) { toast('桌面导出桥不可用'); return; }
      try {
        await invoke('save_export', { name, b64: btoa(bin) });
      } catch (err) {
        if (String(err) !== '已取消') toast(`导出失败:${err}`);
      }
    });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function filename(ext: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  return `RatHeart-SimPro_${stamp}.${ext}`;
}

function time(value: number, decimals = false): string {
  const m = Math.floor(value / 60);
  const s = value - m * 60;
  return decimals ? `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}` : `${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}`;
}

// ---------------- 给药面板 ----------------

function populateDrugs(): void {
  const select = $<HTMLSelectElement>('#drug-select');
  const list = DRUGS.filter(d => !d.hidden && d.group === category);
  select.innerHTML = '';
  for (const drug of list) {
    const option = document.createElement('option');
    option.value = drug.id;
    option.textContent = `${drug.name}（${drug.short}）`;
    select.appendChild(option);
  }
  updateDrug();
}

function updateDrug(): void {
  const drug = DRUGS.find(d => d.id === $<HTMLSelectElement>('#drug-select').value)!;
  $('#drug-english').textContent = drug.english;
  $('#drug-mechanism').textContent = drug.mechanism;
  const doseSelect = $<HTMLSelectElement>('#dose-select');
  doseSelect.innerHTML = '';
  for (const option of doseList(drug)) {
    const el = document.createElement('option');
    el.value = String(option.value);
    el.textContent = option.label;
    doseSelect.appendChild(el);
  }
  doseSelect.selectedIndex = 0;
}

function selectedDose(): number {
  return Number($<HTMLSelectElement>('#dose-select').value);
}

// ---------------- 状态渲染 ----------------

function renderState(): void {
  const s = state;
  $('#abp-value').innerHTML = `${s.art.meanP > 0 ? s.art.meanP.toFixed(1) : '–'}<small>mmHg</small>`;
  $('#hr-value').innerHTML = `${s.heart.rate > 1 ? Math.round(s.heart.rate) : '–'}<small>bpm</small>`;
  $('#time-value').textContent = time(s.time, true);
  $('#recording-status').textContent = s.dead ? '大鼠死亡' : s.historyOnly ? '历史记录回看' : s.running ? '记录中' : s.points > 0 ? '已暂停' : '实验就绪';
  $('#live-indicator').classList.toggle('running', s.running && !s.historyOnly);
  $('#chart-model').textContent = s.pithed ? '去脑大鼠' : '正常大鼠';
  const runLabel = $('#run-label');
  runLabel.textContent = s.running ? '暂停记录' : s.historyOnly ? '历史记录（只读）' : '开始记录';
  const modelRow = $('#model-radios');
  const modelLocked = s.recorderStarted || s.historyOnly;
  modelRow.classList.toggle('disabled', modelLocked);
  modelRow.title = modelLocked ? '动物模型已锁定：点击「新建实验」后可重新选择' : '开始记录后模型不可切换；点击「新建实验」后可重新选择';
  $('#model-note').textContent = modelLocked
    ? '动物模型已锁定（记录开始后不可切换，与原版一致）。点击「新建实验」开始新实验后可重新选择模型。'
    : '去脑大鼠无中枢神经反射，是标准药理筛选制备；正常大鼠保留压力感受器反馈与基础交感张力。开始记录后不可切换。';
  $<HTMLInputElement>('#radio-pithed').checked = s.pithed;
  $<HTMLInputElement>('#radio-normal').checked = !s.pithed;
  const latest = events.at(-1);
  if (latest) $('#last-operation').textContent = latest.text;
  renderHistory();
}

function renderHistory(): void {
  const wrap = $('#history-scroll');
  const slider = $<HTMLInputElement>('#history-position');
  if (frames.length > windowPoints) {
    wrap.classList.remove('hidden');
    slider.max = String(frames.length - 1);
    slider.value = String(historyEnd ?? frames.length - 1);
  } else {
    wrap.classList.add('hidden');
    historyEnd = null;
  }
}

function renderEvents(): void {
  const list = $('#event-list');
  list.innerHTML = '';
  $('#event-count').textContent = String(events.length);
  for (const event of events.slice(-60).reverse()) {
    const item = document.createElement('div');
    item.className = 'event-item';
    const color = EVENT_COLORS[event.kind] ?? '#78818a';
    item.innerHTML = `<span class="event-dot" style="background:${color}"></span><span class="event-time">${time(event.t, true)}</span><span class="event-text"></span>`;
    item.querySelector('.event-text')!.textContent = event.text;
    list.appendChild(item);
  }
}

// ---------------- 五通道记录仪绘制 ----------------

function drawChart(): void {
  const wrap = $('#plot-wrap');
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
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);

  const window = windowPoints > 0 ? windowPoints : frames.length;
  const end = historyEnd ?? frames.length;
  const start = Math.max(0, end - window);
  if (frames.length < 2 || end - start < 2) return;

  const left = 46, right = 12, top = 8, bottom = 30;
  const plotW = width - left - right, plotH = height - top - bottom;
  // 通道带之间留 14px 间隔,避免上一带底部刻度与下一带量程/标题重叠
  const bandGap = 18;
  const bandH = (plotH - bandGap * (CHANNEL_KEYS.length - 1)) / CHANNEL_KEYS.length;
  currentRange = { start, end, left, right, top, bottom, width, height };
  // 只读调试钩子:测试据此断言「全部记录」档确实绘制了整条曲线
  // (用 globalThis:本函数内有局部 const window=窗口样本数,会遮蔽全局 window)
  (globalThis as any).__chartRange = { start, end, frames: frames.length };
  const visibleCount = end - start;
  const stride = Math.max(1, Math.floor(visibleCount / (plotW * 2)));
  const ovDur = () => (frames[Math.min(end, frames.length) - 1]?.t ?? 0) - (frames[start]?.t ?? 0);

  // 事件标记（跨全部通道）
  context.save();
  context.beginPath();
  context.rect(left, top, plotW, plotH);
  context.clip();
  const tAt = (i: number) => frames[Math.min(frames.length - 1, Math.max(0, i))].t;
  const xAt = (t: number) => {
    const t0 = tAt(start), t1 = tAt(end - 1);
    return t1 > t0 ? left + ((t - t0) / (t1 - t0)) * plotW : left;
  };
  let labelRow = 0, lastLabelX = -1e9;
  // 图表只标注实验操作（给药/刺激/死亡/导入），状态类事件（新建、切换模型、设置）
  // 只进右侧实验记录面板，避免 t≈0 的事件在图上与通道名重叠
  const CHART_KINDS = new Set(['dose', 'stimulus', 'death', 'import']);
  for (const event of events) {
    if (!CHART_KINDS.has(event.kind)) continue;
    if (event.t < tAt(start) || event.t > tAt(end - 1)) continue;
    const x = xAt(event.t);
    context.strokeStyle = '#c6cdd3';
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(x, top); context.lineTo(x, top + plotH);
    context.stroke();
    context.setLineDash([]);
    if (x - lastLabelX > 72) {
      context.fillStyle = EVENT_COLORS[event.kind] ?? '#78818a';
      context.font = '11px Consolas, monospace';
      context.textAlign = 'left';
      context.fillText(event.text, Math.min(x + 3, width - right - 90), top + 15 + labelRow * 13);
      lastLabelX = x; labelRow = 1 - labelRow;
    }
  }
  context.restore();

  // 五个通道带
  CHANNEL_KEYS.forEach((key, ch) => {
    const bandTop = top + ch * (bandH + bandGap);
    let ymax = CHANNEL_DEFAULT_MAX[key];
    for (let i = start; i < end; i += stride) {
      const v = frames[i][key];
      if (v > ymax) ymax = v * 1.15;
    }
    // 对比叠加峰值纳入量程(网格/曲线/叠加共用同一标度)
    for (const ov of overlays) {
      for (const f of ov.frames) if (f[key] > ymax) ymax = f[key] * 1.15;
    }
    if (key === 'hr') ymax = Math.max(ymax, 400);
    const ymin = 0;
    const yOf = (v: number) => bandTop + bandH - ((v - ymin) / (ymax - ymin)) * bandH;

    // 网格与刻度:顶线(量程)与 0 轴基线加粗
    context.font = '10px Consolas, monospace';
    context.textAlign = 'right';
    for (let g = 0; g <= 4; g++) {
      const y = bandTop + (g / 4) * bandH;
      const isEdge = g === 0 || g === 4;
      context.strokeStyle = isEdge ? GRID_BASE : GRID;
      context.lineWidth = isEdge ? 1.6 : 1;
      context.beginPath();
      context.moveTo(left, y); context.lineTo(width - right, y);
      context.stroke();
      context.lineWidth = 1;
      const value = ymax - (g / 4) * (ymax - ymin);
      context.fillStyle = MUTED;
      context.fillText(Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(value % 1 === 0 ? 0 : 1), left - 4, y + 3);
    }

    // 通道名与当前值
    context.textAlign = 'left';
    context.fillStyle = MUTED;
    context.font = '10px "Microsoft YaHei", sans-serif';
    context.fillText(CHANNEL_LABELS[key], left + 6, bandTop + 12);
    const lastVisible = frames[Math.min(end, frames.length) - 1];
    if (lastVisible) {
      context.fillStyle = CHANNEL_COLORS[key];
      context.font = '11px Consolas, monospace';
      const value = lastVisible[key];
      context.fillText(value.toFixed(key === 'hr' || key === 'abp' ? 0 : 1), width - right - 38, bandTop + 12);
    }

    // 对比叠加:半透明 ghost,按捕获窗口宽度左对齐当前窗口
    if (overlays.length) {
      const dur = ovDur();
      if (dur > 0) {
        context.save();
        context.globalAlpha = 0.4;
        context.lineWidth = 1.2;
        for (const ov of overlays) {
          const yOfO = (v: number) => bandTop + bandH - ((v - ymin) / (ymax - ymin)) * bandH;
          context.strokeStyle = ov.color;
          context.beginPath();
          ov.frames.forEach((f, i) => {
            const x = left + (f.t / dur) * plotW;
            const y = yOfO(f[key]);
            if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
          });
          context.stroke();
        }
        context.globalAlpha = 1;
        context.lineWidth = 1;
        context.restore();
      }
    }

    // 波形（min/max 抽稀保留脉冲形状）
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
        if (v < min) { min = v; minI = j; }
        if (v > max) { max = v; maxI = j; }
      }
      const first = Math.min(minI, maxI), second = Math.max(minI, maxI);
      for (const idx of stride > 1 ? [first, second] : [i]) {
        const x = left + ((idx - start) / (visibleCount - 1)) * plotW;
        if (!pen) { context.moveTo(x, yOf(frames[idx][key])); pen = true; }
        else context.lineTo(x, yOf(frames[idx][key]));
      }
    }
    context.stroke();
    context.restore();
  });

  // 时间轴
  context.fillStyle = MUTED;
  context.font = '10px Consolas, monospace';
  context.textAlign = 'center';
  const t0 = frames[start].t, t1 = frames[end - 1].t;
  const ticks = width < 450 ? 4 : 6;
  for (let g = 0; g <= ticks; g++) {
    const x = left + (g / ticks) * plotW;
    const t = t0 + (g / ticks) * (t1 - t0);
    context.fillText(time(t), x, height - bottom + 14);
  }
  context.fillText('时间（生理）', width - right - 4, height - 6);
  context.textAlign = 'left';
  context.fillText('(s)', left - 30, height - 6);

  $('#plot-empty').classList.toggle('hidden', frames.length > 1);

  // 测量光标与悬停指示
  if (hoverTime !== null && hoverTime >= t0 && hoverTime <= t1) {
    const x = xAt(hoverTime);
    context.strokeStyle = '#9aa4ad';
    context.setLineDash([3, 3]);
    context.beginPath(); context.moveTo(x, top); context.lineTo(x, top + plotH); context.stroke();
    context.setLineDash([]);
  }
  if (cursorTime !== null && cursorTime >= t0 && cursorTime <= t1) {
    const x = xAt(cursorTime);
    context.strokeStyle = '#2f9e44';
    context.lineWidth = 1.4;
    context.beginPath(); context.moveTo(x, top); context.lineTo(x, top + plotH); context.stroke();
  }
}

function animate(): void { if (dirty) { drawChart(); dirty = false; } requestAnimationFrame(animate); }

// ---- 对比叠加:把当前显示窗口保存为快照,按窗口左对齐半透明重绘 ----
const OVERLAY_COLORS = ['#8b5cf6', '#d97706', '#0d9488', '#dc2626', '#65a30d'];
let overlays: { id: number; label: string; color: string; frames: Frame[] }[] = [];
let overlaySeq = 0;
$('#overlay-capture')?.addEventListener('click', () => {
  const { start, end } = currentRange;
  if (!frames.length || end - start < 10) { toast('暂无可截取的曲线'); return; }
  const slice = frames.slice(start, end);
  const stride = Math.max(1, Math.floor(slice.length / 2000));
  const cap: Frame[] = [];
  for (let i = 0; i < slice.length; i += stride) cap.push(slice[i]);
  overlaySeq += 1;
  const ov = { id: overlaySeq, label: `对比 ${overlaySeq}`, color: OVERLAY_COLORS[(overlaySeq - 1) % OVERLAY_COLORS.length], frames: cap.map(f => ({ ...f, t: f.t - slice[0].t })) };
  overlays.push(ov);
  renderOverlayChips();
  toast(`已保存「${ov.label}」——半透明叠加显示,可叠加多组对比给药前后`);
  dirty = true;
});
function renderOverlayChips(): void {
  const box = $('#overlay-chips');
  box.classList.toggle('hidden', overlays.length === 0);
  box.innerHTML = overlays.map(o => `<span class="overlay-chip" style="border-color:${o.color};color:${o.color}">${o.label} <button data-id="${o.id}" aria-label="移除">×</button></span>`).join('');
  box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    overlays = overlays.filter(o => o.id !== Number(b.dataset.id));
    renderOverlayChips();
    dirty = true;
  }));
}

new ResizeObserver(() => { dirty = true; }).observe($('#plot-wrap'));
requestAnimationFrame(animate);

// ---------------- 光标读数 ----------------

function frameAtTime(t: number): Frame | null {
  if (!frames.length) return null;
  // 二分查找最近的子样本
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1; else hi = mid;
  }
  const a = frames[lo], b = frames[Math.max(0, lo - 1)];
  return Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
}

function readoutText(frame: Frame): string {
  return `t ${frame.t.toFixed(2)} s · ABP ${frame.abp.toFixed(1)} · LVP ${frame.lvp.toFixed(1)} · VBP ${frame.vbp.toFixed(1)} · HF ${frame.hf.toFixed(1)} · HR ${frame.hr.toFixed(0)} bpm`;
}

const tooltip = $('#cursor-tooltip');
function pointerT(event: PointerEvent): number | null {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const { start, end, left, right, width } = currentRange;
  if (x < left - 4 || x > width - right + 4) return null;
  const t0 = frames[start]?.t, t1 = frames[Math.min(end, frames.length) - 1]?.t;
  if (t0 === undefined || t1 === undefined || t1 <= t0) return null;
  return t0 + ((x - left) / (width - left - right)) * (t1 - t0);
}

canvas.addEventListener('pointermove', (event) => {
  if (!frames.length) return;
  const t = pointerT(event);
  hoverTime = t;
  if (t === null) { tooltip.classList.add('hidden'); dirty = true; return; }
  const rect = canvas.getBoundingClientRect();
  const frame = frameAtTime(t);
  if (frame) {
    tooltip.textContent = readoutText(frame);
    tooltip.style.left = `${Math.min(event.clientX - rect.left + 12, rect.width - 250)}px`;
    tooltip.style.top = `${event.clientY - rect.top + 14}px`;
    tooltip.classList.remove('hidden');
  }
  dirty = true;
});
canvas.addEventListener('pointerdown', (event) => {
  const t = pointerT(event);
  if (t !== null) { cursorTime = t; const frame = frameAtTime(t); if (frame) $('#cursor-readout').textContent = readoutText(frame); }
  dirty = true;
});
canvas.addEventListener('pointerleave', () => { hoverTime = null; tooltip.classList.add('hidden'); dirty = true; });

// ---------------- Worker 消息 ----------------

worker.onmessage = (event: MessageEvent) => {
  const m = event.data;
  switch (m.type) {
    case 'update':
      state = m.state;
      activeDrugs = m.activeDrugs;
      if (m.replace) { frames = m.frames; events = m.events; historyEnd = null; cursorTime = null; }
      else { frames.push(...m.frames); events.push(...m.events); }
      renderState();
      if (m.frames.length || m.events.length || m.replace) renderEvents();
      dirty = true;
      break;
    case 'broadcast': {
      const was = broadcasting;
      broadcasting = m.on;
      updateBroadcastButton(m.followers ?? 0, m.error);
      if (m.error) toast(`广播启动失败:${m.detail ?? '网络或服务不可达'}`);
      if (!was && broadcasting && lanInfo?.primaryFollow) {
        toast(`授课广播已开启,同学浏览器访问:${lanInfo.primaryFollow}`);
      }
      break;
    }
    case 'snapshot': {
      const snapshot = m.snapshot as Snapshot;
      if (m.purpose === 'autosave') {
        // 自动保存:最近 96000 子样本(≈10 分钟)以 int16×5 通道 base64 紧凑编码
        // (与 .rat 同精度,时间由下标重建),体积约 1.3MB,Firefox/Safari 5MB 配额内
        const n = Math.min(snapshot.trace.length, 96000);
        const trace = snapshot.trace.slice(-n);
        const buf = new Int16Array(n * 5);
        const put = (i: number, j: number, v: number) => {
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
        let bin = '';
        for (let i = 0; i < u8.length; i += 0x8000) {
          bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        }
        const payload = {
          format: 'ratheart-autosave', version: 2, modelVersion: snapshot.modelVersion,
          savedAt: snapshot.savedAt, state: snapshot.state, events: snapshot.events,
          traceLen: n, traceB64: btoa(bin)
        };
        try { localStorage.setItem('ratheart-simpro-session-v1', JSON.stringify(payload)); } catch { /* 容量不足时忽略 */ }
      } else {
        download(new Blob([JSON.stringify(snapshot, null, 1)], { type: 'application/json' }), filename('json'));
      }
      break;
    }
    case 'csv': {
      const rows: string[] = ['时间_s,ABP_mmHg,LVP_mmHg,VBP_mmHg,HF,HR_bpm,事件'];
      const byTime = new Map<string, string[]>();
      for (const e of m.events as ExperimentEvent[]) {
        const key = e.t.toFixed(2);
        (byTime.get(key) ?? byTime.set(key, []).get(key)!).push(e.text);
      }
      for (const f of m.trace as Frame[]) {
        const key = f.t.toFixed(2);
        const texts = byTime.get(key);
        rows.push(`${key},${f.abp.toFixed(3)},${f.lvp.toFixed(3)},${f.vbp.toFixed(3)},${f.hf.toFixed(3)},${f.hr.toFixed(1)}${texts ? `,"${texts.join(' | ').replaceAll('"', '""')}"` : ''}`);
      }
      download(new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv' }), filename('csv'));
      break;
    }
    case 'rat':
      download(new Blob([m.buffer], { type: 'application/octet-stream' }), filename('rat'));
      break;
    case 'file-error':
      toast('文件读取失败：格式不正确或已损坏。');
      break;
  }
  dirty = true;
};

function roundFrame(f: Frame): Frame {
  return { t: Math.round(f.t * 1e5) / 1e5, abp: Math.round(f.abp * 1000) / 1000, lvp: Math.round(f.lvp * 1000) / 1000, vbp: Math.round(f.vbp * 1000) / 1000, hf: Math.round(f.hf * 1000) / 1000, hr: Math.round(f.hr * 100) / 100 };
}

// 教学机局域网地址(/api/lan 由 serve.mjs 提供;Electron/file 模式为 null)
let lanInfo: { lan: boolean; addresses: string[]; follow: string[]; primary?: string | null; primaryFollow?: string | null } | null = null;

function updateBroadcastButton(followers: number, error = false): void {
  const button = $<HTMLButtonElement>('#broadcast-button');
  button.textContent = broadcasting
    ? (error ? '广播中断（已停止）' : `停止授课广播 · ${followers} 人跟随`)
    : '开始授课广播';
  const hint = $('#broadcast-hint');
  if (!broadcasting || error) { hint.classList.add('hidden'); return; }
  hint.classList.remove('hidden');
  if (!lanInfo) { hint.textContent = '正在获取局域网地址…'; return; }
  if (!lanInfo.lan || !lanInfo.follow.length) {
    hint.textContent = '当前未开放局域网：请在教学机以 npm start -- --lan 重新启动,同学才能访问。';
    return;
  }
  if (lanInfo.primaryFollow) {
    // 路由探测成功:只展示主地址,备用地址收进 ⓘ 图标
    const info = lanInfo;
    const roomQS = broadcastRoom ? `?room=${broadcastRoom}` : '';
    const others = info.follow.filter(u => u !== info.primaryFollow);
    hint.innerHTML = `同学浏览器打开:<code>${info.primaryFollow}${roomQS}</code>(同一 Wi-Fi,实时跟随)`
      + (others.length ? ` <span class="ip-toggle" id="ip-toggle" title="其他可能的地址">?</span><span class="ip-alt hidden">${others.map(u => `<code>${u}${roomQS}</code>`).join('、')}</span>` : '');
    hint.querySelector('#ip-toggle')?.addEventListener('click', () => {
      hint.querySelector('.ip-alt')?.classList.toggle('hidden');
    });
  } else {
    // 探测失败(如教室无默认路由):多选一,优先第一个
    const roomQS = broadcastRoom ? `?room=${broadcastRoom}` : '';
    hint.innerHTML = `同学浏览器打开(多选一,优先第一个):${lanInfo.follow.map(u => `<code>${u}${roomQS}</code>`).join('、')}(同一 Wi-Fi,实时跟随)`;
  }
}

// ---------------- 操作接线 ----------------

$<HTMLSelectElement>('#drug-select').addEventListener('change', updateDrug);
for (const button of document.querySelectorAll<HTMLButtonElement>('.drug-categories button')) {
  button.addEventListener('click', () => {
    for (const b of document.querySelectorAll('.drug-categories button')) b.classList.remove('active');
    button.classList.add('active');
    category = button.dataset.group as DrugDefinition['group'];
    populateDrugs();
  });
}

$('#inject-button').addEventListener('click', () => {
  send('dose', { drugId: $<HTMLSelectElement>('#drug-select').value, dose: selectedDose() });
});

const nerveHint = $('#nerve-hint');
function updateNerveHint(): void {
  const pathway = document.querySelector<HTMLInputElement>('input[name="nerve-pathway"]:checked')!.value;
  nerveHint.textContent = NERVE_PATHWAYS.find(p => p.id === pathway)?.hint ?? '';
}
for (const radio of document.querySelectorAll('input[name="nerve-pathway"]')) {
  radio.addEventListener('change', updateNerveHint);
}
updateNerveHint();

$('#stimulate-button').addEventListener('click', () => {
  const pathway = document.querySelector<HTMLInputElement>('input[name="nerve-pathway"]:checked')!.value;
  send('stimulate', { pathway });
});

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="rat-model"]')) {
  radio.addEventListener('change', () => {
    // 锁定态下不再静默吞掉点击：给出解释并立即回弹选中态
    if (state && (state.recorderStarted || state.historyOnly)) {
      toast(state.historyOnly
        ? '导入的历史记录只读；点击「新建实验」后可重新选择动物模型。'
        : '动物模型已锁定：记录开始后不可切换（与原版一致）。点击「新建实验」开始新实验后可重新选择。');
      renderState();
      return;
    }
    // setPithed 期望「是否去脑大鼠」；radio 的 value='pithed' 对应 true
    send('model', { value: radio.value === 'pithed' });
  });
}

$('#new-experiment-button').addEventListener('click', () => {
  if (!confirm('新建实验！当前记录将被清除，确定吗？')) return;
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  send('reset', { pithed: state?.pithed ?? true, seed });
});

$('#run-button').addEventListener('click', () => {
  if (state.historyOnly) { toast('导入的历史记录只读，请新建实验后开始记录。'); return; }
  send(state.running ? 'pause' : 'run');
});

$('#advance-button').addEventListener('click', () => send('advance', { seconds: 30 }));
$<HTMLSelectElement>('#speed-select').addEventListener('change', (event) => send('speed', { value: Number((event.target as HTMLSelectElement).value) }));

function setWindow(points: number): void {
  // 0 = 全部记录（哨兵值），其余为子样本数；钳在 1.5 s ~ 96 s
  windowPoints = points === 0 ? 0 : Math.min(MAX_WINDOW_POINTS, Math.max(MIN_WINDOW_POINTS, points));
  const select = $<HTMLSelectElement>('#window-select');
  if (windowPoints > 0) {
    const match = Array.from(select.options).find(o => Number(o.value) === windowPoints);
    if (!match) {
      const option = document.createElement('option');
      option.value = String(windowPoints);
      option.textContent = `${(windowPoints * 0.00625).toFixed(1).replace(/\.0$/, '')} s`;
      select.appendChild(option);
    }
  }
  select.value = String(windowPoints);
  renderHistory();
  dirty = true;
}
$<HTMLSelectElement>('#window-select').addEventListener('change', (event) => setWindow(Number((event.target as HTMLSelectElement).value)));
$('#window-double').addEventListener('click', () => setWindow(windowPoints === 0 ? 0 : Math.round(windowPoints * 2)));
$('#window-half').addEventListener('click', () => setWindow(windowPoints === 0 ? 0 : Math.round(windowPoints / 2)));

$<HTMLInputElement>('#history-position').addEventListener('input', (event) => {
  historyEnd = Number((event.target as HTMLInputElement).value);
  dirty = true;
});
$('#latest-button').addEventListener('click', () => { historyEnd = null; renderHistory(); dirty = true; });

// ---- 文件 ----
$('#load-button').addEventListener('click', () => $<HTMLInputElement>('#file-input').click());
$<HTMLInputElement>('#file-input').addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.name.toLowerCase().endsWith('.json')) {
    try {
      const snapshot = JSON.parse(await file.text());
      if (snapshot.format !== 'ratheart-simpro' || snapshot.version !== 1) throw new Error('format');
      send('restore', { snapshot });
    } catch { toast('实验文件格式不正确。'); }
  } else {
    const buffer = await file.arrayBuffer();
    worker.postMessage({ type: 'rat', buffer }, [buffer]);
  }
});
$('#save-button').addEventListener('click', () => send('snapshot', { purpose: 'download' }));
$('#csv-button').addEventListener('click', () => send('csv'));
$('#png-button').addEventListener('click', () => canvas.toBlob(blob => blob && download(blob, filename('png')), 'image/png'));
$('#rat-button').addEventListener('click', () => send('rat-export'));
$('#concentration-button').addEventListener('click', () => {
  const rows = activeDrugs.map(d => `<tr><td>${d.name}（${d.short}）</td><td>血药 ${d.dose.toExponential(2)} mg/kg</td><td>注射残余 ${d.injected.toExponential(2)}</td></tr>`).join('');
  openDialog('循环药物浓度', `<p>当前循环中的药物（剂量单位 mg/kg，血药浓度按一阶动力学衰减）：</p><table class="drug-table"><thead><tr><th>药物</th><th>血药浓度</th><th>注射 compartment 残余</th></tr></thead><tbody>${rows || '<tr><td colspan="3">无</td></tr>'}</tbody></table>`);
});

// ---- 广播 ----
// web(http/https)与桌面版(Electron ratheart:// / Tauri,内嵌广播服务器)均支持;
// 桌面版 API 直连 http://127.0.0.1:<端口>(主进程经 ?api= 传入),
// 避免自定义协议代理在 worker POST 上的不确定性
const DESKTOP_API_BASE = (() => {
  const p = new URLSearchParams(location.search).get('api');
  return p ? `http://127.0.0.1:${p}` : '';
})();
const api = (p: string) => DESKTOP_API_BASE + p;
// Tauri:Linux/macOS 源为 tauri://,Windows 为 http://tauri.localhost(被 startsWith('http') 命中);
// __TAURI_INTERNALS__ 判定对三平台一致
const BROADCAST_CAPABLE = location.protocol.startsWith('http') || location.protocol === 'ratheart:' || IN_TAURI;
const broadcastButton = $<HTMLButtonElement>('#broadcast-button');
// 房间隔离:每位教师一个房间(学生跟随链接携带 ?room=);token 为教师令牌,
// 推送/停止时携带,学生只读无法伪造广播
let broadcastRoom = localStorage.getItem('ratheart-room') ?? '';
let broadcastToken = '';
function genRoom(): string {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(6))].map(b => abc[b % abc.length]).join('');
}
function genToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
}
if (BROADCAST_CAPABLE) {
  broadcastButton.classList.remove('hidden');
  broadcastButton.textContent = '开始授课广播';
  broadcastButton.addEventListener('click', () => {
    if (broadcasting) {
      // worker 会携带 room+token+base 通知服务器清空房间会话
      send('broadcast-off', { base: DESKTOP_API_BASE });
    } else {
      if (!broadcastRoom) {
        broadcastRoom = genRoom();
        localStorage.setItem('ratheart-room', broadcastRoom);
      }
      broadcastToken = genToken();
      send('broadcast-on', { room: broadcastRoom, token: broadcastToken, base: DESKTOP_API_BASE });
    }
  });
  // 获取教学机局域网地址,开启广播后提示同学访问地址
  fetch(api('/api/lan'), { cache: 'no-store' })
    .then(r => r.json())
    .then(d => { lanInfo = d; updateBroadcastButton(0); })
    .catch(() => { /* Electron/file 模式无此接口 */ });
}

// ---- 主页直播横幅:检测到授课广播进行时,引导开错页面的同学进入跟随页 ----
let lastSessionLive = false;
let liveBannerDismissed = false;
function pollLiveSession(): void {
  if (!BROADCAST_CAPABLE) return;
  fetch(api('/api/session'), { cache: 'no-store' })
    .then(r => r.json())
    .then(data => {
      if (lastSessionLive === false && data.live) liveBannerDismissed = false;
      lastSessionLive = !!data.live;
      $('#live-banner').classList.toggle('hidden', !(data.live && !broadcasting && !liveBannerDismissed));
    })
    .catch(() => { /* Electron/file 模式无此接口 */ });
}
$('#live-banner-close').addEventListener('click', () => {
  liveBannerDismissed = true;
  $('#live-banner').classList.add('hidden');
});
setInterval(pollLiveSession, 10000);
pollLiveSession();

// ---- 对话框 ----
function openDialog(title: string, content: string): void {
  $('#dialog-title').textContent = title;
  $('#dialog-content').innerHTML = content;
  dialog.showModal();
}
$('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
$('#help-button').addEventListener('click', () => openDialog('使用说明', HELP_HTML));
$('#model-button').addEventListener('click', renderSettingsDialog);

const HELP_HTML = `
<p><strong>实验流程（对应原版 RatCVS User Guide）</strong></p>
<ol>
  <li>在「动物模型」选择<strong>去脑大鼠</strong>（无神经反射，标准制备）或<strong>正常大鼠</strong>（保留压力感受器反射与基础交感张力），点击「新建实验」。</li>
  <li>点击「开始记录」，图纸开始走动。</li>
  <li>在「给药注射」选择药物与剂量，点击「注射药物」——注射信息自动标注在曲线上。</li>
  <li>如需刺激神经，在「神经刺激」选择通路后点击「刺激神经」。</li>
  <li>重复注射可绘制<strong>量效曲线</strong>；先给拮抗药再给激动药可判别<strong>作用受体</strong>。</li>
  <li>点击曲线放置绿色测量光标，读取各通道数值；拖动「回看时间」滑块回看历史。</li>
  <li>「快进 30 s」可跳过药物起效等待（速度默认 0.25×，与原版走纸速度一致，可调高）。</li>
</ol>
<p><strong>五条通道</strong>：ABP 动脉血压、LVP 左心室内压、VBP 中心静脉压、HF 心收缩力、HR 心率。</p>
<p><strong>教学工具</strong>：「＋对比」把当前窗口存为半透明叠加曲线(给药前后对照);「量效曲线」自动汇总各剂量的血压反应;「测量工作表」光标取数填表导出 CSV。可在「原理与设置」开启死亡后曲线拉平。</p>
<p><strong>教学提示</strong>：动脉压长时间低于 20 mmHg 会导致大鼠死亡；大剂量地高辛（≥10 mg/kg）会诱发心室颤动，心脏停止射血。「未知药」A–K 供盲检练习——先测其作用，再用已知药物鉴别。</p>
<p><strong>授课广播</strong>（仅网页模式）：教学机以 <code>npm start -- --lan</code> 启动后，点击「开始授课广播」，界面会显示局域网地址——同学浏览器打开该地址的 <code>/follow.html</code>（注意不是主页），即可实时跟随观看；学生就算误开主页，也会看到「进入跟随页」的提示横幅。停止广播后跟随页回到等待状态。</p>
`;

let settingsHtml = '';
function renderSettingsDialog(): void {
  settingsHtml = `  <p><strong>模型结构</strong>：三室集总参数模型（心脏、动脉、静脉）+ 两个单向阀。心脏收缩弹性为高斯脉冲，积分步长 0.125 ms，每 12.5 ms 输出一个显示点（2 个子样本）；受体激活与血药动力学每 5 ms 更新。</p>
  <p><strong>受体方程</strong>（竞争性占领）：激活量 = Σ(效能ᵢ·xᵢ)/(1+Σxᵢ)，其中 xᵢ = 剂量ᵢ/(效力ᵢ× potencyShift)；拮抗药效能 0。PDE 抑制使 β 效力 shift = 1 − PDE×0.5。</p>
  <p><strong>血药动力学</strong>：dDose/dt = k_on·(Injected−Dose) − k_off·Dose；注射剂量带 ±10% 随机波动，效力参数带 ±50% 个体差异（与原版一致）。</p>
  <p><strong>压力感受器反射</strong>（仅正常大鼠）：迷走张力 = 5/(1+e^(−(MAP−130)/8))；基础交感张力恒定。</p>
  <div class="setting-row"><div><strong>给药波动与记录噪声</strong><small>关闭后效力参数取名义值、注射与心率无随机波动（用于精确复现实验）</small></div><input id="noise-toggle" type="checkbox" ${state?.noise ? 'checked' : ''}></div>
  <div class="setting-row"><div><strong>死亡后曲线拉平</strong><small>默认保持原版室颤行为（死亡后心收缩力仍显示杂乱波动）；开启后死亡瞬间 LVP/HF/HR 全通道拉平，教学上更直观，但偏离原版</small></div><input id="flatten-toggle" type="checkbox" ${state?.flattenAfterDeath ? 'checked' : ''}></div>
  <div class="setting-row"><div><strong>随机种子</strong><small>修改后点击「应用」以新种子重建实验</small></div><input id="seed-input" class="seed-input" type="number" value="${state?.seed ?? 0}"></div>
  <button id="apply-settings" class="button primary" type="button">应用（重建实验）</button>
  <p class="model-note">模型版本 ${MODEL_VERSION} · 移植自 RatCVS 3.3.7 (30.07.20) · 原版 (c) J. Dempster, University of Strathclyde。原版“刺激心交感神经”因 iSympHeart 未赋值实际注入肾上腺素，本版按原版行为复刻。</p>`;
  // 先注入 DOM,再给动态元素挂监听(否则查询为 null)
  openDialog('原理与设置', settingsHtml);
  $('#noise-toggle').addEventListener('change', (event) => send('noise', { value: (event.target as HTMLInputElement).checked }));
  $('#flatten-toggle').addEventListener('change', (event) => send('flatten', { value: (event.target as HTMLInputElement).checked }));
  $('#apply-settings').addEventListener('click', () => {
    const seed = Number($<HTMLInputElement>('#seed-input').value) >>> 0;
    if (!confirm('以新种子重建实验？当前记录将被清除。')) return;
    send('reset', { pithed: state?.pithed ?? true, seed, noise: state?.noise ?? true });
    dialog.close();
  });
}

// ---- 量效曲线:从给药事件解析剂量,自动计算给药前后反应 ----
function parseDose(text: string): { short: string; mgkg: number } | null {
  const m = text.match(/([A-Za-z0-9]+) ([\d.]+) (ug|mg)\/kg/);
  if (!m) return null;
  return { short: m[1], mgkg: Number(m[2]) * (m[3] === 'ug' ? 0.001 : 1) };
}
function computeDoseResponse(): { drug: string; dose: number; pre: number; post: number; peak: number; dAbp: number; hrPre: number; hrPost: number; t: number }[] {
  const doseEvents = events.filter(e => e.kind === 'dose' && parseDose(e.text));
  const rows: any[] = [];
  doseEvents.forEach((ev, i) => {
    const parsed = parseDose(ev.text)!;
    const nextT = doseEvents[i + 1]?.t ?? frames.at(-1)?.t ?? ev.t;
    const winPre = frames.filter(f => f.t >= ev.t - 3 && f.t <= ev.t);
    const winPost = frames.filter(f => f.t >= ev.t + 3 && f.t <= Math.min(nextT, ev.t + 20));
    if (!winPre.length || !winPost.length) return;
    const mean = (arr: Frame[], k: keyof Frame) => arr.reduce((a, f) => a + (f[k] as number), 0) / arr.length;
    const pre = mean(winPre, 'abp');
    const post = mean(winPost, 'abp');
    rows.push({
      drug: parsed.short, dose: parsed.mgkg, t: ev.t,
      pre: Math.round(pre * 10) / 10,
      post: Math.round(post * 10) / 10,
      peak: Math.round(Math.max(...winPost.map(f => f.abp)) * 10) / 10,
      dAbp: Math.round((post - pre) * 10) / 10,
      hrPre: Math.round(mean(winPre, 'hr')), hrPost: Math.round(mean(winPost, 'hr'))
    });
  });
  return rows;
}
$('#dose-tool-button')?.addEventListener('click', () => {
  const rows = computeDoseResponse();
  const fmtDose = (mg: number) => mg < 1 ? `${+(mg * 1000).toFixed(1)} µg/kg` : `${mg} mg/kg`;
  const table = rows.map(r => `<tr><td>${r.drug}</td><td class="num">${fmtDose(r.dose)}</td><td class="num">${r.pre}</td><td class="num">${r.post}</td><td class="num">${r.peak}</td><td class="num">${r.dAbp > 0 ? '+' : ''}${r.dAbp}</td><td class="num">${r.hrPre}→${r.hrPost}</td></tr>`).join('');
  openDialog('量效曲线', `
    <p>按给药事件自动计算:给药前 3 s 均值 → 给药后 3~20 s 均值/峰值(ΔABP = 后-前)。同一剂量多次给药逐行列出。</p>
    <table class="work-table"><thead><tr><th>药物</th><th>剂量</th><th>给药前 ABP</th><th>给药后 ABP</th><th>峰值</th><th>ΔABP</th><th>HR 前→后</th></tr></thead><tbody>${rows.map(r => r).length ? table : '<tr><td colspan="7">本次实验尚无给药记录</td></tr>'}</tbody></table>
    <div class="dose-plot-wrap"><canvas id="dose-canvas" width="720" height="260"></canvas></div>
    <p class="micro-note">横轴为对数剂量,纵轴为 ΔABP;散点来自上表。剂量相同视为重复点。</p>
    <button id="dose-csv-button" class="button secondary" type="button">导出量效数据 CSV</button>`);
  // 散点图
  const cv = document.querySelector<HTMLCanvasElement>('#dose-canvas');
  if (cv && rows.length) {
    const c2 = cv.getContext('2d')!;
    c2.fillStyle = '#fff'; c2.fillRect(0, 0, 720, 260);
    const usable = rows.filter(r => r.dose > 0);
    const logMin = Math.log10(Math.min(...usable.map(r => r.dose))) - 0.2;
    const logMax = Math.log10(Math.max(...usable.map(r => r.dose))) + 0.2;
    const ys = rows.map(r => r.dAbp);
    const yMin = Math.min(...ys, -5), yMax = Math.max(...ys, 5);
    const X = (d: number) => 50 + (Math.log10(d) - logMin) / (logMax - logMin) * 650;
    const Y = (v: number) => 230 - (v - yMin) / (yMax - yMin) * 200;
    c2.strokeStyle = '#aab3bc'; c2.beginPath(); c2.moveTo(40, Y(0)); c2.lineTo(710, Y(0)); c2.stroke();
    c2.fillStyle = '#606970'; c2.font = '10px Consolas'; c2.textAlign = 'center';
    for (const r of usable) { const x = X(r.dose); c2.strokeStyle = '#e7eaee'; c2.beginPath(); c2.moveTo(x, 20); c2.lineTo(x, 235); c2.stroke(); c2.fillText(fmtDose(r.dose).replace(' µg/kg', 'µg').replace(' mg/kg', 'mg'), x, 246); }
    for (const r of rows) if (r.dose > 0) { c2.fillStyle = '#b03a2e'; c2.beginPath(); c2.arc(X(r.dose), Y(r.dAbp), 5, 0, Math.PI * 2); c2.fill(); }
    c2.fillStyle = '#606970'; c2.textAlign = 'left'; c2.fillText('ΔABP mmHg', 8, 16);
  }
  document.querySelector<HTMLButtonElement>('#dose-csv-button')?.addEventListener('click', () => {
    const csv = ['药物,剂量_mg/kg,给药前ABP,给药后ABP,峰值,ΔABP,HR前,HR后',
      ...rows.map(r => `${r.drug},${r.dose},${r.pre},${r.post},${r.peak},${r.dAbp},${r.hrPre},${r.hrPost}`)].join('\r\n');
    download(new Blob(['\uFEFF' + csv], { type: 'text/csv' }), filename('dose.csv'));
  });
});

// ---- 测量工作表:光标取数 → 表格 → CSV ----
let workRows: { t: number; abp: number; lvp: number; vbp: number; hf: number; hr: number }[] = [];
function renderWorksheet(): void {
  const table = workRows.map((r, i) => `<tr><td>${i + 1}</td><td class="num">${r.t.toFixed(2)}</td><td class="num">${r.abp.toFixed(1)}</td><td class="num">${r.lvp.toFixed(1)}</td><td class="num">${r.vbp.toFixed(1)}</td><td class="num">${r.hf.toFixed(1)}</td><td class="num">${r.hr.toFixed(0)}</td></tr>`).join('');
  return void table; // 由打开对话框的函数拼装
}
$('#worksheet-button')?.addEventListener('click', () => {
  openDialog('测量工作表', `
    <p>点击曲线放置绿色光标,再点「加入光标读数」逐行记录;导出 CSV 交作业或作图。</p>
    <table class="work-table"><thead><tr><th>#</th><th>时间 s</th><th>ABP</th><th>LVP</th><th>VBP</th><th>HF</th><th>HR</th></tr></thead><tbody id="work-body">${workRows.map((r, i) => `<tr><td>${i + 1}</td><td class="num">${r.t.toFixed(2)}</td><td class="num">${r.abp.toFixed(1)}</td><td class="num">${r.lvp.toFixed(1)}</td><td class="num">${r.vbp.toFixed(1)}</td><td class="num">${r.hf.toFixed(1)}</td><td class="num">${r.hr.toFixed(0)}</td></tr>`).join('') || '<tr><td colspan="7">暂无记录</td></tr>'}</tbody></table>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button id="work-add" class="button secondary" type="button">加入光标读数</button>
      <button id="work-clear" class="button ghost" type="button">清空</button>
      <button id="work-csv" class="button primary" type="button">导出 CSV</button>
    </div>`);
  const refresh = () => {
    document.querySelector<HTMLTableSectionElement>('#work-body')!.innerHTML = workRows.map((r, i) => `<tr><td>${i + 1}</td><td class="num">${r.t.toFixed(2)}</td><td class="num">${r.abp.toFixed(1)}</td><td class="num">${r.lvp.toFixed(1)}</td><td class="num">${r.vbp.toFixed(1)}</td><td class="num">${r.hf.toFixed(1)}</td><td class="num">${r.hr.toFixed(0)}</td></tr>`).join('');
  };
  document.querySelector<HTMLButtonElement>('#work-add')?.addEventListener('click', () => {
    const t = cursorTime ?? frames.at(-1)?.t;
    if (t === undefined) { toast('请先点击曲线放置测量光标'); return; }
    const f = frameAtTime(t);
    if (f) { workRows.push(f); refresh(); }
  });
  document.querySelector<HTMLButtonElement>('#work-clear')?.addEventListener('click', () => { workRows = []; refresh(); });
  document.querySelector<HTMLButtonElement>('#work-csv')?.addEventListener('click', () => {
    if (!workRows.length) { toast('工作表为空'); return; }
    const csv = ['序号,时间_s,ABP_mmHg,LVP_mmHg,VBP_mmHg,HF,HR_bpm',
      ...workRows.map((r, i) => `${i + 1},${r.t.toFixed(2)},${r.abp.toFixed(1)},${r.lvp.toFixed(1)},${r.vbp.toFixed(1)},${r.hf.toFixed(1)},${r.hr.toFixed(0)}`)].join('\r\n');
    download(new Blob(['\uFEFF' + csv], { type: 'text/csv' }), filename('worksheet.csv'));
  });
});

// ---------------- 自动保存与恢复 ----------------

setInterval(() => { if (state && state.points > 0) send('snapshot', { purpose: 'autosave' }); }, 20000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state && state.points > 0) send('snapshot', { purpose: 'autosave' });
});

// 自动保存紧凑格式(ratheart-autosave v2)→ 完整快照:
// int16 值 × 标度还原物理量,时间由下标重建(波形时间恒为 i×SAMPLE_DT)
function decodeAutosave(data: any): Snapshot | null {
  try {
    if (data.format !== 'ratheart-autosave' || data.version !== 2) return null;
    const bin = atob(data.traceB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const buf = new Int16Array(bytes.buffer);
    const n = Math.min(data.traceLen, buf.length / 5 | 0);
    const t0 = (data.state.points - n) * SAMPLE_DT;
    const trace: Frame[] = [];
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
      format: 'ratheart-simpro', version: 1, modelVersion: data.modelVersion,
      savedAt: data.savedAt, state: data.state, trace, events: data.events ?? []
    };
  } catch { return null; }
}

(function restoreAutosave(): void {
  const saved = localStorage.getItem('ratheart-simpro-session-v1');
  if (!saved) return;
  try {
    const data = JSON.parse(saved);
    let snapshot: Snapshot;
    if (data.format === 'ratheart-autosave') {
      const decoded = decodeAutosave(data);
      if (!decoded) return;
      snapshot = decoded;
    } else {
      snapshot = data;
    }
    if (snapshot.format !== 'ratheart-simpro' || snapshot.version !== 1) return;
    send('restore', { snapshot });
    toast(snapshot.state?.recorderStarted
      ? '已恢复上次自动保存的实验（记录已开始：动物模型已锁定，点击「新建实验」可重新开始）。'
      : '已恢复上次自动保存的实验。');
  } catch { /* 忽略损坏的自动保存 */ }
})();

populateDrugs();
send('init');
