/**
 * Jarvis Desktop - Preload Script
 * Exposes safe IPC methods to the renderer process
 */

import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // ─── Workspace ─────────────────────────────────────────────
  workspace: {
    list: () => ipcRenderer.invoke('workspace:list'),
    create: (config: any) => ipcRenderer.invoke('workspace:create', config),
    get: (id: string) => ipcRenderer.invoke('workspace:get', id),
    update: (id: string, updates: any) => ipcRenderer.invoke('workspace:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('workspace:delete', id),
  },

  // ─── Agent / Chat ──────────────────────────────────────────
  agent: {
    chat: (workspaceId: string, message: string) => ipcRenderer.invoke('agent:chat', workspaceId, message),
    abort: () => ipcRenderer.invoke('agent:abort'),
    onChunk: (callback: (data: { workspaceId: string; chunk: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('agent:chunk', handler);
      return () => ipcRenderer.removeListener('agent:chunk', handler);
    },
    onThinking: (callback: (data: { workspaceId: string; text: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('agent:thinking', handler);
      return () => ipcRenderer.removeListener('agent:thinking', handler);
    },
    onToolUse: (callback: (data: { workspaceId: string; name: string; input: any }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('agent:tool_use', handler);
      return () => ipcRenderer.removeListener('agent:tool_use', handler);
    },
    onToolResult: (callback: (data: { workspaceId: string; name: string; content: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('agent:tool_result', handler);
      return () => ipcRenderer.removeListener('agent:tool_result', handler);
    },
  },

  // ─── CC Session (Agent Loop) ────────────────────────────────
  cc: {
    send: (workspaceId: string, message: string, options?: any) =>
      ipcRenderer.invoke('cc:send', workspaceId, message, options),
    abort: (workspaceId: string) => ipcRenderer.invoke('cc:abort', workspaceId),
    newSession: (workspaceId: string) => ipcRenderer.invoke('cc:newSession', workspaceId),
    onMessage: (callback: (data: { workspaceId: string; text: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('cc:message', handler);
      return () => ipcRenderer.removeListener('cc:message', handler);
    },
    onThinking: (callback: (data: { workspaceId: string; text: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('cc:thinking', handler);
      return () => ipcRenderer.removeListener('cc:thinking', handler);
    },
    onToolUse: (callback: (data: { workspaceId: string; name: string; input: any }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('cc:tool_use', handler);
      return () => ipcRenderer.removeListener('cc:tool_use', handler);
    },
    onToolResult: (callback: (data: { workspaceId: string; name: string; content: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('cc:tool_result', handler);
      return () => ipcRenderer.removeListener('cc:tool_result', handler);
    },
    onResult: (callback: (data: { workspaceId: string; text: string; sessionId: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('cc:result', handler);
      return () => ipcRenderer.removeListener('cc:result', handler);
    },
    onError: (callback: (data: { workspaceId: string; error: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('cc:error', handler);
      return () => ipcRenderer.removeListener('cc:error', handler);
    },
    onDone: (callback: (data: { workspaceId: string; code: number | null }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('cc:done', handler);
      return () => ipcRenderer.removeListener('cc:done', handler);
    },
  },

  // ─── Memory ────────────────────────────────────────────────
  memory: {
    getRecent: (workspaceId: string, limit?: number) => ipcRenderer.invoke('memory:getRecent', workspaceId, limit),
    remember: (workspaceId: string, key: string, value: string, type: string) =>
      ipcRenderer.invoke('memory:remember', workspaceId, key, value, type),
    recall: (workspaceId: string, query: string) => ipcRenderer.invoke('memory:recall', workspaceId, query),
  },

  // ─── Models ────────────────────────────────────────────────
  models: {
    getConfig: (workspaceId: string) => ipcRenderer.invoke('models:getConfig', workspaceId),
    setConfig: (workspaceId: string, config: any) => ipcRenderer.invoke('models:setConfig', workspaceId, config),
    list: () => ipcRenderer.invoke('models:list'),
  },

  // ─── Loop Mode ─────────────────────────────────────────────
  loop: {
    start: (workspaceId: string, config: any) => ipcRenderer.invoke('loop:start', workspaceId, config),
    stop: (workspaceId: string) => ipcRenderer.invoke('loop:stop', workspaceId),
  },

  // ─── Self-Upgrade ──────────────────────────────────────────
  upgrade: {
    develop: (description: string, workspaceId: string) => ipcRenderer.invoke('upgrade:develop', description, workspaceId),
    generateTool: (spec: any) => ipcRenderer.invoke('upgrade:generateTool', spec),
    generatePage: (spec: any) => ipcRenderer.invoke('upgrade:generatePage', spec),
  },

  // ─── Lark ──────────────────────────────────────────────────
  lark: {
    bind: (workspaceId: string, chatId: string) => ipcRenderer.invoke('lark:bind', workspaceId, chatId),
    send: (workspaceId: string, content: string) => ipcRenderer.invoke('lark:send', workspaceId, content),
  },

  // ─── Skills ────────────────────────────────────────────────
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    install: (name: string, content: string) => ipcRenderer.invoke('skills:install', name, content),
    generate: (description: string) => ipcRenderer.invoke('skills:generate', description),
  },

  // ─── Tools ─────────────────────────────────────────────────
  tools: {
    list: (workspaceId?: string) => ipcRenderer.invoke('tools:list', workspaceId),
    execute: (name: string, params: any, context: any) => ipcRenderer.invoke('tools:execute', name, params, context),
  },

  // ─── Scheduler ─────────────────────────────────────────────
  scheduler: {
    startHeartbeat: (workspaceId: string, intervalMs: number) =>
      ipcRenderer.invoke('scheduler:startHeartbeat', workspaceId, intervalMs),
  },

  // ─── Digital Humans ─────────────────────────────────────────
  digitalHumans: {
    list: () => ipcRenderer.invoke('dh:list'),
    create: (input: any) => ipcRenderer.invoke('dh:create', input),
    update: (id: string, updates: any) => ipcRenderer.invoke('dh:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('dh:delete', id),
    getActivity: (id: string, limit?: number) => ipcRenderer.invoke('dh:getActivity', id, limit),
    activity: (id: string, limit?: number) => ipcRenderer.invoke('dh:activity', id, limit),
  },

  // ─── Providers ──────────────────────────────────────────────
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    update: (id: string, updates: any) => ipcRenderer.invoke('providers:update', id, updates),
    models: () => ipcRenderer.invoke('providers:models'),
  },

  // ─── Artifacts ──────────────────────────────────────────────
  artifacts: {
    list: (workspaceId: string) => ipcRenderer.invoke('artifacts:list', workspaceId),
    read: (workspaceId: string, artifactId: string) => ipcRenderer.invoke('artifacts:read', workspaceId, artifactId),
    tree: (workspaceId: string) => ipcRenderer.invoke('artifacts:tree', workspaceId),
    content: (filePath: string) => ipcRenderer.invoke('artifacts:content', filePath),
  },

  // ─── System ────────────────────────────────────────────────
  system: {
    status: () => ipcRenderer.invoke('system:status'),
    getJarvisHome: () => ipcRenderer.invoke('system:getJarvisHome'),
  },
};

contextBridge.exposeInMainWorld('jarvis', api);

export type JarvisAPI = typeof api;
