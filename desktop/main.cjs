const { app, BrowserWindow, dialog, Menu, net, protocol } = require('electron');
const path = require('node:path');
const nodeNet = require('node:net');
const { pathToFileURL } = require('node:url');
const { createBroadcastServer } = require('../server/broadcast-server.cjs');

let APP_URL = 'ratheart://lab/index.html';   // 广播服务器启动后追加 ?api=<端口>
const assets = path.resolve(__dirname, '..', 'dist');
let broadcastPort = 0;

app.setName('RatHeart-SimPro');
app.setPath('userData', path.join(app.getPath('appData'), 'RatHeart-SimPro'));
app.setAppUserModelId('org.ratheartsimpro.teaching');

// A stable local origin supports ES modules, module Workers and localStorage.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ratheart',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
]);

// 从 5189 起找第一个空闲端口(被占时依次 +1)
function findFreePort(start) {
  return new Promise(resolve => {
    const tryPort = p => {
      if (p >= start + 20) return resolve(start);
      const probe = nodeNet.createServer();
      probe.once('error', () => tryPort(p + 1));
      probe.once('listening', () => probe.close(() => resolve(p)));
      probe.listen(p, '127.0.0.1');
    };
    tryPort(start);
  });
}

function startBroadcastServer() {
  return findFreePort(5189).then(port => new Promise((resolve, reject) => {
    const server = createBroadcastServer({ root: assets, port, openLan: true });
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      broadcastPort = port;
      resolve(port);
    });
  })).catch(error => {
    dialog.showErrorBox('局域网广播启动失败', String(error && error.message || error));
  });
}

async function serveAsset(request) {
  const url = new URL(request.url);
  if (url.hostname !== 'lab') return new Response('Not found', { status: 404 });
  // /api/* 代理到内嵌广播服务器:教师端页面与 Worker 的相对 fetch 统一走这里
  if (url.pathname.startsWith('/api/') && broadcastPort) {
    const target = `http://127.0.0.1:${broadcastPort}${url.pathname}${url.search}`;
    const init = { method: request.method, headers: { 'content-type': 'application/json' } };
    if (request.method === 'POST') init.body = await request.text();
    try {
      return await net.fetch(target, init);
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error && error.message || error) }), { status: 502 });
    }
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Invalid URL', { status: 400 });
  }
  const file = path.resolve(assets, '.' + (pathname === '/' ? '/index.html' : pathname));
  const relative = path.relative(assets, file);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    return new Response('Not found', { status: 404 });
  }
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow() {
  if (broadcastPort) APP_URL = `ratheart://lab/index.html?api=${broadcastPort}`;
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: '大鼠心血管实验台',
    backgroundColor: '#ffffff',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    const url = new URL(target);
    if (url.protocol !== 'ratheart:' || url.hostname !== 'lab') event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  window.loadURL(APP_URL).catch(error => {
    dialog.showErrorBox('实验台启动失败', error.message);
    app.quit();
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // 内嵌广播服务器:0.0.0.0 监听,学生浏览器访问 http://<教学机IP>:端口/follow.html
  await startBroadcastServer();
  protocol.handle('ratheart', serveAsset);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
