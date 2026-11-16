// ============================================================
// 广播/静态服务器工厂(CJS):web CLI(serve.mjs)与 Electron 桌面版
// (desktop/main.cjs)共用。教师浏览器 POST /api/broadcast 推送增量,
// 学生浏览器访问 /follow.html 增量拉取实时跟随。
// 会话保存在进程内存,不落盘、不外发。
// ============================================================
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const dgram = require('node:dgram');

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

const MAX_BROADCAST_FRAMES = 18000;   // 滚动窗口 15 分钟 @20 Hz

function createBroadcastServer({ root, port, openLan = true }) {
  root = path.resolve(root);
  const broadcast = {
    seq: 0, state: null, frames: [], events: [], updatedAt: 0,
    live: false, followers: new Set(),
    // 绝对帧号计数:frames 是滚动窗口(满 18000 后头部被挤出),
    // 学生端按绝对号增量拉取;totalAbs - frames.length = 窗口起点
    totalAbs: 0
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
      broadcast.totalAbs = broadcast.frames.length;
    } else if (message.type === 'chunk') {
      if (Array.isArray(message.frames)) {
        broadcast.frames.push(...message.frames);
        broadcast.totalAbs += message.frames.length;
        if (broadcast.frames.length > MAX_BROADCAST_FRAMES) {
          broadcast.frames.splice(0, broadcast.frames.length - MAX_BROADCAST_FRAMES);
        }
      }
      if (Array.isArray(message.events)) broadcast.events.push(...message.events);
      if (message.state) broadcast.state = message.state;
    } else {
      res.writeHead(400); res.end('Unknown type'); return;
    }
    broadcast.live = true;
    broadcast.updatedAt = Date.now();
    broadcastChunk(message);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, followers: broadcast.followers.size }));
  }

  // 教师页直接关闭/刷新(未点停止)时,广播会话会残留:
  // 无跟随者且超过 60s 无更新 → 清空,学生端回到「等待老师」空态
  const gcTimer = setInterval(() => {
    if (broadcast.live && broadcast.followers.size === 0 && Date.now() - broadcast.updatedAt > 60000) {
      broadcast.live = false;
      broadcast.state = null;
      broadcast.frames = [];
      broadcast.events = [];
      broadcast.seq += 1;
    }
  }, 30000);

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

    if (pathname === '/api/broadcast' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 8e6) req.destroy(); });
      req.on('end', () => handleBroadcast(req, res, body));
      return;
    }
    // 老师端停止广播:清空会话,学生跟随页回到「等待老师」空态
    if (pathname === '/api/broadcast-off' && req.method === 'POST') {
      broadcast.live = false;
      broadcast.state = null;
      broadcast.frames = [];
      broadcast.events = [];
      broadcast.updatedAt = Date.now();
      broadcastChunk({ type: 'off' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (pathname === '/api/follow' && req.method === 'GET') {
      handleFollow(res);
      return;
    }
    if (pathname === '/api/poll' && req.method === 'GET') {
      // 学生 f 为绝对帧号;窗口滑动挤出后(f < windowStart)自动重置
      const f = Math.max(0, Number(url.searchParams.get('f') ?? 0) || 0);
      const e = Math.max(0, Number(url.searchParams.get('e') ?? 0) || 0);
      const seqMatch = Number(url.searchParams.get('seq') ?? -1) === broadcast.seq;
      const windowStart = broadcast.totalAbs - broadcast.frames.length;
      const inRange = f >= windowStart && f <= broadcast.totalAbs && e <= broadcast.events.length;
      const reset = !seqMatch || !inRange;
      const relF = Math.max(0, f - windowStart);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({
        seq: broadcast.seq,
        reset,
        state: broadcast.state,
        frames: reset ? broadcast.frames : broadcast.frames.slice(relF),
        events: reset ? broadcast.events : broadcast.events.slice(e),
        totalAbs: broadcast.totalAbs,
        windowStart,
        totalF: broadcast.frames.length,
        totalE: broadcast.events.length,
        updatedAt: broadcast.updatedAt
      }));
      return;
    }
    if (pathname === '/api/session' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        live: broadcast.live && !!broadcast.state,
        followers: broadcast.followers.size,
        updatedAt: broadcast.updatedAt,
        tissue: broadcast.state?.tissue ?? null
      }));
      return;
    }
    // 局域网地址:前端据此提示学生访问地址
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

  server.on('close', () => clearInterval(gcTimer));
  return server;
}

module.exports = { createBroadcastServer, detectPrimaryIp };
