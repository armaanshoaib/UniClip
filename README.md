# UniClip: Cross-Device Clipboard Sync

UniClip is a real-time, scalable clipboard synchronization solution designed to seamlessly share text across Windows (Electron) and Mobile (Flutter/Android) devices using a central Node.js Socket.io server.

## Architecture & Workflow

UniClip utilizes a Hub-and-Spoke architecture:
* **Central Server (Hub)**: A Node.js backend managing temporary "Rooms." It relays clipboard updates from one device and broadcasts them to all other connected devices in the same room. It also maintains a real-time list of connected users.
* **Electron Client (Spoke)**: A Windows desktop application that polls the system clipboard and uses a Socket.io client to sync changes to the room. It handles background communication and provides a clean UI.
* **Flutter Client (Spoke)**: An Android app that manages background restrictions via two layers:
  * **PopScope / Backgrounding**: Keeps the socket alive by moving the app to the background instead of closing when the back button is pressed.
  * **Accessibility Service**: A native background service (`ClipboardAccessibilityService`) that globally monitors clipboard changes across the entire OS (bypassing Android 10+ background read restrictions) and pushes them to a REST endpoint.
  * **Native Context Menu**: Registers a "UniClip Sync" option in the Android native text selection menu, handled by a hidden activity (`ProcessTextActivity`).

**Data Flow:**
1. Text is copied on Device A (Windows or Android).
2. The client intercepts the text (via Polling or Accessibility Service).
3. The client emits the data to the Node Server via WebSockets (Socket.io) or an HTTP POST (`/broadcast`).
4. The server broadcasts the `clipboard_update` to all devices in the target Room.
5. Device B receives the text and natively writes it to its system clipboard.

## Technologies Used
* **Server**: Node.js, Express, Socket.io
* **Windows Client**: Electron, HTML/CSS/JS (Vanilla), IPC (Inter-Process Communication)
* **Android Client**: Flutter (Dart), Native Android (Kotlin), SharedPreferences, Android Accessibility Services, Android Intent Filters.

## Folder Structure
```text
D:\uniclip-gemini-2\
├── server\                     # Node.js + Socket.io relay server
│   ├── index.js                # Core server logic, room management, user tracking
│   └── package.json
├── electron-app\               # Windows Desktop Client
│   ├── main.js                 # Electron main process (Background clipboard polling & Sockets)
│   ├── preload.js              # IPC Bridge (Secure context isolation)
│   ├── renderer.js             # UI Logic (Create/Join/Pause)
│   ├── index.html              # Dark Mode UI
│   └── package.json
└── flutter_app\                # Android Client
    ├── lib\
    │   └── main.dart           # Flutter UI, Socket.io client, state management
    └── android\app\src\main\
        ├── AndroidManifest.xml # Permissions, intents, cleartext traffic config
        └── kotlin\com\example\flutter_app\
            ├── MainActivity.kt 
            ├── ProcessTextActivity.kt # Hidden activity for Context Menu sync
            └── ClipboardAccessibilityService.kt # Native background clipboard listener
```

## Execution Steps

### 1. Start the Relay Server
```bash
cd server
npm start
# Server listens on port 3000
```

### 2. Start the Windows App (Electron)
```bash
cd electron-app
npm start
# Enter a Room ID and Device Name to Create/Join a room.
```

### 3. Start the Android App (Flutter)
Ensure you have an Android emulator running or a physical device connected via USB with debugging enabled.
```bash
cd flutter_app
flutter run
```

### Important Android Setup
For true background syncing to work on Android without the app being open, you **must enable the Accessibility Service**:
1. Go to **Settings > Accessibility > Installed apps** (or Downloaded apps) on your Android device.
2. Find **UniClip** and turn it **ON**.
