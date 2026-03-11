# Jarvis - Self-Evolving AI Agent Platform

## Project Overview
Jarvis is a self-evolving AI agent platform built on Claude Code with a pure web UI.
It supports multiple workspaces, each with its own agent persona, tools, and memory system.

## Architecture
- **Monorepo** with npm workspaces
- **packages/core**: Shared core logic (workspace, memory, models, scheduler, self-upgrade, lark, tools, skills)
- **packages/daemon**: Guardian daemon process that monitors and auto-fixes the server
- **packages/desktop**: Web UI (React + Vite) + Node.js API server (HTTP + WebSocket)
- **packages/web**: Mobile-responsive web UI for remote access via WebSocket

## Tech Stack
- TypeScript throughout
- React 19 + Tailwind CSS 4 + Vite for web UI
- Node.js HTTP + WebSocket API server (no Electron)
- better-sqlite3 for memory storage
- OpenAI-compatible API for model calls
- WebSocket for real-time streaming events
- node-cron for scheduled tasks

## Key Patterns
- All workspace data stored in `~/.jarvis/data/workspaces/{id}/`
- Each workspace has: config.json, soul.md, agent.md, user.md, tools/, memory/, history/
- Self-upgrade uses Claude Code CLI (`claude --print` for queries, `claude` for code changes)
- API server (`src/server/`) exposes REST endpoints + WebSocket for all core services
- Frontend (`src/renderer/`) communicates via HTTP fetch + WebSocket (no IPC)
- Loop mode: periodic autonomous planning toward a goal

## Commands
- `npm run dev` - Start web UI + API server in dev mode (concurrently)
- `npm run dev:server` - Start API server only
- `npm run dev:daemon` - Start daemon
- `npm run dev:web` - Start mobile web UI
- `npm run build` - Build all packages
- `npm start` - Start API server (production)
