const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

// --- Logger Configuration ---
const logDir = process.env.LOG_DIR || 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
  ],
});

// --- Server Setup ---
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
  pingTimeout: 7000,
  pingInterval: 3000,
  // Optimization for load testing
  maxHttpBufferSize: 1e7, // 10MB
});

// --- State Management ---
const activeRooms = new Set();
const roomUsers = {}; // roomId -> { socketId: deviceName }
const roomData = {};  // roomId -> { password, creatorSocketId }
const syncExclusions = {}; // socketId -> Set of excluded socketIds
let globalConnectionCount = 0;

// --- Stats Export (for Docker Volumes) ---
const statsDir = process.env.STATS_DIR || 'status';
if (!fs.existsSync(statsDir)) {
  fs.mkdirSync(statsDir);
}
const statsFilePath = path.join(statsDir, 'stats.json');

function updateStatsFile() {
  const stats = {
    timestamp: new Date().toISOString(),
    totalConnections: globalConnectionCount,
    activeRooms: activeRooms.size,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  };
  fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2));
}

// Update stats file every 5 seconds
setInterval(updateStatsFile, 5000);

// --- Helpers ---
function emitRoomUsers(roomId) {
  if (roomUsers[roomId] && roomData[roomId]) {
    const users = Object.entries(roomUsers[roomId]).map(([socketId, deviceName]) => ({
      socketId,
      deviceName,
      isCreator: roomData[roomId].creatorSocketId === socketId,
    }));
    io.to(roomId).emit('room_users', users);
  }
}

function transferCreator(roomId) {
  const sockets = Object.keys(roomUsers[roomId] || {});
  if (sockets.length > 0) {
    roomData[roomId].creatorSocketId = sockets[0];
  }
}

// --- Endpoints ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok', connections: globalConnectionCount });
});

app.get('/stats', (req, res) => {
  res.json({
    totalConnections: globalConnectionCount,
    activeRooms: activeRooms.size,
    uptime: process.uptime(),
    rooms: Array.from(activeRooms).map(id => ({
      id,
      userCount: roomUsers[id] ? Object.keys(roomUsers[id]).length : 0
    }))
  });
});

app.post('/broadcast', (req, res) => {
  const { room_id, device_name, text } = req.body;
  if (!room_id || !text) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  if (activeRooms.has(room_id)) {
    logger.info(`[HTTP] Clipboard update from ${device_name} in ${room_id}`);
    io.to(room_id).emit('clipboard_update', { device_name: device_name || 'Mobile', text });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Room not found' });
  }
});

// --- Socket logic ---
io.on('connection', (socket) => {
  globalConnectionCount++;
  logger.info(`User connected: ${socket.id}. Total: ${globalConnectionCount}`);

  socket.on('get_room_info', (data, callback) => {
    const { room_id } = data;
    const room = roomData[room_id];
    if (room && activeRooms.has(room_id)) {
      if (callback) callback({ exists: true, passwordRequired: !!room.password });
    } else {
      if (callback) callback({ exists: false, passwordRequired: false });
    }
  });

  socket.on('create_room', (data, callback) => {
    const { room_id, device_name, password } = data;

    if (activeRooms.has(room_id)) {
      if (callback) callback({ success: false, message: 'Room ID already exists.' });
      return;
    }

    activeRooms.add(room_id);
    socket.join(room_id);
    socket.roomId = room_id;
    socket.deviceName = device_name;

    if (!roomUsers[room_id]) roomUsers[room_id] = {};
    roomUsers[room_id][socket.id] = device_name;
    roomData[room_id] = { password: password || null, creatorSocketId: socket.id };

    logger.info(`Room created: ${room_id} by ${device_name}`);
    emitRoomUsers(room_id);

    if (callback) callback({ success: true, message: 'Room created successfully.' });
  });

  socket.on('join_room', (data, callback) => {
    const { room_id, device_name, password } = data;

    if (!activeRooms.has(room_id)) {
      if (callback) callback({ success: false, message: 'Room does not exist.' });
      return;
    }

    const room = roomData[room_id];
    if (room && room.password && room.password !== password) {
      if (callback) callback({ success: false, message: 'Incorrect room password.' });
      return;
    }

    socket.join(room_id);
    socket.roomId = room_id;
    socket.deviceName = device_name;

    if (!roomUsers[room_id]) roomUsers[room_id] = {};
    roomUsers[room_id][socket.id] = device_name;

    logger.info(`User ${device_name} joined room: ${room_id}`);
    socket.to(room_id).emit('user_joined', { device_name });
    emitRoomUsers(room_id);

    if (callback) callback({ success: true, message: 'Joined room successfully.' });
  });

  socket.on('leave_room', () => {
    if (socket.roomId) {
      const roomId = socket.roomId;
      if (roomUsers[roomId]) delete roomUsers[roomId][socket.id];
      delete syncExclusions[socket.id];

      socket.leave(roomId);
      logger.info(`User ${socket.deviceName} left room: ${roomId}`);

      const room = io.sockets.adapter.rooms.get(roomId);
      if (!room || room.size === 0) {
        activeRooms.delete(roomId);
        delete roomUsers[roomId];
        delete roomData[roomId];
        logger.info(`Room ${roomId} deleted (empty).`);
      } else {
        if (roomData[roomId] && roomData[roomId].creatorSocketId === socket.id) {
          transferCreator(roomId);
        }
        socket.to(roomId).emit('user_left', { device_name: socket.deviceName });
        emitRoomUsers(roomId);
      }
      socket.roomId = null;
      socket.deviceName = null;
    }
  });

  socket.on('sync_preferences', (data) => {
    const { exclude } = data;
    syncExclusions[socket.id] = new Set(exclude || []);
  });

  socket.on('clipboard_update', (data) => {
    if (socket.roomId) {
      logger.info(`[Socket] Clipboard update from ${socket.deviceName} in ${socket.roomId}`);
      
      const exclusions = syncExclusions[socket.id] || new Set();
      
      if (exclusions.size === 0) {
        socket.to(socket.roomId).emit('clipboard_update', data);
      } else {
        const room = io.sockets.adapter.rooms.get(socket.roomId);
        if (room) {
          room.forEach((targetSocketId) => {
            if (targetSocketId !== socket.id && !exclusions.has(targetSocketId)) {
              io.to(targetSocketId).emit('clipboard_update', data);
            }
          });
        }
      }
    }
  });

  socket.on('disconnect', () => {
    globalConnectionCount--;
    logger.info(`User disconnected: ${socket.id}. Total: ${globalConnectionCount}`);

    if (socket.roomId) {
      const roomId = socket.roomId;
      if (roomUsers[roomId]) delete roomUsers[roomId][socket.id];
      delete syncExclusions[socket.id];

      const room = io.sockets.adapter.rooms.get(roomId);
      if (!room || room.size === 0) {
        activeRooms.delete(roomId);
        delete roomUsers[roomId];
        delete roomData[roomId];
      } else {
        if (roomData[roomId] && roomData[roomId].creatorSocketId === socket.id) {
          transferCreator(roomId);
        }
        socket.to(roomId).emit('user_left', { device_name: socket.deviceName });
        emitRoomUsers(roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Relay server running on port ${PORT}`);
});