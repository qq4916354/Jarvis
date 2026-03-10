import { create } from 'zustand';

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

export interface Message {
  id: string;
  workspaceId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
}

interface WorkspaceState {
  workspaces: WorkspaceConfig[];
  activeWorkspace: WorkspaceConfig | null;
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;

  // Actions
  setWorkspaces: (workspaces: WorkspaceConfig[]) => void;
  setActiveWorkspace: (workspace: WorkspaceConfig | null) => void;
  addWorkspace: (workspace: WorkspaceConfig) => void;
  removeWorkspace: (id: string) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  setStreaming: (isStreaming: boolean) => void;
  appendStreamContent: (chunk: string) => void;
  resetStreamContent: () => void;

  // Async actions
  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string, description?: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  loadMessages: (workspaceId: string) => Promise<void>;
}

declare global {
  interface Window {
    jarvis: any;
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspace: null,
  messages: [],
  isStreaming: false,
  streamingContent: '',

  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),
  addWorkspace: (workspace) => set((s) => ({ workspaces: [...s.workspaces, workspace] })),
  removeWorkspace: (id) => set((s) => ({
    workspaces: s.workspaces.filter((w) => w.id !== id),
    activeWorkspace: s.activeWorkspace?.id === id ? null : s.activeWorkspace,
  })),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  setStreaming: (isStreaming) => set({ isStreaming }),
  appendStreamContent: (chunk) => set((s) => ({ streamingContent: s.streamingContent + chunk })),
  resetStreamContent: () => set({ streamingContent: '' }),

  loadWorkspaces: async () => {
    try {
      const workspaces = await window.jarvis.workspace.list();
      set({ workspaces });
    } catch (err) {
      console.error('Failed to load workspaces:', err);
    }
  },

  createWorkspace: async (name, description) => {
    try {
      const workspace = await window.jarvis.workspace.create({ name, description });
      get().addWorkspace(workspace);
      get().setActiveWorkspace(workspace);
    } catch (err) {
      console.error('Failed to create workspace:', err);
    }
  },

  deleteWorkspace: async (id) => {
    try {
      await window.jarvis.workspace.delete(id);
      get().removeWorkspace(id);
    } catch (err) {
      console.error('Failed to delete workspace:', err);
    }
  },

  sendMessage: async (content) => {
    const { activeWorkspace } = get();
    if (!activeWorkspace) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      workspaceId: activeWorkspace.id,
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    get().addMessage(userMessage);
    set({ isStreaming: true, streamingContent: '' });

    try {
      // Set up chunk listener
      const unsubscribe = window.jarvis.agent.onChunk((data: any) => {
        if (data.workspaceId === activeWorkspace.id) {
          get().appendStreamContent(data.chunk);
        }
      });

      const response = await window.jarvis.agent.chat(activeWorkspace.id, content);

      unsubscribe();

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        workspaceId: activeWorkspace.id,
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };

      get().addMessage(assistantMessage);
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      set({ isStreaming: false, streamingContent: '' });
    }
  },

  loadMessages: async (workspaceId) => {
    try {
      const messages = await window.jarvis.memory.getRecent(workspaceId, 100);
      set({ messages });
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  },
}));
