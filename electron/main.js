const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: 'Daily Government Bulletin Studio v2.0',
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      spellcheck: false
    }
  });

  // Load the web application
  const appPath = path.join(__dirname, '..', 'bulletin_app', 'index.html');
  mainWindow.loadFile(appPath);

  // External links open in default OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // App keyboard shortcuts
  const menuTemplate = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Export Native PDF...',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => mainWindow.webContents.send('trigger-native-pdf')
        },
        {
          label: 'Print...',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow.webContents.print()
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('get-app-version', () => app.getVersion());

// High-fidelity background printToPDF
ipcMain.handle('print-to-pdf', async (event, customOptions = {}) => {
  if (!mainWindow) return { success: false, error: 'No active window' };

  try {
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Official Bulletin PDF',
      defaultPath: customOptions.defaultName || 'Swachhata_Daily_Bulletin.pdf',
      filters: [
        { name: 'PDF Documents', extensions: ['pdf'] }
      ]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true };
    }

    const pdfData = await mainWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margins: { marginType: 'none' }
    });

    await fs.promises.writeFile(saveResult.filePath, pdfData);
    return { success: true, filePath: saveResult.filePath };
  } catch (err) {
    console.error('printToPDF error:', err);
    return { success: false, error: err.message };
  }
});

// Native JSON Draft Save Dialog
ipcMain.handle('save-json-dialog', async (event, content, defaultName = 'bulletin_draft.json') => {
  if (!mainWindow) return { success: false };
  try {
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Bulletin Project Draft',
      defaultPath: defaultName,
      filters: [{ name: 'JSON Draft', extensions: ['json'] }]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true };
    }

    await fs.promises.writeFile(saveResult.filePath, content, 'utf8');
    return { success: true, filePath: saveResult.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Native JSON Draft Open Dialog
ipcMain.handle('open-json-dialog', async () => {
  if (!mainWindow) return { success: false };
  try {
    const openResult = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Bulletin Project Draft',
      filters: [{ name: 'JSON Draft', extensions: ['json'] }],
      properties: ['openFile']
    });

    if (openResult.canceled || openResult.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = openResult.filePaths[0];
    const data = await fs.promises.readFile(filePath, 'utf8');
    return { success: true, data, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
