import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'dart:async';
import 'dart:io' show Platform;

void main() {
  runApp(const UniClipApp());
}

class UniClipApp extends StatelessWidget {
  const UniClipApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'UniClip',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        primarySwatch: Colors.blue,
        scaffoldBackgroundColor: const Color(0xFF1E1E1E),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF61DAFB),
          secondary: Color(0xFF4CAF50),
        ),
      ),
      home: const MainScreen(),
    );
  }
}

class MainScreen extends StatefulWidget {
  const MainScreen({Key? key}) : super(key: key);

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> with WidgetsBindingObserver {
  static const platform = MethodChannel('com.uniclip.app/uniclip');

  // State Variables
  IO.Socket? socket;
  bool isInRoom = false;
  bool isSyncing = true;
  String currentRoomId = '';
  String currentDeviceName = 'Android Device';
  String serverUrl = 'https://server.uniclip.online/';
  String ownSocketId = '';
  bool isCreator = false;
  List<Map<String, dynamic>> connectedUsers = [];
  Set<String> syncExcludeSet = {};
  bool isAccessibilityEnabled = false;
  bool _showLogs = true;
  String errorMsg = '';
  String _currentMode = 'menu'; // 'menu', 'create', 'join', 'settings'
  String _connectionState = 'disconnected';

  // Timers
  Timer? _clipboardTimer;
  String _lastClipboardText = '';
  Timer? _checkRoomTimer;

  // Controllers
  final TextEditingController _roomIdController = TextEditingController();
  final TextEditingController _deviceNameController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  final TextEditingController _broadcastController = TextEditingController();
  final TextEditingController _serverUrlController = TextEditingController();

  List<String> logs = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadSettings();
    _setupPlatformChannel();
    _initDeviceName();
    _checkAccessibility();
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      serverUrl = prefs.getString('server_url') ?? 'https://server.uniclip.online/';
      _serverUrlController.text = serverUrl;
    });
  }

  Future<void> _saveSettings() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server_url', _serverUrlController.text.trim());
    setState(() {
      serverUrl = _serverUrlController.text.trim();
      _currentMode = 'menu';
    });
    // Reconnect if server changed
    if (socket != null) {
      socket!.disconnect();
      socket!.dispose();
      socket = null;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkAccessibility();
    }
  }

  Future<void> _initDeviceName() async {
    try {
      final deviceInfo = DeviceInfoPlugin();
      String name = 'Android Device';
      if (Platform.isAndroid) {
        final androidInfo = await deviceInfo.androidInfo;
        final brand = androidInfo.brand.trim();
        final model = androidInfo.model.trim();
        name = '${brand.isNotEmpty ? '$brand ' : ''}$model';
        if (name.trim().isEmpty) name = 'Android Device';
      } else if (Platform.isIOS) {
        final iosInfo = await deviceInfo.iosInfo;
        name = iosInfo.name;
      }
      if (mounted) {
        setState(() => _deviceNameController.text = name);
      }
    } catch (_) {
      // ignore
    }
  }

  Future<void> _checkAccessibility() async {
    try {
      final result = await platform.invokeMethod('isAccessibilityEnabled');
      if (mounted) {
        setState(() => isAccessibilityEnabled = result as bool);
      }
    } catch (_) {
      if (mounted) setState(() => isAccessibilityEnabled = false);
    }
  }

  void _openAccessibilitySettings() {
    platform.invokeMethod('openAccessibilitySettings');
  }

  void _setupPlatformChannel() {
    platform.setMethodCallHandler((call) async {
      if (call.method == "onProcessText") {
        final text = call.arguments as String?;
        if (text != null && text.isNotEmpty) {
          _syncTextFromContextMenu(text);
        }
      }
    });
  }

  void _syncTextFromContextMenu(String text) {
    if (isInRoom && socket != null && isSyncing) {
      socket!.emit('clipboard_update', {
        'device_name': currentDeviceName,
        'text': text,
      });
      _addLog('Sent via Context Menu: ${text.length > 30 ? text.substring(0, 30) + '...' : text}');
    } else {
      print('Cannot sync text: Not in a room or syncing paused.');
    }
  }

  void _addLog(String message) {
    setState(() {
      logs.insert(0, '[${DateTime.now().toLocal().toString().split(' ')[1].substring(0, 8)}] $message');
    });
  }

  void _connectSocketAnd(Function() onConnected) {
    if (socket != null && socket!.connected) {
      onConnected();
      return;
    }

    if (socket == null) {
      socket = IO.io(serverUrl, <String, dynamic>{
        'transports': ['websocket'],
        'autoConnect': false,
      });

      socket!.on('connect', (_) {
        ownSocketId = socket!.id ?? '';
        setState(() => _connectionState = 'connected');
      });

      socket!.on('disconnect', (_) {
        setState(() {
          _connectionState = 'disconnected';
          if (isInRoom) {
            _leaveRoomSilently();
            errorMsg = 'Connection lost.';
          }
        });
      });

      socket!.on('connect_error', (_) {
        setState(() => _connectionState = 'error');
      });

      socket!.on('clipboard_update', (data) {
        if (!isSyncing) return;
        final text = data['text'] as String;
        final deviceName = data['device_name'] as String;
        _addLog('Received from $deviceName: ${text.length > 30 ? text.substring(0, 30) + '...' : text}');
        Clipboard.setData(ClipboardData(text: text));
      });

      socket!.on('room_users', (data) {
        setState(() {
          connectedUsers = List<Map<String, dynamic>>.from(data as List);
          final me = connectedUsers.cast<Map<String, dynamic>>().firstWhere(
            (u) => u['socketId'] == ownSocketId,
            orElse: () => <String, dynamic>{},
          );
          isCreator = me['isCreator'] == true;
        });
      });

      socket!.on('user_joined', (data) {
        _addLog('${data['device_name']} joined.');
      });

      socket!.on('user_left', (data) {
        _addLog('${data['device_name']} left.');
      });

      socket!.on('force_leave', (data) {
        _addLog(data['message'] ?? 'You were removed from the room.');
        _leaveRoomSilently();
      });
    }

    socket!.connect();

    void connectListener(dynamic _) {
      onConnected();
      socket!.off('connect', connectListener);
      socket!.off('connect_error');
    }

    void errorListener(dynamic err) {
      if (mounted) {
        setState(() => errorMsg = 'Connection failed. Is server running?');
      }
      socket!.off('connect', connectListener);
      socket!.off('connect_error');
    }

    socket!.on('connect', connectListener);
    socket!.on('connect_error', errorListener);
  }

  void _startClipboardPolling() {
    _clipboardTimer?.cancel();
    _clipboardTimer = Timer.periodic(const Duration(seconds: 1), (timer) async {
      if (!isSyncing || !isInRoom) return;
      try {
        final data = await Clipboard.getData('text/plain');
        if (data != null && data.text != null) {
          final text = data.text!;
          if (text.isNotEmpty && text != _lastClipboardText) {
            _lastClipboardText = text;
            if (socket != null && socket!.connected) {
              socket!.emit('clipboard_update', {
                'device_name': currentDeviceName,
                'text': text,
              });
              _addLog('Sent: ${text.length > 30 ? text.substring(0, 30) + '...' : text}');
            }
          }
        }
      } catch (e) {
        // Ignore clipboard read errors
      }
    });
  }

  void _stopClipboardPolling() {
    _clipboardTimer?.cancel();
    _clipboardTimer = null;
  }

  Future<void> _saveRoomPrefs(String roomId, String deviceName) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('room_id', roomId);
    await prefs.setString('device_name', deviceName);
    await prefs.setString('server_url', serverUrl);
  }

  Future<void> _clearRoomPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('room_id');
    await prefs.remove('device_name');
    await prefs.remove('server_url');
  }

  void _checkRoomDebounced(String roomId) {
    _checkRoomTimer?.cancel();
    if (roomId.isEmpty) return;
    _checkRoomTimer = Timer(const Duration(milliseconds: 500), () {
      if (socket != null && socket!.connected) {
        socket!.emitWithAck('get_room_info', {'room_id': roomId}, ack: (dynamic response) {
          if (mounted && response['exists'] == true) {
            setState(() {
              errorMsg = response['passwordRequired'] == true ? 'This room requires a password' : '';
            });
          }
        });
      }
    });
  }

  void _createRoom() {
    final roomId = _roomIdController.text.trim();
    final deviceName = _deviceNameController.text.trim();
    final password = _passwordController.text.trim();

    if (roomId.isEmpty) {
      setState(() => errorMsg = 'Room ID cannot be empty');
      return;
    }

    setState(() => errorMsg = 'Connecting...');

    _connectSocketAnd(() {
      socket!.emitWithAck('create_room', {
        'room_id': roomId,
        'device_name': deviceName,
        'password': password.isEmpty ? null : password,
      }, ack: (dynamic response) {
        if (!mounted) return;
        if (response['success'] == true) {
          _saveRoomPrefs(roomId, deviceName);
          setState(() {
            isInRoom = true;
            isSyncing = true;
            currentRoomId = roomId;
            currentDeviceName = deviceName;
            errorMsg = '';
            isCreator = true;
          });
          _startClipboardPolling();
          _addLog('Room created successfully.');
        } else {
          setState(() => errorMsg = response['message'] ?? 'Failed to create room.');
        }
      });
    });
  }

  void _joinRoom() {
    final roomId = _roomIdController.text.trim();
    final deviceName = _deviceNameController.text.trim();
    final password = _passwordController.text.trim();

    if (roomId.isEmpty) {
      setState(() => errorMsg = 'Room ID cannot be empty');
      return;
    }

    setState(() => errorMsg = 'Connecting...');

    _connectSocketAnd(() {
      socket!.emitWithAck('join_room', {
        'room_id': roomId,
        'device_name': deviceName,
        'password': password,
      }, ack: (dynamic response) {
        if (!mounted) return;
        if (response['success'] == true) {
          _saveRoomPrefs(roomId, deviceName);
          setState(() {
            isInRoom = true;
            isSyncing = true;
            currentRoomId = roomId;
            currentDeviceName = deviceName;
            errorMsg = '';
          });
          _startClipboardPolling();
          _addLog('Joined room successfully.');
        } else {
          setState(() => errorMsg = response['message'] ?? 'Failed to join room.');
        }
      });
    });
  }

  void _leaveRoomSilently() {
    _clearRoomPrefs();
    _stopClipboardPolling();
    syncExcludeSet.clear();
    setState(() {
      isInRoom = false;
      currentRoomId = '';
      connectedUsers = [];
      logs.clear();
    });
  }

  Future<void> _leaveRoom() async {
    final bool? confirm = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('Confirm'),
          content: const Text('Are you sure you want to leave the room?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('No'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Yes'),
            ),
          ],
        );
      },
    );

    if (confirm == true) {
      _clearRoomPrefs();
      _stopClipboardPolling();
      socket?.emit('leave_room');
      syncExcludeSet.clear();
      setState(() {
        isInRoom = false;
        currentRoomId = '';
        connectedUsers = [];
        logs.clear();
      });
    }
  }

  void _toggleSyncForUser(String socketId) {
    setState(() {
      if (syncExcludeSet.contains(socketId)) {
        syncExcludeSet.remove(socketId);
      } else {
        syncExcludeSet.add(socketId);
      }
    });
    if (socket != null && socket!.connected) {
      socket!.emit('sync_preferences', {'exclude': syncExcludeSet.toList()});
    }
  }

  void _removeUser(String targetSocketId) {
    if (socket != null && socket!.connected) {
      socket!.emitWithAck('remove_user', {
        'target_socket_id': targetSocketId,
      }, ack: (dynamic response) {
        if (response['success'] == true) {
          _addLog('User removed from room.');
        } else {
          _addLog('Failed to remove user: ${response['message']}');
        }
      });
    }
  }

  Future<void> _refreshConnection() async {
    if (socket != null && socket!.connected) {
      _addLog('State refreshed.');
      return;
    }
    _addLog('Reconnecting...');
    socket?.disconnect();
    socket?.dispose();
    socket = null;
    ownSocketId = '';
    if (isInRoom) {
      _connectSocketAnd(() {
        socket!.emitWithAck('join_room', {
          'room_id': currentRoomId,
          'device_name': currentDeviceName,
        }, ack: (dynamic response) {
          if (response['success'] == true) {
            _addLog('Reconnected successfully.');
          } else {
            _addLog('Failed to reconnect.');
          }
        });
      });
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stopClipboardPolling();
    _checkRoomTimer?.cancel();
    _roomIdController.dispose();
    _deviceNameController.dispose();
    _passwordController.dispose();
    _broadcastController.dispose();
    _serverUrlController.dispose();
    socket?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !isInRoom,
      onPopInvoked: (didPop) {
        if (didPop) return;
        if (isInRoom) {
          platform.invokeMethod('moveToBack');
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('UniClip'),
          centerTitle: true,
        ),
        body: Padding(
          padding: const EdgeInsets.all(20.0),
          child: isInRoom ? _buildRoomView() : _buildAuthView(),
        ),
      ),
    );
  }

  Widget _buildConnectionIndicator() {
    Color color;
    String text;
    switch (_connectionState) {
      case 'connected':
        color = Colors.green;
        text = 'Connected';
      case 'disconnected':
        color = Colors.red;
        text = 'Disconnected';
      case 'error':
        color = Colors.orange;
        text = 'Connection Error';
      default:
        color = Colors.grey;
        text = 'Unknown';
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(text, style: TextStyle(color: color, fontSize: 12), textAlign: TextAlign.center),
    );
  }

  Widget _buildAccessibilityWarning() {
    if (isAccessibilityEnabled) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.orange.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.orange.withValues(alpha: 0.5)),
      ),
      child: Column(
        children: [
          const Text('Sync may not work properly as Accessibility is not turned on.',
            style: TextStyle(color: Colors.orange, fontSize: 13, fontWeight: FontWeight.w500),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          TextButton(
            style: TextButton.styleFrom(backgroundColor: Colors.orange, foregroundColor: Colors.white),
            onPressed: _openAccessibilitySettings,
            child: const Text('Open Accessibility Settings'),
          ),
        ],
      ),
    );
  }

  Widget _buildAuthView() {
    if (_currentMode == 'settings') {
      return SingleChildScrollView(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Settings', textAlign: TextAlign.center, style: TextStyle(fontSize: 24, color: Color(0xFF61DAFB), fontWeight: FontWeight.bold)),
            const SizedBox(height: 20),
            TextField(
              controller: _serverUrlController,
              decoration: const InputDecoration(
                labelText: 'Server URL',
                hintText: 'https://server.uniclip.online/',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 20),
            const Text('Do not change unless you know what you are doing', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: Color.fromARGB(255, 243, 64, 36))),
            const SizedBox(height: 10),
            ElevatedButton(
              onPressed: _saveSettings,
              child: const Text('Save & Back'),
            ),
            const SizedBox(height: 10),
            TextButton(
              onPressed: () => setState(() => _currentMode = 'menu'),
              child: const Text('Cancel', style: TextStyle(color: Colors.grey)),
            ),
          ],
        ),
      );
    }

    if (_currentMode == 'menu') {
      return SingleChildScrollView(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _buildConnectionIndicator(),
            _buildAccessibilityWarning(),
            const Text('Seamless Cross-Device Clipboard Sync',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey, fontSize: 16),
            ),
            const SizedBox(height: 40),
            ElevatedButton(
              style: ElevatedButton.styleFrom(minimumSize: const Size.fromHeight(50)),
              onPressed: () => setState(() {
                _currentMode = 'create';
                errorMsg = '';
              }),
              child: const Text('Create Room', style: TextStyle(fontSize: 18)),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              style: ElevatedButton.styleFrom(minimumSize: const Size.fromHeight(50)),
              onPressed: () => setState(() {
                _currentMode = 'join';
                errorMsg = '';
              }),
              child: const Text('Join Room', style: TextStyle(fontSize: 18)),
            ),
            const SizedBox(height: 20),
            TextButton(
              onPressed: () => setState(() => _currentMode = 'settings'),
              child: const Text('Settings', style: TextStyle(color: Colors.grey)),
            ),
          ],
        ),
      );
    }

    return SingleChildScrollView(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            _currentMode == 'create' ? 'Create Room' : 'Join Room',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 24, color: Color(0xFF61DAFB), fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _deviceNameController,
            decoration: const InputDecoration(
              labelText: 'Device Name',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 15),
          TextField(
            controller: _roomIdController,
            decoration: const InputDecoration(
              labelText: 'Room ID',
              border: OutlineInputBorder(),
            ),
            onChanged: _currentMode == 'join' ? _checkRoomDebounced : null,
          ),
          const SizedBox(height: 15),
          TextField(
            controller: _passwordController,
            decoration: InputDecoration(
              labelText: _currentMode == 'create' ? 'Room Password (optional)' : 'Room Password (if required)',
              border: const OutlineInputBorder(),
            ),
            obscureText: true,
          ),
          const SizedBox(height: 15),
          if (errorMsg.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(errorMsg, style: const TextStyle(color: Colors.red), textAlign: TextAlign.center),
            ),
          ElevatedButton(
            onPressed: _currentMode == 'create' ? _createRoom : _joinRoom,
            child: Text(_currentMode == 'create' ? 'Create' : 'Join'),
          ),
          const SizedBox(height: 10),
          TextButton(
            onPressed: () => setState(() {
              _currentMode = 'menu';
              errorMsg = '';
              _passwordController.clear();
            }),
            child: const Text('Back', style: TextStyle(color: Colors.grey)),
          ),
        ],
      ),
    );
  }

  Widget _buildRoomView() {
    return RefreshIndicator(
      onRefresh: () async {
        _refreshConnection();
      },
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF2D2D2D),
                borderRadius: BorderRadius.circular(8),
              ),
              width: double.infinity,
              child: Column(
                children: [
                  Text('Room: $currentRoomId', style: const TextStyle(fontSize: 20, color: Colors.green, fontWeight: FontWeight.bold)),
                  Text('Device: $currentDeviceName'),
                  const SizedBox(height: 8),
                  _buildConnectionIndicator(),
                  const SizedBox(height: 8),
                  if (connectedUsers.isNotEmpty) ...[
                    const Text('Connected Devices:', style: TextStyle(fontSize: 14, color: Colors.green, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    _buildUserList(),
                    const SizedBox(height: 8),
                  ],
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: isSyncing ? Colors.orange : Colors.green,
                    ),
                    onPressed: () {
                      setState(() {
                        isSyncing = !isSyncing;
                        _addLog(isSyncing ? 'Syncing resumed.' : 'Syncing paused.');
                      });
                    },
                    child: Text(isSyncing ? 'Pause Syncing' : 'Resume Syncing', style: const TextStyle(color: Colors.white)),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF2D2D2D),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _broadcastController,
                      decoration: const InputDecoration(
                        hintText: 'Type a message to broadcast...',
                        border: InputBorder.none,
                      ),
                      style: const TextStyle(fontSize: 14),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.send, color: Color(0xFF61DAFB)),
                    onPressed: () {
                      final text = _broadcastController.text.trim();
                      if (text.isNotEmpty) {
                        socket?.emit('clipboard_update', {'device_name': currentDeviceName, 'text': text});
                        _addLog('Broadcasted: ${text.length > 30 ? text.substring(0, 30) + '...' : text}');
                        _broadcastController.clear();
                        FocusScope.of(context).unfocus();
                      }
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            GestureDetector(
              onTap: () => setState(() => _showLogs = !_showLogs),
              behavior: HitTestBehavior.opaque,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Recent Syncs', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  Icon(_showLogs ? Icons.keyboard_arrow_down : Icons.keyboard_arrow_right, size: 24),
                ],
              ),
            ),
            const SizedBox(height: 10),
            if (_showLogs)
              Container(
                constraints: const BoxConstraints(maxHeight: 200),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFF2D2D2D),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: logs.length,
                  itemBuilder: (context, index) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Text(logs[index], style: const TextStyle(fontFamily: 'monospace', fontSize: 14)),
                    );
                  },
                ),
              ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.grey,
                      minimumSize: const Size.fromHeight(50),
                    ),
                    onPressed: _refreshConnection,
                    child: const Text('Refresh', style: TextStyle(color: Colors.white)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.red,
                      minimumSize: const Size.fromHeight(50),
                    ),
                    onPressed: _leaveRoom,
                    child: const Text('Leave Room', style: TextStyle(color: Colors.white)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildUserList() {
    return Column(
      children: connectedUsers.map((user) {
        final socketId = user['socketId'] as String;
        final deviceName = user['deviceName'] as String;
        final isUserCreator = user['isCreator'] == true;
        final isSelf = socketId == ownSocketId;
        final isExcluded = syncExcludeSet.contains(socketId);

        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          margin: const EdgeInsets.symmetric(vertical: 2),
          decoration: BoxDecoration(
            color: const Color(0xFF333333),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '${deviceName}${isUserCreator ? ' (Owner)' : ''}${isSelf ? ' (you)' : ''}',
                  style: const TextStyle(fontSize: 13),
                ),
              ),
              if (!isSelf)
                TextButton(
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    backgroundColor: isExcluded ? Colors.grey : Colors.green,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(0, 28),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
                  ),
                  onPressed: () => _toggleSyncForUser(socketId),
                  child: Text(isExcluded ? 'Blocked' : 'Syncing', style: const TextStyle(fontSize: 11)),
                ),
              if (isCreator && !isSelf)
                TextButton(
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    backgroundColor: Colors.red,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(0, 28),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
                  ),
                  onPressed: () => _removeUser(socketId),
                  child: const Text('Remove', style: TextStyle(fontSize: 11)),
                ),
            ],
          ),
        );
      }).toList(),
    );
  }
}