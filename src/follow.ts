/* 授课跟随页：增量拉取老师端的大鼠实验状态、五通道曲线与操作事件。
 * 不含本地仿真；HTTP 轮询比 SSE 更健壮（不受 Service Worker/代理影响）。 */

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const canvas = $<HTMLCanvasElement>('#trace-canvas');
const context = canvas.getContext('2d')!;
let state: any = null;
let frames: { t: number; abp: number; lvp: number; vbp: number; hf: number; hr: number }[] = [];
let events: any[] = [];
let dirty = true;
let lastRenderedEventCount = -1;

const CHANNEL_KEYS = ['abp', 'lvp', 'vbp', 'hf', 'hr'] as const;
const CHANNEL_COLORS: Record<string, string> = { abp: '#b03a2e', lvp: '#245e9c', vbp: '#2e8b74', hf: '#b06f2e', hr: '#3a7d44' };
const CHANNEL_LABELS: Record<string, string> = { abp: 'ABP', lvp: 'LVP', vbp: 'VBP', hf: 'HF', hr: 'HR' };
const CHANNEL_DEFAULT_MAX: Record<string, number> = { abp: 220, lvp: 220, vbp: 20, hf: 20, hr: 400 };
const EVENT_COLORS: Record<string, string> = { dose: '#78818a', stimulus: '#8b7552', death: '#b03a2e', import: '#9aa4ad' };

function time(value: number, decimals = false): string {
  const minutes = Math.floor(value / 60), seconds = Math.max(0, value % 60);
  return `${String(minutes).padStart(2, '0')}:${decimals ? seconds.toFixed(1).padStart(4, '0') : String(Math.floor(seconds)).padStart(2, '0')}`;
}
function setStatus(text: string, live: boolean): void {
  $('#follow-status').textContent = text;
  $('#follow-live').classList.toggle('running', live);
  $('#follow-live2').classList.toggle('running', live);
}
// 仿真时间本地走表:每次收到广播状态即重设基准,渲染 tick 间本地插值;
// 教师暂停(state.running=false)或广播停止(收到空状态)时冻结
let timeBase = 0, timeAt = 0, timeFrozen = true;
function renderHeader(): void {
  if (!state) return;
  $('#chart-model').textContent = state.pithed ? '去脑大鼠' : '正常大鼠';
  $('#abp-value').innerHTML = `${state.art?.meanP > 0 ? state.art.meanP.toFixed(1) : '–'}<small>mmHg</small>`;
  $('#hr-value').innerHTML = `${state.heart?.rate > 1 ? Math.round(state.heart.rate) : '–'}<small>bpm</small>`;
  const shown = timeFrozen || !state.running ? timeBase : timeBase + (performance.now() - timeAt) / 1000;
  $('#time-value').textContent = time(shown, true);
  $('#last-operation').textContent = events.at(-1)?.text ?? '—';
}
function renderEvents(): void {
  if (events.length === lastRenderedEventCount) return;
  lastRenderedEventCount = events.length;
  $('#event-count').textContent = String(events.length);
  $('#event-list').replaceChildren(...events.slice(-35).reverse().map(event => {
    const row = document.createElement('div'); row.className = 'event-item';
    const at = document.createElement('span'); at.className = 'event-time'; at.textContent = time(event.t);
    const dot = document.createElement('span'); dot.className = 'event-dot'; dot.style.background = EVENT_COLORS[event.kind] ?? '#78818a';
    const text = document.createElement('span'); text.className = 'event-text'; text.textContent = event.text;
    row.append(at, dot, text); return row;
  }));
}

function drawChart(): void {
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(box.width, 240), height = Math.max(box.height, 220);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  }
  const ctx = context; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
  // 遮罩开关在一切早退之前执行,保证状态始终正确
  $('#plot-empty').classList.toggle('hidden', frames.length > 1);
  if (frames.length < 2) return;
  // 按下标开窗(取最近 N 个子样本):服务器只保留最近 18000 帧,
  // 帧的 t 是绝对时间,不能再用 时间/采样间隔 反推下标
  const windowSamples = Number(($<HTMLSelectElement>('#window-select')).value);
  const end = Math.min(historyEnd ?? frames.length, frames.length);
  const start = windowSamples > 0 ? Math.max(0, end - windowSamples) : 0;
  if (end - start < 2) return;

  const left = width < 480 ? 42 : 46, right = 12, top = 8, bottom = 30;
  const pw = width - left - right, ph = height - top - bottom;
  const bandGap = 18;
  const bandH = (ph - bandGap * (CHANNEL_KEYS.length - 1)) / CHANNEL_KEYS.length;
  const stride = Math.max(1, Math.floor((end - start) / (pw * 2)));
  const t0 = frames[start].t, t1 = frames[end - 1].t;

  // 事件标记（只标注实验操作，与实验台一致；状态类事件不上图）
  const CHART_KINDS = new Set(['dose', 'stimulus', 'death', 'import']);
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, pw, ph); ctx.clip();
  let lastLabelX = -1e9, labelRow = 0;
  for (const event of events) {
    if (!CHART_KINDS.has(event.kind)) continue;
    if (event.t < t0 || event.t > t1) continue;
    const xx = left + (event.t - t0) / (t1 - t0) * pw;
    ctx.strokeStyle = '#c6cdd3'; ctx.lineWidth = .8; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(xx, top); ctx.lineTo(xx, top + ph); ctx.stroke(); ctx.setLineDash([]);
    if (xx - lastLabelX > 72) {
      ctx.fillStyle = EVENT_COLORS[event.kind] ?? '#78818a';
      ctx.textAlign = 'left'; ctx.font = '10px Consolas, monospace';
      ctx.fillText(event.text, xx + 3, top + 10 + labelRow * 12);
      lastLabelX = xx; labelRow = 1 - labelRow;
    }
  }
  ctx.restore();

  CHANNEL_KEYS.forEach((key, ch) => {
    const bandTop = top + ch * (bandH + bandGap);
    let ymax = CHANNEL_DEFAULT_MAX[key];
    for (let i = start; i < end; i += stride) if (frames[i][key] > ymax) ymax = frames[i][key] * 1.15;
    if (key === 'hr') ymax = Math.max(ymax, 400);
    const ymin = 0;
    const yOf = (v: number) => bandTop + bandH - ((v - ymin) / (ymax - ymin)) * bandH;
    ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'right';
    for (let g = 0; g <= 4; g++) {
      const yy = bandTop + (g / 4) * bandH;
      const isEdge = g === 0 || g === 4;
      ctx.strokeStyle = isEdge ? '#aab3bc' : '#e7eaee';
      ctx.lineWidth = isEdge ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(width - right, yy); ctx.stroke();
      ctx.lineWidth = 1;
      const value = ymax - (g / 4) * (ymax - ymin);
      ctx.fillStyle = '#626d77';
      ctx.fillText(value.toFixed(value % 1 === 0 || Math.abs(value) >= 100 ? 0 : 1), left - 4, yy + 3);
    }
    ctx.textAlign = 'left'; ctx.fillStyle = '#626d77'; ctx.font = '10px "Microsoft YaHei", sans-serif';
    ctx.fillText(`${CHANNEL_LABELS[key]}  ${key === 'hr' ? 'bpm' : key === 'hf' ? '' : 'mmHg'}`, left + 6, bandTop + 12);
    ctx.save(); ctx.beginPath(); ctx.rect(left, bandTop, pw, bandH); ctx.clip();
    ctx.strokeStyle = CHANNEL_COLORS[key]; ctx.lineWidth = 1.2; ctx.beginPath();
    let pen = false;
    for (let i = start; i < end; i += stride) {
      const stop = Math.min(end, i + stride);
      let minI = i, maxI = i;
      for (let j = i; j < stop; j++) { if (frames[j][key] < frames[minI][key]) minI = j; if (frames[j][key] > frames[maxI][key]) maxI = j; }
      const first = Math.min(minI, maxI), second = Math.max(minI, maxI);
      for (const idx of stride > 1 ? [first, second] : [i]) {
        const xx = left + ((idx - start) / (end - start - 1)) * pw;
        if (!pen) { ctx.moveTo(xx, yOf(frames[idx][key])); pen = true; } else ctx.lineTo(xx, yOf(frames[idx][key]));
      }
    }
    ctx.stroke(); ctx.restore();
  });

  ctx.fillStyle = '#626d77'; ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'center';
  const ticks = width < 450 ? 4 : 6;
  for (let g = 0; g <= ticks; g++) {
    const t = t0 + (g / ticks) * (t1 - t0);
    ctx.fillText(time(t), left + (g / ticks) * pw, height - bottom + 14);
  }
  $('#plot-empty').classList.toggle('hidden', frames.length > 1);
}

$('#window-select').addEventListener('change', () => { dirty = true; });
new ResizeObserver(() => { dirty = true; }).observe($('#plot-wrap'));

// 回看进度条:拖动查看整条曲线,「回到最新」恢复直播视图
let historyEnd: number | null = null;
const slider = $<HTMLInputElement>('#history-position');
slider.addEventListener('input', () => { historyEnd = Number(slider.value); dirty = true; });
$('#latest-button').addEventListener('click', () => { historyEnd = null; dirty = true; });
function renderHistorySlider(): void {
  const wrap = $('#history-scroll');
  const windowSamples = Number(($<HTMLSelectElement>('#window-select')).value);
  const show = frames.length > Math.max(windowSamples, 320);
  wrap.classList.toggle('hidden', !show);
  if (!show) { historyEnd = null; return; }
  if (document.activeElement !== slider) {
    slider.max = String(frames.length - 1);
    if (historyEnd === null) slider.value = slider.max;
  }
}

// 跟随页可能处于后台标签/低频渲染环境：用固定间隔驱动，不依赖 requestAnimationFrame
setInterval(() => {
  try {
    renderHistorySlider();
    if (dirty) { renderHeader(); renderEvents(); drawChart(); dirty = false; }
  } catch (error) {
    (window as any).__followError = String((error as Error)?.stack ?? error);
  }
}, 100);

function applyUpdate(reset: boolean, message: any): void {
  state = message.state ?? state;
  if (message.state) {
    // 广播状态到达即重设本地走表基准;教师暂停时不插值
    timeBase = message.state.time ?? timeBase;
    timeAt = performance.now();
    timeFrozen = !message.state.running;
  } else {
    timeFrozen = true;   // 广播停止:冻结在最后时刻
  }
  if (reset) { frames = message.frames ?? []; events = message.events ?? []; lastRenderedEventCount = -1; }
  else {
    if (message.frames?.length) frames.push(...message.frames);
    if (message.events?.length) events.push(...message.events);
  }
  dirty = true;
}

// HTTP 轮询：增量拉取老师端状态。
// 自适应间隔:跟随中 0.2 s(体感延迟 ≤0.3 s),等待开播/连接中断 1.5 s 减负
let seenSeq = -1, sentF = 0, sentE = 0, polling = false;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let pollIntervalMs = 1500;
function setPollInterval(ms: number): void {
  if (pollIntervalMs === ms) return;
  pollIntervalMs = ms;
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, ms);
}
async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const res = await fetch(`/api/poll?f=${sentF}&e=${sentE}&seq=${seenSeq}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    seenSeq = data.seq;
    applyUpdate(!!data.reset || !data.state, data);
    sentF = data.totalF; sentE = data.totalE;
    if (data.state) {
      // 教师端推送陈旧(>10s 未更新,如页面崩溃/网络中断)→ 判定中断并冻结走表
      const stale = Date.now() - (data.updatedAt ?? 0) > 10000;
      if (stale) timeFrozen = true;
      setStatus(stale ? '教师端连接已中断，等待恢复…' : '实时跟随老师端', !stale);
      setPollInterval(stale ? 1500 : 50);
    }
    else { setStatus('老师端尚未开始广播，等待中…', false); setPollInterval(1500); }
  } catch {
    setStatus('连接中断，自动重试中…', false);
  } finally {
    polling = false;
  }
}
pollTimer = setInterval(poll, pollIntervalMs);
poll();
