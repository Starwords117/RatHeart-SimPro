// ============================================================
// 广播/静态服务器工厂(CJS):web CLI(serve.mjs)与 Electron 桌面版
// (desktop/main.cjs)共用。
// 多教师房间隔离:每个 roomId 独立会话;教师首次推送时以携带的 token
// 建立会话所有权,后续推送/停止必须携带同一 token(学生只读无法伪造)。
// 教师浏览器 POST /api/broadcast 推送增量,学生浏览器访问
// /follow.html?room=<roomId> 增量拉取实时跟随(SSE 或轮询)。
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

const MAX_BROADCAST_FRAMES = 18000;   // 滚动窗口 15 分钟 @40 子样本/s
const SESSION_GC_MS = 60000;          // 无跟随者且 60s 无更新 → 会话清除

function createBroadcastServer({ root, port, openLan = true }) {
  root = path.resolve(root);
  /** @type {Map<string, any>} roomId → 会话 */
  const rooms = new Map();
  /** 房间停止广播后的迟到推送忽略窗口(roomId → 忽略截止时刻) */
  const recentlyClosed = new Map();

  function getSession(room, token, create) {
    let s = rooms.get(room);
    if (!s) {
      if (!create) return null;
      s = {
        seq: 0, state: null, frames: [], events: [], updatedAt: 0,
        live: false, followers: new Set(), totalAbs: 0,
        token: token ?? null   // 建立会话的教师令牌;null 表示未设(兼容无 token 客户端)
      };
      rooms.set(room, s);
    }
    // 所有权校验:会话已有 token 则必须匹配
    if (s.token && token !== s.token) return 'forbidden';
    return s;
  }

  function broadcastChunk(s, payload) {
    const text = `event: chunk\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of s.followers) res.write(text);
  }

  function handleBroadcast(req, res, body) {
    let message;
    try { message = JSON.parse(body); } catch { res.writeHead(400); res.end('Bad JSON'); return; }
    if (!message.room) { res.writeHead(400); res.end('Missing room'); return; }
    // 停止广播后到达的在途推送:静默忽略,防止会话被重建
    if ((recentlyClosed.get(message.room) ?? 0) > Date.now()) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, followers: 0 }));
      return;
    }
    const s = getSession(message.room, message.token, true);
    if (s === 'forbidden') { res.writeHead(403); res.end('Forbidden'); return; }
    if (message.type === 'full') {
      s.seq = message.seq ?? (s.seq + 1);
      s.frames = Array.isArray(message.frames) ? message.frames.slice(-MAX_BROADCAST_FRAMES) : [];
      s.events = Array.isArray(message.events) ? message.events : [];
      s.state = message.state ?? null;
      s.totalAbs = s.frames.length;
    } else if (message.type === 'chunk') {
      if (Array.isArray(message.frames)) {
        s.frames.push(...message.frames);
        s.totalAbs += message.frames.length;
        if (s.frames.length > MAX_BROADCAST_FRAMES) {
          s.frames.splice(0, s.frames.length - MAX_BROADCAST_FRAMES);
        }
      }
      if (Array.isArray(message.events)) s.events.push(...message.events);
      if (message.state) s.state = message.state;
    } else {
      res.writeHead(400); res.end('Unknown type'); return;
    }
    s.live = true;
    s.updatedAt = Date.now();
    message.updatedAt = s.updatedAt;   // 供跟随端陈旧判定
    broadcastChunk(s, message);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, followers: s.followers.size }));
  }

  function handleBroadcastOff(req, res, body) {
    let message;
    try { message = JSON.parse(body); } catch { res.writeHead(400); res.end('Bad JSON'); return; }
    if (!message.room) { res.writeHead(400); res.end('Missing room'); return; }
    const s = getSession(message.room, message.token, false);
    if (s === 'forbidden') { res.writeHead(403); res.end('Forbidden'); return; }
    if (!s) { res.writeHead(200); res.end(JSON.stringify({ ok: true })); return; }
    s.live = false;
    s.state = null;
    s.frames = [];
    s.events = [];
    s.updatedAt = Date.now();
    s.seq += 1;
    broadcastChunk(s, { type: 'off' });
    rooms.delete(message.room);
    recentlyClosed.set(message.room, Date.now() + 1500);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
  }

  function handleFollow(res, room) {
    const s = rooms.get(room);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`event: backfill\ndata: ${JSON.stringify({
      seq: s?.seq ?? 0, state: s?.state ?? null,
      frames: s?.frames ?? [], events: s?.events ?? []
    })}\n\n`);
    if (s) s.followers.add(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
    res.on('close', () => { clearInterval(heartbeat); if (s) s.followers.delete(res); });
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
    if (pathname === '/api/broadcast-off' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 8e6) req.destroy(); });
      req.on('end', () => handleBroadcastOff(req, res, body));
      return;
    }
    if (pathname === '/api/follow' && req.method === 'GET') {
      const room = url.searchParams.get('room');
      if (!room) { res.writeHead(400); res.end('Missing room'); return; }
      handleFollow(res, room);
      return;
    }
    if (pathname === '/api/poll' && req.method === 'GET') {
      const room = url.searchParams.get('room') ?? '';
      const s = rooms.get(room);
      const f = Math.max(0, Number(url.searchParams.get('f') ?? 0) || 0);
      const e = Math.max(0, Number(url.searchParams.get('e') ?? 0) || 0);
      const seqMatch = Number(url.searchParams.get('seq') ?? -1) === (s?.seq ?? 0);
      const windowStart = s ? s.totalAbs - s.frames.length : 0;
      const inRange = !!s && f >= windowStart && f <= s.totalAbs && e <= s.events.length;
      const reset = !s || !seqMatch || !inRange;
      const relF = Math.max(0, f - windowStart);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({
        seq: s?.seq ?? 0,
        reset,
        state: s?.state ?? null,
        frames: reset ? (s?.frames ?? []) : s.frames.slice(relF),
        events: reset ? (s?.events ?? []) : s.events.slice(e),
        totalAbs: s?.totalAbs ?? 0,
        windowStart,
        totalF: s?.frames.length ?? 0,
        totalE: s?.events.length ?? 0,
        updatedAt: s?.updatedAt ?? 0
      }));
      return;
    }
    if (pathname === '/api/session' && req.method === 'GET') {
      const room = url.searchParams.get('room');
      const s = room ? rooms.get(room) : null;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        live: !!s && s.live && !!s.state,
        followers: s?.followers.size ?? 0,
        updatedAt: s?.updatedAt ?? 0,
        tissue: s?.state?.tissue ?? null
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

  // 教师页直接关闭/刷新(未点停止)时,房间会话会残留:
  // 无跟随者且超过 SESSION_GC_MS 无更新 → 清空,学生端回到「等待老师」空态
  const gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [room, s] of rooms) {
      if (s.live && s.followers.size === 0 && now - s.updatedAt > SESSION_GC_MS) {
        rooms.delete(room);
      }
      if ((recentlyClosed.get(room) ?? 0) < now) recentlyClosed.delete(room);
    }
  }, 30000);
  server.on('close', () => clearInterval(gcTimer));

  return server;
}

module.exports = { createBroadcastServer, detectPrimaryIp };
