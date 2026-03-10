# Jarvis - Self-Evolving AI Agent Platform

## Project Overview
Jarvis is a self-evolving AI agent platform built on Claude Code with an Electron desktop app.
It supports multiple workspaces, each with its own agent persona, tools, and memory system.

## Architecture
- **Monorepo** with npm workspaces
- **packages/core**: Shared core logic (workspace, memory, models, scheduler, self-upgrade, lark, tools, skills)
- **packages/daemon**: Guardian daemon process that monitors and auto-fixes the desktop app
- **packages/desktop**: Electron + React desktop application
- **packages/web**: Mobile-responsive web UI for remote access via WebSocket

## Tech Stack
- TypeScript throughout
- Electron + React 19 + Tailwind CSS 4 for desktop
- Vite for building
- better-sqlite3 for memory storage
- OpenAI-compatible API for model calls
- WebSocket for real-time mobile access
- node-cron for scheduled tasks

## Key Patterns
- All workspace data stored in `~/.jarvis/data/workspaces/{id}/`
- Each workspace has: config.json, soul.md, agent.md, user.md, tools/, memory/, history/
- Self-upgrade uses Claude Code CLI (`claude --print` for queries, `claude` for code changes)
- Daemon auto-restarts desktop app and can invoke CC to fix crashes
- Loop mode: periodic autonomous planning toward a goal

## Commands
- `npm run dev` - Start desktop in dev mode
- `npm run dev:daemon` - Start daemon
- `npm run dev:web` - Start mobile web UI
- `npm run build` - Build all packages
- `npm start` - Start via daemon (production)
