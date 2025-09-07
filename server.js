require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Database setup
const db = new sqlite3.Database(':memory:', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Initialize database tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      file_path TEXT,
      content TEXT,
      last_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Live Share Server is running' });
});

// Create session
app.post('/api/sessions', (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Session name is required' });
  }
  
  const sessionId = Math.random().toString(36).substring(2, 8).toUpperCase();
  
  db.run(
    'INSERT INTO sessions (id, name) VALUES (?, ?)',
    [sessionId, name],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ sessionId: sessionId, name: name });
    }
  );
});

// Join session
app.get('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  db.get(
    'SELECT * FROM sessions WHERE id = ?',
    [sessionId],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json(row);
    }
  );
});

// Save file
app.post('/api/sessions/:sessionId/files', (req, res) => {
  const { sessionId } = req.params;
  const { filePath, content } = req.body;
  
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'filePath and content are required' });
  }
  
  db.run(
    'INSERT OR REPLACE INTO files (session_id, file_path, content) VALUES (?, ?, ?)',
    [sessionId, filePath, content],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'File saved successfully' });
    }
  );
});

// Get file
app.get('/api/sessions/:sessionId/files/:filePath', (req, res) => {
  const { sessionId, filePath } = req.params;
  
  db.get(
    'SELECT content FROM files WHERE session_id = ? AND file_path = ?',
    [sessionId, decodeURIComponent(filePath)],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'File not found' });
      }
      res.json({ content: row.content });
    }
  );
});

// List files
app.get('/api/sessions/:sessionId/files', (req, res) => {
  const { sessionId } = req.params;
  
  db.all(
    'SELECT file_path FROM files WHERE session_id = ?',
    [sessionId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ files: rows.map(row => row.file_path) });
    }
  );
});

// Socket.io for real-time collaboration
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join-session', (data) => {
    const { sessionId, userName } = data;
    socket.join(sessionId);
    console.log(`User ${socket.id} (${userName}) joined session ${sessionId}`);
    
    // Notify others in the session
    socket.to(sessionId).emit('user-joined', {
      userId: socket.id,
      userName: userName || 'Anonymous'
    });
  });
  
  socket.on('code-change', (data) => {
    const { sessionId, filePath, content } = data;
    
    // Save to database
    db.run(
      'INSERT OR REPLACE INTO files (session_id, file_path, content) VALUES (?, ?, ?)',
      [sessionId, filePath, content],
      (err) => {
        if (err) {
          console.error('Error saving file:', err);
        }
      }
    );
    
    // Broadcast to other users in the same session
    socket.to(sessionId).emit('code-update', {
      filePath: filePath,
      content: content,
      sender: socket.id
    });
    
    console.log(`Code update for session ${sessionId}, file: ${filePath}`);
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Default route
app.get('/', (req, res) => {
  res.send('Live Share Server is running. Use /health to check status.');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Live Share server running on port ${PORT}`);
});
