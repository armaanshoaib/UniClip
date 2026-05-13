const { app, BrowserWindow, ipcMain, clipboard, dialog, Tray, Menu, nativeImage } = require('electron');
if (require('electron-squirrel-startup')) app.quit();

const path = require('path');
const os = require('os');
const { io } = require('socket.io-client');

let mainWindow;
let tray;
let toastWindow;
let currentClipboardContent = '';
let pollingInterval;
let socket;
let currentRoomId = null;
let currentDeviceName = null;
let isSyncing = true;
let ownSocketId = null;
let isCreator = false;
let syncExcludeSet = new Set();
let serverUrl = 'https://server.uniclip.online/';

const ICON_PATH = path.join(__dirname, 'uniclip_icon_electron.png');

app.setAppUserModelId('com.uniclip.app');
// Set relaunch command to help with jump lists during dev
app.setAsDefaultProtocolClient('uniclip');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 700,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

function createToastWindow() {
  toastWindow = new BrowserWindow({
    width: 300,
    height: 120,
    show: false,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    }
  });

  const toastHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { background: #2d2d2d; color: white; font-family: sans-serif; margin: 0; padding: 15px; border: 1px solid #61dafb; overflow: hidden; }
        .title { color: #61dafb; font-size: 14px; font-weight: bold; margin-bottom: 5px; }
        .text { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #eee; margin-bottom: 10px; }
        .actions { display: flex; justify-content: space-between; align-items: center; }
        button { background: #ff6b6b; color: white; border: none; padding: 4px 8px; border-radius: 3px; font-size: 11px; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="title">Synced Successfully</div>
      <div id="text" class="text"></div>
      <div class="actions">
        <span style="font-size: 10px; color: #888;">UniClip</span>
        <button onclick="window.electronAPI.toggleSync(false); window.close();">Stop Syncing</button>
      </div>
      <script>
        window.electronAPI.onToastData((data) => {
          document.getElementById('text').innerText = data;
        });
      </script>
    </body>
    </html>
  `;
  toastWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toastHtml)}`);

  toastWindow.on('closed', () => {
    toastWindow = null;
  });
}

function showToast(text) {
  if (!toastWindow || toastWindow.isDestroyed()) {
    createToastWindow();
  }
  
  if (toastWindow && !toastWindow.isDestroyed()) {
    toastWindow.webContents.send('toast_data', text);
    
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    
    toastWindow.setPosition(width - 320, height - 140);
    toastWindow.show();
    
    setTimeout(() => {
      if (toastWindow && !toastWindow.isDestroyed()) {
        toastWindow.hide();
      }
    }, 2500);
  }
}

function createTray() {
  tray = new Tray(ICON_PATH);
  tray.setToolTip('UniClip');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show UniClip',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    //{ type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  createWindow();
  createToastWindow();
  createTray();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      createToastWindow();
    }
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get_hostname', () => os.hostname());

function connectSocket() {
  return new Promise((resolve, reject) => {
    if (socket?.connected) {
      return resolve();
    }

    if (!socket) {
      socket = io(serverUrl, {
        timeout: 5000,
      });

      socket.on('connect', () => {
        ownSocketId = socket.id;
        if (mainWindow) {
          mainWindow.webContents.send('connection_state', 'connected');
        }
      });

      socket.on('disconnect', () => {
        if (mainWindow) {
          mainWindow.webContents.send('connection_state', 'disconnected');
        }
      });

      socket.on('connect_error', () => {
        if (mainWindow) {
          mainWindow.webContents.send('connection_state', 'error');
        }
      });

      socket.on('clipboard_update', (data) => {
        if (!isSyncing) return;
        if (data.text && data.text !== currentClipboardContent) {
          currentClipboardContent = data.text;
          clipboard.writeText(data.text);
          if (mainWindow) {
            mainWindow.webContents.send('log_message', `Received from ${data.device_name}: ${data.text.substring(0, 50)}...`);
          }
        }
      });

      socket.on('user_joined', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('log_message', `${data.device_name} joined the room.`);
        }
      });

      socket.on('user_left', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('log_message', `${data.device_name} left the room.`);
        }
      });

      socket.on('room_users', (users) => {
        if (mainWindow) {
          mainWindow.webContents.send('update_users', users);
        }
        const me = users.find(u => u.socketId === ownSocketId);
        if (me) {
          isCreator = me.isCreator;
        }
      });

      socket.on('force_leave', (data) => {
        currentRoomId = null;
        currentDeviceName = null;
        isCreator = false;
        ownSocketId = null;
        syncExcludeSet = new Set();
        stopClipboardPolling();
        if (mainWindow) {
          mainWindow.webContents.send('force_leave', data);
        }
      });
    }

    socket.once('connect', () => resolve());
    socket.once('connect_error', (err) => reject(err));
  });
}

function startClipboardPolling() {
  currentClipboardContent = clipboard.readText();
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(() => {
    if (!isSyncing) return;
    const text = clipboard.readText();
    if (text !== currentClipboardContent && text.trim() !== '') {
      currentClipboardContent = text;
      if (socket && currentRoomId) {
        socket.emit('clipboard_update', { device_name: currentDeviceName, text: text });
        if (mainWindow) {
          mainWindow.webContents.send('log_message', `Sent: ${text.substring(0, 50)}...`);
        }
        showToast(text);
      }
    }
  }, 1000);
}

function stopClipboardPolling() {
  if (pollingInterval) clearInterval(pollingInterval);
}

ipcMain.on('broadcast', (event, text) => {
  if (socket && socket.connected && currentRoomId) {
    socket.emit('clipboard_update', { device_name: currentDeviceName, text: text });
    if (mainWindow) {
      mainWindow.webContents.send('log_message', `Broadcasted: ${text.substring(0, 50)}...`);
    }
  }
});

ipcMain.on('set_server_url', (event, url) => {
  serverUrl = url;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
});

ipcMain.handle('check_room', async (event, roomId) => {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve({ exists: false, passwordRequired: false });
      return;
    }
    socket.emit('get_room_info', { room_id: roomId }, (response) => {
      resolve(response || { exists: false, passwordRequired: false });
    });
  });
});

ipcMain.handle('create_room', async (event, { roomId, deviceName, password }) => {
  try {
    await connectSocket();
    return new Promise((resolve) => {
      socket.emit('create_room', { room_id: roomId, device_name: deviceName, password: password || null }, (response) => {
        if (response && response.success) {
          currentRoomId = roomId;
          currentDeviceName = deviceName;
          isCreator = true;
          startClipboardPolling();
        }
        resolve(response || { success: false, message: 'Server did not respond.' });
      });
    });
  } catch (err) {
    return { success: false, message: 'Failed to connect to server.' };
  }
});

ipcMain.handle('join_room', async (event, { roomId, deviceName, password }) => {
  try {
    await connectSocket();
    return new Promise((resolve) => {
      socket.emit('join_room', { room_id: roomId, device_name: deviceName, password: password || '' }, (response) => {
        if (response && response.success) {
          currentRoomId = roomId;
          currentDeviceName = deviceName;
          startClipboardPolling();
        }
        resolve(response || { success: false, message: 'Server did not respond.' });
      });
    });
  } catch (err) {
    return { success: false, message: 'Failed to connect to server.' };
  }
});

ipcMain.on('leave_room', () => {
  if (socket) socket.emit('leave_room');
  currentRoomId = null;
  currentDeviceName = null;
  isCreator = false;
  ownSocketId = null;
  syncExcludeSet = new Set();
  stopClipboardPolling();
});

ipcMain.on('toggle_sync', (event, syncState) => {
  isSyncing = syncState;
  if (mainWindow) {
    mainWindow.webContents.send('sync_state_changed', syncState);
  }
});

ipcMain.handle('show_leave_confirmation', async () => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Yes', 'No'],
    title: 'Confirm',
    message: 'Are you sure you want to leave the room?',
  });
  return result.response === 0;
});

ipcMain.handle('remove_user', async (event, targetSocketId) => {
  return new Promise((resolve) => {
    if (socket && socket.connected) {
      socket.emit('remove_user', { target_socket_id: targetSocketId }, (response) => {
        resolve(response || { success: false, message: 'Server did not respond.' });
      });
    } else {
      resolve({ success: false, message: 'Not connected.' });
    }
  });
});

ipcMain.on('update_sync_preferences', (event, excludeList) => {
  syncExcludeSet = new Set(excludeList);
  if (socket && socket.connected) {
    socket.emit('sync_preferences', { exclude: excludeList });
  }
});

ipcMain.handle('get_own_socket_id', () => ownSocketId);

ipcMain.handle('refresh_connection', async () => {
  if (socket && socket.connected) {
    return true;
  }
  if (socket && !socket.connected) {
    try {
      socket.connect();
      await new Promise((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', (err) => reject(err));
        setTimeout(() => reject(new Error('timeout')), 5000);
      });
      if (currentRoomId) {
        return new Promise((resolve) => {
          socket.emit('join_room', { room_id: currentRoomId, device_name: currentDeviceName }, (response) => {
            resolve(response && response.success ? true : false);
          });
        });
      }
      return true;
    } catch {
      return false;
    }
  }
  return false;
});
