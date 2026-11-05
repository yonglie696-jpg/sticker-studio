// 桌面外壳（Electron）：在本机 127.0.0.1 的空闲端口上启动后端，再用窗口打开它。
// 数据（角色、专辑、Key）存在 %APPDATA%\表情包工坊\data，卸载软件不会删除。
import { app, BrowserWindow, dialog, shell } from 'electron';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 测试用：STUDIO_SMOKE=1 只起后端、不开窗口；STUDIO_PORT 指定端口 */
const SMOKE = process.env.STUDIO_SMOKE === '1';

if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();

let win = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitReady(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('后端启动超时');
}

async function start() {
  const port = Number(process.env.STUDIO_PORT) || (await freePort());
  process.env.API_PORT = String(port);
  process.env.STUDIO_HOST = '127.0.0.1';
  process.env.STUDIO_DATA_DIR ||= path.join(app.getPath('userData'), 'data');
  await import(pathToFileURL(path.join(app.getAppPath(), 'server-dist', 'index.mjs')).href);
  const base = `http://127.0.0.1:${port}`;
  await waitReady(`${base}/api/status`);
  if (SMOKE) {
    console.log(`SMOKE_READY ${base} ${process.env.STUDIO_DATA_DIR}`);
    return;
  }

  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    title: '表情包工坊',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // 软件内的链接（看原图等）开新窗口；外部网址（平台控制台等）用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(base)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(base)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  win.once('ready-to-show', () => win.show());
  await win.loadURL(base);
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});
app.on('window-all-closed', () => app.quit());
app
  .whenReady()
  .then(start)
  .catch((e) => {
    dialog.showErrorBox('表情包工坊启动失败', String(e?.stack ?? e));
    app.quit();
  });
