/**
 * Jarvis Web Server - Standalone HTTP + WebSocket API server
 *
 * Replaces the Electron main process. Serves:
 * - Static files (Vite-built renderer)
 * - REST API endpoints for all core services
 * - WebSocket for streaming events (CC session, agent)
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { homedir } from 'os';

// ─── Constants ───────────────────────────────────────────────────

const JARVIS_HOME = process.env.JARVIS_HOME || join(homedir(), '.jarvis');
const PORT = parseInt(process.env.JARVIS_PORT || process.env.JARVIS_WEB_PORT || '3927', 10);
// Resolve static dir: check dist/renderer first (production build), fall back to __dirname/../renderer
const PACKAGE_ROOT = join(__dirname, '..', '..');
const STATIC_DIR = existsSync(join(PACKAGE_ROOT, 'dist', 'renderer', 'index.html'))
  ? join(PACKAGE_ROOT, 'dist', 'renderer')
  : join(__dirname, '..', 'renderer');
const isDev = process.env.NODE_ENV !== 'production';

// ─── State ───────────────────────────────────────────────────────

const wsClients = new Set<WebSocket>();
const ccSessions = new Map<string, any>(); // workspaceId -> CCSession

// ─── Utility ─────────────────────────────────────────────────────

function broadcast(data: any) {
  const msg = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res: ServerResponse, data: any, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, message: string, status = 500) {
  sendJSON(res, { error: message }, status);
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function serveStatic(res: ServerResponse, filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
    });
    res.end(readFileSync(filePath));
    return true;
  } catch {
    return false;
  }
}

// ─── REST API Routes ─────────────────────────────────────────────

async function handleAPI(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const method = req.method || 'GET';

  try {
    // ── Workspace ──
    if (pathname === '/api/workspaces' && method === 'GET') {
      const { WorkspaceManager } = await import('@jarvis/core');
      const mgr = new WorkspaceManager();
      return sendJSON(res, await mgr.list());
    }

    if (pathname === '/api/workspaces' && method === 'POST') {
      const body = await readBody(req);
      const { WorkspaceManager } = await import('@jarvis/core');
      const mgr = new WorkspaceManager();
      return sendJSON(res, await mgr.create(body), 201);
    }

    if (pathname.startsWith('/api/workspaces/') && method === 'GET') {
      const id = pathname.split('/')[3];
      const { WorkspaceManager } = await import('@jarvis/core');
      const mgr = new WorkspaceManager();
      return sendJSON(res, await mgr.get(id));
    }

    if (pathname.startsWith('/api/workspaces/') && method === 'PUT') {
      const id = pathname.split('/')[3];
      const body = await readBody(req);
      const { WorkspaceManager } = await import('@jarvis/core');
      const mgr = new WorkspaceManager();
      return sendJSON(res, await mgr.update(id, body));
    }

    if (pathname.startsWith('/api/workspaces/') && method === 'DELETE') {
      const id = pathname.split('/')[3];
      const { WorkspaceManager } = await import('@jarvis/core');
      const mgr = new WorkspaceManager();
      await mgr.delete(id);
      return sendJSON(res, { deleted: true });
    }

    // ── Agent Chat (non-streaming, returns final result) ──
    if (pathname === '/api/agent/chat' && method === 'POST') {
      const { workspaceId, message } = await readBody(req);
      const { CCSession, WorkspaceManager, MemoryManager } = await import('@jarvis/core');

      const wm = new WorkspaceManager();
      const ws = await wm.get(workspaceId);
      if (!ws) return sendError(res, 'Workspace not found', 404);

      const memory = new MemoryManager();
      await memory.addMessage(workspaceId, { role: 'user', content: message });

      const session = new CCSession({ workspacePath: ws.path });

      session.on('message', (text: string) => {
        broadcast({ type: 'agent:chunk', workspaceId, chunk: text });
      });
      session.on('thinking', (text: string) => {
        broadcast({ type: 'agent:thinking', workspaceId, text });
      });
      session.on('tool_use', (name: string, input: any) => {
        broadcast({ type: 'agent:tool_use', workspaceId, name, input });
      });
      session.on('tool_result', (name: string, content: string) => {
        broadcast({ type: 'agent:tool_result', workspaceId, name, content });
      });

      return new Promise<void>((resolve) => {
        let fullResponse = '';
        session.on('message', (text: string) => { fullResponse += text; });
        session.on('result', async (text: string) => {
          const final = text || fullResponse;
          await memory.addMessage(workspaceId, { role: 'assistant', content: final });
          sendJSON(res, { content: final });
          resolve();
        });
        session.on('error', (err: Error) => {
          sendError(res, err.message);
          resolve();
        });
        session.on('done', (code: number | null) => {
          if (!fullResponse && code !== 0) {
            sendError(res, `CC exited with code ${code}`);
          } else {
            sendJSON(res, { content: fullResponse });
          }
          resolve();
        });
        session.send(message);
      });
    }

    // ── CC Session (persistent, via WebSocket primarily) ──
    if (pathname === '/api/cc/send' && method === 'POST') {
      const { workspaceId, message, options } = await readBody(req);
      await ensureCCSession(workspaceId, options);
      const session = ccSessions.get(workspaceId);
      session.send(message);
      return sendJSON(res, { sessionId: session.getSessionId() });
    }

    if (pathname === '/api/cc/abort' && method === 'POST') {
      const { workspaceId } = await readBody(req);
      const session = ccSessions.get(workspaceId);
      if (session) {
        session.abort();
        ccSessions.delete(workspaceId);
      }
      return sendJSON(res, { aborted: true });
    }

    if (pathname === '/api/cc/newSession' && method === 'POST') {
      const { workspaceId } = await readBody(req);
      ccSessions.delete(workspaceId);
      return sendJSON(res, { cleared: true });
    }

    // ── Memory ──
    if (pathname === '/api/memory/recent' && method === 'POST') {
      const { workspaceId, limit } = await readBody(req);
      const { MemoryManager } = await import('@jarvis/core');
      const memory = new MemoryManager();
      return sendJSON(res, await memory.getRecentMessages(workspaceId, limit));
    }

    if (pathname === '/api/memory/remember' && method === 'POST') {
      const { workspaceId, key, value, type } = await readBody(req);
      const { MemoryManager } = await import('@jarvis/core');
      const memory = new MemoryManager();
      return sendJSON(res, await memory.remember(workspaceId, key, value, type));
    }

    if (pathname === '/api/memory/recall' && method === 'POST') {
      const { workspaceId, query } = await readBody(req);
      const { MemoryManager } = await import('@jarvis/core');
      const memory = new MemoryManager();
      return sendJSON(res, await memory.recall(workspaceId, query));
    }

    // ── Models ──
    if (pathname === '/api/models/config' && method === 'POST') {
      const { workspaceId } = await readBody(req);
      const { ConfigManager } = await import('@jarvis/core');
      const config = new ConfigManager();
      return sendJSON(res, await config.get(`workspaces.${workspaceId}.models`));
    }

    if (pathname === '/api/models/setConfig' && method === 'POST') {
      const { workspaceId, config: modelConfig } = await readBody(req);
      const { ConfigManager } = await import('@jarvis/core');
      const config = new ConfigManager();
      await config.set(`workspaces.${workspaceId}.models`, modelConfig);
      return sendJSON(res, { saved: true });
    }

    if (pathname === '/api/models/list' && method === 'GET') {
      const { ModelService } = await import('@jarvis/core');
      const models = new ModelService();
      return sendJSON(res, await models.listModels());
    }

    // ── Loop Mode ──
    if (pathname === '/api/loop/start' && method === 'POST') {
      const { workspaceId, config } = await readBody(req);
      const { Scheduler } = await import('@jarvis/core');
      const scheduler = new Scheduler();
      return sendJSON(res, await scheduler.startLoopMode(workspaceId, config));
    }

    if (pathname === '/api/loop/stop' && method === 'POST') {
      const { workspaceId } = await readBody(req);
      const { Scheduler } = await import('@jarvis/core');
      const scheduler = new Scheduler();
      return sendJSON(res, await scheduler.stopLoopMode(workspaceId));
    }

    // ── Self-Upgrade ──
    if (pathname === '/api/upgrade/develop' && method === 'POST') {
      const { description, workspaceId } = await readBody(req);
      const { UpgradeEngine } = await import('@jarvis/core');
      const engine = new UpgradeEngine();
      return sendJSON(res, await engine.developFeature(description, workspaceId));
    }

    if (pathname === '/api/upgrade/generateTool' && method === 'POST') {
      const body = await readBody(req);
      const { UpgradeEngine } = await import('@jarvis/core');
      const engine = new UpgradeEngine();
      return sendJSON(res, await engine.generateTool(body));
    }

    if (pathname === '/api/upgrade/generatePage' && method === 'POST') {
      const body = await readBody(req);
      const { UpgradeEngine } = await import('@jarvis/core');
      const engine = new UpgradeEngine();
      return sendJSON(res, await engine.generateWebPage(body));
    }

    // ── Lark ──
    if (pathname === '/api/lark/bind' && method === 'POST') {
      const { workspaceId, chatId } = await readBody(req);
      const { LarkService } = await import('@jarvis/core');
      const lark = new LarkService();
      return sendJSON(res, await lark.bindGroup(workspaceId, chatId));
    }

    if (pathname === '/api/lark/send' && method === 'POST') {
      const { workspaceId, content } = await readBody(req);
      const { LarkService } = await import('@jarvis/core');
      const lark = new LarkService();
      return sendJSON(res, await lark.sendMessage(workspaceId, content));
    }

    // ── Skills ──
    if (pathname === '/api/skills' && method === 'GET') {
      const { SkillManager } = await import('@jarvis/core');
      const skills = new SkillManager();
      return sendJSON(res, await skills.list());
    }

    if (pathname === '/api/skills/install' && method === 'POST') {
      const { name, content } = await readBody(req);
      const { SkillManager } = await import('@jarvis/core');
      const skills = new SkillManager();
      return sendJSON(res, await skills.install(name, content));
    }

    if (pathname === '/api/skills/generate' && method === 'POST') {
      const { description } = await readBody(req);
      const { SkillManager } = await import('@jarvis/core');
      const skills = new SkillManager();
      return sendJSON(res, await skills.generate(description));
    }

    // ── Tools ──
    if (pathname === '/api/tools' && method === 'GET') {
      const url = new URL(req.url || '/', `http://localhost:${PORT}`);
      const workspaceId = url.searchParams.get('workspaceId') || undefined;
      const { ToolManager } = await import('@jarvis/core');
      const tools = new ToolManager();
      return sendJSON(res, await tools.list(workspaceId));
    }

    if (pathname === '/api/tools/execute' && method === 'POST') {
      const { name, params, context } = await readBody(req);
      const { ToolManager } = await import('@jarvis/core');
      const tools = new ToolManager();
      return sendJSON(res, await tools.execute(name, params, context));
    }

    // ── Scheduler ──
    if (pathname === '/api/scheduler/heartbeat' && method === 'POST') {
      const { workspaceId, intervalMs } = await readBody(req);
      const { Scheduler } = await import('@jarvis/core');
      const scheduler = new Scheduler();
      return sendJSON(res, await scheduler.startHeartbeat(workspaceId, intervalMs));
    }

    // ── System ──
    if (pathname === '/api/system/status' && method === 'GET') {
      const statusPath = join(JARVIS_HOME, 'status.json');
      if (existsSync(statusPath)) {
        return sendJSON(res, JSON.parse(readFileSync(statusPath, 'utf-8')));
      }
      return sendJSON(res, { status: 'running' });
    }

    if (pathname === '/api/system/home' && method === 'GET') {
      return sendJSON(res, { home: JARVIS_HOME });
    }

    // ── Digital Humans ──
    if (pathname === '/api/digital-humans' && method === 'GET') {
      const { DigitalHumanManager, JARVIS_HOME: jh } = await import('@jarvis/core');
      const mgr = new DigitalHumanManager(join(jh, 'data', 'digital-humans'));
      return sendJSON(res, await mgr.list());
    }

    if (pathname === '/api/digital-humans' && method === 'POST') {
      const body = await readBody(req);
      const { DigitalHumanManager, JARVIS_HOME: jh } = await import('@jarvis/core');
      const mgr = new DigitalHumanManager(join(jh, 'data', 'digital-humans'));
      return sendJSON(res, await mgr.create(body), 201);
    }

    if (pathname.match(/^\/api\/digital-humans\/[^/]+$/) && method === 'PUT') {
      const id = pathname.split('/')[3];
      const body = await readBody(req);
      const { DigitalHumanManager, JARVIS_HOME: jh } = await import('@jarvis/core');
      const mgr = new DigitalHumanManager(join(jh, 'data', 'digital-humans'));
      return sendJSON(res, await mgr.update(id, body));
    }

    if (pathname.match(/^\/api\/digital-humans\/[^/]+$/) && method === 'DELETE') {
      const id = pathname.split('/')[3];
      const { DigitalHumanManager, JARVIS_HOME: jh } = await import('@jarvis/core');
      const mgr = new DigitalHumanManager(join(jh, 'data', 'digital-humans'));
      await mgr.delete(id);
      return sendJSON(res, { deleted: true });
    }

    if (pathname.match(/^\/api\/digital-humans\/[^/]+\/activity$/) && method === 'GET') {
      const id = pathname.split('/')[3];
      const url = new URL(req.url || '/', `http://localhost:${PORT}`);
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const { DigitalHumanManager, JARVIS_HOME: jh } = await import('@jarvis/core');
      const mgr = new DigitalHumanManager(join(jh, 'data', 'digital-humans'));
      return sendJSON(res, await mgr.getActivity(id, limit));
    }

    // ── Providers ──
    if (pathname === '/api/providers' && method === 'GET') {
      const { ProviderRegistry } = await import('@jarvis/core');
      const registry = new ProviderRegistry();
      return sendJSON(res, await registry.listProviders());
    }

    if (pathname.match(/^\/api\/providers\/[^/]+$/) && method === 'PUT') {
      const id = pathname.split('/')[3];
      const body = await readBody(req);
      const { ProviderRegistry } = await import('@jarvis/core');
      const registry = new ProviderRegistry();
      registry.updateProvider(id, body);
      return sendJSON(res, await registry.getProvider(id));
    }

    if (pathname === '/api/providers/models' && method === 'GET') {
      const { ProviderRegistry } = await import('@jarvis/core');
      const registry = new ProviderRegistry();
      return sendJSON(res, await registry.getAllModels());
    }

    // ── Artifacts ──
    if (pathname === '/api/artifacts' && method === 'POST') {
      const { workspaceId } = await readBody(req);
      const { ArtifactManager, WorkspaceManager } = await import('@jarvis/core');
      const wm = new WorkspaceManager();
      const ws = await wm.get(workspaceId);
      if (!ws) return sendJSON(res, []);
      const am = new ArtifactManager(ws.path, workspaceId);
      return sendJSON(res, await am.getArtifacts());
    }

    if (pathname === '/api/artifacts/tree' && method === 'POST') {
      const { workspaceId } = await readBody(req);
      const { ArtifactManager, WorkspaceManager } = await import('@jarvis/core');
      const wm = new WorkspaceManager();
      const ws = await wm.get(workspaceId);
      if (!ws) return sendJSON(res, []);
      const am = new ArtifactManager(ws.path, workspaceId);
      return sendJSON(res, await am.getFileTree());
    }

    if (pathname === '/api/artifacts/content' && method === 'POST') {
      const { filePath } = await readBody(req);
      if (!filePath || !existsSync(filePath)) return sendJSON(res, null);
      return sendJSON(res, readFileSync(filePath, 'utf-8'));
    }

    // ── Evolution Engine (file-protocol, Daemon executes) ──
    const EVOLUTION_DIR = join(JARVIS_HOME, 'evolution');
    const EVOLUTION_REQUESTS_DIR = join(EVOLUTION_DIR, 'requests');
    const EVOLUTION_HISTORY_DIR = join(EVOLUTION_DIR, 'history');

    const DEFAULT_EVOLUTION_CONFIG = {
      enabled: true,
      loopIntervalMinutes: 15,
      maxConcurrent: 1,
      planning: {
        anthropicAuthToken: '',
        anthropicBaseUrl: 'https://api.anthropic.com',
        model: 'claude-haiku-4-5-20251001',
      },
      execution: {
        anthropicAuthToken: '',
        anthropicBaseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-6',
      },
      maxHistoryRecords: 100,
    };

    if (pathname === '/api/evolution/start' && method === 'POST') {
      const { goal, goalType, priority, workspaceId } = await readBody(req);
      if (!goal) return sendError(res, 'goal is required', 400);
      const id = `evo-${Date.now()}`;
      mkdirSync(EVOLUTION_REQUESTS_DIR, { recursive: true });
      const request = {
        id,
        goal,
        goalType: goalType || 'feature',
        priority: priority || 1,
        source: 'manual',
        workspaceId: workspaceId || null,
        createdAt: new Date().toISOString(),
      };
      writeFileSync(join(EVOLUTION_REQUESTS_DIR, `${id}.json`), JSON.stringify(request, null, 2));
      return sendJSON(res, { id, status: 'queued' });
    }

    if (pathname === '/api/evolution/status' && method === 'GET') {
      const statusPath = join(EVOLUTION_DIR, 'status.json');
      if (existsSync(statusPath)) {
        return sendJSON(res, JSON.parse(readFileSync(statusPath, 'utf-8')));
      }
      return sendJSON(res, {
        active: false,
        currentTask: null,
        completedCount: 0,
        failedCount: 0,
        lastRunAt: null,
      });
    }

    if (pathname === '/api/evolution/queue' && method === 'GET') {
      const queuePath = join(EVOLUTION_DIR, 'queue.json');
      if (existsSync(queuePath)) {
        return sendJSON(res, JSON.parse(readFileSync(queuePath, 'utf-8')));
      }
      return sendJSON(res, []);
    }

    if (pathname === '/api/evolution/history' && method === 'GET') {
      mkdirSync(EVOLUTION_HISTORY_DIR, { recursive: true });
      const files = readdirSync(EVOLUTION_HISTORY_DIR).filter(f => f.endsWith('.json'));
      const records = files.map(f => {
        try {
          return JSON.parse(readFileSync(join(EVOLUTION_HISTORY_DIR, f), 'utf-8'));
        } catch {
          return null;
        }
      }).filter(Boolean);
      records.sort((a: any, b: any) => {
        const ta = a.completedAt || a.createdAt || '';
        const tb = b.completedAt || b.createdAt || '';
        return tb.localeCompare(ta);
      });
      return sendJSON(res, records.slice(0, 50));
    }

    if (pathname === '/api/evolution/config' && method === 'GET') {
      const configPath = join(EVOLUTION_DIR, 'config.json');
      if (existsSync(configPath)) {
        return sendJSON(res, JSON.parse(readFileSync(configPath, 'utf-8')));
      }
      return sendJSON(res, DEFAULT_EVOLUTION_CONFIG);
    }

    if (pathname === '/api/evolution/config' && method === 'POST') {
      const body = await readBody(req);
      mkdirSync(EVOLUTION_DIR, { recursive: true });
      writeFileSync(join(EVOLUTION_DIR, 'config.json'), JSON.stringify(body, null, 2));
      return sendJSON(res, body);
    }

    if (pathname.match(/^\/api\/evolution\/queue\/[^/]+$/) && method === 'DELETE') {
      const id = pathname.split('/')[4];
      const requestFile = join(EVOLUTION_REQUESTS_DIR, `${id}.json`);
      if (existsSync(requestFile)) {
        unlinkSync(requestFile);
        return sendJSON(res, { deleted: true });
      }
      return sendError(res, `Request ${id} not found`, 404);
    }

    // ── 404 ──
    return sendError(res, `API endpoint not found: ${method} ${pathname}`, 404);
  } catch (err: any) {
    console.error(`[API Error] ${method} ${pathname}:`, err);
    return sendError(res, err.message || 'Internal server error');
  }
}

// ─── CC Session Management ───────────────────────────────────────

async function ensureCCSession(workspaceId: string, options?: any) {
  if (ccSessions.has(workspaceId)) return;

  const { CCSession, WorkspaceManager } = await import('@jarvis/core');
  const wm = new WorkspaceManager();
  const ws = await wm.get(workspaceId);
  if (!ws) throw new Error(`Workspace ${workspaceId} not found`);

  const session = new CCSession({
    workspacePath: ws.path,
    sessionId: options?.sessionId,
    systemPrompt: options?.systemPrompt,
    model: options?.model,
  });

  session.on('message', (text: string) => {
    broadcast({ type: 'cc:message', workspaceId, text });
  });
  session.on('thinking', (text: string) => {
    broadcast({ type: 'cc:thinking', workspaceId, text });
  });
  session.on('tool_use', (name: string, input: any) => {
    broadcast({ type: 'cc:tool_use', workspaceId, name, input });
  });
  session.on('tool_result', (name: string, content: string) => {
    broadcast({ type: 'cc:tool_result', workspaceId, name, content });
  });
  session.on('result', (text: string, sessionId: string) => {
    broadcast({ type: 'cc:result', workspaceId, text, sessionId });
  });
  session.on('error', (error: Error) => {
    broadcast({ type: 'cc:error', workspaceId, error: error.message });
  });
  session.on('done', (code: number | null) => {
    broadcast({ type: 'cc:done', workspaceId, code });
  });

  ccSessions.set(workspaceId, session);
}

// ─── WebSocket Handler ───────────────────────────────────────────

async function handleWSMessage(ws: WebSocket, msg: any) {
  const { type, payload } = msg;

  try {
    switch (type) {
      case 'workspace:list': {
        const { WorkspaceManager } = await import('@jarvis/core');
        const mgr = new WorkspaceManager();
        const list = await mgr.list();
        ws.send(JSON.stringify({ type: 'workspace:list', payload: list }));
        break;
      }

      case 'cc:send': {
        const { workspaceId, message, options } = payload;
        await ensureCCSession(workspaceId, options);
        const session = ccSessions.get(workspaceId);
        session.send(message);
        ws.send(JSON.stringify({ type: 'cc:sent', payload: { sessionId: session.getSessionId() } }));
        break;
      }

      case 'cc:abort': {
        const { workspaceId } = payload;
        const session = ccSessions.get(workspaceId);
        if (session) {
          session.abort();
          ccSessions.delete(workspaceId);
        }
        ws.send(JSON.stringify({ type: 'cc:aborted' }));
        break;
      }

      case 'agent:chat': {
        const { workspaceId, message } = payload;
        const { CCSession, WorkspaceManager, MemoryManager } = await import('@jarvis/core');
        const wm = new WorkspaceManager();
        const workspace = await wm.get(workspaceId);
        if (!workspace) {
          ws.send(JSON.stringify({ type: 'error', message: 'Workspace not found' }));
          break;
        }
        const memory = new MemoryManager();
        await memory.addMessage(workspaceId, { role: 'user', content: message });
        const session = new CCSession({ workspacePath: workspace.path });

        session.on('message', (text: string) => {
          ws.send(JSON.stringify({ type: 'agent:chunk', workspaceId, chunk: text }));
          broadcast({ type: 'agent:chunk', workspaceId, chunk: text });
        });

        let fullResponse = '';
        session.on('message', (text: string) => { fullResponse += text; });
        session.on('result', async (text: string) => {
          const final = text || fullResponse;
          await memory.addMessage(workspaceId, { role: 'assistant', content: final });
          ws.send(JSON.stringify({ type: 'agent:response', payload: { workspaceId, content: final } }));
        });
        session.on('error', (err: Error) => {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        });
        session.send(message);
        break;
      }

      case 'system:status': {
        const statusPath = join(JARVIS_HOME, 'status.json');
        if (existsSync(statusPath)) {
          ws.send(JSON.stringify({ type: 'system:status', payload: JSON.parse(readFileSync(statusPath, 'utf-8')) }));
        }
        break;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${type}` }));
    }
  } catch (err: any) {
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
}

// ─── HTTP Request Handler ────────────────────────────────────────

function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // API routes
  if (pathname.startsWith('/api/')) {
    handleAPI(req, res, pathname);
    return;
  }

  // In dev mode, proxy to Vite dev server
  if (isDev) {
    // Return a redirect hint - the frontend runs on Vite dev server directly
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      name: 'Jarvis API',
      version: '0.1.0',
      mode: 'development',
      api: `http://localhost:${PORT}/api`,
      websocket: `ws://localhost:${PORT}`,
    }));
    return;
  }

  // Production: serve static files
  // Try exact file
  let filePath = join(STATIC_DIR, pathname);
  if (serveStatic(res, filePath)) return;

  // SPA fallback: serve index.html for non-file routes
  filePath = join(STATIC_DIR, 'index.html');
  if (serveStatic(res, filePath)) return;

  sendError(res, 'Not found', 404);
}

// ─── Start Server ────────────────────────────────────────────────

const server = createServer(handleRequest);

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  wsClients.add(ws);
  console.log(`[WS] Client connected (total: ${wsClients.size})`);

  ws.on('message', async (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      await handleWSMessage(ws, msg);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════╗
║           Jarvis Web Server                  ║
║──────────────────────────────────────────────║
║  HTTP API:    http://0.0.0.0:${PORT}            ║
║  WebSocket:   ws://0.0.0.0:${PORT}              ║
║  Mode:        ${isDev ? 'development' : 'production '}                ║
╚══════════════════════════════════════════════╝
  `);
});
