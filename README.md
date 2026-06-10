# UniClip: Cross-Device Clipboard Sync

UniClip is a real-time, scalable clipboard synchronization solution designed to seamlessly share text across Windows (Electron) and Mobile (Flutter/Android) devices using a central Node.js Socket.io server.

Download Setup Files (.exe/.msi/.apk) from [here](https://uniclip.online)

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
├── electron-app/               # Windows Desktop Client
│   ├── main.js                 # Main process: system tray, clipboard polling, squirrel startup
│   ├── renderer.js             # UI logic: room creation, joining, pause/resume sync
│   ├── index.html              # Dark-mode interface
│   ├── package.json            # Electron Forge build scripts
│   └── out/                    # Compiled Windows installers (.exe)
│
├── flutter_app/                # Android Mobile Client
│   ├── lib/main.dart           # Flutter UI, Socket.io client, state management
│   └── android/app/src/main/   # Native Android Configurations
│       ├── AndroidManifest.xml # Permissions, intents, cleartext traffic config
│       └── kotlin/com/uniclip/app/
│           ├── MainActivity.kt                  # Flutter embedding & method channels
│           ├── ProcessTextActivity.kt           # Native context menu handler (Share to PC)
│           └── ClipboardAccessibilityService.kt # Background clipboard listener
│
├── server/                     # Node.js + Socket.io Relay Server
│   ├── index.js                # Core logic, room management, horizontal scaling optimizations
│   ├── logs/                   # Winston structured logs (error.log, combined.log)
│   ├── status/                 # stats.json for real-time monitoring via Docker Volumes
│   └── package.json
│
├── website/                    # Public Landing Page
│   └── index.html              # Vibrant, modern download portal
│
```


## Execution Steps (Local Development)

### 1. Server
```bash
cd server
npm install
npm start
# Server runs on port 3000
```
### 2. Windows Client (Electron)
```bash
cd electron-app
npm install
npm start
# To build installer: npm run make
```

### 3. Android Client (Flutter)
```bash
cd flutter_app
flutter clean
flutter run
# To build release APK: flutter build apk --release
# To build App Bundle: flutter build appbundle --release
```

### Important Android Setup
For true background syncing to work on Android without the app being open, you **must enable the Accessibility Service**:
1. Go to **Settings > Accessibility > Installed apps** (or Downloaded apps) on your Android device.
2. Find **UniClip** and turn it **ON**.
