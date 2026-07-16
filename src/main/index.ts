import "dotenv/config";
import { app, shell, BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync, renameSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'

// App renamed to "HappyVibe" (was the scaffold "hv-scaffold"). Preserve existing
// data — sessions, provider keys, settings — by migrating the userData dir once,
// before anything reads it. Runs at module load (app.getPath works pre-ready).
try {
  const appData = app.getPath('appData')
  const legacy = join(appData, 'hv-scaffold')
  const current = join(appData, app.getName()) // now "HappyVibe" (package.json productName)
  if (existsSync(legacy) && !existsSync(current)) renameSync(legacy, current)
} catch {
  /* non-fatal: fall back to a fresh userData dir */
}

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Open links in the OS browser, not inside the app window.
  // setWindowOpenHandler covers target=_blank / window.open; will-navigate
  // covers a plain <a href> click (e.g. links in chat answers), which would
  // otherwise navigate the whole SPA away from the app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL() && /^(https?|mailto):/.test(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('dev.happyvibe.app')

  // Dev dock icon: packaged builds use build/icon.icns (electron-builder), but
  // in dev the dock would show the default Electron icon — set ours explicitly.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(icon))
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const mainWindow = createWindow()
  registerIpc(mainWindow)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
