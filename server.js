/**
 * Pantheon Village - Backend Server
 * Watches OpenClaw agent session files and pushes events to the 3D frontend.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const chokidar = require('chokidar');

const PORT = process.env.PORT || 3000;
const AGENTS_DIR = process.env.AGENTS_DIR || '/home/miki/.openclaw/agents';
const STATIC_DIR = path.join(__dirname, 'public');

// Agent config
const AGENTS = {
  main:    { id: 'main',    name: 'Atlas',   emoji: '🌍', color: '#4A90D9' },
  vulkan:  { id: 'vulkan',  name: 'Vulkan',  emoji: '🔥', color: '#FF6B35' },
  saga:    { id: 'saga',    name: 'Saga',    emoji: '📜', color: '#9B59B6' },
  cerbero: { id: 'cerbero', name: 'Cerbero', emoji: '🐕‍🦺', color: '#7F8C8D' },
};

// In-memory state per agent
const agentState = {};
for (const [id, cfg] of Object.entries(AGENTS)) {
  agentState[id] = {
    ...cfg,
    status: 'idle',         // idle | thinking | responding
    lastMessage: null,      // last user message received
    lastResponse: null,     // last assistant response (truncated)
    lastActive: null,       // ISO timestamp
    messagesTotal: 0,
    messagesThisSession: 0,
  };
}

// ── HTTP server (static files) ────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  // strip query string
  filePath = filePath.split('?')[0];
  const fullPath = path.join(STATIC_DIR, filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).slice(1);
    const mime = { html: 'text/html', js: 'application/javascript', css: 'text/css',
                   json: 'application/json', png: 'image/png', ico: 'image/x-icon',
                   glb: 'model/gltf-binary', gltf: 'model/gltf+json', md: 'text/markdown' };
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ── WebSocket server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected (${clients.size} total)`);

  // Send full state snapshot on connect
  ws.send(JSON.stringify({ type: 'snapshot', agents: agentState }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected (${clients.size} total)`);
  });
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

// ── JSONL watcher ─────────────────────────────────────────────────────────────
// Track last-read byte position per file so we only read new lines
const filePositions = {};

function processNewLines(agentId, filePath) {
  try {
    const stat = fs.statSync(filePath);
    const prev = filePositions[filePath] || 0;
    if (stat.size <= prev) return;

    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - prev);
    fs.readSync(fd, buf, 0, buf.length, prev);
    fs.closeSync(fd);
    filePositions[filePath] = stat.size;

    const lines = buf.toString('utf8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        handleEntry(agentId, entry);
      } catch (_) {}
    }
  } catch (err) {
    // file may be rotating
  }
}

function truncate(text, maxLen = 120) {
  if (!text) return '';
  text = text.trim().replace(/\n+/g, ' ');
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

function handleEntry(agentId, entry) {
  if (entry.type !== 'message') return;
  const msg = entry.message;
  const state = agentState[agentId];
  if (!state) return;

  state.messagesTotal++;
  state.lastActive = entry.timestamp;

  if (msg.role === 'user') {
    // Extract text content
    let text = '';
    if (typeof msg.content === 'string') text = msg.content;
    else if (Array.isArray(msg.content)) {
      const t = msg.content.find(c => c.type === 'text');
      if (t) text = t.text;
    }
    // Skip heartbeat/system messages
    if (text && text.length < 2000) {
      state.lastMessage = truncate(text);
      state.status = 'thinking';
      state.messagesThisSession++;
      broadcast({ type: 'agentUpdate', agentId, state: { ...state } });
    }
  } else if (msg.role === 'assistant') {
    let text = '';
    if (Array.isArray(msg.content)) {
      const t = msg.content.find(c => c.type === 'text');
      if (t) text = t.text;
    } else if (typeof msg.content === 'string') {
      text = msg.content;
    }
    if (text) {
      state.lastResponse = truncate(text);
      state.status = 'responding';
      broadcast({ type: 'agentUpdate', agentId, state: { ...state } });

      // After 4 seconds, go back to idle
      setTimeout(() => {
        state.status = 'idle';
        broadcast({ type: 'agentUpdate', agentId, state: { ...state } });
      }, 4000);
    }
  }
}

// Start watching
function startWatcher() {
  for (const agentId of Object.keys(AGENTS)) {
    const sessDir = path.join(AGENTS_DIR, agentId, 'sessions');
    if (!fs.existsSync(sessDir)) {
      console.log(`[watch] Sessions dir not found for ${agentId}: ${sessDir}`);
      continue;
    }

    // Seed positions with current file sizes (don't replay history)
    const files = fs.readdirSync(sessDir).filter(f => f.endsWith('.jsonl'));
    for (const f of files) {
      const fp = path.join(sessDir, f);
      try {
        filePositions[fp] = fs.statSync(fp).size;
      } catch (_) {}
    }

    const pattern = path.join(sessDir, '*.jsonl');
    const watcher = chokidar.watch(pattern, { ignoreInitial: true, usePolling: false });

    watcher.on('change', (fp) => processNewLines(agentId, fp));
    watcher.on('add',    (fp) => {
      filePositions[fp] = 0;
      processNewLines(agentId, fp);
    });
    console.log(`[watch] Watching ${agentId} sessions at ${sessDir}`);
  }
}

// ── REST endpoint for current state ──────────────────────────────────────────
// (for polling fallback)
// We'll handle /api/state in the HTTP server
const origHandler = server.listeners('request')[0];
server.removeAllListeners('request');
server.on('request', (req, res) => {
  if (req.url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ agents: agentState }));
    return;
  }
  origHandler(req, res);
});

// ── Start ─────────────────────────────────────────────────────────────────────
startWatcher();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🏛️  Pantheon Village running at http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   Watching agents: ${Object.keys(AGENTS).join(', ')}\n`);
});
