// 손전등 PC 버전: www 폴더의 앱 화면을 창으로 띄움
const { app, BrowserWindow, shell, session } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const win = new BrowserWindow({
    width: 430, height: 860, minWidth: 360, minHeight: 600,
    title: '손전등', autoHideMenuBar: true, backgroundColor: '#1b1f2e',
    icon: path.join(__dirname, 'www', 'icons', 'icon-512.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
  // 바깥 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.focus(); });
}

app.whenReady().then(() => {
  // 지도 '내 위치' 등 권한 허용
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['geolocation', 'media', 'notifications'].includes(perm)));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
