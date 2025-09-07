require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs').promises;
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

// Create sessions directory if it doesn't exist
const SESSIONS_DIR = './sessions';

async function ensureSessionsDir() {
  try {
    await fs.access(SESSIONS_DIR);
  } catch {
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    console.log('Created sessions directory');
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Live Share Server is running' });
});

// Create session - FIXED
app.post('/api/sessions', async (req, res) => {
  try {
    await ensureSessionsDir();
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Session name is required' });
    }
    
    const sessionId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    
    // Create session directory
    await fs.mkdir(sessionDir, { recursive: true });
    
    // Create session info file
    const sessionInfo = {
      id: sessionId,
      name: name,
      createdAt: new Date().toISOString()
    };
    
    await fs.writeFile(
      path.join(sessionDir, 'session.json'),
      JSON.stringify(sessionInfo, null, 2)
    );
    
    // Create default main.js file
    const defaultContent = `// Welcome to Live Share Session: ${sessionId}
// Start editing this file to collaborate with others!

function welcomeMessage() {
    return "Hello from Live Share!";
}

console.log(welcomeMessage());`;

    await fs.writeFile(
      path.join(sessionDir, 'main.js'),
      defaultContent
    );
    
    console.log(`Session created: ${sessionId}`);
    res.json({ sessionId: sessionId, name: name });
    
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Join session - FIXED
app.get('/api/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    
    // Check if session directory exists
    try {
      await fs.access(sessionDir);
    } catch {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const sessionInfo = await fs.readFile(path.join(sessionDir, 'session.json'), 'utf8');
    res.json(JSON.parse(sessionInfo));
    
  } catch (error) {
    console.error('Error joining session:', error);
    res.status(500).json({ error: error.message });
  }
});

// List files - FIXED
app.get('/api/sessions/:sessionId/files', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    
    // Check if session exists
    try {
      await fs.access(sessionDir);
    } catch {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const files = await fs.readdir(sessionDir);
    // Filter out session.json and return only code files
    const codeFiles = files.filter(file => file !== 'session.json' && file !== '.gitkeep');
    res.json({ files: codeFiles });
    
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get file content - FIXED
app.get('/api/sessions/:sessionId/files/:filePath', async (req, res) => {
  try {
    const { sessionId, filePath } = req.params;
    const fileFullPath = path.join(SESSIONS_DIR, sessionId, filePath);
    
    const content = await fs.readFile(fileFullPath, 'utf8');
    res.json({ content: content });
    
  } catch (error) {
    console.error('Error getting file:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

// Save file - FIXED
app.post('/api/sessions/:sessionId/files', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { filePath, content } = req.body;
    
    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'filePath and content are required' });
    }
    
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    const fileFullPath = path.join(sessionDir, filePath);
    
    // Create session directory if it doesn't exist
    await fs.mkdir(sessionDir, { recursive: true });
    
    await fs.writeFile(fileFullPath, content);
    res.json({ message: 'File saved successfully' });
    
  } catch (error) {
    console.error('Error saving file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to see all sessions
app.get('/api/debug/sessions', async (req, res) => {
  try {
    await ensureSessionsDir();
    const sessions = await fs.readdir(SESSIONS_DIR);
    const sessionList = [];
    
    for (const sessionId of sessions) {
      if (sessionId !== '.gitkeep') {
        try {
          const sessionInfo = await fs.readFile(path.join(SESSIONS_DIR, sessionId, 'session.json'), 'utf8');
          sessionList.push(JSON.parse(sessionInfo));
        } catch (e) {
          sessionList.push({ id: sessionId, error: 'No session info' });
        }
      }
    }

    // Debug endpoint to see actual files
app.get('/api/debug/filesystem', async (req, res) => {
  try {
    await ensureSessionsDir();
    const sessions = await fs.readdir(SESSIONS_DIR);
    const result = {};

    for (const sessionId of sessions) {
      if (sessionId !== '.gitkeep') {
        const sessionDir = path.join(SESSIONS_DIR, sessionId);
        try {
          const files = await fs.readdir(sessionDir);
          result[sessionId] = {
            exists: true,
            files: files
          };
        } catch (error) {
          result[sessionId] = {
            exists: false,
            error: error.message
          };
        }
      }
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
    
    res.json({ sessions: sessionList, total: sessionList.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.io for real-time collaboration
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join-session', (data) => {
    const { sessionId, userName } = data;
    socket.join(sessionId);
    console.log(`User ${socket.id} (${userName}) joined session ${sessionId}`);
  });
  
  socket.on('code-change', (data) => {
    const { sessionId, filePath, content } = data;
    socket.to(sessionId).emit('code-update', {
      filePath: filePath,
      content: content,
      sender: socket.id
    });
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
server.listen(PORT, async () => {
  await ensureSessionsDir();
  console.log(`Live Share server running on port ${PORT}`);
  console.log(`Sessions directory: ${path.resolve(SESSIONS_DIR)}`);
});
