/**
 * Unified API adapter - HTTP + WebSocket transport for pure web mode.
 *
 * All calls go through the Jarvis API server (HTTP REST + WebSocket for streaming).
 * No Electron IPC dependency.
 */

// ─── Configuration ───────────────────────────────────────────────

const API_BASE = (import.meta as any).env?.VITE_API_URL || `http://${window.location.hostname}:3927`;
const WS_URL = (import.meta as any).env?.VITE_WS_URL || `ws://${window.location.hostname}:3927`;

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

  browser: {
    open: (_url?: string) => Promise.resolve(null),
    navigate: (_url: string) => Promise.resolve(null),
    state: () => Promise.resolve(null),
    screenshot: () => Promise.resolve(null),
    close: () => Promise.resolve(undefined),
  },
};
