// 大鼠心血管实验台 · 本地/局域网服务器(web 模式 CLI)
// Electron 桌面版复用同一服务器工厂(见 server/broadcast-server.mjs)
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createBroadcastServer } from '../server/broadcast-server.cjs';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
// --host 0.0.0.0 或 --lan：开放局域网访问（学生手机 / 鸿蒙设备连接教师电脑）
const openLan = args.includes('--lan') || args.includes('--host');
const host = argValue('--host', openLan ? '0.0.0.0' : '127.0.0.1');
const port = Number(argValue('--port', process.env.PORT ?? 5173));

const server = createBroadcastServer({ root: path.resolve('dist'), port, openLan });
server.listen(port, host, () => {
  const local = `http://127.0.0.1:${port}`;
  if (host === '0.0.0.0') {
    console.log('大鼠心血管实验台已开放局域网访问：');
    console.log(`  本机：${local}`);
    const nets = os.networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const net of list ?? []) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  局域网：http://${net.address}:${port}  ← 学生设备连同一 Wi-Fi 后访问`);
        }
      }
    }
    console.log('  学生跟随页：/follow.html（Online 授课模式）');
  } else {
    console.log(`大鼠心血管实验台：${local}`);
  }
  console.log('提示：加 --lan 可开放局域网；加 --port 可改端口。');
  if (args.includes('--open')) {
    const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const url = host === '0.0.0.0' ? local : `http://${host === '127.0.0.1' ? '127.0.0.1' : host}:${port}`;
    const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(command, cmdArgs, { detached: true, stdio: 'ignore' });
    child.on('error', console.error); child.unref();
  }
});
