import { app, BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, shell } from 'electron'
import type { MenuItemConstructorOptions, Rectangle } from 'electron'
import path from 'node:path'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const isDev = !app.isPackaged
const githubUrl = 'https://github.com/aincn/YAMI-Canvas-Annotation'
const githubIssuesUrl = 'https://github.com/aincn/YAMI-Canvas-Annotation/issues'

let mainWindow: BrowserWindow | null = null
let aboutWindow: BrowserWindow | null = null
let helpWindow: BrowserWindow | null = null
let allowWindowClose = false
let rendererReady = false
let screenshotOverlay: BrowserWindow | null = null
let pendingShortcutStatus: { ok: boolean; message?: string } | null = null

function getAppIconPath() {
  return isDev ? path.join(process.cwd(), 'electron/assets/icon.ico') : path.join(app.getAppPath(), 'electron/assets/icon.ico')
}

function sendMenuCommand(command: string) {
  mainWindow?.webContents.send('menu:command', command)
}

function sendRendererEvent(channel: string, payload?: unknown) {
  mainWindow?.webContents.send(channel, payload)
}

function staticAssetUrl(fileName: string) {
  const assetPath = isDev ? path.join(process.cwd(), 'public', fileName) : path.join(app.getAppPath(), 'dist', fileName)
  return pathToFileURL(assetPath).toString()
}

function staticAssetDataUrl(fileName: string) {
  const assetPath = isDev ? path.join(process.cwd(), 'public', fileName) : path.join(app.getAppPath(), 'dist', fileName)
  const ext = path.extname(fileName).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
  return `data:${mime};base64,${fsSync.readFileSync(assetPath).toString('base64')}`
}

function aboutWindowHtml() {
  const logoUrl = staticAssetDataUrl('about-yami.png')
  return encodeURIComponent(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';" />
  <style>
    :root {
      color: #1f2937;
      background: #ffffff;
      font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; overflow: hidden; background: #ffffff; }
    .about { display: flex; flex-direction: column; height: 100vh; background: #ffffff; }
    .main { flex: 0 0 auto; padding: 8px 14px 4px; overflow: hidden; }
    .hero { display: grid; grid-template-columns: 190px minmax(0, 1fr); align-items: center; gap: 16px; margin-bottom: 6px; }
    .logo-wrap { display: flex; justify-content: center; align-items: center; min-height: 112px; }
    .logo { width: 132px; max-height: 126px; object-fit: contain; }
    .title { margin: 0 0 5px; color: #151922; font-size: 23px; font-weight: 800; line-height: 1.15; letter-spacing: 0; }
    .description { margin: 0 0 5px; color: #3f4652; font-size: 12px; line-height: 1.32; }
    .version { margin: 0; color: #4b5563; font-size: 11px; }
    .info-card { margin: 2px 0 6px; border: 1px solid #d9dee7; border-radius: 7px; background: #ffffff; overflow: hidden; }
    .row { display: grid; grid-template-columns: 34px 78px minmax(0, 1fr); align-items: center; min-height: 32px; padding: 0 9px; border-bottom: 1px solid #e3e6eb; }
    .row:last-child { border-bottom: 0; }
    .icon { width: 18px; height: 18px; color: #20242a; }
    .label { color: #20242a; font-size: 12px; font-weight: 600; }
    .value { color: #20242a; font-size: 12px; min-width: 0; }
    a { color: #0b66d8; font-weight: 500; text-decoration: none; white-space: nowrap; }
    a:hover { text-decoration: underline; }
    .external { display: inline-block; margin-left: 3px; font-size: 12px; line-height: 1; transform: translateY(-1px); }
    .footnote { display: flex; align-items: center; gap: 6px; margin: 0 0 3px; color: #343a43; font-size: 11px; line-height: 1.2; }
    .warn { width: 15px; height: 15px; flex: 0 0 auto; color: #d58100; }
    .copyright { margin: 0; color: #3f4652; font-size: 11px; }
    .footer { display: flex; justify-content: flex-end; align-items: center; height: 42px; margin-top: auto; padding: 0 14px; border-top: 1px solid #dce1e8; background: #ffffff; }
    .close { min-width: 70px; height: 28px; border: 0; border-radius: 5px; background: #0b66d8; color: #ffffff; cursor: pointer; font-size: 12px; font-weight: 600; line-height: 28px; }
    .close:hover { background: #095bc2; }
  </style>
</head>
<body>
  <main class="about">
    <section class="main">
      <section class="hero">
        <div class="logo-wrap"><img class="logo" src="${logoUrl}" alt="YAMI Logo" /></div>
        <div>
          <h1 class="title">YAMI&#30011;&#24067;&#25209;&#27880;</h1>
          <p class="description">&#19968;&#27454;&#29992;&#20110;&#22270;&#29255;&#25209;&#27880;&#12289;&#20462;&#25913;&#24847;&#35265;&#26631;&#27880;&#21644;&#24037;&#31243;&#25991;&#20214;&#20445;&#23384;&#30340;&#26700;&#38754;&#24037;&#20855;&#12290;</p>
          <p class="version">&#29256;&#26412;&#65306; v1.0.0</p>
        </div>
      </section>

      <section class="info-card" aria-label="&#24212;&#29992;&#20449;&#24687;">
        <div class="row">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/></svg>
          <div class="label">&#24320;&#21457;&#32773;&#65306;</div>
          <div class="value">&#21271;&#20140;&#24066;&#38597;&#35269;&#20449;&#24687;&#31185;&#25216;&#24037;&#20316;&#23460;&#65288;YAMI&#65289;</div>
        </div>
        <div class="row">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.3 11.3 0 0 0-3.57 22.03c.57.1.78-.25.78-.55v-2.12c-3.18.69-3.85-1.35-3.85-1.35-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.54-.29-5.21-1.27-5.21-5.65 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.45.11-3.03 0 0 .96-.31 3.15 1.17A10.9 10.9 0 0 1 12 5.47c.97 0 1.95.13 2.86.38 2.18-1.48 3.14-1.17 3.14-1.17.62 1.58.23 2.74.11 3.03.74.8 1.18 1.82 1.18 3.07 0 4.39-2.68 5.36-5.23 5.64.41.35.77 1.04.77 2.1v3.66c0 .3.2.66.79.55A11.3 11.3 0 0 0 12 .7Z"/></svg>
          <div class="label">GitHub&#65306;</div>
          <div class="value"><a href="${githubUrl}" target="_blank" rel="noreferrer">github.com/aincn/YAMI-Canvas-Annotation<span class="external">&#8599;</span></a></div>
        </div>
        <div class="row">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M21 12a8 8 0 0 1-8 8H7l-4 3 1.5-5A8 8 0 1 1 21 12Z"/><path fill="currentColor" d="M8 12a1.2 1.2 0 1 0 0-2.4A1.2 1.2 0 0 0 8 12Zm4 0a1.2 1.2 0 1 0 0-2.4A1.2 1.2 0 0 0 12 12Zm4 0a1.2 1.2 0 1 0 0-2.4A1.2 1.2 0 0 0 16 12Z"/></svg>
          <div class="label">&#21453;&#39304;&#65306;</div>
          <div class="value"><a href="${githubIssuesUrl}" target="_blank" rel="noreferrer">GitHub Issues<span class="external">&#8599;</span></a></div>
        </div>
        <div class="row">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M14 2v5h5M8.5 13h7M8.5 17h7M8.5 9H11"/></svg>
          <div class="label">&#24320;&#28304;&#21327;&#35758;&#65306;</div>
          <div class="value"><a href="https://opensource.org/license/mit" target="_blank" rel="noreferrer">MIT License</a></div>
        </div>
      </section>

      <p class="footnote"><svg class="warn" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 8v5"/><circle cx="12" cy="16.5" r="1" fill="currentColor"/></svg>&#26412;&#36719;&#20214;&#25353;&#29616;&#29366;&#25552;&#20379;&#65292;&#19981;&#20316;&#20219;&#20309;&#25285;&#20445;&#65292;&#20351;&#29992;&#39118;&#38505;&#30001;&#29992;&#25143;&#33258;&#34892;&#25215;&#25285;&#12290;</p>
      <p class="copyright">&copy; 2026 &#21271;&#20140;&#24066;&#38597;&#35269;&#20449;&#24687;&#31185;&#25216;&#24037;&#20316;&#23460;&#65288;YAMI&#65289;</p>
    </section>
    <footer class="footer"><button class="close" onclick="window.close()">&#20851;&#38381;</button></footer>
  </main>
</body>
</html>`)
}
function openAboutWindow() {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus()
    return
  }

  aboutWindow = new BrowserWindow({
    width: 740,
    height: 370,
    useContentSize: true,
    minWidth: 640,
    minHeight: 360,
    parent: mainWindow ?? undefined,
    modal: false,
    title: '\u5173\u4e8e YAMI\u753b\u5e03\u6279\u6ce8',
    icon: getAppIconPath(),
    backgroundColor: '#f6f7f9',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  aboutWindow.setMenu(null)
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === githubUrl || url === githubIssuesUrl) void shell.openExternal(url)
    return { action: 'deny' }
  })
  aboutWindow.webContents.on('will-navigate', (event, url) => {
    if (url === githubUrl || url === githubIssuesUrl) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
  aboutWindow.on('closed', () => {
    aboutWindow = null
  })
  aboutWindow.loadURL(`data:text/html;charset=utf-8,${aboutWindowHtml()}`)
}

function helpWindowHtml() {
  return encodeURIComponent(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
  <style>
    :root {
      color: #111827;
      background: #ffffff;
      font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; overflow: hidden; background: #ffffff; }
    .help { position: relative; display: flex; height: 100vh; flex-direction: column; background: #ffffff; padding: 14px 24px 16px; }
    .header { display: grid; grid-template-columns: 46px minmax(0, 1fr); align-items: center; gap: 14px; margin-bottom: 11px; }
    .hero-icon { display: grid; width: 46px; height: 46px; place-items: center; border-radius: 11px; background: linear-gradient(135deg, #6aa9ff 0%, #3d86f6 100%); color: #ffffff; box-shadow: 0 8px 18px rgba(61, 134, 246, 0.22); }
    h1 { margin: 0; color: #111827; font-size: 25px; font-weight: 800; line-height: 1.1; }
    .subtitle { margin: 4px 0 0; color: #5f6673; font-size: 12px; }
    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 11px 14px; }
    .card { min-height: 73px; border: 1px solid #e1e5ec; border-radius: 9px; background: #ffffff; padding: 10px 12px 9px; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.03); }
    .card-head { display: flex; align-items: center; gap: 9px; margin-bottom: 7px; }
    .card-icon { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border-radius: 999px; color: #ffffff; }
    .green { background: linear-gradient(135deg, #7ee08f, #44c760); }
    .orange { background: linear-gradient(135deg, #ffc36f, #ff9d35); }
    .purple { background: linear-gradient(135deg, #c786ff, #9755e8); }
    .blue { background: linear-gradient(135deg, #7bb5ff, #3d86f6); }
    .teal { background: linear-gradient(135deg, #70dedb, #39bdb8); }
    .yellow { background: linear-gradient(135deg, #ffd356, #f5ad14); }
    .card h2 { margin: 0; color: #161b22; font-size: 14px; font-weight: 800; line-height: 1.2; }
    ul { margin: 0; padding-left: 15px; color: #2f3640; font-size: 10px; line-height: 1.6; }
    li { padding-left: 2px; }
    .tip { display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 10px; margin-top: 12px; border: 1px solid #bfdbfe; border-radius: 9px; background: #eff7ff; padding: 9px 14px; }
    .tip-icon { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 999px; background: linear-gradient(135deg, #76b7ff, #3d86f6); color: #ffffff; }
    .tip strong { display: block; margin-bottom: 2px; color: #2680eb; font-size: 13px; font-weight: 800; }
    .tip p { margin: 0; color: #2f3640; font-size: 11px; }
    svg { display: block; }
  </style>
</head>
<body>
  <main class="help">
    <header class="header">
      <div class="hero-icon">
        <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10"/><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="m14 14-2-2.5L8 16h7"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="m18 18 3 3m0-3-3 3"/></svg>
      </div>
      <div>
        <h1>使用说明</h1>
        <p class="subtitle">快速了解 YAMI画布批注的主要功能</p>
      </div>
    </header>

    <section class="cards">
      <article class="card">
        <div class="card-head"><div class="card-icon green"><svg width="23" height="23" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 5h16v14H4zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-1 5 3-3.5 2.2 2.3 2.4-3.2L19 16"/></svg></div><h2>1. 导入图片</h2></div>
        <ul><li>拖入图片或按 Ctrl+V 粘贴图片</li><li>支持多张图片同时放入画布</li></ul>
      </article>
      <article class="card">
        <div class="card-head"><div class="card-icon orange"><svg width="23" height="23" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m15 5 4 4L9 19H5v-4L15 5Zm-2 14h7"/></svg></div><h2>2. 添加批注</h2></div>
        <ul><li>切换到批注模式</li><li>从问题位置拖出箭头，松开后输入说明</li></ul>
      </article>
      <article class="card">
        <div class="card-head"><div class="card-icon purple"><svg width="23" height="23" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="m15 5 4 4L9 19H5v-4L15 5Zm-2 14h7"/></svg></div><h2>3. 编辑批注</h2></div>
        <ul><li>点击文字框可继续编辑</li><li>选中批注后可删除或调整大小</li></ul>
      </article>
      <article class="card">
        <div class="card-head"><div class="card-icon blue"><svg width="23" height="23" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M3 7h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg></div><h2>4. 工程文件</h2></div>
        <ul><li>导出工程可保存当前进度</li><li>导入工程可继续上次修改</li></ul>
      </article>
      <article class="card">
        <div class="card-head"><div class="card-icon teal"><svg width="23" height="23" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 8h3l2-3h6l2 3h3v11H4V8Zm8 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/></svg></div><h2>5. 截图功能</h2></div>
        <ul><li>使用快捷键快速截图</li><li>截图后可自动加入当前画布</li></ul>
      </article>
      <article class="card">
        <div class="card-head"><div class="card-icon yellow"><svg width="23" height="23" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 6h16v12H4zM8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/></svg></div><h2>6. 快捷键</h2></div>
        <ul><li>Ctrl+V 粘贴图片</li><li>Ctrl+Z 撤回　 Ctrl+Y 重做</li><li>Delete 删除选中对象</li></ul>
      </article>
    </section>

    <section class="tip">
      <div class="tip-icon"><svg width="22" height="22" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 18h6M10 22h4M8.5 14.5A6 6 0 1 1 15.5 14.5c-.8.6-1.5 1.3-1.5 2.5h-4c0-1.2-.7-1.9-1.5-2.5Z"/></svg></div>
      <div><strong>小提示</strong><p>建议在多轮修改时及时导出工程，方便下次继续编辑。</p></div>
    </section>
  </main>
</body>
</html>`)
}

function openHelpWindow() {
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.focus()
    return
  }

  helpWindow = new BrowserWindow({
    width: 740,
    height: 370,
    useContentSize: true,
    minWidth: 640,
    minHeight: 360,
    parent: mainWindow ?? undefined,
    modal: false,
    title: '使用说明',
    icon: getAppIconPath(),
    backgroundColor: '#f6f7f9',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  helpWindow.setMenu(null)
  helpWindow.on('closed', () => {
    helpWindow = null
  })
  helpWindow.loadURL(`data:text/html;charset=utf-8,${helpWindowHtml()}`)
}

function projectFileName() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `YAMI画布批注_${stamp}.yami`
}

function installChineseMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '导入工程', accelerator: 'CmdOrCtrl+O', click: () => sendMenuCommand('import-project') },
        { label: '导出工程', accelerator: 'CmdOrCtrl+S', click: () => sendMenuCommand('export-project') },
        { label: '导入图片', accelerator: 'CmdOrCtrl+I', click: () => sendMenuCommand('import-images') },
        { label: '清空画布', click: () => sendMenuCommand('clear-canvas') },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤回', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuCommand('undo') },
        { label: '重做', accelerator: 'CmdOrCtrl+Y', click: () => sendMenuCommand('redo') },
        { label: '删除选中对象', accelerator: 'Delete', click: () => sendMenuCommand('delete-selected') },
        { type: 'separator' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', click: () => sendMenuCommand('select-all') },
        { label: '取消选择', accelerator: 'Esc', click: () => sendMenuCommand('clear-selection') },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '放大', accelerator: 'CmdOrCtrl+=', click: () => sendMenuCommand('zoom-in') },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => sendMenuCommand('zoom-out') },
        { label: '恢复 100%', accelerator: 'CmdOrCtrl+0', click: () => sendMenuCommand('zoom-reset') },
        { label: '适应窗口', click: () => sendMenuCommand('fit-window') },
        { label: '显示/隐藏网格', click: () => sendMenuCommand('toggle-grid') },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '最大化', click: () => mainWindow?.maximize() },
        { label: '还原窗口', click: () => mainWindow?.unmaximize() },
        { label: '全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于 YAMI画布批注', click: () => openAboutWindow() },
        { label: '使用说明', click: () => openHelpWindow() },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
function createWindow() {
  rendererReady = false
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 900,
    minHeight: 600,
    center: true,
    maximizable: true,
    resizable: true,
    fullscreen: false,
    title: 'YAMI画布批注',
    icon: getAppIconPath(),
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('close', (event) => {
    if (allowWindowClose) return
    if (!rendererReady || mainWindow?.webContents.isCrashed()) {
      allowWindowClose = true
      return
    }
    event.preventDefault()
    mainWindow?.webContents.send('window:close-requested')
  })
  mainWindow.webContents.on('render-process-gone', () => {
    rendererReady = false
  })
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingShortcutStatus) sendRendererEvent('screenshot:shortcut-status', pendingShortcutStatus)
  })
}

function screenshotOverlayHtml(bounds: Rectangle) {
  return encodeURIComponent(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      cursor: crosshair;
      user-select: none;
      background: transparent;
      font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
    }
    .mask {
      position: fixed;
      background: rgba(15, 23, 42, 0.36);
      pointer-events: none;
    }
    #selection {
      position: fixed;
      display: none;
      box-sizing: border-box;
      border: 2px solid #2f80ed;
      background: transparent;
      box-shadow: 0 8px 30px rgba(15, 23, 42, 0.28);
      pointer-events: none;
    }
    #hint {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      border-radius: 8px;
      background: rgba(17, 24, 39, 0.88);
      color: #fff;
      padding: 10px 14px;
      font-size: 14px;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="hint">拖拽选择截图区域，按 Esc 取消</div>
  <div id="maskTop" class="mask"></div>
  <div id="maskBottom" class="mask"></div>
  <div id="maskLeft" class="mask"></div>
  <div id="maskRight" class="mask"></div>
  <div id="selection"></div>
  <script>
    const { ipcRenderer } = require('electron')
    const selection = document.getElementById('selection')
    const masks = {
      top: document.getElementById('maskTop'),
      bottom: document.getElementById('maskBottom'),
      left: document.getElementById('maskLeft'),
      right: document.getElementById('maskRight')
    }
    let dragging = false
    let startX = 0
    let startY = 0

    function draw(x, y) {
      const left = Math.min(startX, x)
      const top = Math.min(startY, y)
      const width = Math.abs(x - startX)
      const height = Math.abs(y - startY)
      selection.style.display = 'block'
      selection.style.left = left + 'px'
      selection.style.top = top + 'px'
      selection.style.width = width + 'px'
      selection.style.height = height + 'px'
      masks.top.style.left = '0px'
      masks.top.style.top = '0px'
      masks.top.style.width = window.innerWidth + 'px'
      masks.top.style.height = top + 'px'
      masks.bottom.style.left = '0px'
      masks.bottom.style.top = (top + height) + 'px'
      masks.bottom.style.width = window.innerWidth + 'px'
      masks.bottom.style.height = Math.max(0, window.innerHeight - top - height) + 'px'
      masks.left.style.left = '0px'
      masks.left.style.top = top + 'px'
      masks.left.style.width = left + 'px'
      masks.left.style.height = height + 'px'
      masks.right.style.left = (left + width) + 'px'
      masks.right.style.top = top + 'px'
      masks.right.style.width = Math.max(0, window.innerWidth - left - width) + 'px'
      masks.right.style.height = height + 'px'
    }

    window.addEventListener('mousedown', (event) => {
      dragging = true
      startX = event.clientX
      startY = event.clientY
      draw(startX, startY)
    })

    window.addEventListener('mousemove', (event) => {
      if (!dragging) return
      draw(event.clientX, event.clientY)
    })

    window.addEventListener('mouseup', (event) => {
      if (!dragging) return
      dragging = false
      const left = Math.min(startX, event.clientX)
      const top = Math.min(startY, event.clientY)
      const width = Math.abs(event.clientX - startX)
      const height = Math.abs(event.clientY - startY)
      ipcRenderer.send('screenshot:selection', {
        x: left + ${bounds.x},
        y: top + ${bounds.y},
        width,
        height
      })
    })

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') ipcRenderer.send('screenshot:cancel')
    })
  </script>
</body>
</html>`)
}

async function captureScreenSelection(selection: Rectangle) {
  const display = screen.getDisplayMatching(selection)
  const scaleFactor = display.scaleFactor || 1
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.bounds.width * scaleFactor),
      height: Math.round(display.bounds.height * scaleFactor),
    },
  })
  const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0]

  if (!source) throw new Error('No screen source available')

  const thumbnailSize = source.thumbnail.getSize()
  const crop = {
    x: Math.max(0, Math.round((selection.x - display.bounds.x) * scaleFactor)),
    y: Math.max(0, Math.round((selection.y - display.bounds.y) * scaleFactor)),
    width: Math.min(thumbnailSize.width, Math.round(selection.width * scaleFactor)),
    height: Math.min(thumbnailSize.height, Math.round(selection.height * scaleFactor)),
  }
  crop.width = Math.min(crop.width, thumbnailSize.width - crop.x)
  crop.height = Math.min(crop.height, thumbnailSize.height - crop.y)
  if (crop.width < 1 || crop.height < 1) throw new Error('Invalid screenshot selection')
  const cropped = source.thumbnail.crop(crop)
  const size = cropped.getSize()
  return {
    dataUrl: cropped.toDataURL(),
    width: size.width,
    height: size.height,
    name: `鎴浘_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`,
  }
}

function closeScreenshotOverlay() {
  if (!screenshotOverlay) return
  const overlay = screenshotOverlay
  screenshotOverlay = null
  if (!overlay.isDestroyed()) overlay.close()
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function startScreenshotSelection() {
  if (screenshotOverlay) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  screenshotOverlay = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    fullscreenable: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  })
  screenshotOverlay.setAlwaysOnTop(true, 'screen-saver')
  screenshotOverlay.loadURL(`data:text/html;charset=utf-8,${screenshotOverlayHtml(display.bounds)}`)
  screenshotOverlay.once('ready-to-show', () => screenshotOverlay?.focus())
  screenshotOverlay.on('closed', () => {
    screenshotOverlay = null
  })
}

function registerScreenshotShortcut() {
  const registered = globalShortcut.register('CommandOrControl+Alt+A', () => {
    startScreenshotSelection()
  })
  if (!registered) {
    pendingShortcutStatus = {
      ok: false,
      message: '截图快捷键注册失败，可能已被其他软件占用。',
    }
    sendRendererEvent('screenshot:shortcut-status', pendingShortcutStatus)
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.yami.canvas-annotation')
  installChineseMenu()
  createWindow()
  registerScreenshotShortcut()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('clipboard:read-image', () => {
  const image = clipboard.readImage()
  if (image.isEmpty()) return null
  const size = image.getSize()
  return {
    dataUrl: image.toDataURL(),
    width: size.width,
    height: size.height,
  }
})

ipcMain.handle('files:read-images', async (_event, filePaths: string[]) => {
  const supported = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
  const results = []

  for (const filePath of filePaths) {
    const ext = path.extname(filePath).toLowerCase()
    if (!supported.has(ext)) continue
    const bytes = await fs.readFile(filePath)
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) continue
    const size = image.getSize()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
    results.push({
      dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
      width: size.width,
      height: size.height,
      name: path.basename(filePath),
    })
  }

  return results
})

ipcMain.handle('dialog:open-images', async () => {
  if (!mainWindow) return []
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入图片',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  })
  if (result.canceled) return []
  return readImageFiles(result.filePaths)
})

ipcMain.handle('project:save', async (_event, project: unknown) => {
  if (!mainWindow) return { canceled: true }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出工程',
    defaultPath: projectFileName(),
    filters: [{ name: 'YAMI工程文件', extensions: ['yami'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await fs.writeFile(result.filePath, JSON.stringify(project, null, 2), 'utf-8')
  return { canceled: false, filePath: result.filePath }
})

ipcMain.handle('project:open', async () => {
  if (!mainWindow) return { canceled: true }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入工程',
    properties: ['openFile'],
    filters: [{ name: 'YAMI工程文件', extensions: ['yami'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }
  const filePath = result.filePaths[0]
  const content = await fs.readFile(filePath, 'utf-8')
  return { canceled: false, filePath, project: JSON.parse(content) }
})

ipcMain.handle('project:read', async (_event, filePath: string) => {
  if (path.extname(filePath).toLowerCase() !== '.yami') return { canceled: true }
  const content = await fs.readFile(filePath, 'utf-8')
  return { canceled: false, filePath, project: JSON.parse(content) }
})

ipcMain.handle('window:close-now', () => {
  allowWindowClose = true
  mainWindow?.close()
})

ipcMain.on('renderer:ready', () => {
  rendererReady = true
})

async function readImageFiles(filePaths: string[]) {
  const supported = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
  const results = []
  for (const filePath of filePaths) {
    const ext = path.extname(filePath).toLowerCase()
    if (!supported.has(ext)) continue
    const bytes = await fs.readFile(filePath)
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) continue
    const size = image.getSize()
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
    results.push({
      dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
      width: size.width,
      height: size.height,
      name: path.basename(filePath),
    })
  }
  return results
}

ipcMain.handle('window:toggle-fullscreen', () => {
  if (!mainWindow) return false
  mainWindow.setFullScreen(!mainWindow.isFullScreen())
  return mainWindow.isFullScreen()
})

ipcMain.handle('window:show-main', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

ipcMain.on('screenshot:cancel', () => {
  closeScreenshotOverlay()
})

ipcMain.on('screenshot:selection', async (_event, selection: Rectangle) => {
  if (selection.width < 4 || selection.height < 4) {
    closeScreenshotOverlay()
    return
  }
  try {
    screenshotOverlay?.hide()
    await delay(120)
    const image = await captureScreenSelection(selection)
    closeScreenshotOverlay()
    sendRendererEvent('screenshot:captured', image)
  } catch {
    closeScreenshotOverlay()
    sendRendererEvent('screenshot:error', '截图失败，请重试。')
  }
})



