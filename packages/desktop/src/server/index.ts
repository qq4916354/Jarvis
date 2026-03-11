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
import { existsSync, readFileSync, statSync } from 'fs';
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
const loopTimers = new Map<string, ReturnType<typeof setInterval>>();
const researchTasks = new Map<string, any>(); // taskId -> { status, topic, report?, error? }

// ─── Singleton Service Instances ────────────────────────────────

let _workspaceManager: any = null;
let _memoryManager: any = null;
let _scheduler: any = null;
let _toolManager: any = null;
let _skillManager: any = null;
let _providerRegistry: any = null;

async function getWorkspaceManager() {
  if (!_workspaceManager) {
    const { WorkspaceManager } = await import('@jarvis/core');
    _workspaceManager = new WorkspaceManager();
  }
  return _workspaceManager;
}

async function getMemoryManager() {
  if (!_memoryManager) {
    const { MemoryManager } = await import('@jarvis/core');
    _memoryManager = new MemoryManager();
  }
  return _memoryManager;
}

async function getScheduler() {
  if (!_scheduler) {
    const { Scheduler } = await import('@jarvis/core');
    _scheduler = new Scheduler();
  }
  return _scheduler;
}

async function getToolManager() {
  if (!_toolManager) {
    const { ToolManager } = await import('@jarvis/core');
    _toolManager = new ToolManager();
  }
  return _toolManager;
}

async function getSkillManager() {
  if (!_skillManager) {
    const { SkillManager } = await import('@jarvis/core');
    _skillManager = new SkillManager();
  }
  return _skillManager;
}

async function getProviderRegistry() {
  if (!_providerRegistry) {
    const { ProviderRegistry } = await import('@jarvis/core');
    _providerRegistry = new ProviderRegistry();
  }
  return _providerRegistry;
}

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

// ─── Helpers ────────────────────────────────────────────────────

/** Flatten core Workspace { config, path } to { ...config, path } for the frontend */
function flattenWorkspace(ws: any): any {
  if (!ws) return ws;
  if (ws.config) {
    return { ...ws.config, path: ws.path };
  }
  return ws;
}

// ─── REST API Routes ─────────────────────────────────────────────

async function handleAPI(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const method = req.method || 'GET';

  try {
    // ── Workspace ──
    if (pathname === '/api/workspaces' && method === 'GET') {
      const mgr = await getWorkspaceManager();
      const list = await mgr.list();
      return sendJSON(res, list.map(flattenWorkspace));
    }

    if (pathname === '/api/workspaces' && method === 'POST') {
      const body = await readBody(req);
      const mgr = await getWorkspaceManager();
      return sendJSON(res, flattenWorkspace(await mgr.create(body)), 201);
    }

    if (pathname.startsWith('/api/workspaces/') && method === 'GET') {
      const id = pathname.split('/')[3];
      const mgr = await getWorkspaceManager();
      return sendJSON(res, flattenWorkspace(await mgr.get(id)));
    }

    if (pathname.startsWith('/api/workspaces/') && method === 'PUT') {
      const id = pathname.split('/')[3];
      const body = await readBody(req);
      const mgr = await getWorkspaceManager();
      return sendJSON(res, flattenWorkspace(await mgr.update(id, body)));
    }

    if (pathname.startsWith('/api/workspaces/') && method === 'DELETE') {
      const id = pathname.split('/')[3];
      const mgr = await getWorkspaceManager();
      await mgr.delete(id);
      return sendJSON(res, { deleted: true });
    }

    // ── Agent Chat (non-streaming, returns final result) ──
    if (pathname === '/api/agent/chat' && method === 'POST') {
      const { workspaceId, message } = await readBody(req);
      const { CCSession } = await import('@jarvis/core');

      const wm = await getWorkspaceManager();
      const ws = await wm.get(workspaceId);
      if (!ws) return sendError(res, 'Workspace not found', 404);

      const memory = await getMemoryManager();
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
      if (!workspaceId || !message) return sendError(res, 'workspaceId and message are required', 400);
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
      const memory = await getMemoryManager();
      return sendJSON(res, await memory.getRecentMessages(workspaceId, limit));
    }

    if (pathname === '/api/memory/remember' && method === 'POST') {
      const { workspaceId, key, value, type } = await readBody(req);
      const memory = await getMemoryManager();
      return sendJSON(res, await memory.remember(workspaceId, key, value, type));
    }

    if (pathname === '/api/memory/recall' && method === 'POST') {
      const { workspaceId, query } = await readBody(req);
      const memory = await getMemoryManager();
      return sendJSON(res, await memory.recall(workspaceId, query));
    }

    // ── Memory: Semantic Search ──
    if (pathname.match(/^\/api\/workspaces\/[^/]+\/memory\/search$/) && method === 'GET') {
      const id = pathname.split('/')[3];
      const url = new URL(req.url || '/', `http://localhost:${PORT}`);
      const q = url.searchParams.get('q') || '';
      const semantic = url.searchParams.get('semantic') === 'true';
      const limit = parseInt(url.searchParams.get('limit') || '10', 10);
      const threshold = parseFloat(url.searchParams.get('threshold') || '0.5');

      const { MemoryManager } = await import('@jarvis/core');
      const memory = new MemoryManager();

      if (semantic) {
        return sendJSON(res, await memory.semanticSearch(id, q, { limit, threshold }));
      } else {
        return sendJSON(res, await memory.recall(id, q));
      }
    }

    // ── Memory: Auto-Summarize ──
    if (pathname.match(/^\/api\/workspaces\/[^/]+\/memory\/summarize$/) && method === 'POST') {
      const id = pathname.split('/')[3];
      const { messages } = await readBody(req);
      const { MemoryManager } = await import('@jarvis/core');
      const memory = new MemoryManager();
      return sendJSON(res, await memory.autoSummarize(id, messages || []));
    }

    // ── Memory: Consolidate ──
    if (pathname.match(/^\/api\/workspaces\/[^/]+\/memory\/consolidate$/) && method === 'POST') {
      const id = pathname.split('/')[3];
      const { MemoryManager } = await import('@jarvis/core');
      const memory = new MemoryManager();
      return sendJSON(res, await memory.consolidate(id));
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
      const registry = await getProviderRegistry();
      return sendJSON(res, await registry.getAllModels());
    }

    // ── Loop Mode ──
    if (pathname === '/api/loop/start' && method === 'POST') {
      const { workspaceId, config: loopConfig } = await readBody(req);
      const wm = await getWorkspaceManager();
      const ws = await wm.get(workspaceId);
      if (!ws) return sendError(res, 'Workspace not found', 404);

      const intervalMinutes = loopConfig?.intervalMinutes || 10;
      
      if (loopTimers.has(workspaceId)) {
        clearInterval(loopTimers.get(workspaceId)!);
      }

      const runLoop = async () => {
        try {
          const { CCSession } = await import('@jarvis/core');
          const wsData = await wm.get(workspaceId);
          const goal = wsData?.config?.goal || wsData?.goal || 'Review current state and suggest improvements';
          
          const prompt = `You are in autonomous loop mode. Your workspace goal is: "${goal}"
          
Analyze the current state, decide what to do next to progress toward the goal, and take action.
Report what you did and what should be done in the next iteration.`;

          const session = new CCSession({ workspacePath: ws.path });
          session.on('message', (text: string) => {
            broadcast({ type: 'cc:message', workspaceId, text });
          });
          session.on('result', (text: string) => {
            broadcast({ type: 'loop:iteration', workspaceId, result: text });
          });
          session.send(prompt);
        } catch (err: any) {
          broadcast({ type: 'loop:error', workspaceId, error: err.message });
        }
      };

      const timer = setInterval(runLoop, intervalMinutes * 60 * 1000);
      loopTimers.set(workspaceId, timer);
      
      runLoop();
      
      return sendJSON(res, { started: true, intervalMinutes });
    }

    if (pathname === '/api/loop/stop' && method === 'POST') {
      const { workspaceId } = await readBody(req);
      if (loopTimers.has(workspaceId)) {
        clearInterval(loopTimers.get(workspaceId)!);
        loopTimers.delete(workspaceId);
      }
      return sendJSON(res, { stopped: true });
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
      const skills = await getSkillManager();
      return sendJSON(res, await skills.list());
    }

    if (pathname === '/api/skills/install' && method === 'POST') {
      const { name, content } = await readBody(req);
      const skills = await getSkillManager();
      return sendJSON(res, await skills.install(name, content));
    }

    if (pathname === '/api/skills/generate' && method === 'POST') {
      const { description } = await readBody(req);
      const skills = await getSkillManager();
      return sendJSON(res, await skills.generate(description));
    }

    // ── Tools ──
    if (pathname === '/api/tools' && method === 'GET') {
      const url = new URL(req.url || '/', `http://localhost:${PORT}`);
      const workspaceId = url.searchParams.get('workspaceId') || undefined;
      const tools = await getToolManager();
      return sendJSON(res, await tools.list(workspaceId));
    }

    if (pathname === '/api/tools/execute' && method === 'POST') {
      const { name, params, context } = await readBody(req);
      const tools = await getToolManager();
      return sendJSON(res, await tools.execute(name, params, context));
    }

    // ── Scheduler ──
    if (pathname === '/api/scheduler/heartbeat' && method === 'POST') {
      const { workspaceId, intervalMs } = await readBody(req);
      const scheduler = await getScheduler();
      return sendJSON(res, await scheduler.startHeartbeat(workspaceId, intervalMs));
    }

    // ── Dashboard ──
    if (pathname === '/api/dashboard' && method === 'GET') {
      const { WorkspaceManager, MemoryManager } = await import('@jarvis/core');

      const wm = new WorkspaceManager();
      const workspaces = await wm.list();
      const uptimeSeconds = Math.floor(process.uptime());
      const hasActiveSessions = ccSessions.size > 0;

      let messageCount = 0;
      let memoryCount = 0;
      let episodeCount = 0;
      const recentActivity: { time: string; title: string; description?: string }[] = [];

      try {
        const memory = new MemoryManager();
        for (const ws of workspaces) {
          try {
            const msgs = await memory.getRecentMessages(ws.id, 100);
            messageCount += Array.isArray(msgs) ? msgs.length : 0;
            const memories = await memory.recall(ws.id, '*');
            if (Array.isArray(memories)) memoryCount += memories.length;
          } catch { /* workspace may not have memory initialized */ }
        }
        for (const ws of workspaces.slice(0, 3)) {
          try {
            const msgs = await memory.getRecentMessages(ws.id, 3);
            if (Array.isArray(msgs)) {
              for (const msg of msgs) {
                recentActivity.push({
                  time: msg.timestamp || new Date().toISOString(),
                  title: `${msg.role === 'user' ? 'User' : 'Agent'} message`,
                  description: typeof msg.content === 'string' ? msg.content.slice(0, 80) : undefined,
                });
              }
            }
          } catch { /* ignore */ }
        }
      } catch { /* MemoryManager may not be available */ }

      let activeTasks: any[] = [];
      let nextExecution: string | null = null;
      try {
        const { Scheduler } = await import('@jarvis/core');
        const scheduler = new Scheduler();
        if (typeof scheduler.listTasks === 'function') {
          activeTasks = await scheduler.listTasks();
          if (activeTasks.length > 0 && activeTasks[0].nextRun) {
            nextExecution = activeTasks[0].nextRun;
          }
        }
      } catch { /* Scheduler may not support listTasks */ }

      let evolutionData = { currentCycle: null as any, history: [] as any[] };
      try {
        const statusPath = join(JARVIS_HOME, 'evolution', 'status.json');
        if (existsSync(statusPath)) {
          evolutionData = JSON.parse(readFileSync(statusPath, 'utf-8'));
        }
      } catch { /* no evolution data */ }

      return sendJSON(res, {
        system: {
          uptime: uptimeSeconds,
          activeWorkspaces: workspaces.length,
          agentStatus: hasActiveSessions ? 'active' : 'idle',
          evolutionActive: evolutionData.currentCycle !== null,
        },
        evolution: evolutionData,
        memory: { messageCount, memoryCount, episodeCount, recentActivity: recentActivity.slice(0, 5) },
        scheduler: { activeTasks, nextExecution },
      });
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
      const registry = await getProviderRegistry();
      return sendJSON(res, await registry.listProviders());
    }

    if (pathname.match(/^\/api\/providers\/[^/]+$/) && method === 'PUT') {
      const id = pathname.split('/')[3];
      const body = await readBody(req);
      const registry = await getProviderRegistry();
      registry.updateProvider(id, body);
      return sendJSON(res, await registry.getProvider(id));
    }

    if (pathname === '/api/providers/models' && method === 'GET') {
      const registry = await getProviderRegistry();
      return sendJSON(res, await registry.getAllModels());
    }

    // ── Artifacts ──
    if (pathname === '/api/artifacts' && method === 'POST') {
      const { workspaceId } = await readBody(req);
      const { ArtifactManager } = await import('@jarvis/core');
      const wm = await getWorkspaceManager();
      const ws = await wm.get(workspaceId);
      if (!ws) return sendJSON(res, []);
      const am = new ArtifactManager(ws.path, workspaceId);
      return sendJSON(res, await am.getArtifacts());
    }

    if (pathname === '/api/artifacts/tree' && method === 'POST') {
      const { workspaceId } = await readBody(req);
      const { ArtifactManager } = await import('@jarvis/core');
      const wm = await getWorkspaceManager();
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

    // ── Browser Automation ──
    if (pathname === '/api/browser/launch' && method === 'POST') {
      const { getBrowserService } = await import('@jarvis/core/browser');
      const browser = getBrowserService();
      return sendJSON(res, await browser.launch());
    }

    if (pathname === '/api/browser/close' && method === 'POST') {
      const { getBrowserService } = await import('@jarvis/core/browser');
      const browser = getBrowserService();
      await browser.close();
      return sendJSON(res, { closed: true });
    }

    if (pathname === '/api/browser/navigate' && method === 'POST') {
      const { url } = await readBody(req);
      const { getBrowserService } = await import('@jarvis/core/browser');
      const browser = getBrowserService();
      const result = await browser.navigate(url);
      broadcast({ type: 'browser:navigated', ...result });
      return sendJSON(res, result);
    }

    if (pathname === '/api/browser/back' && method === 'POST') {
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, await getBrowserService().goBack());
    }

    if (pathname === '/api/browser/forward' && method === 'POST') {
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, await getBrowserService().goForward());
    }

    if (pathname === '/api/browser/reload' && method === 'POST') {
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, await getBrowserService().reload());
    }

    if (pathname === '/api/browser/snapshot' && method === 'POST') {
      const { getBrowserService } = await import('@jarvis/core/browser');
      const snapshot = await getBrowserService().snapshot();
      return sendJSON(res, { snapshot });
    }

    if (pathname === '/api/browser/screenshot' && method === 'POST') {
      const { getBrowserService } = await import('@jarvis/core/browser');
      const base64 = await getBrowserService().screenshot();
      return sendJSON(res, { image: base64 });
    }

    if (pathname === '/api/browser/click' && method === 'POST') {
      const { uid, dblClick } = await readBody(req);
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, { result: await getBrowserService().click(uid, { dblClick }) });
    }

    if (pathname === '/api/browser/hover' && method === 'POST') {
      const { uid } = await readBody(req);
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, { result: await getBrowserService().hover(uid) });
    }

    if (pathname === '/api/browser/fill' && method === 'POST') {
      const { uid, value } = await readBody(req);
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, { result: await getBrowserService().fill(uid, value) });
    }

    if (pathname === '/api/browser/select' && method === 'POST') {
      const { uid, values } = await readBody(req);
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, { result: await getBrowserService().selectOption(uid, values) });
    }

    if (pathname === '/api/browser/type' && method === 'POST') {
      const { text, delay } = await readBody(req);
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, { result: await getBrowserService().type(text, { delay }) });
    }

    if (pathname === '/api/browser/press' && method === 'POST') {
      const { key } = await readBody(req);
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, { result: await getBrowserService().press(key) });
    }

    if (pathname === '/api/browser/evaluate' && method === 'POST') {
      const { expression } = await readBody(req);
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, { result: await getBrowserService().evaluate(expression) });
    }

    if (pathname === '/api/browser/wait' && method === 'POST') {
      const { selector, text, timeout } = await readBody(req);
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, { result: await getBrowserService().waitFor({ selector, text, timeout }) });
    }

    if (pathname === '/api/browser/state' && method === 'GET') {
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, await getBrowserService().getStateWithTitle());
    }

    if (pathname === '/api/browser/pages' && method === 'GET') {
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, await getBrowserService().listPages());
    }

    if (pathname === '/api/browser/new-page' && method === 'POST') {
      const { url } = await readBody(req);
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, await getBrowserService().newPage(url));
    }

    if (pathname === '/api/browser/close-page' && method === 'POST') {
      const { index } = await readBody(req);
      const { getBrowserService } = await import('@jarvis/core/browser');
      await getBrowserService().closePage(index);
      return sendJSON(res, { closed: true });
    }

    if (pathname === '/api/browser/select-page' && method === 'POST') {
      const { index } = await readBody(req);
      const { getBrowserService } = await import('@jarvis/core/browser');
      return sendJSON(res, await getBrowserService().selectPage(index));
    }

    // ── Workspace Files ──
    if (pathname === '/api/workspace-files/read' && method === 'POST') {
      const { workspaceId, fileName } = await readBody(req);
      if (!workspaceId || !fileName) return sendJSON(res, null);
      const wm = await getWorkspaceManager();
      const ws = await wm.get(workspaceId);
      if (!ws) return sendJSON(res, null);
      const filePath = join(ws.path, fileName);
      if (!existsSync(filePath)) return sendJSON(res, '');
      return sendJSON(res, readFileSync(filePath, 'utf-8'));
    }

    if (pathname === '/api/workspace-files/write' && method === 'POST') {
      const { workspaceId, fileName, content } = await readBody(req);
      if (!workspaceId || !fileName) return sendError(res, 'Missing workspaceId or fileName', 400);
      const { writeFileSync, mkdirSync } = await import('fs');
      const wm = await getWorkspaceManager();
      const ws = await wm.get(workspaceId);
      if (!ws) return sendError(res, 'Workspace not found', 404);
      const filePath = join(ws.path, fileName);
      mkdirSync(join(ws.path), { recursive: true });
      writeFileSync(filePath, content, 'utf-8');
      return sendJSON(res, { saved: true });
    }

    // ── Daemon Status ──
    if (pathname === '/api/daemon/status' && method === 'GET') {
      const statusPath = join(JARVIS_HOME, 'daemon-status.json');
      if (existsSync(statusPath)) {
        return sendJSON(res, JSON.parse(readFileSync(statusPath, 'utf-8')));
      }
      return sendJSON(res, {
        running: true,
        uptime: Math.floor(process.uptime()),
        pid: process.pid,
        version: '1.0.0',
        lastHealthCheck: Date.now(),
        serverStatus: 'healthy',
        errors: [],
        autoFixCount: 0,
      });
    }

    if (pathname === '/api/daemon/logs' && method === 'GET') {
      const logsPath = join(JARVIS_HOME, 'logs', 'daemon.log');
      if (!existsSync(logsPath)) return sendJSON(res, []);
      try {
        const raw = readFileSync(logsPath, 'utf-8');
        const lines = raw.trim().split('\n').slice(-50);
        const logs = lines.map((line) => {
          try { return JSON.parse(line); } catch { return { timestamp: Date.now(), level: 'info', message: line }; }
        });
        return sendJSON(res, logs);
      } catch { return sendJSON(res, []); }
    }

    if (pathname === '/api/daemon/restart' && method === 'POST') {
      return sendJSON(res, { restarted: true });
    }

    // ── Scheduler CRUD ──
    if (pathname === '/api/scheduler' && method === 'GET') {
      const url = new URL(req.url || '/', `http://localhost:${PORT}`);
      const workspaceId = url.searchParams.get('workspaceId') || '';
      const tasksPath = join(JARVIS_HOME, 'data', 'workspaces', workspaceId, 'scheduled-tasks.json');
      if (!existsSync(tasksPath)) return sendJSON(res, []);
      return sendJSON(res, JSON.parse(readFileSync(tasksPath, 'utf-8')));
    }

    if (pathname === '/api/scheduler' && method === 'POST') {
      const { writeFileSync: wf, mkdirSync: md } = await import('fs');
      const { randomUUID } = await import('crypto');
      const body = await readBody(req);
      const { workspaceId, name, cron, action } = body;
      const dir = join(JARVIS_HOME, 'data', 'workspaces', workspaceId);
      md(dir, { recursive: true });
      const tasksPath = join(dir, 'scheduled-tasks.json');
      const tasks = existsSync(tasksPath) ? JSON.parse(readFileSync(tasksPath, 'utf-8')) : [];
      const task = { id: randomUUID(), name, cron, action, enabled: true, lastRun: null, nextRun: null, workspaceId };
      tasks.push(task);
      wf(tasksPath, JSON.stringify(tasks, null, 2), 'utf-8');
      return sendJSON(res, task, 201);
    }

    if (pathname.match(/^\/api\/scheduler\/[^/]+$/) && method === 'PUT') {
      const { writeFileSync: wf } = await import('fs');
      const taskId = pathname.split('/')[3];
      const updates = await readBody(req);
      // Find across all workspaces - simplified: search in all workspace dirs
      const { readdirSync } = await import('fs');
      const wsDir = join(JARVIS_HOME, 'data', 'workspaces');
      if (existsSync(wsDir)) {
        for (const wsId of readdirSync(wsDir)) {
          const tasksPath = join(wsDir, wsId, 'scheduled-tasks.json');
          if (!existsSync(tasksPath)) continue;
          const tasks = JSON.parse(readFileSync(tasksPath, 'utf-8'));
          const idx = tasks.findIndex((t: any) => t.id === taskId);
          if (idx >= 0) {
            tasks[idx] = { ...tasks[idx], ...updates };
            wf(tasksPath, JSON.stringify(tasks, null, 2), 'utf-8');
            return sendJSON(res, tasks[idx]);
          }
        }
      }
      return sendError(res, 'Task not found', 404);
    }

    if (pathname.match(/^\/api\/scheduler\/[^/]+$/) && method === 'DELETE') {
      const { writeFileSync: wf } = await import('fs');
      const taskId = pathname.split('/')[3];
      const { readdirSync } = await import('fs');
      const wsDir = join(JARVIS_HOME, 'data', 'workspaces');
      if (existsSync(wsDir)) {
        for (const wsId of readdirSync(wsDir)) {
          const tasksPath = join(wsDir, wsId, 'scheduled-tasks.json');
          if (!existsSync(tasksPath)) continue;
          const tasks = JSON.parse(readFileSync(tasksPath, 'utf-8'));
          const idx = tasks.findIndex((t: any) => t.id === taskId);
          if (idx >= 0) {
            tasks.splice(idx, 1);
            wf(tasksPath, JSON.stringify(tasks, null, 2), 'utf-8');
            return sendJSON(res, { deleted: true });
          }
        }
      }
      return sendError(res, 'Task not found', 404);
    }

    // ── Evolution Engine ──
    if (pathname === '/api/evolution/start' && method === 'POST') {
      const { goal, projectPath } = await readBody(req);
      console.log('[Evolution] Starting with goal:', goal || '(default)');

      try {
        const { EvolutionEngine } = await import('@jarvis/core');
        const engine = new EvolutionEngine({
          projectPath: projectPath || join(__dirname, '..', '..', '..'),
          goal: goal || 'Improve the Jarvis platform',
        });
        
        engine.on('log', (message: string) => {
          console.log('[Evolution]', message);
          broadcast({ type: 'evolution:log', message });
        });
        engine.on('phase:start', (phase: string, cycle: any) => {
          console.log('[Evolution] Phase started:', phase);
          broadcast({ type: 'evolution:phase', phase, status: 'running', cycle });
        });
        engine.on('phase:complete', (phase: string, output: string, cycle: any) => {
          console.log('[Evolution] Phase completed:', phase, `(${output.length} chars)`);
          broadcast({ type: 'evolution:phase', phase, status: 'completed', output: output.slice(0, 1000), cycle });
        });
        engine.on('phase:error', (phase: string, error: string) => {
          console.error('[Evolution] Phase error:', phase, error);
          broadcast({ type: 'evolution:phase', phase, status: 'failed', error });
        });
        engine.on('cycle:complete', (cycle: any) => {
          console.log('[Evolution] Cycle completed');
          broadcast({ type: 'evolution:complete', cycle });
        });
        engine.on('cycle:error', (error: string, cycle: any) => {
          console.error('[Evolution] Cycle error:', error);
          broadcast({ type: 'evolution:error', error, cycle });
        });

        engine.runCycle(goal).catch(err => {
          console.error('[Evolution] Unhandled error:', err);
          broadcast({ type: 'evolution:error', error: err.message });
        });
        
        return sendJSON(res, { started: true, goal: goal || 'Improve the Jarvis platform' });
      } catch (err: any) {
        console.error('[Evolution] Failed to initialize:', err);
        return sendError(res, `Evolution failed to start: ${err.message}`);
      }
    }

    if (pathname === '/api/evolution/history' && method === 'GET') {
      const historyPath = join(JARVIS_HOME, 'data', 'evolution-history.json');
      if (existsSync(historyPath)) {
        return sendJSON(res, JSON.parse(readFileSync(historyPath, 'utf-8')));
      }
      return sendJSON(res, []);
    }

    // ── Research ──
    if (pathname === '/api/research' && method === 'POST') {
      const { topic, config: researchConfig } = await readBody(req);
      if (!topic) return sendError(res, 'Missing required field: topic', 400);

      const { BrowserService, ResearchAgent, ModelService } = await import('@jarvis/core');
      const browser = new BrowserService();
      const id = `research-${Date.now()}`;

      let summarizer: ((prompt: string) => Promise<string>) | undefined;
      try {
        const models = new ModelService();
        summarizer = async (prompt: string) => {
          const result = await models.chat([{ role: 'user', content: prompt }]) as any;
          return result?.choices?.[0]?.message?.content ?? '';
        };
      } catch { /* No model configured */ }

      const agent = new ResearchAgent(browser, researchConfig, summarizer);
      researchTasks.set(id, { status: 'running', topic, startedAt: Date.now() });

      agent.on('progress', (data) => {
        const task = researchTasks.get(id);
        if (task) task.progress = data;
        broadcast({ type: 'research:progress', id, ...data });
      });

      agent.on('error', (data) => {
        broadcast({ type: 'research:error', id, ...data });
      });

      agent.research(topic).then(async (report) => {
        researchTasks.set(id, { status: 'complete', topic, report, startedAt: researchTasks.get(id)?.startedAt ?? Date.now() });
        broadcast({ type: 'research:complete', id, report });
        await browser.close();
      }).catch(async (err: any) => {
        researchTasks.set(id, { status: 'error', topic, error: err.message, startedAt: researchTasks.get(id)?.startedAt ?? Date.now() });
        broadcast({ type: 'research:error', id, error: err.message });
        await browser.close();
      });

      return sendJSON(res, { id, status: 'running' }, 202);
    }

    if (pathname.match(/^\/api\/research\/[^/]+$/) && method === 'GET') {
      const id = pathname.split('/')[3];
      const task = researchTasks.get(id);
      if (!task) return sendError(res, 'Research task not found', 404);
      return sendJSON(res, { id, ...task });
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

  const { CCSession } = await import('@jarvis/core');
  const wm = await getWorkspaceManager();
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
  session.on('system', (info: any) => {
    broadcast({ type: 'cc:system', workspaceId, ...info });
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
        const mgr = await getWorkspaceManager();
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
        const { CCSession } = await import('@jarvis/core');
        const wm = await getWorkspaceManager();
        const workspace = await wm.get(workspaceId);
        if (!workspace) {
          ws.send(JSON.stringify({ type: 'error', message: 'Workspace not found' }));
          break;
        }
        const memory = await getMemoryManager();
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

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[Server] Port ${PORT} is already in use.`);
    console.error(`[Server] Set JARVIS_PORT env var to use a different port.`);
    process.exit(1);
  }
  console.error('[Server] Error:', err);
});

server.listen(PORT, '0.0.0.0', () => {
  // Only create WebSocket server after HTTP server is successfully listening
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

// ─── Graceful Shutdown ────────────────────────────────────────────
function shutdown(signal: string) {
  console.log(`\n[Server] ${signal} received, shutting down...`);

  // Close all WebSocket connections
  for (const ws of wsClients) {
    ws.close(1000, 'Server shutting down');
  }
  wsClients.clear();

  // Clear all loop timers
  for (const [id, timer] of loopTimers) {
    clearInterval(timer);
  }
  loopTimers.clear();

  // Abort all CC sessions
  for (const [id, session] of ccSessions) {
    try { session.abort?.(); } catch {}
  }
  ccSessions.clear();

  // Close HTTP server to release the port
  server.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 3s if graceful close hangs
  setTimeout(() => {
    console.log('[Server] Force exit');
    process.exit(1);
  }, 3000);
}

process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C
process.on('SIGTERM', () => shutdown('SIGTERM')); // kill
process.on('SIGTSTP', () => shutdown('SIGTSTP')); // Ctrl+Z
