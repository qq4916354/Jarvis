/**
 * Jarvis Desktop - Electron Main Process
 *
 * Multi-workspace AI agent desktop application with:
 * - Workspace management (agent, soul, tools, memory per workspace)
 * - Lark/Feishu integration
 * - Model configuration
 * - Self-upgrade capability
 * - Loop mode for autonomous goal pursuit
 * - Web server for mobile remote access
 */

import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

// ─── Constants ───────────────────────────────────────────────────

const JARVIS_HOME = process.env.JARVIS_HOME || join(homedir(), '.jarvis');
const WEB_PORT = parseInt(process.env.JARVIS_WEB_PORT || '3927', 10);
const isDev = !app.isPackaged;

// ─── State ───────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let webSocketClients: Set<WebSocket> = new Set();

// ─── IPC Handlers ────────────────────────────────────────────────

function setupIPC() {
  // Workspace operations
  ipcMain.handle('workspace:list', async () => {
    const { WorkspaceManager } = await import('@jarvis/core');
    const manager = new WorkspaceManager();
    return manager.list();
  });

  ipcMain.handle('workspace:create', async (_event, config) => {
    const { WorkspaceManager } = await import('@jarvis/core');
    const manager = new WorkspaceManager();
    return manager.create(config);
  });

  ipcMain.handle('workspace:get', async (_event, id: string) => {
    const { WorkspaceManager } = await import('@jarvis/core');
    const manager = new WorkspaceManager();
    return manager.get(id);
  });

  ipcMain.handle('workspace:update', async (_event, id: string, updates) => {
    const { WorkspaceManager } = await import('@jarvis/core');
    const manager = new WorkspaceManager();
    return manager.update(id, updates);
  });

  ipcMain.handle('workspace:delete', async (_event, id: string) => {
    const { WorkspaceManager } = await import('@jarvis/core');
    const manager = new WorkspaceManager();
    return manager.delete(id);
  });

  // Agent / Chat
  ipcMain.handle('agent:chat', async (_event, workspaceId: string, message: string) => {
    const { ModelService } = await import('@jarvis/core');
    const { MemoryManager } = await import('@jarvis/core');

    const models = new ModelService();
    const memory = new MemoryManager();

    // Add user message to memory
    await memory.addMessage(workspaceId, {
      id: crypto.randomUUID(),
      workspaceId,
      role: 'user',
      content: message,
      timestamp: Date.now(),
    });

    // Get recent context
    const recentMessages = await memory.getRecentMessages(workspaceId, 50);

    // Stream response
    const stream = models.chat(
      recentMessages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
      { workspaceId, stream: true }
    );

    let fullResponse = '';
    for await (const chunk of stream) {
      fullResponse += chunk;
      // Send chunk to renderer
      mainWindow?.webContents.send('agent:chunk', { workspaceId, chunk });
      // Also broadcast to WebSocket clients
      broadcastToWebSocket({ type: 'agent:chunk', workspaceId, chunk });
    }

    // Save assistant response
    await memory.addMessage(workspaceId, {
      id: crypto.randomUUID(),
      workspaceId,
      role: 'assistant',
      content: fullResponse,
      timestamp: Date.now(),
    });

    return fullResponse;
  });

  // Memory operations
  ipcMain.handle('memory:getRecent', async (_event, workspaceId: string, limit?: number) => {
    const { MemoryManager } = await import('@jarvis/core');
    const memory = new MemoryManager();
    return memory.getRecentMessages(workspaceId, limit);
  });

  ipcMain.handle('memory:remember', async (_event, workspaceId: string, key: string, value: string, type: string) => {
    const { MemoryManager } = await import('@jarvis/core');
    const memory = new MemoryManager();
    return memory.remember(workspaceId, key, value, type as any);
  });

  ipcMain.handle('memory:recall', async (_event, workspaceId: string, query: string) => {
    const { MemoryManager } = await import('@jarvis/core');
    const memory = new MemoryManager();
    return memory.recall(workspaceId, query);
  });

  // Model configuration
  ipcMain.handle('models:getConfig', async (_event, workspaceId: string) => {
    const { ConfigManager } = await import('@jarvis/core');
    const config = new ConfigManager();
    return config.get(`workspaces.${workspaceId}.models`);
  });

  ipcMain.handle('models:setConfig', async (_event, workspaceId: string, modelConfig) => {
    const { ConfigManager } = await import('@jarvis/core');
    const config = new ConfigManager();
    return config.set(`workspaces.${workspaceId}.models`, modelConfig);
  });

  ipcMain.handle('models:list', async () => {
    const { ModelService } = await import('@jarvis/core');
    const models = new ModelService();
    return models.listModels();
  });

  // Loop mode
  ipcMain.handle('loop:start', async (_event, workspaceId: string, config) => {
    const { Scheduler } = await import('@jarvis/core');
    const scheduler = new Scheduler();
    return scheduler.startLoopMode(workspaceId, config);
  });

  ipcMain.handle('loop:stop', async (_event, workspaceId: string) => {
    const { Scheduler } = await import('@jarvis/core');
    const scheduler = new Scheduler();
    return scheduler.stopLoopMode(workspaceId);
  });

  // Self-upgrade
  ipcMain.handle('upgrade:develop', async (_event, description: string, workspaceId: string) => {
    const { UpgradeEngine } = await import('@jarvis/core');
    const engine = new UpgradeEngine();
    return engine.developFeature(description, workspaceId);
  });

  ipcMain.handle('upgrade:generateTool', async (_event, spec) => {
    const { UpgradeEngine } = await import('@jarvis/core');
    const engine = new UpgradeEngine();
    return engine.generateTool(spec);
  });

  ipcMain.handle('upgrade:generatePage', async (_event, spec) => {
    const { UpgradeEngine } = await import('@jarvis/core');
    const engine = new UpgradeEngine();
    return engine.generateWebPage(spec);
  });

  // Lark integration
  ipcMain.handle('lark:bind', async (_event, workspaceId: string, chatId: string) => {
    const { LarkService } = await import('@jarvis/core');
    const lark = new LarkService();
    return lark.bindGroup(workspaceId, chatId);
  });

  ipcMain.handle('lark:send', async (_event, workspaceId: string, content: string) => {
    const { LarkService } = await import('@jarvis/core');
    const lark = new LarkService();
    return lark.sendMessage(workspaceId, content);
  });

  // CC Skills
  ipcMain.handle('skills:list', async () => {
    const { SkillManager } = await import('@jarvis/core');
    const skills = new SkillManager();
    return skills.list();
  });

  ipcMain.handle('skills:install', async (_event, name: string, content: string) => {
    const { SkillManager } = await import('@jarvis/core');
    const skills = new SkillManager();
    return skills.install(name, content);
  });

  ipcMain.handle('skills:generate', async (_event, description: string) => {
    const { SkillManager } = await import('@jarvis/core');
    const skills = new SkillManager();
    return skills.generate(description);
  });

  // Tools
  ipcMain.handle('tools:list', async (_event, workspaceId?: string) => {
    const { ToolManager } = await import('@jarvis/core');
    const tools = new ToolManager();
    return tools.list(workspaceId);
  });

  ipcMain.handle('tools:execute', async (_event, name: string, params: any, context: any) => {
    const { ToolManager } = await import('@jarvis/core');
    const tools = new ToolManager();
    return tools.execute(name, params, context);
  });

  // Scheduler
  ipcMain.handle('scheduler:startHeartbeat', async (_event, workspaceId: string, intervalMs: number) => {
    const { Scheduler } = await import('@jarvis/core');
    const scheduler = new Scheduler();
    return scheduler.startHeartbeat(workspaceId, intervalMs);
  });

  // System
  ipcMain.handle('system:status', async () => {
    const statusPath = join(JARVIS_HOME, 'status.json');
    if (existsSync(statusPath)) {
      const { readFileSync } = await import('fs');
      return JSON.parse(readFileSync(statusPath, 'utf-8'));
    }
    return null;
  });

  ipcMain.handle('system:getJarvisHome', () => JARVIS_HOME);
}

// ─── Window Management ───────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Jarvis',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'right' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (event) => {
    // Minimize to tray instead of closing
    event.preventDefault();
    mainWindow?.hide();
  });
}

// ─── Tray ────────────────────────────────────────────────────────

function createTray() {
  // Create a simple 16x16 tray icon
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Jarvis', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.exit(0); } },
  ]);

  tray.setToolTip('Jarvis AI Agent');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow?.show());
}

// ─── WebSocket Server for Mobile Access ──────────────────────────

function startWebServer() {
  const server = createServer(handleHttpRequest);

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    webSocketClients.add(ws);
    console.log(`[WS] Client connected (total: ${webSocketClients.size})`);

    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        await handleWebSocketMessage(ws, msg);
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      webSocketClients.delete(ws);
    });
  });

  server.listen(WEB_PORT, '0.0.0.0', () => {
    console.log(`[Web] Server listening on http://0.0.0.0:${WEB_PORT}`);
  });
}

function handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
  // Serve the mobile web UI
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${WEB_PORT}`);

  if (url.pathname === '/api/status') {
    const statusPath = join(JARVIS_HOME, 'status.json');
    if (existsSync(statusPath)) {
      const { readFileSync } = require('fs');
      res.writeHead(200);
      res.end(readFileSync(statusPath, 'utf-8'));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'running' }));
    }
    return;
  }

  if (url.pathname === '/api/workspaces') {
    // Forward to IPC
    ipcMain.emit('workspace:list');
    res.writeHead(200);
    res.end(JSON.stringify({ message: 'Use WebSocket for real-time interaction' }));
    return;
  }

  // Default: serve static files for mobile web UI
  res.writeHead(200);
  res.end(JSON.stringify({
    name: 'Jarvis',
    version: '0.1.0',
    endpoints: ['/api/status', '/api/workspaces'],
    websocket: `ws://localhost:${WEB_PORT}`,
  }));
}

async function handleWebSocketMessage(ws: WebSocket, msg: any) {
  const { type, payload } = msg;

  switch (type) {
    case 'workspace:list': {
      const result = await ipcMain.handle?.('workspace:list', null as any);
      ws.send(JSON.stringify({ type: 'workspace:list', payload: result }));
      break;
    }

    case 'agent:chat': {
      const { workspaceId, message } = payload;
      // Stream response chunks to this WebSocket client
      const result = await ipcMain.handle?.('agent:chat', null as any, workspaceId, message);
      ws.send(JSON.stringify({ type: 'agent:response', payload: { workspaceId, content: result } }));
      break;
    }

    case 'system:status': {
      const statusPath = join(JARVIS_HOME, 'status.json');
      if (existsSync(statusPath)) {
        const { readFileSync } = require('fs');
        ws.send(JSON.stringify({ type: 'system:status', payload: JSON.parse(readFileSync(statusPath, 'utf-8')) }));
      }
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${type}` }));
  }
}

function broadcastToWebSocket(data: any) {
  const message = JSON.stringify(data);
  for (const client of webSocketClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// ─── App Lifecycle ───────────────────────────────────────────────

app.whenReady().then(() => {
  setupIPC();
  createMainWindow();
  createTray();
  startWebServer();
});

app.on('window-all-closed', () => {
  // Keep running in tray on macOS
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow) {
    createMainWindow();
  } else {
    mainWindow.show();
  }
});
