/**
 * Unified API adapter - HTTP + WebSocket transport for pure web mode.
 *
 * All calls go through the Jarvis API server (HTTP REST + WebSocket for streaming).
 * No Electron IPC dependency.
 */

// ─── Configuration ───────────────────────────────────────────────

const API_BASE = (import.meta as any).env?.VITE_API_URL || '';
const WS_URL = (import.meta as any).env?.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

// ─── HTTP helpers ────────────────────────────────────────────────

async function get<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) return fallback;
    return await res.json();
  } catch (err) {
    console.warn(`[api] GET ${path} failed:`, err);
    return fallback;
  }
}

async function post<T>(path: string, body: any, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return fallback;
    return await res.json();
  } catch (err) {
    console.warn(`[api] POST ${path} failed:`, err);
    return fallback;
  }
}

async function put<T>(path: string, body: any, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return fallback;
    return await res.json();
  } catch (err) {
    console.warn(`[api] PUT ${path} failed:`, err);
    return fallback;
  }
}

async function del<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
    if (!res.ok) return fallback;
    return await res.json();
  } catch (err) {
    console.warn(`[api] DELETE ${path} failed:`, err);
    return fallback;
  }
}

// ─── WebSocket singleton ─────────────────────────────────────────

type EventCallback = (data: any) => void;

class WebSocketManager {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<EventCallback>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('[WS] Connected to', WS_URL);
        this.reconnectDelay = 1000;
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const type = msg.type as string;
          const handlers = this.listeners.get(type);
          if (handlers) {
            for (const handler of handlers) {
              handler(msg);
            }
          }
        } catch { /* ignore parse errors */ }
      };

      this.ws.onclose = () => {
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      this.connect();
    }, this.reconnectDelay);
  }

  on(type: string, callback: EventCallback): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(callback);

    // Ensure connected
    this.connect();

    return () => {
      this.listeners.get(type)?.delete(callback);
    };
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}

const wsManager = new WebSocketManager();

// ─── Public API ──────────────────────────────────────────────────

export const api = {
  workspace: {
    list: () => get<any[]>('/api/workspaces', []),
    create: (input: any) => post<any>('/api/workspaces', input, null),
    update: (id: string, updates: any) => put<any>(`/api/workspaces/${id}`, updates, null),
    delete: (id: string) => del<boolean>(`/api/workspaces/${id}`, false),
  },

  agent: {
    chat: (workspaceId: string, content: string) =>
      post<string>('/api/agent/chat', { workspaceId, message: content }, ''),
    onChunk: (cb: (data: any) => void) => wsManager.on('agent:chunk', cb),
  },

  cc: {
    send: (workspaceId: string, message: string, options?: any) =>
      post<any>('/api/cc/send', { workspaceId, message, options }, null),
    abort: (workspaceId: string) =>
      post<void>('/api/cc/abort', { workspaceId }, undefined),
    newSession: (workspaceId: string) =>
      post<any>('/api/cc/newSession', { workspaceId }, null),
    onMessage: (cb: (data: any) => void) => wsManager.on('cc:message', cb),
    onThinking: (cb: (data: any) => void) => wsManager.on('cc:thinking', cb),
    onToolUse: (cb: (data: any) => void) => wsManager.on('cc:tool_use', cb),
    onToolResult: (cb: (data: any) => void) => wsManager.on('cc:tool_result', cb),
    onResult: (cb: (data: any) => void) => wsManager.on('cc:result', cb),
    onError: (cb: (data: any) => void) => wsManager.on('cc:error', cb),
    onDone: (cb: (data: any) => void) => wsManager.on('cc:done', cb),
  },

  memory: {
    getRecent: (workspaceId: string, limit: number) =>
      post<any[]>('/api/memory/recent', { workspaceId, limit }, []),
  },

  models: {
    getConfig: (workspaceId: string) =>
      post<any>('/api/models/config', { workspaceId }, null),
    setConfig: (workspaceId: string, config: any) =>
      post<void>('/api/models/setConfig', { workspaceId, config }, undefined),
  },

  tools: {
    list: (workspaceId?: string) =>
      get<any[]>(`/api/tools${workspaceId ? `?workspaceId=${workspaceId}` : ''}`, []),
  },

  skills: {
    list: () => get<any[]>('/api/skills', []),
    generate: (desc: string) =>
      post<void>('/api/skills/generate', { description: desc }, undefined),
    install: (name: string, content: string) =>
      post<void>('/api/skills/install', { name, content }, undefined),
  },

  upgrade: {
    generateTool: (opts: any) =>
      post<void>('/api/upgrade/generateTool', opts, undefined),
  },

  loop: {
    start: (workspaceId: string, config: any) =>
      post<void>('/api/loop/start', { workspaceId, config }, undefined),
    stop: (workspaceId: string) =>
      post<void>('/api/loop/stop', { workspaceId }, undefined),
  },

  lark: {
    bind: (workspaceId: string, chatId: string) =>
      post<void>('/api/lark/bind', { workspaceId, chatId }, undefined),
  },

  digitalHumans: {
    list: () => get<any[]>('/api/digital-humans', []),
    create: (input: any) => post<any>('/api/digital-humans', input, null),
    update: (id: string, updates: any) => put<any>(`/api/digital-humans/${id}`, updates, null),
    delete: (id: string) => del<boolean>(`/api/digital-humans/${id}`, false),
    activity: (id: string, limit?: number) =>
      get<any[]>(`/api/digital-humans/${id}/activity?limit=${limit || 20}`, []),
  },

  providers: {
    list: () => get<any[]>('/api/providers', []),
    update: (id: string, updates: any) => put<any>(`/api/providers/${id}`, updates, null),
    models: () => get<any[]>('/api/providers/models', []),
  },

  artifacts: {
    list: (workspaceId: string) =>
      post<any[]>('/api/artifacts', { workspaceId }, []),
    content: (filePath: string) =>
      post<string | null>('/api/artifacts/content', { filePath }, null),
  },

  dashboard: {
    get: () => get<any>('/api/dashboard', null),
  },

  ws: {
    on: (type: string, callback: EventCallback) => wsManager.on(type, callback),
  },

  browser: {
    launch: () => post<any>('/api/browser/launch', {}, null),
    close: () => post<void>('/api/browser/close', {}, undefined),
    navigate: (url: string) => post<any>('/api/browser/navigate', { url }, null),
    back: () => post<any>('/api/browser/back', {}, null),
    forward: () => post<any>('/api/browser/forward', {}, null),
    reload: () => post<any>('/api/browser/reload', {}, null),
    snapshot: () => post<any>('/api/browser/snapshot', {}, null),
    screenshot: () => post<any>('/api/browser/screenshot', {}, null),
    click: (uid: string, dblClick?: boolean) => post<any>('/api/browser/click', { uid, dblClick }, null),
    hover: (uid: string) => post<any>('/api/browser/hover', { uid }, null),
    fill: (uid: string, value: string) => post<any>('/api/browser/fill', { uid, value }, null),
    select: (uid: string, values: string[]) => post<any>('/api/browser/select', { uid, values }, null),
    type: (text: string, delay?: number) => post<any>('/api/browser/type', { text, delay }, null),
    press: (key: string) => post<any>('/api/browser/press', { key }, null),
    evaluate: (expression: string) => post<any>('/api/browser/evaluate', { expression }, null),
    wait: (opts: { selector?: string; text?: string; timeout?: number }) => post<any>('/api/browser/wait', opts, null),
    state: () => get<any>('/api/browser/state', null),
    pages: () => get<any[]>('/api/browser/pages', []),
    newPage: (url?: string) => post<any>('/api/browser/new-page', { url }, null),
    closePage: (index?: number) => post<void>('/api/browser/close-page', { index }, undefined),
    selectPage: (index: number) => post<any>('/api/browser/select-page', { index }, null),
    onNavigated: (cb: (data: any) => void) => wsManager.on('browser:navigated', cb),
    onConsole: (cb: (data: any) => void) => wsManager.on('browser:console', cb),
    onError: (cb: (data: any) => void) => wsManager.on('browser:error', cb),
  },

  workspaceFiles: {
    read: (workspaceId: string, fileName: string) =>
      post<string | null>('/api/workspace-files/read', { workspaceId, fileName }, null),
    write: (workspaceId: string, fileName: string, content: string) =>
      post<void>('/api/workspace-files/write', { workspaceId, fileName, content }, undefined),
  },

  daemon: {
    status: () => get<any>('/api/daemon/status', null),
    logs: (limit?: number) => get<any[]>(`/api/daemon/logs?limit=${limit || 50}`, []),
    restart: () => post<void>('/api/daemon/restart', {}, undefined),
  },

  scheduler: {
    list: (workspaceId: string) =>
      get<any[]>(`/api/scheduler?workspaceId=${workspaceId}`, []),
    create: (workspaceId: string, task: { name: string; cron: string; action: string }) =>
      post<any>('/api/scheduler', { workspaceId, ...task }, null),
    update: (taskId: string, updates: any) =>
      put<any>(`/api/scheduler/${taskId}`, updates, null),
    delete: (taskId: string) =>
      del<boolean>(`/api/scheduler/${taskId}`, false),
  },

  evolution: {
    start: (goal?: string, projectPath?: string) =>
      post<any>('/api/evolution/start', { goal, projectPath }, null),
    history: () => get<any[]>('/api/evolution/history', []),
    onLog: (cb: (data: any) => void) => wsManager.on('evolution:log', cb),
    onPhase: (cb: (data: any) => void) => wsManager.on('evolution:phase', cb),
    onComplete: (cb: (data: any) => void) => wsManager.on('evolution:complete', cb),
    onError: (cb: (data: any) => void) => wsManager.on('evolution:error', cb),
  },
};
