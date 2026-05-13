# UniClip — Agent Guide

## Repo overview

Monorepo with 3 packages:
- **server/** — Node.js + Express + Socket.io relay server
- **electron-app/** — Windows desktop client (vanilla Electron)
- **flutter_app/** — Android client (Flutter + native Kotlin)

## Commands

```bash
cd server && npm start       # Relay server on port 3000
cd electron-app && npm start # Electron client (requires server)
cd flutter_app && flutter run # Android client (requires server)
```

No lint, typecheck, or test scripts exist. The test file (`flutter_app/test/widget_test.dart`) is stale boilerplate referencing a nonexistent `MyApp`.

## Architecture notes

### Server (`server/index.js`)
- Socket.io relay + Express HTTP server
- `POST /broadcast` endpoint for Android background accessibility service
- Rooms auto-delete when last user disconnects
- Supports optional room passwords (set by creator; joiners must match)
- Tracks room creator socket ID; `remove_user` event only works for creator
- Individual sync exclusions: `sync_preferences` event per-socket, `clipboard_update` skips excluded recipients
- Creator role transfers to next user when creator disconnects

### Electron client (`electron-app/main.js`)
- Polls clipboard every 1s; sends changes via Socket.io
- Hardcoded server: `http://localhost:3000`
- IPC bridge via `preload.js`, `contextIsolation: true`
- Device name auto-filled with `os.hostname()` (user can override)
- Single instance lock via `app.requestSingleInstanceLock()`
- Minimizes to system tray instead of closing; tray icon with Show/Quit menu
- Own socket ID tracked for identifying self in user list

### Flutter/Android client
- Polls clipboard every 1s (foreground); sends via Socket.io
- Device name auto-filled using `device_info_plus` (model/brand)
- Two background mechanisms bypassing Android 10+ clipboard restrictions:
  - **Accessibility Service** (`ClipboardAccessibilityService.kt`) — uses `POST /broadcast` HTTP endpoint
  - **Context Menu** (`ProcessTextActivity.kt`) — "UniClip Sync" option in text selection, also uses `POST /broadcast`
- Both background services read room/device/server from `FlutterSharedPreferences` (prefixed `flutter.`)
- Hardcoded LAN IP `http://192.168.29.241:3000` in `main.dart:102` and Kotlin defaults to `http://10.0.2.2:3000` (emulator)
- Android Accessibility Service must be manually enabled in system Settings; app shows warning on homepage if disabled and provides shortcut to settings
- `RefreshIndicator` pull-to-refresh on room view; manual refresh button

### URLs to update for new environments
- `electron-app/main.js` — `http://localhost:3000`
- `flutter_app/lib/main.dart` — LAN IP (two occurrences: `IO.io` and `_saveRoomPrefs`)
- `flutter_app/android/.../ClipboardAccessibilityService.kt:41` — default `10.0.2.2:3000`
- `flutter_app/android/.../ProcessTextActivity.kt:23` — default `10.0.2.2:3000`

## Conventions

- All JS: CommonJS (`require`)
- All JSON payloads use snake_case keys (`room_id`, `device_name`)
- Socket.io events: `create_room`, `join_room`, `leave_room`, `clipboard_update`, `room_users`, `user_joined`, `user_left`, `get_room_info`, `remove_user`, `sync_preferences`, `force_leave`
- `room_users` payload is now `[{socketId, deviceName, isCreator}]` (objects, not strings)
- Flutter uses `socket_io_client` v3, not the `web_socket_channel` package
- Method channel `com.example.flutter_app/uniclip`: methods `moveToBack`, `isAccessibilityEnabled`, `openAccessibilitySettings`, `onProcessText`
