const mainMenu = document.getElementById('main-menu');
const authView = document.getElementById('auth-view');
const authTitle = document.getElementById('auth-title');
const roomView = document.getElementById('room-view');
const btnShowCreate = document.getElementById('btn-show-create');
const btnShowJoin = document.getElementById('btn-show-join');
const btnAction = document.getElementById('btn-action');
const btnBack = document.getElementById('btn-back');
const btnLeave = document.getElementById('btn-leave');
const btnRefresh = document.getElementById('btn-refresh');
const btnToggleSync = document.getElementById('btn-toggle-sync');
const inputDeviceName = document.getElementById('device-name');
const inputRoomId = document.getElementById('room-id');
const inputRoomPassword = document.getElementById('room-password');
const passwordHint = document.getElementById('password-hint');
const errorMsg = document.getElementById('error-msg');
const displayRoomId = document.getElementById('display-room-id');
const displayDeviceName = document.getElementById('display-device-name');
const displayUsers = document.getElementById('display-users');
const logsDiv = document.getElementById('logs');
const toggleLogs = document.getElementById('toggle-logs');
const logsArrow = document.getElementById('logs-arrow');
const tagline = document.getElementById('tagline');
const connectionStatus = document.getElementById('connection-status');
const btnBroadcast = document.getElementById('btn-broadcast');
const broadcastText = document.getElementById('broadcast-text');
const btnShowSettings = document.getElementById('btn-show-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const settingsMenu = document.getElementById('settings-menu');
const settingServerUrl = document.getElementById('setting-server-url');

let isSyncing = true;
let currentMode = '';
let ownSocketId = null;
let isCreator = false;
let roomUsersList = [];
let syncExcludeSet = new Set();
let checkRoomTimer = null;
let currentServerUrl = 'https://server.uniclip.online/';

async function init() {
  const hostname = await window.electronAPI.getHostname();
  inputDeviceName.value = hostname || 'Windows PC';
  settingServerUrl.value = currentServerUrl;
}
init();

function addLog(message) {
  const div = document.createElement('div');
  div.className = 'log-item';
  div.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
  logsDiv.prepend(div);
}

toggleLogs.addEventListener('click', () => {
  if (logsDiv.style.display === 'none') {
    logsDiv.style.display = 'block';
    logsArrow.innerText = '▼';
  } else {
    logsDiv.style.display = 'none';
    logsArrow.innerText = '▶';
  }
});

btnBroadcast.addEventListener('click', () => {
  const text = broadcastText.value.trim();
  if (text) {
    window.electronAPI.broadcast(text);
    broadcastText.value = '';
  }
});

btnShowSettings.addEventListener('click', () => {
  mainMenu.style.display = 'none';
  settingsMenu.style.display = 'block';
  tagline.style.display = 'none';
});

btnCloseSettings.addEventListener('click', () => {
  settingsMenu.style.display = 'none';
  mainMenu.style.display = 'flex';
  tagline.style.display = 'block';
});

btnSaveSettings.addEventListener('click', () => {
  const url = settingServerUrl.value.trim();
  if (url) {
    currentServerUrl = url;
    window.electronAPI.setServerUrl(url);
    addLog(`Server URL updated to: ${url}`);
    settingsMenu.style.display = 'none';
    mainMenu.style.display = 'flex';
    tagline.style.display = 'block';
  }
});

function setConnectionState(state) {
  connectionStatus.innerText = state === 'connected' ? 'Connected' : state === 'disconnected' ? 'Disconnected' : 'Connection Error';
  connectionStatus.className = state === 'connected' ? 'status-connected' : state === 'disconnected' ? 'status-disconnected' : 'status-error';
}

window.electronAPI.onConnectionState((state) => {
  setConnectionState(state);
  if (state === 'disconnected' && roomView.style.display === 'flex') {
    hideRoom();
    errorMsg.innerText = 'Connection lost.';
  }
});

window.electronAPI.onLogMessage((message) => {
  addLog(message);
});

window.electronAPI.onSyncStateChanged((state) => {
  isSyncing = state;
  btnToggleSync.innerText = isSyncing ? 'Pause Syncing' : 'Resume Syncing';
  btnToggleSync.style.backgroundColor = isSyncing ? '#f39c12' : '#4CAF50';
  addLog(isSyncing ? 'Syncing resumed.' : 'Syncing paused.');
});

window.electronAPI.onUpdateUsers(async (users) => {
  roomUsersList = users;
  ownSocketId = await window.electronAPI.getOwnSocketId();
  renderUsers();
});

window.electronAPI.onForceLeave((data) => {
  hideRoom();
  errorMsg.innerText = data.message || 'You were removed from the room.';
});

function renderUsers() {
  const me = roomUsersList.find(u => u.socketId === ownSocketId);
  isCreator = me ? me.isCreator : false;

  displayUsers.innerHTML = '';
  roomUsersList.forEach(user => {
    const isSelf = user.socketId === ownSocketId;
    const isExcluded = syncExcludeSet.has(user.socketId);

    const item = document.createElement('div');
    item.className = 'user-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.innerText = user.deviceName;
    if (user.isCreator) {
      const badge = document.createElement('span');
      badge.className = 'creator-badge';
      badge.innerText = ' (Owner)';
      nameSpan.appendChild(badge);
    }
    if (isSelf) {
      const selfLabel = document.createElement('span');
      selfLabel.style.color = '#61dafb';
      selfLabel.style.fontSize = '11px';
      selfLabel.innerText = ' (you)';
      nameSpan.appendChild(selfLabel);
    }
    item.appendChild(nameSpan);

    if (!isSelf) {
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'sync-toggle ' + (isExcluded ? 'inactive' : 'active');
      toggleBtn.innerText = isExcluded ? 'Blocked' : 'Syncing';
      toggleBtn.title = isExcluded ? 'Click to allow syncing' : 'Click to block syncing';
      toggleBtn.addEventListener('click', () => {
        if (isExcluded) {
          syncExcludeSet.delete(user.socketId);
        } else {
          syncExcludeSet.add(user.socketId);
        }
        window.electronAPI.updateSyncPreferences([...syncExcludeSet]);
        renderUsers();
      });
      item.appendChild(toggleBtn);
    }

    if (isCreator && !isSelf) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.innerText = 'Remove';
      removeBtn.addEventListener('click', async () => {
        const res = await window.electronAPI.removeUser(user.socketId);
        if (res && res.success) {
          addLog(`Removed ${user.deviceName} from room.`);
        } else {
          addLog(`Failed to remove ${user.deviceName}: ${res?.message || 'error'}`);
        }
      });
      item.appendChild(removeBtn);
    }

    displayUsers.appendChild(item);
  });
}

function showRoom(roomId, deviceName) {
  displayRoomId.innerText = roomId;
  displayDeviceName.innerText = deviceName;

  isSyncing = true;
  btnToggleSync.innerText = 'Pause Syncing';
  btnToggleSync.style.backgroundColor = '#f39c12';

  mainMenu.style.display = 'none';
  authView.style.display = 'none';
  tagline.style.display = 'none';
  roomView.style.display = 'flex';

  errorMsg.innerText = '';
  logsDiv.innerHTML = '';
  addLog('Joined room successfully.');
}

btnToggleSync.addEventListener('click', () => {
  isSyncing = !isSyncing;
  window.electronAPI.toggleSync(isSyncing);
  if (isSyncing) {
    btnToggleSync.innerText = 'Pause Syncing';
    btnToggleSync.style.backgroundColor = '#f39c12';
    addLog('Syncing resumed.');
  } else {
    btnToggleSync.innerText = 'Resume Syncing';
    btnToggleSync.style.backgroundColor = '#4CAF50';
    addLog('Syncing paused.');
  }
});

function hideRoom() {
  mainMenu.style.display = 'flex';
  authView.style.display = 'none';
  roomView.style.display = 'none';
  tagline.style.display = 'block';
  inputRoomId.value = '';
  roomUsersList = [];
  syncExcludeSet = new Set();
}

btnShowCreate.addEventListener('click', () => {
  currentMode = 'create';
  authTitle.innerText = 'Create Room';
  btnAction.innerText = 'Create';
  mainMenu.style.display = 'none';
  authView.style.display = 'flex';
  errorMsg.innerText = '';
  inputRoomPassword.style.display = 'block';
  inputRoomPassword.placeholder = 'Room Password (optional)';
  passwordHint.style.display = 'none';
});

btnShowJoin.addEventListener('click', () => {
  currentMode = 'join';
  authTitle.innerText = 'Join Room';
  btnAction.innerText = 'Join';
  mainMenu.style.display = 'none';
  authView.style.display = 'flex';
  errorMsg.innerText = '';
  inputRoomPassword.style.display = 'block';
  inputRoomPassword.placeholder = 'Room Password (if required)';
});

btnBack.addEventListener('click', () => {
  mainMenu.style.display = 'flex';
  authView.style.display = 'none';
  errorMsg.innerText = '';
});

inputRoomId.addEventListener('input', () => {
  if (currentMode !== 'join') return;
  clearTimeout(checkRoomTimer);
  const roomId = inputRoomId.value.trim();
  if (!roomId) {
    inputRoomPassword.style.display = 'none';
    passwordHint.style.display = 'none';
    return;
  }
  checkRoomTimer = setTimeout(async () => {
    const info = await window.electronAPI.checkRoom(roomId);
    if (info.exists) {
      inputRoomPassword.style.display = 'block';
      if (info.passwordRequired) {
        inputRoomPassword.placeholder = 'Room Password (required)';
        passwordHint.innerHTML = '<span class="password-lock">This room requires a password</span>';
        passwordHint.style.display = 'block';
      } else {
        inputRoomPassword.placeholder = 'Room Password (not required)';
        passwordHint.innerText = 'No password required';
        passwordHint.style.display = 'block';
      }
    } else {
      inputRoomPassword.style.display = 'none';
      passwordHint.style.display = 'none';
    }
  }, 500);
});

btnAction.addEventListener('click', async () => {
  const deviceName = inputDeviceName.value.trim() || 'Windows PC';
  const roomId = inputRoomId.value.trim();
  const password = inputRoomPassword.value.trim();

  if (!roomId) {
    errorMsg.innerText = 'Please enter a Room ID.';
    return;
  }

  btnAction.disabled = true;
  errorMsg.innerText = 'Connecting...';

  let response;
  if (currentMode === 'create') {
    response = await window.electronAPI.createRoom({ roomId, deviceName, password });
  } else {
    response = await window.electronAPI.joinRoom({ roomId, deviceName, password });
  }

  btnAction.disabled = false;
  if (response.success) {
    showRoom(roomId, deviceName);
  } else {
    errorMsg.innerText = response.message;
  }
});

btnLeave.addEventListener('click', async () => {
  const confirmed = await window.electronAPI.showLeaveConfirmation();
  if (confirmed) {
    window.electronAPI.leaveRoom();
    hideRoom();
  }
});

btnRefresh.addEventListener('click', async () => {
  btnRefresh.disabled = true;
  btnRefresh.innerText = 'Refreshing...';
  const ok = await window.electronAPI.refreshConnection();
  btnRefresh.disabled = false;
  btnRefresh.innerText = 'Refresh';
  if (ok) {
    addLog('State refreshed.');
    renderUsers();
  } else {
    addLog('Failed to refresh connection.');
  }
});
