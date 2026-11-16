import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import dgram from 'node:dgram';
import { spawn } from 'node:child_process';

// 探测对外主 IP:UDP connect 走一次路由选择(不发包),OS 直接给出
// 默认路由对应的本机地址;教室无外网/无默认路由时超时返回 null
function detectPrimaryIp(timeoutMs = 500) {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4');
    const done = ip => { clearTimeout(timer); try { socket.close(); } catch { /* 已关闭 */ } resolve(ip); };
    const timer = setTimeout(() => done(null), timeoutMs);
    socket.on('error', () => done(null));
    socket.connect(53, '8.8.8.8', () => done(socket.address().address));
  });
}

const root = path.resolve('dist');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
// --host 0.0.0.0 或 --lan：开放局域网访问（学生手机 / 鸿蒙设备连接教师电脑）
const openLan = args.includes('--lan') || args.includes('--host');
const host = argValue('--host', openLan ? '0.0.0.0' : '127.0.0.1');
const port = Number(argValue('--port', process.env.PORT ?? 5173));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

// ---------------- Online 授课广播 ----------------
// 老师浏览器 POST /api/broadcast 推送增量；学生 GET /api/follow 以 SSE 实时跟随。
// 会话保存在本进程内存，老师停止或服务器重启即清空；不落盘、不外发。
const MAX_BROADCAST_FRAMES = 18000;   // 滚动窗口 15 分钟 @20 Hz
const broadcast = {
  seq: 0,
  state: null,
  frames: [],
  events: [],
  updatedAt: 0,
  followers: new Set()
};

function broadcastChunk(payload) {
  const text = `event: chunk\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of broadcast.followers) res.write(text);
}

function handleBroadcast(req, res, body) {
  let message;
  try { message = JSON.parse(body); } catch { res.writeHead(400); res.end('Bad JSON'); return; }
  if (message.type === 'full') {
    broadcast.seq = message.seq ?? (broadcast.seq + 1);
    broadcast.frames = Array.isArray(message.frames) ? message.frames.slice(-MAX_BROADCAST_FRAMES) : [];
    broadcast.events = Array.isArray(message.events) ? message.events : [];
    broadcast.state = message.state ?? null;
  } else if (message.type === 'chunk') {
    if (Array.isArray(message.frames)) {
      broadcast.frames.push(...message.frames);
      if (broadcast.frames.length > MAX_BROADCAST_FRAMES) {
        broadcast.frames.splice(0, broadcast.frames.length - MAX_BROADCAST_FRAMES);
      }
    }
    if (Array.isArray(message.events)) broadcast.events.push(...message.events);
    if (message.state) broadcast.state = message.state;
  } else {
    res.writeHead(400); res.end('Unknown type'); return;
  }
  broadcast.updatedAt = Date.now();
  broadcastChunk(message);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, followers: broadcast.followers.size }));
}

function handleFollow(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`event: backfill\ndata: ${JSON.stringify({
    seq: broadcast.seq, state: broadcast.state, frames: broadcast.frames, events: broadcast.events
  })}\n\n`);
  broadcast.followers.add(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  res.on('close', () => { clearInterval(heartbeat); broadcast.followers.delete(res); });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  // ---- Online 授课广播 API ----
  if (pathname === '/api/broadcast' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 8e6) req.destroy(); });
    req.on('end', () => handleBroadcast(req, res, body));
    return;
  }
  if (pathname === '/api/follow' && req.method === 'GET') {
    handleFollow(res);
    return;
  }
  if (pathname === '/api/poll' && req.method === 'GET') {
    const f = Math.max(0, Number(url.searchParams.get('f') ?? 0) || 0);
    const e = Math.max(0, Number(url.searchParams.get('e') ?? 0) || 0);
    const seqMatch = Number(url.searchParams.get('seq') ?? -1) === broadcast.seq;
    const inRange = f <= broadcast.frames.length && e <= broadcast.events.length;
    const reset = !seqMatch || !inRange;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({
      seq: broadcast.seq,
      reset,
      state: broadcast.state,
      frames: reset ? broadcast.frames : broadcast.frames.slice(f),
      events: reset ? broadcast.events : broadcast.events.slice(e),
      totalF: broadcast.frames.length,
      totalE: broadcast.events.length
    }));
    return;
  }
  if (pathname === '/api/session' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      live: broadcast.followers.size >= 0 && !!broadcast.state,
      followers: broadcast.followers.size,
      updatedAt: broadcast.updatedAt,
      tissue: broadcast.state?.tissue ?? null
    }));
    return;
  }
  // 局域网地址:前端据此提示学生访问地址(需要 --lan 才真正对外开放)
  if (pathname === '/api/lan' && req.method === 'GET') {
    const addresses = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list ?? []) {
        if (net.family === 'IPv4' && !net.internal) addresses.push(`http://${net.address}:${port}`);
      }
    }
    // 教学 Wi-Fi 网段排前,虚拟/桥接网卡地址殿后
    const rank = s => (s.includes('192.168.') ? 0 : s.includes('10.') ? 1 : s.includes('172.') ? 2 : 3);
    addresses.sort((a, b) => rank(a) - rank(b));
    // 默认路由探测到的 IP 为主地址(学生只需抄这一个);探测失败则不设主地址
    const primaryIp = await detectPrimaryIp();
    const primary = primaryIp && addresses.some(a => a.includes(primaryIp)) ? `http://${primaryIp}:${port}` : null;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      lan: openLan, port, addresses, primary,
      follow: addresses.map(a => `${a}/follow.html`),
      primaryFollow: primary ? `${primary}/follow.html` : null
    }));
    return;
  }

  // ---- 静态文件 ----
  const relative = path.posix.normalize('/' + pathname).replace(/^\/+/, '');
  const file = path.join(root, relative || 'index.html');
  if (!file.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const body = await readFile(file);
    const headers = { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' };
    if (file.endsWith('sw.js')) headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
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
