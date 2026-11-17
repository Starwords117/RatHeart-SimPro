// ============================================================
// 计算线程：持有 Experiment 实例，固定步长推进仿真，
// 与界面只传增量帧；授课广播 POST 也在此执行
// （worker 定时器不受页面后台节流影响）。
// ============================================================

import { Experiment, POINT_DT } from './core.js';

const scope = globalThis as any;
let experiment = new Experiment(true);
let sentFrames = 0, sentEvents = 0;
let last = performance.now(), budget = 0;

// Online 授课广播
// 房间隔离:每位教师一个 room(学生 follow.html?room=xxx);token 为教师
// 令牌(首次推送建立所有权,学生只读无法伪造)。推送窗口化:只发最近
// 18000 帧窗口(与服务器窗口一致),避免恢复长实验后整条 trace 超限被销毁。
const BROADCAST_WINDOW = 18000;
let broadcastOn = false, broadcastSeq = 0, bSentFrames = 0, bSentEvents = 0, lastBroadcast = 0, broadcastFull = false;
let broadcastRoom = '', broadcastToken = '', broadcastBase = '';
// ipc 模式(桌面版):推送经主线程 invoke 过进程内路由,绕开 WebView 私网限制;
// http 模式(网页版):直接 fetch 同源 /api/broadcast
let ipcMode = false;
function broadcastNow(): void {
  const traceLen = experiment.trace.length;
  const windowStart = Math.max(0, traceLen - BROADCAST_WINDOW);
  const needFull = broadcastFull || bSentFrames > traceLen || bSentFrames < windowStart;
  let payload: any;
  if (needFull) {
    payload = { type: 'full', seq: ++broadcastSeq, state: experiment.state, frames: experiment.trace.slice(windowStart), events: experiment.events };
    bSentFrames = traceLen; bSentEvents = experiment.events.length;
  } else {
    payload = { type: 'chunk', seq: broadcastSeq, state: experiment.state, frames: experiment.trace.slice(bSentFrames), events: experiment.events.slice(bSentEvents) };
    bSentFrames = traceLen; bSentEvents = experiment.events.length;
  }
  payload.room = broadcastRoom;
  payload.token = broadcastToken;
  broadcastFull = false;
  if (ipcMode) {
    // 结果由主线程回传 broadcast-ipc-result 后再更新按钮状态
    scope.postMessage({ type: 'broadcast-ipc', path: '/api/broadcast', body: JSON.stringify(payload) });
    return;
  }
  // POST 显式超时:失败/挂起都以 detail 回执,界面可见
  const ctrl = new AbortController();
  const kill = setTimeout(() => ctrl.abort(), 5000);
  scope.fetch(`${broadcastBase}/api/broadcast`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal })
    .then((r: any) => r.json())
    .then((d: any) => { clearTimeout(kill); scope.postMessage({ type: 'broadcast', on: broadcastOn, followers: d.followers ?? 0 }); })
    .catch((e: any) => { clearTimeout(kill); broadcastOn = false; scope.postMessage({ type: 'broadcast', on: false, error: true, detail: String(e && e.message || e) }); });
}

function send(replace = false): void {
  if (replace) { sentFrames = 0; sentEvents = 0; }
  scope.postMessage({
    type: 'update',
    state: experiment.state,
    activeDrugs: experiment.activeDrugs(),
    frames: experiment.trace.slice(sentFrames),
    events: experiment.events.slice(sentEvents),
    replace
  });
  sentFrames = experiment.trace.length; sentEvents = experiment.events.length;
}

function rebaseline(): void {
  budget = 0; last = performance.now();
  if (broadcastOn) { bSentFrames = 0; bSentEvents = 0; broadcastFull = true; }
}

scope.onmessage = (event: MessageEvent) => {
  const m = event.data;
  switch (m.type) {
    case 'init': send(true); break;
    case 'run':
      if (!experiment.state.historyOnly) experiment.state.running = true;
      experiment.state.recorderStarted = true;
      rebaseline(); send(); break;
    case 'pause': experiment.state.running = false; budget = 0; send(); break;
    case 'speed': experiment.state.speed = m.value; send(); break;
    case 'advance': experiment.advance(m.seconds); rebaseline(); send(); break;
    case 'reset': experiment.reset(m.pithed, m.seed ?? experiment.state.seed, m.noise ?? experiment.state.noise); rebaseline(); send(true); break;
    case 'dose': experiment.inject(m.drugId, m.dose); send(); break;
    case 'stimulate': experiment.stimulate(m.pathway); send(); break;
    case 'model': experiment.setPithed(m.value); send(); break;
    case 'noise': experiment.setNoise(m.value); send(); break;
    case 'flatten': experiment.setFlattenAfterDeath(m.value); send(); break;
    case 'snapshot': scope.postMessage({ type: 'snapshot', purpose: m.purpose ?? 'download', snapshot: experiment.exportSnapshot() }); break;
    case 'csv': scope.postMessage({ type: 'csv', trace: experiment.trace, events: experiment.events }); break;
    case 'rat-export': scope.postMessage({ type: 'rat', buffer: experiment.exportRAT() }); break;
    case 'restore':
      try { experiment.restore(m.snapshot); rebaseline(); send(true); }
      catch (error) { console.error(error); scope.postMessage({ type: 'file-error' }); }
      break;
    case 'rat':
      try {
        if (experiment.importRAT(m.buffer)) { rebaseline(); send(true); }
        else scope.postMessage({ type: 'file-error' });
      } catch (error) { console.error(error); scope.postMessage({ type: 'file-error' }); }
      break;
    case 'broadcast-on':
      broadcastRoom = m.room ?? ''; broadcastToken = m.token ?? ''; broadcastBase = m.base ?? '';
      ipcMode = m.mode === 'ipc';
      broadcastOn = true; broadcastSeq += 1; bSentFrames = 0; bSentEvents = 0; broadcastFull = true; lastBroadcast = 0; broadcastNow(); break;
    // 桌面版 ipc 推送的结果回执(主线程 invoke 后转发)
    case 'broadcast-ipc-result': {
      let followers = 0, detail = '';
      try { const j = JSON.parse(m.body); followers = j.followers ?? 0; if (m.status === 403) detail = '403 Forbidden'; } catch { detail = '响应解析失败'; }
      if (m.status && m.status >= 400) { broadcastOn = false; scope.postMessage({ type: 'broadcast', on: false, error: true, detail: detail || ('HTTP ' + m.status) }); }
      else scope.postMessage({ type: 'broadcast', on: broadcastOn, followers });
      break;
    }
    // 关闭广播需回执,否则界面按钮状态不翻转;同时通知服务器清空房间会话
    case 'broadcast-off': {
      broadcastOn = false;
      if (ipcMode) {
        scope.postMessage({ type: 'broadcast-ipc', path: '/api/broadcast-off', body: JSON.stringify({ room: broadcastRoom, token: broadcastToken }) });
      } else {
        scope.fetch(`${broadcastBase}/api/broadcast-off`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room: broadcastRoom, token: broadcastToken }) })
          .catch(() => { /* 服务器不可达时 GC 会兜底 */ });
      }
      scope.postMessage({ type: 'broadcast', on: false, followers: 0 });
      break;
    }
  }
};

// 主循环：按墙钟时间 × 回放速度推进显示点（原版 TTimer 50ms 的等价物，
// 速度以“生理秒/实际秒”计，默认 0.25 与原版一致）
setInterval(() => {
  const now = performance.now();
  const elapsed = Math.min((now - last) / 1000, 0.5); last = now;
  // 推送节奏 1s:配合学生端 SSE 长连接(或轮询回退),跟随延迟约 ≤1s,
  // 大幅降低课堂 Wi-Fi 空口压力(平滑性由学生端回放缓冲保证)
  if (broadcastOn && (broadcastFull || now - lastBroadcast >= 1000 || experiment.trace.length > bSentFrames + 40)) {
    lastBroadcast = now;
    broadcastNow();
  }
  if (!experiment.state.running || experiment.state.historyOnly) return;
  budget += elapsed * experiment.state.speed;
  const steps = Math.floor(budget / POINT_DT);
  for (let i = 0; i < steps; i++) experiment.step();
  budget -= steps * POINT_DT;
  if (steps) send();
}, 40);
