// ============================================================
// 广播链路端到端核验:真实 worker(worker_threads 桥接)+ 真实广播服务器
// 覆盖:房间隔离、教师 token 鉴权、数据流、停止清会话。
// 运行前先 npm run build;由 npm test 自动执行。
// ============================================================
import { Worker } from 'node:worker_threads';
import { createBroadcastServer } from '../server/broadcast-server.cjs';

const PORT = 5213;
const BASE = `http://127.0.0.1:${PORT}`;
const server = createBroadcastServer({ root: new URL('../dist/', import.meta.url).pathname, port: PORT, openLan: false });
await new Promise(res => server.listen(PORT, '127.0.0.1', res));

const workerURL = new URL('../dist/simulation.worker.js', import.meta.url).href;
// 桥接浏览器 Worker API:postMessage/onmessage;相对 fetch 以服务器为基底
const bridge = `import {parentPort} from 'node:worker_threads';
globalThis.postMessage = m => parentPort.postMessage(m);
const of_ = globalThis.fetch;
globalThis.fetch = (u, i) => of_(new URL(u, ${JSON.stringify(BASE + '/')}), i);
const buffered = [];
let ready = false;
parentPort.on('message', d => { if (ready) globalThis.onmessage({ data: d }); else buffered.push(d); });
await import(${JSON.stringify(workerURL)});
ready = true;
for (const d of buffered) globalThis.onmessage({ data: d });`;
const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(bridge)));
const queue = [];
let wake;
worker.on('message', message => { queue.push(message); wake?.(); });
const next = async type => {
  while (true) {
    const at = queue.findIndex(m => m.type === type);
    if (at >= 0) return queue.splice(at, 1)[0];
    await new Promise(r => { wake = r; });
    wake = null;
  }
};
const command = async (message, type = 'update') => { worker.postMessage(message); return next(type); };

const results = [];
const ok = (name, cond, actual = cond) => { results.push({ name, passed: !!cond, actual }); };

// 1) 教师开启广播(room=r1, token=tk1) → worker 自行推送
worker.postMessage({ type: 'init' });
await next('update');
worker.postMessage({ type: 'broadcast-on', room: 'r1', token: 'tk1' });
await next('broadcast');
worker.postMessage({ type: 'run' });
await command({ type: 'advance', seconds: 2 });
await new Promise(r => setTimeout(r, 1600));   // 等两批推送

// 2) 学生轮询(room=r1)拿到帧
const poll1 = await fetch(`${BASE}/api/poll?room=r1&f=0&e=0&seq=-1`).then(r => r.json());
ok('学生拉取到帧(房间隔离)', poll1.totalAbs > 0 && poll1.frames.length > 0, poll1.totalAbs);

// 3) 伪造 token 推送被拒
const forged = await fetch(`${BASE}/api/broadcast`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'chunk', room: 'r1', token: 'bad', seq: 99, state: { hacked: true }, frames: [], events: [] }) });
ok('伪造 token 推送被 403 拒绝', forged.status === 403, forged.status);

// 4) 房间隔离:第二房间 r2 无数据
const poll2 = await fetch(`${BASE}/api/poll?room=r2&f=0&e=0&seq=-1`).then(r => r.json());
ok('房间隔离:r2 无 r1 数据', poll2.totalAbs === 0 && poll2.frames.length === 0, poll2.totalAbs);

// 5) SSE:响应头与首个 backfill 事件
const sse = await fetch(`${BASE}/api/follow?room=r1`);
const sseOk = (sse.headers.get('content-type') || '').includes('text/event-stream');
const reader = sse.body.getReader();
const { value } = await reader.read();
const firstText = new TextDecoder().decode(value);
ok('SSE 响应头为 event-stream', sseOk, sse.headers.get('content-type'));
ok('SSE backfill 携带帧数据', firstText.includes('event: backfill') && firstText.includes('"frames"'), firstText.slice(0, 60));
await reader.cancel().catch(() => {});

// 6) 停止广播(错误 token)→ 会话仍在
await fetch(`${BASE}/api/broadcast-off`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room: 'r1', token: 'bad' }) });
const still = await fetch(`${BASE}/api/session?room=r1`).then(r => r.json());
ok('错误 token 停止被拒,会话保留', still.live === true, still.live);

// 7) 停止广播(正确 token)→ 会话清空,学生回到等待态
worker.postMessage({ type: 'broadcast-off', room: 'r1', token: 'tk1' });
await next('broadcast');
await new Promise(r => setTimeout(r, 1700));   // 等迟到推送忽略窗口过去
const after = await fetch(`${BASE}/api/poll?room=r1&f=0&e=0&seq=-1`).then(r => r.json());
ok('正确 token 停止:state/frames 清空,学生回到等待态', after.state === null && after.frames.length === 0, { state: after.state, frames: after.frames.length });

// 8) 房间隔离:教师切到 r2 不影响 r1 学生(已停止态)…改为:重开 r2 广播,r1 会话独立
worker.postMessage({ type: 'broadcast-on', room: 'r2', token: 'tk2' });
await next('broadcast');
await command({ type: 'advance', seconds: 2 });
await new Promise(r => setTimeout(r, 1600));
const r1again = await fetch(`${BASE}/api/poll?room=r1&f=0&e=0&seq=-1`).then(r => r.json());
const r2poll = await fetch(`${BASE}/api/poll?room=r2&f=0&e=0&seq=-1`).then(r => r.json());
ok('多房间:r2 有数据', r2poll.totalAbs > 0, r2poll.totalAbs);
ok('多房间:r1 停止后仍为空(互不串台)', r1again.frames.length === 0 && r1again.state === null, true);

const passed = results.filter(r => r.passed).length;
console.log(JSON.stringify({ checks: results.length, passed, failed: results.length - passed }, null, 0));
for (const r of results.filter(r => !r.passed)) console.error(`FAIL ${r.name}: ${JSON.stringify(r.actual)}`);
worker.terminate().catch(() => {});
server.close();
process.exitCode = passed === results.length ? 0 : 1;
