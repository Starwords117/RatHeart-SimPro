// ============================================================
// 跟随端压力基准:50 学生并发轮询(可经环境变量调整)
// 用法:node scripts/bench-follow.mjs [STUDENTS=50] [INTERVAL=50] [DURATION=10000]
// ============================================================
import { createBroadcastServer } from '../server/broadcast-server.cjs';

const STUDENTS = Number(process.argv[2] ?? 50);
const INTERVAL = Number(process.argv[3] ?? 50);
const DURATION = Number(process.argv[4] ?? 10000);
const root = new URL('../dist/', import.meta.url).pathname;
const PORT = 5199;

const server = createBroadcastServer({ root, port: PORT, openLan: false });
await new Promise(res => server.listen(PORT, '127.0.0.1', res));

let frameT = 0;
const post = (type, frames) => fetch(`http://127.0.0.1:${PORT}/api/broadcast`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type, seq: 1, room: 'bench', token: 'bench', state: { pithed: true, time: frameT, running: true }, frames, events: [] })
});

// 预填满窗口(18000 帧,模拟长录制)+ 教师持续推送
await post('full', Array.from({ length: 18000 }, (_, i) => ({ t: i * 0.00625, abp: 120, lvp: 120, vbp: 8, hf: 8, hr: 231 })));
const pushTimer = setInterval(async () => {
  const frames = Array.from({ length: 4 }, () => ({ t: (frameT += 0.00625), abp: 120, lvp: 120, vbp: 8, hf: 8, hr: 231 }));
  await post('chunk', frames);
}, 150);

const poll = (f, e, seq) => {
  const t0 = performance.now();
  return fetch(`http://127.0.0.1:${PORT}/api/poll?room=bench&f=${f}&e=${e}&seq=${seq}`, { cache: 'no-store' })
    .then(async r => {
      const text = await r.text();
      return { ms: performance.now() - t0, bytes: text.length, status: r.status, seq: JSON.parse(text).seq, totalAbs: JSON.parse(text).totalAbs };
    })
    .catch(e => ({ ms: performance.now() - t0, bytes: 0, status: 0, err: String(e) }));
};

const lat = [], errs = [];
let reqs = 0, bytesIn = 0;
const students = Array.from({ length: STUDENTS }, () => {
  let f = 0, e = 0, seq = 0;
  return (async () => {
    const tEnd = Date.now() + DURATION;
    while (Date.now() < tEnd) {
      const r = await poll(f, e, seq);
      reqs++; bytesIn += r.bytes; lat.push(r.ms);
      if (r.status !== 200 || r.err) errs.push(r);
      f = r.totalAbs ?? f; seq = r.seq ?? seq;   // follow 页真实语义
      await new Promise(res => setTimeout(res, INTERVAL));
    }
  })();
});
await Promise.all(students);
lat.sort((a, b) => a - b);
const p = q => lat[Math.floor(lat.length * q)];
console.log(JSON.stringify({
  场景: `${STUDENTS} 学生 × 0.0${INTERVAL}s 轮询 × ${DURATION / 1000}s`,
  reqPerSec: Math.round(reqs / (DURATION / 1000)),
  延迟ms: { p50: Math.round(p(.5)), p95: Math.round(p(.95)), p99: Math.round(p(.99)), max: Math.round(lat.at(-1)) },
  错误: errs.length, 下载MB: Math.round(bytesIn / 1e6 * 10) / 10,
}, null, 1));
clearInterval(pushTimer);
server.close();
process.exit(0);
