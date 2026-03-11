import { create } from 'zustand';
import { api } from '../api';

// ─── Types ───────────────────────────────────────────────────────

export interface WorkspaceConfig {
  id: string;
  name: string;
  description?: string;
  goal?: string;
  loopMode?: {
    enabled: boolean;
    intervalMinutes: number;
    maxIterations?: number;
  };
  larkChatId?: string;
  models?: Record<string, ModelConfig>;
  createdAt: number;
  updatedAt: number;
}

export interface ModelConfig {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface ContentBlock {
  id: string;
  type: 'text' | 'thinking' | 'tool_use' | 'error';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolStatus?: 'running' | 'success' | 'error';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks?: ContentBlock[];
  timestamp: number;
}

export interface ChatSession {
  messages: ChatMessage[];
  currentBlocks: ContentBlock[];
  isStreaming: boolean;
  error: string | null;
}

export const EMPTY_SESSION: ChatSession = {
  messages: [],
  currentBlocks: [],
  isStreaming: false,
  error: null,
};

interface MemoryRecord {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

// ─── Store Interface ─────────────────────────────────────────────

interface WorkspaceState {
  workspaces: WorkspaceConfig[];
  activeWorkspace: WorkspaceConfig | null;
  chatSessions: Record<string, ChatSession>;

  // Workspace actions
  setWorkspaces: (workspaces: WorkspaceConfig[]) => void;
  setActiveWorkspace: (workspace: WorkspaceConfig | null) => void;
  addWorkspace: (workspace: WorkspaceConfig) => void;
  removeWorkspace: (id: string) => void;

  // Chat accessors
  getSession: (workspaceId: string) => ChatSession;

  // User chat actions
  loadMessages: (workspaceId: string) => Promise<void>;
  sendMessage: (workspaceId: string, text: string) => void;
  abortStreaming: (workspaceId: string) => void;
  clearSession: (workspaceId: string) => void;

  // CC event handlers (called by WebSocket subscriptions)
  _ccText: (workspaceId: string, text: string) => void;
  _ccThinking: (workspaceId: string, text: string) => void;
  _ccToolUse: (workspaceId: string, name: string, input: Record<string, unknown>) => void;
  _ccToolResult: (workspaceId: string, name: string, content: string) => void;
  _ccResult: (workspaceId: string) => void;
  _ccError: (workspaceId: string, error: string) => void;
  _ccDone: (workspaceId: string) => void;

  // Async workspace actions
  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string, description?: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
}

// ─── Helper ──────────────────────────────────────────────────────

function uid(): string {
  return crypto.randomUUID();
}

function updateSession(
  state: WorkspaceState,
  workspaceId: string,
  updater: (session: ChatSession) => Partial<ChatSession>,
): Partial<WorkspaceState> {
  const session = state.chatSessions[workspaceId] || EMPTY_SESSION;
  return {
    chatSessions: {
      ...state.chatSessions,
      [workspaceId]: { ...session, ...updater(session) },
    },
  };
}

// ─── Store ───────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspace: null,
  chatSessions: {},

  // ── Workspace management ────────────────────────────────────

  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),
  addWorkspace: (workspace) =>
    set((s) => ({ workspaces: [...s.workspaces, workspace] })),
  removeWorkspace: (id) =>
    set((s) => ({
      workspaces: s.workspaces.filter((w) => w.id !== id),
      activeWorkspace: s.activeWorkspace?.id === id ? null : s.activeWorkspace,
    })),

  loadWorkspaces: async () => {
    try {
      const workspaces = await api.workspace.list();
      set({ workspaces });
    } catch (err) {
      console.error('Failed to load workspaces:', err);
    }
  },

  createWorkspace: async (name, description) => {
    try {
      const workspace = await api.workspace.create({ name, description });
      if (workspace) {
        get().addWorkspace(workspace);
        get().setActiveWorkspace(workspace);
      }
    } catch (err) {
      console.error('Failed to create workspace:', err);
    }
  },

  deleteWorkspace: async (id) => {
    try {
      await api.workspace.delete(id);
      get().removeWorkspace(id);
    } catch (err) {
      console.error('Failed to delete workspace:', err);
    }
  },

  // ── Chat session access ─────────────────────────────────────

  getSession: (workspaceId) => {
    return get().chatSessions[workspaceId] || EMPTY_SESSION;
  },

  // ── User chat actions ───────────────────────────────────────

  loadMessages: async (workspaceId) => {
    try {
      const existing = get().chatSessions[workspaceId];
      if (existing && existing.messages.length > 0) return;

      const records = await api.memory.getRecent(workspaceId, 50);
      if (!records || records.length === 0) return;

      const messages: ChatMessage[] = (records as MemoryRecord[]).map((r) => ({
        id: r.id || uid(),
        role: r.role || 'assistant',
        content: r.content || '',
        timestamp: r.timestamp || Date.now(),
      }));

      set((s) => ({
        chatSessions: {
          ...s.chatSessions,
          [workspaceId]: {
            ...(s.chatSessions[workspaceId] || EMPTY_SESSION),
            messages,
          },
        },
      }));
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  },

  sendMessage: (workspaceId, text) => {
    const userMsg: ChatMessage = {
      id: uid(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    const session = get().getSession(workspaceId);

    set((s) => ({
      chatSessions: {
        ...s.chatSessions,
        [workspaceId]: {
          messages: [...session.messages, userMsg],
          currentBlocks: [],
          isStreaming: true,
          error: null,
        },
      },
    }));

    api.cc.send(workspaceId, text)?.catch((err: Error) => {
      console.error('[store] CC send failed:', err);
      get()._ccError(workspaceId, err.message);
    });
  },

  abortStreaming: (workspaceId) => {
    api.cc.abort(workspaceId);
    // Finalize any in-progress blocks before stopping
    const session = get().getSession(workspaceId);
    if (session.currentBlocks.length > 0) {
      get()._ccResult(workspaceId);
    }
    set((s) => updateSession(s, workspaceId, () => ({ isStreaming: false })));
  },

  clearSession: (workspaceId) => {
    api.cc.newSession(workspaceId);
    set((s) => ({
      chatSessions: {
        ...s.chatSessions,
        [workspaceId]: { ...EMPTY_SESSION },
      },
    }));
  },

  // ── CC event handlers ───────────────────────────────────────

  _ccText: (workspaceId, text) => {
    set((s) => {
      const session = s.chatSessions[workspaceId] || EMPTY_SESSION;
      const blocks = [...session.currentBlocks];
      const last = blocks[blocks.length - 1];

      if (last?.type === 'text') {
        blocks[blocks.length - 1] = { ...last, content: last.content + text };
      } else {
        blocks.push({ id: uid(), type: 'text', content: text });
      }

      return {
        chatSessions: {
          ...s.chatSessions,
          [workspaceId]: { ...session, currentBlocks: blocks },
        },
      };
    });
  },

  _ccThinking: (workspaceId, text) => {
    set((s) => {
      const session = s.chatSessions[workspaceId] || EMPTY_SESSION;
      const blocks = [...session.currentBlocks];
      const last = blocks[blocks.length - 1];

      if (last?.type === 'thinking') {
        blocks[blocks.length - 1] = { ...last, content: last.content + text };
      } else {
        blocks.push({ id: uid(), type: 'thinking', content: text });
      }

      return {
        chatSessions: {
          ...s.chatSessions,
          [workspaceId]: { ...session, currentBlocks: blocks },
        },
      };
    });
  },

  _ccToolUse: (workspaceId, name, input) => {
    set((s) => {
      const session = s.chatSessions[workspaceId] || EMPTY_SESSION;
      const blocks = [...session.currentBlocks];
      blocks.push({
        id: uid(),
        type: 'tool_use',
        content: '',
        toolName: name,
        toolInput: input,
        toolStatus: 'running',
      });

      return {
        chatSessions: {
          ...s.chatSessions,
          [workspaceId]: { ...session, currentBlocks: blocks },
        },
      };
    });
  },

  _ccToolResult: (workspaceId, name, content) => {
    set((s) => {
      const session = s.chatSessions[workspaceId] || EMPTY_SESSION;
      const blocks = [...session.currentBlocks];

      for (let i = blocks.length - 1; i >= 0; i--) {
        if (
          blocks[i].type === 'tool_use' &&
          blocks[i].toolName === name &&
          blocks[i].toolStatus === 'running'
        ) {
          blocks[i] = { ...blocks[i], toolResult: content, toolStatus: 'success' };
          break;
        }
      }

      return {
        chatSessions: {
          ...s.chatSessions,
          [workspaceId]: { ...session, currentBlocks: blocks },
        },
      };
    });
  },

  _ccResult: (workspaceId) => {
    set((s) => {
      const session = s.chatSessions[workspaceId] || EMPTY_SESSION;
      if (session.currentBlocks.length === 0) return s;

      const textContent = session.currentBlocks
        .filter((b) => b.type === 'text')
        .map((b) => b.content)
        .join('');

      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: textContent,
        blocks: [...session.currentBlocks],
        timestamp: Date.now(),
      };

      return {
        chatSessions: {
          ...s.chatSessions,
          [workspaceId]: {
            messages: [...session.messages, assistantMsg],
            currentBlocks: [],
            isStreaming: false,
            error: null,
          },
        },
      };
    });
  },

  _ccError: (workspaceId, error) => {
    set((s) => {
      const session = s.chatSessions[workspaceId] || EMPTY_SESSION;
      const blocks = [...session.currentBlocks];
      blocks.push({ id: uid(), type: 'error', content: error });

      return {
        chatSessions: {
          ...s.chatSessions,
          [workspaceId]: { ...session, currentBlocks: blocks, error },
        },
      };
    });
  },

  _ccDone: (workspaceId) => {
    const session = get().getSession(workspaceId);
    if (session.currentBlocks.length > 0 && session.isStreaming) {
      get()._ccResult(workspaceId);
    } else {
      set((s) => updateSession(s, workspaceId, () => ({ isStreaming: false })));
    }
  },
}));

// ─── WebSocket Subscriptions (global, runs once) ─────────────────

function setupWebSocketListeners() {
  const store = useWorkspaceStore;

  api.cc.onMessage((data: { workspaceId: string; text: string }) => {
    store.getState()._ccText(data.workspaceId, data.text);
  });

  api.cc.onThinking((data: { workspaceId: string; text: string }) => {
    store.getState()._ccThinking(data.workspaceId, data.text);
  });

  api.cc.onToolUse((data: { workspaceId: string; name: string; input: Record<string, unknown> }) => {
    store.getState()._ccToolUse(data.workspaceId, data.name, data.input);
  });

  api.cc.onToolResult((data: { workspaceId: string; name: string; content: string }) => {
    store.getState()._ccToolResult(data.workspaceId, data.name, data.content);
  });

  api.cc.onResult((data: { workspaceId: string }) => {
    store.getState()._ccResult(data.workspaceId);
  });

  api.cc.onError((data: { workspaceId: string; error: string }) => {
    store.getState()._ccError(data.workspaceId, data.error);
  });

  api.cc.onDone((data: { workspaceId: string }) => {
    store.getState()._ccDone(data.workspaceId);
  });
}

setupWebSocketListeners();
