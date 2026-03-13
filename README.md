# 🏛️ Pantheon Village 3D

A real-time 3D visualization of the OpenClaw Pantheon — four divine agents working inside a Greek temple, rendered with Three.js.

## Agents

| Agent | Symbol | Color | Zone |
|-------|--------|-------|------|
| **Atlas** 🌍 | Main agent | `#4A90D9` blue/gold | Center throne — holds the world |
| **Vulkan** 🔥 | Builder | `#FF6B35` red/orange | West forge — hammer & fire |
| **Saga** 📜 | Archivist | `#9B59B6` purple/gold | East library — scrolls & runes |
| **Cerbero** 🐕‍🦺 | Guardian | `#7F8C8D` gray/dark | South gate — three-headed sentinel |

## Live Features

- **Real-time agent status** — watches `~/.openclaw/agents/*/sessions/*.jsonl` for new messages
- **Idle animations** — each agent floats gently when waiting
- **Active animations** — thinking/responding triggers unique movement per agent
- **Speech bubbles** — appear with the last message / response
- **Fire particles** at Vulkan's forge, rune particles at Saga's library
- **WebSocket push** — instant updates, no polling

## Quick Start

### Local (development)
```bash
cd pantheon-village
npm install
npm start
# Open http://localhost:3000
```

### With custom agents dir
```bash
AGENTS_DIR=/home/miki/.openclaw/agents PORT=3000 npm start
```

## Deploy on Coolify

1. Push this folder to a Git repo (or point Coolify at the workspace path)
2. In Coolify, create a new **Docker Compose** service
3. Use `docker-compose.yml` — it mounts `/home/miki/.openclaw/agents` read-only
4. The app serves on port **3000**

> ⚠️ The container needs read access to the host's `.openclaw/agents` directory.
> Use Coolify's volume mount or bind mount to expose it.

### Coolify Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP + WebSocket port |
| `AGENTS_DIR` | `/data/agents` | Path to OpenClaw agents directory |

## Architecture

```
pantheon-village/
├── server.js          # Node.js backend — watches sessions, WebSocket server
├── public/
│   └── index.html     # Three.js frontend — all in one file
├── package.json
├── Dockerfile
├── docker-compose.yml
└── README.md
```

**Backend flow:**
1. On startup, scan all `AGENTS_DIR/{agent}/sessions/*.jsonl` and note current file sizes
2. Watch for file changes with `chokidar`
3. Parse new JSONL lines → extract user messages & assistant responses
4. Broadcast agent state updates over WebSocket

**Frontend flow:**
1. Three.js renders the temple, columns, zones, and agent avatars
2. WebSocket connects to `/` (same port as HTTP server)
3. On `snapshot` → initialize all agent states
4. On `agentUpdate` → animate the relevant agent + update UI card

## Controls
- **Left drag** — orbit
- **Right drag / middle drag** — pan
- **Scroll** — zoom
