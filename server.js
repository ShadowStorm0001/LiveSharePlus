require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Live Share Server is running' });
});

// Create session
app.post('/api/sessions', async (req, res) => {
  await ensureSessionsDir();
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Session name is required' });
  }
  
  const sessionId = Math.random().toString(36).substring(2, 8).toUpperCase();
  const sessionDir = path.join(SESSIONS_DIR, sessionId);
  
  try {
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
    
    res.json({ sessionId: sessionId, name: name });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Join session
app.get('/api/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const sessionDir = path.join(SESSIONS_DIR, sessionId);
  
  try {
    const sessionInfo = await fs.readFile(path.join(sessionDir, 'session.json'), 'utf8');
    res.json(JSON.parse(sessionInfo));
  } catch (error) {
    res.status(404).json({ error: 'Session not found' });
  }
});

// Save file
app.post('/api/sessions/:sessionId/files', async (req, res) => {
  const { sessionId } = req.params;
  const { filePath, content } = req.body;
  
  if (!filePath || content === undefined) {
    return res.status(400).json({ error: 'filePath and content are required' });
  }
  
  const sessionDir = path.join(SESSIONS_DIR, sessionId);
  const fileFullPath = path.join(sessionDir, filePath);
  
  try {
    // Create directory if it doesn't exist
    await fs.mkdir(path.dirname(fileFullPath), { recursive: true });
    
    await fs.writeFile(fileFullPath, content);
    res.json({ message: 'File saved successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get file
app.get('/api/sessions/:sessionId/files/:filePath', async (req, res) => {
  const { sessionId, filePath } = req.params;
  const fileFullPath = path.join(SESSIONS_DIR, sessionId, filePath);
  
  try {
    const content = await fs.readFile(fileFullPath, 'utf8');
    res.json({ content: content });
  } catch (error) {
    res.status(404).json({ error: 'File not found' });
  }
});

// List files
app.get('/api/sessions/:sessionId/files', async (req, res) => {
  const { sessionId } = req.params;
  const sessionDir = path.join(SESSIONS_DIR, sessionId);
  
  try {
    const files = await fs.readdir(sessionDir);
    // Filter out session.json and return only code files
    const codeFiles = files.filter(file => file !== 'session.json');
    res.json({ files: codeFiles });
  } catch (error) {
    res.status(404).json({ error: 'Session not found' });
  }
});

// View all sessions (for GitHub repo viewing)
app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await fs.readdir(SESSIONS_DIR);
    res.json({ sessions: sessions });
  } catch (error) {
    res.json({ sessions: [] });
  }
});

// Socket.io for real-time collaboration (keep this)
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
  console.log(`Files are stored in: ${path.resolve(SESSIONS_DIR)}`);
});
