// 손전등 PC 버전: www 폴더의 앱 화면을 창으로 띄움
// 창의 X(닫기)를 누르면 꺼지지 않고 오른쪽 아래 작업표시줄 트레이(^)로 들어감
const { app, BrowserWindow, shell, session, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
let tray = null;
let quitting = false;

function showWin() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 430, height: 860, minWidth: 360, minHeight: 600,
    title: '손전등', autoHideMenuBar: true, backgroundColor: '#1b1f2e',
    icon: path.join(__dirname, 'www', 'icons', 'icon-512.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
  // 바깥 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // 닫기 → 트레이로 숨기기
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'www', 'icons', 'icon-192.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('손전등');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: showWin },
    { type: 'separator' },
    { label: '완전히 종료', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWin);
  tray.on('double-click', showWin);
}

app.on('second-instance', showWin);
app.on('before-quit', () => { quitting = true; });

app.whenReady().then(() => {
  // 지도 '내 위치' 등 권한 허용
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['geolocation', 'media', 'notifications'].includes(perm)));
  createWindow();
  createTray();
});
app.on('window-all-closed', () => { /* 트레이에 남아 있음 */ });
