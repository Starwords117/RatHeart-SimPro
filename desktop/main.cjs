const { app, BrowserWindow, dialog, Menu, net, protocol } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_URL = 'ratcvs://lab/index.html';
const assets = path.resolve(__dirname, '..', 'dist');

app.setName('RatCVSLab');
app.setPath('userData', path.join(app.getPath('appData'), 'RatCVSLab'));
app.setAppUserModelId('org.ratcvslab.teaching');

// A stable local origin supports ES modules, module Workers and localStorage.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ratcvs',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
]);

async function serveAsset(request) {
  const url = new URL(request.url);
  if (url.hostname !== 'lab') return new Response('Not found', { status: 404 });
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
    if (url.protocol !== 'ratcvs:' || url.hostname !== 'lab') event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  window.loadURL(APP_URL).catch(error => {
    dialog.showErrorBox('实验台启动失败', error.message);
    app.quit();
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('ratcvs', serveAsset);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
