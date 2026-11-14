// Worker 消息链核验：在 Node worker_threads 中桥接浏览器 Worker 文件。
import { Worker } from 'node:worker_threads';
const workerURL = new URL('../dist/simulation.worker.js', import.meta.url).href;
const bridge = `import {parentPort} from 'node:worker_threads'; globalThis.postMessage = m=>parentPort.postMessage(m); await import(${JSON.stringify(workerURL)}); parentPort.on('message',data=>globalThis.onmessage({data}));`;
const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(bridge)));
const queue = [];
let wake;
worker.on('message', message => { queue.push(message); wake?.(); });
const next = async type => {
  while (true) {
    const at = queue.findIndex(message => message.type === type);
    if (at >= 0) return queue.splice(at, 1)[0];
    await new Promise(resolve => { wake = resolve; });
    wake = null;
  }
};
const command = async (message, type = 'update') => { worker.postMessage(message); return next(type); };

const first = await command({ type: 'init' });
await command({ type: 'dose', drugId: 'noradrenaline', dose: 0.01 });
const after = await command({ type: 'advance', seconds: 5 });
const stim = await command({ type: 'stimulate', pathway: 'vagus_nerve' });
const saved = await command({ type: 'snapshot', purpose: 'download' }, 'snapshot');
const imported = await command({ type: 'restore', snapshot: saved.snapshot });
// .rat 导出与再导入
const ratMsg = await command({ type: 'rat-export' }, 'rat');

// 用真实 .rat 导入
import { readFileSync } from 'node:fs';
const buf = readFileSync(new URL('./fixtures/vagus.rat', import.meta.url));
worker.postMessage({ type: 'rat', buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }, [buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)]);
const importedRat = await next('update');

const framesExpected = 400;   // 5 s / 0.0125 s
const checks = {
  init: first.replace && first.state.pithed === true,
  doseAndAdvance: after.state.points === 800 && after.frames.length === 800 && Math.abs(after.state.time - 5) < 1e-6,
  stimulateAnnotated: stim.events.some(e => e.text === 'Vagus Nv.'),
  snapshotPurpose: saved.purpose === 'download',
  restoreReplace: imported.replace && imported.frames.length === 800 && imported.state.running === false,
  timePreserved: Math.abs(imported.state.time - 5) < 1e-6,
  ratExportHasHeader: ratMsg.buffer instanceof ArrayBuffer && ratMsg.buffer.byteLength === 20400 + 800 * 10,
  ratImport: importedRat.replace && importedRat.state.historyOnly === true && importedRat.frames.length === 3780
};
console.log(JSON.stringify({ checks, passed: Object.values(checks).every(Boolean) }, null, 2));
await worker.terminate();
process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
