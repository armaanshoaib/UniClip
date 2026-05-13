const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getHostname: () => ipcRenderer.invoke('get_hostname'),
  checkRoom: (roomId) => ipcRenderer.invoke('check_room', roomId),
  createRoom: (data) => ipcRenderer.invoke('create_room', data),
  joinRoom: (data) => ipcRenderer.invoke('join_room', data),
  leaveRoom: () => ipcRenderer.send('leave_room'),
  toggleSync: (state) => ipcRenderer.send('toggle_sync', state),
  broadcast: (text) => ipcRenderer.send('broadcast', text),
  setServerUrl: (url) => ipcRenderer.send('set_server_url', url),
  onLogMessage: (callback) => ipcRenderer.on('log_message', (_event, message) => callback(message)),
  onSyncStateChanged: (callback) => ipcRenderer.on('sync_state_changed', (_event, state) => callback(state)),
  onToastData: (callback) => ipcRenderer.on('toast_data', (_event, data) => callback(data)),
  onUpdateUsers: (callback) => ipcRenderer.on('update_users', (_event, users) => callback(users)),
  onConnectionState: (callback) => ipcRenderer.on('connection_state', (_event, state) => callback(state)),
  onForceLeave: (callback) => ipcRenderer.on('force_leave', (_event, data) => callback(data)),
  showLeaveConfirmation: () => ipcRenderer.invoke('show_leave_confirmation'),
  removeUser: (targetSocketId) => ipcRenderer.invoke('remove_user', targetSocketId),
  updateSyncPreferences: (excludeList) => ipcRenderer.send('update_sync_preferences', excludeList),
  getOwnSocketId: () => ipcRenderer.invoke('get_own_socket_id'),
  refreshConnection: () => ipcRenderer.invoke('refresh_connection'),
});
