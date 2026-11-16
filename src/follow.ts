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
function renderHeader(): void {
  if (!state) return;
  $('#chart-model').textContent = state.pithed ? '去脑大鼠' : '正常大鼠';
  $('#abp-value').innerHTML = `${state.art?.meanP > 0 ? state.art.meanP.toFixed(1) : '–'}<small>mmHg</small>`;
  $('#hr-value').innerHTML = `${state.heart?.rate > 1 ? Math.round(state.heart.rate) : '–'}<small>bpm</small>`;
  $('#time-value').textContent = time(state.time ?? 0, true);
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
  if (frames.length < 2) return;
  const windowSeconds = Number(($<HTMLSelectElement>('#window-select')).value);
  const lastT = frames.at(-1)!.t;
  const duration = windowSeconds > 0 ? windowSeconds * 0.00625 : Math.max(5, lastT);
  const endT = Math.min(lastT, Math.max(duration, state?.time ?? lastT));
  const startT = windowSeconds > 0 ? endT - duration : 0;
  const start = Math.max(0, Math.floor(startT / 0.00625));
  const end = Math.min(frames.length, Math.ceil(endT / 0.00625) + 1);
  if (end - start < 2) return;

  const left = width < 480 ? 42 : 46, right = 12, top = 8, bottom = 30;
  const pw = width - left - right, ph = height - top - bottom;
  const bandH = ph / CHANNEL_KEYS.length;
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
    const bandTop = top + ch * bandH;
    let ymax = CHANNEL_DEFAULT_MAX[key];
    for (let i = start; i < end; i += stride) if (frames[i][key] > ymax) ymax = frames[i][key] * 1.15;
    if (key === 'hr') ymax = Math.max(ymax, 400);
    const ymin = 0;
    const yOf = (v: number) => bandTop + bandH - ((v - ymin) / (ymax - ymin)) * bandH;
    ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'right';
    for (let g = 0; g <= 4; g++) {
      const yy = bandTop + (g / 4) * bandH;
      ctx.strokeStyle = g === 0 ? '#aab3bc' : '#e7eaee';
      ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(width - right, yy); ctx.stroke();
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
// 跟随页可能处于后台标签/低频渲染环境：用固定间隔驱动，不依赖 requestAnimationFrame
setInterval(() => {
  try {
    if (dirty) { renderHeader(); renderEvents(); drawChart(); dirty = false; }
  } catch (error) {
    (window as any).__followError = String((error as Error)?.stack ?? error);
  }
}, 250);

function applyUpdate(reset: boolean, message: any): void {
  state = message.state ?? state;
  if (reset) { frames = message.frames ?? []; events = message.events ?? []; lastRenderedEventCount = -1; }
  else {
    if (message.frames?.length) frames.push(...message.frames);
    if (message.events?.length) events.push(...message.events);
  }
  dirty = true;
}

// HTTP 轮询：增量拉取老师端状态
let seenSeq = -1, sentF = 0, sentE = 0, polling = false;
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
    if (data.state) setStatus('实时跟随老师端', true);
    else setStatus('老师端尚未开始广播，等待中…', false);
  } catch {
    setStatus('连接中断，自动重试中…', false);
  } finally {
    polling = false;
  }
}
setInterval(poll, 1500);
poll();
