/**
 * Unified API adapter - works in both Electron (IPC) and browser (mock) modes.
 *
 * In Electron, window.jarvis is injected by preload.
 * In browser, we provide a stub that returns sensible defaults so the UI renders
 * without errors. A future HTTP backend can replace the stubs.
 */

function getIPC(): any | null {
  return typeof window !== 'undefined' && (window as any).jarvis
    ? (window as any).jarvis
    : null;
}

export function isElectron(): boolean {
  return getIPC() !== null;
}

// ---------------------------------------------------------------------------
// Helpers: wrap IPC calls with fallback
// ---------------------------------------------------------------------------

async function invoke<T>(path: string, fallback: T, ...args: any[]): Promise<T> {
  const ipc = getIPC();
  if (!ipc) return fallback;

  const parts = path.split('.');
  let target: any = ipc;
  for (const p of parts) {
    target = target?.[p];
  }

  if (typeof target === 'function') {
    try {
      return await target(...args);
    } catch (err) {
      console.warn(`[api] ${path} failed:`, err);
      return fallback;
    }
  }
  return fallback;
}

function listen(path: string, callback: (...args: any[]) => void): () => void {
  const ipc = getIPC();
  if (!ipc) return () => {};

  const parts = path.split('.');
  let target: any = ipc;
  for (const p of parts) {
    target = target?.[p];
  }

  if (typeof target === 'function') {
    try {
      return target(callback) || (() => {});
    } catch {
      return () => {};
    }
  }
  return () => {};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const api = {
  workspace: {
    list: () => invoke<any[]>('workspace.list', []),
    create: (input: any) => invoke<any>('workspace.create', null, input),
    update: (id: string, updates: any) => invoke<any>('workspace.update', null, id, updates),
    delete: (id: string) => invoke<boolean>('workspace.delete', false, id),
  },

  agent: {
    chat: (workspaceId: string, content: string) =>
      invoke<string>('agent.chat', '', workspaceId, content),
    onChunk: (cb: (data: any) => void) => listen('agent.onChunk', cb),
  },

  cc: {
    send: (workspaceId: string, message: string, options?: any) =>
      invoke<any>('cc.send', null, workspaceId, message, options),
    abort: (workspaceId: string) => invoke<void>('cc.abort', undefined, workspaceId),
    newSession: (workspaceId: string) => invoke<any>('cc.newSession', null, workspaceId),
    onMessage: (cb: (data: any) => void) => listen('cc.onMessage', cb),
    onThinking: (cb: (data: any) => void) => listen('cc.onThinking', cb),
    onToolUse: (cb: (data: any) => void) => listen('cc.onToolUse', cb),
    onToolResult: (cb: (data: any) => void) => listen('cc.onToolResult', cb),
    onResult: (cb: (data: any) => void) => listen('cc.onResult', cb),
    onError: (cb: (data: any) => void) => listen('cc.onError', cb),
    onDone: (cb: (data: any) => void) => listen('cc.onDone', cb),
  },

  memory: {
    getRecent: (workspaceId: string, limit: number) =>
      invoke<any[]>('memory.getRecent', [], workspaceId, limit),
  },

  models: {
    getConfig: (workspaceId: string) => invoke<any>('models.getConfig', null, workspaceId),
    setConfig: (workspaceId: string, config: any) =>
      invoke<void>('models.setConfig', undefined, workspaceId, config),
  },

  tools: {
    list: (workspaceId?: string) => invoke<any[]>('tools.list', [], workspaceId),
  },

  skills: {
    list: () => invoke<any[]>('skills.list', []),
    generate: (desc: string) => invoke<void>('skills.generate', undefined, desc),
    install: (name: string, content: string) =>
      invoke<void>('skills.install', undefined, name, content),
  },

  upgrade: {
    generateTool: (opts: any) => invoke<void>('upgrade.generateTool', undefined, opts),
  },

  loop: {
    start: (workspaceId: string, config: any) =>
      invoke<void>('loop.start', undefined, workspaceId, config),
    stop: (workspaceId: string) => invoke<void>('loop.stop', undefined, workspaceId),
  },

  lark: {
    bind: (workspaceId: string, chatId: string) =>
      invoke<void>('lark.bind', undefined, workspaceId, chatId),
  },

  digitalHumans: {
    list: () => invoke<any[]>('digitalHumans.list', []),
    create: (input: any) => invoke<any>('digitalHumans.create', null, input),
    update: (id: string, updates: any) => invoke<any>('digitalHumans.update', null, id, updates),
    delete: (id: string) => invoke<boolean>('digitalHumans.delete', false, id),
    activity: (id: string, limit?: number) =>
      invoke<any[]>('digitalHumans.activity', [], id, limit),
  },

  providers: {
    list: () => invoke<any[]>('providers.list', []),
    update: (id: string, updates: any) => invoke<any>('providers.update', null, id, updates),
    models: () => invoke<any[]>('providers.models', []),
  },

  artifacts: {
    list: (workspaceId: string) => invoke<any[]>('artifacts.list', [], workspaceId),
    content: (filePath: string) => invoke<string | null>('artifacts.content', null, filePath),
  },

  browser: {
    open: (url?: string) => invoke<any>('browser.open', null, url),
    navigate: (url: string) => invoke<any>('browser.navigate', null, url),
    state: () => invoke<any>('browser.state', null),
    screenshot: () => invoke<string | null>('browser.screenshot', null),
    close: () => invoke<void>('browser.close', undefined),
  },
};
