
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
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
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('./sessions.db', (err) => {
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      file_path TEXT,
      content TEXT,
      last_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      UNIQUE(session_id, file_path)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS session_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      user_id TEXT,
      user_name TEXT,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);
});

// Helper function to update session activity
function updateSessionActivity(sessionId) {
  db.run(
    'UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = ?',
    [sessionId]
  );
}

// REST API Routes
app.post('/api/sessions', async (req, res) => {
  const { name } = req.body;
  const sessionId = uuidv4().substring(0, 8);
  
  db.run(
    'INSERT INTO sessions (id, name) VALUES (?, ?)',
    [sessionId, name],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ sessionId, name });
    }
  );
});

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

app.post('/api/sessions/:sessionId/files', (req, res) => {
  const { sessionId } = req.params;
  const { filePath, content } = req.body;
  
  db.get(
    'SELECT id FROM sessions WHERE id = ?',
    [sessionId],
    (err, sessionRow) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!sessionRow) {
        return res.status(404).json({ error: 'Session not found' });
      }
      
      db.get(
        'SELECT * FROM files WHERE session_id = ? AND file_path = ?',
        [sessionId, filePath],
        (err, fileRow) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          if (fileRow) {
            db.run(
              'UPDATE files SET content = ?, last_modified = CURRENT_TIMESTAMP WHERE session_id = ? AND file_path = ?',
              [content, sessionId, filePath],
              function(err) {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }
                updateSessionActivity(sessionId);
                res.json({ message: 'File updated' });
              }
            );
          } else {
            db.run(
              'INSERT INTO files (session_id, file_path, content) VALUES (?, ?, ?)',
              [sessionId, filePath, content],
              function(err) {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }
                updateSessionActivity(sessionId);
                res.json({ message: 'File saved' });
              }
            );
          }
        }
      );
    }
  );
});

app.get('/api/sessions/:sessionId/files/:filePath', (req, res) => {
  const { sessionId, filePath } = req.params;
  
  db.get(
    'SELECT * FROM files WHERE session_id = ? AND file_path = ?',
    [sessionId, decodeURIComponent(filePath)],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'File not found' });
      }
      updateSessionActivity(sessionId);
      res.json({ content: row.content });
    }
  );
});

app.get('/api/sessions/:sessionId/files', (req, res) => {
  const { sessionId } = req.params;
  
  db.all(
    'SELECT file_path, last_modified FROM files WHERE session_id = ? ORDER BY file_path',
    [sessionId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      updateSessionActivity(sessionId);
      res.json({ files: rows });
    }
  );
});

app.delete('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  db.run(
    'DELETE FROM sessions WHERE id = ?',
    [sessionId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json({ message: 'Session deleted' });
    }
  );
});

app.get('/api/sessions', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  
  db.all(
    'SELECT * FROM sessions ORDER BY last_activity DESC LIMIT ?',
    [limit],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ sessions: rows });
    }
  );
});

// Socket.io for real-time collaboration
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join-session', (data) => {
    const { sessionId, userName } = data;
    socket.join(sessionId);
    
    // Store user in database
    db.run(
      'INSERT INTO session_users (session_id, user_id, user_name) VALUES (?, ?, ?)',
      [sessionId, socket.id, userName || 'Anonymous'],
      (err) => {
        if (err) {
          console.error('Error storing user:', err);
        }
      }
    );
    
    console.log(`User ${socket.id} (${userName}) joined session ${sessionId}`);
    
    // Notify others in the session
    socket.to(sessionId).emit('user-joined', {
      userId: socket.id,
      userName: userName || 'Anonymous'
    });
    
    // Send current users in session to the new user
    db.all(
      'SELECT user_id, user_name FROM session_users WHERE session_id = ?',
      [sessionId],
      (err, users) => {
        if (!err) {
          socket.emit('current-users', users);
        }
      }
    );
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
        } else {
          updateSessionActivity(sessionId);
        }
      }
    );
    
    // Broadcast to other users in the same session
    socket.to(sessionId).emit('code-update', {
      filePath: filePath,
      content: content,
      sender: socket.id
    });
  });
  
  socket.on('cursor-change', (data) => {
    const { sessionId, position } = data;
    
    // Get user info from database
    db.get(
      'SELECT user_name FROM session_users WHERE user_id = ?',
      [socket.id],
      (err, row) => {
        if (!err && row) {
          // Broadcast cursor position to other users in the session
          socket.to(sessionId).emit('cursor-update', {
            userId: socket.id,
            userName: row.user_name,
            position: position
          });
        }
      }
    );
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Get user info before removing
    db.get(
      'SELECT session_id, user_name FROM session_users WHERE user_id = ?',
      [socket.id],
      (err, row) => {
        if (!err && row) {
          // Notify others that user left
          socket.to(row.session_id).emit('user-left', {
            userId: socket.id,
            userName: row.user_name
          });
        }
      }
    );
    
    // Remove user from database
    db.run(
      'DELETE FROM session_users WHERE user_id = ?',
      [socket.id],
      (err) => {
        if (err) {
          console.error('Error removing user:', err);
        }
      }
    );
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });

});


app.get('/', (req, res) => {
  res.send('Live Share Server is running');
});

// Add these routes to your existing server.js



// Get all sessions (for debugging)
app.get('/api/sessions', (req, res) => {
  db.all('SELECT * FROM sessions ORDER BY created_at DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ sessions: rows });
  });
});

// Create a new session
app.post('/api/sessions', (req, res) => {
  const { name } = req.body;
  const sessionId = Math.random().toString(36).substring(2, 8).toUpperCase();
  
  db.run(
    'INSERT INTO sessions (id, name) VALUES (?, ?)',
    [sessionId, name],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ sessionId, name });
    }
  );
});

// Get session info
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

// Save a file
app.post('/api/sessions/:sessionId/files', (req, res) => {
  const { sessionId } = req.params;
  const { filePath, content } = req.body;
  
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

// Get a file
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

// List all files in a session
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

// Delete a session (optional)
app.delete('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  db.run(
    'DELETE FROM sessions WHERE id = ?',
    [sessionId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Session deleted' });
    }
  );
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Live Share server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
  });
  server.close(() => {
    console.log('Server stopped.');
    process.exit(0);
  });
});
