import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Send,
  ArrowLeft,
  RotateCw,
  MessageSquare,
  Activity,
  Settings,
  Wifi,
  WifiOff,
  Play,
  Square,
  ChevronDown,
  ChevronRight,
  Wrench,
  Brain,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────

interface ContentBlock {
  id: string;
  type: 'text' | 'thinking' | 'tool_use' | 'error';
  content: string;
  toolName?: string;
  toolStatus?: 'running' | 'success' | 'error';
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks?: ContentBlock[];
  timestamp: number;
}

interface Workspace {
  id: string;
  name: string;
  goal?: string;
  loopMode?: { enabled: boolean; intervalMinutes: number };
}

interface SystemStatus {
  uptime?: number;
  memoryUsage?: { heapUsed: number; heapTotal: number };
  workspaceCount?: number;
  ccAvailable?: boolean;
}

type Tab = 'chat' | 'status' | 'settings';

// ─── API helpers ────────────────────────────────────────────────

let API_BASE = '';

function setApiBase(wsUrl: string) {
  const url = new URL(wsUrl.replace('ws://', 'http://').replace('wss://', 'https://'));
  API_BASE = `${url.protocol}//${url.host}`;
}

async function apiGet<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) return fallback;
    return await res.json();
  } catch { return fallback; }
}

async function apiPost<T>(path: string, body: any, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return fallback;
    return await res.json();
  } catch { return fallback; }
}

// ─── WebSocket connection ───────────────────────────────────────

const WS_URL = `ws://${window.location.hostname}:3927`;

// ─── App ────────────────────────────────────────────────────────

export function App() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentBlocks, setCurrentBlocks] = useState<ContentBlock[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showConnect, setShowConnect] = useState(true);
  const [serverUrl, setServerUrl] = useState(WS_URL);
  const [tab, setTab] = useState<Tab>('chat');
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const uid = () => crypto.randomUUID();

  const connect = useCallback((url: string) => {
    try {
      setApiBase(url);
      const socket = new WebSocket(url);

      socket.onopen = () => {
        setConnected(true);
        setShowConnect(false);
        socket.send(JSON.stringify({ type: 'workspace:list' }));
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'workspace:list':
            setWorkspaces(msg.payload || []);
            break;
          case 'cc:message':
            setCurrentBlocks((prev) => {
              const last = prev[prev.length - 1];
              if (last?.type === 'text') {
                return [...prev.slice(0, -1), { ...last, content: last.content + msg.text }];
              }
              return [...prev, { id: uid(), type: 'text', content: msg.text }];
            });
            break;
          case 'cc:thinking':
            setCurrentBlocks((prev) => {
              const last = prev[prev.length - 1];
              if (last?.type === 'thinking') {
                return [...prev.slice(0, -1), { ...last, content: last.content + msg.text }];
              }
              return [...prev, { id: uid(), type: 'thinking', content: msg.text }];
            });
            break;
          case 'cc:tool_use':
            setCurrentBlocks((prev) => [
              ...prev,
              { id: uid(), type: 'tool_use', content: '', toolName: msg.name, toolStatus: 'running' },
            ]);
            break;
          case 'cc:tool_result':
            setCurrentBlocks((prev) =>
              prev.map((b) =>
                b.type === 'tool_use' && b.toolName === msg.name && b.toolStatus === 'running'
                  ? { ...b, toolStatus: 'success' }
                  : b
              )
            );
            break;
          case 'cc:result':
          case 'cc:done': {
            setCurrentBlocks((prev) => {
              if (prev.length === 0) return prev;
              const textContent = prev.filter(b => b.type === 'text').map(b => b.content).join('');
              const assistantMsg: Message = {
                id: uid(),
                role: 'assistant',
                content: textContent,
                blocks: [...prev],
                timestamp: Date.now(),
              };
              setMessages((msgs) => [...msgs, assistantMsg]);
              setIsStreaming(false);
              return [];
            });
            break;
          }
          case 'cc:error':
            setCurrentBlocks((prev) => [
              ...prev,
              { id: uid(), type: 'error', content: msg.error || 'Unknown error' },
            ]);
            setIsStreaming(false);
            break;
        }
      };

      socket.onclose = () => {
        setConnected(false);
        setShowConnect(true);
      };

      socket.onerror = () => socket.close();

      setWs(socket);
      wsRef.current = socket;
    } catch {
      console.error('Failed to connect');
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentBlocks]);

  useEffect(() => {
    if (!connected || tab !== 'status') return;
    const fetchStatus = () => apiGet<SystemStatus>('/api/system/status', {}).then(setSystemStatus);
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [connected, tab]);

  const sendMessage = () => {
    if (!input.trim() || !wsRef.current || !activeWorkspace || isStreaming) return;
    const text = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { id: uid(), role: 'user', content: text, timestamp: Date.now() }]);
    setIsStreaming(true);
    setCurrentBlocks([]);

    apiPost('/api/cc/send', { workspaceId: activeWorkspace.id, message: text }, null);
  };

  const toggleLoop = async () => {
    if (!activeWorkspace) return;
    if (activeWorkspace.loopMode?.enabled) {
      await apiPost('/api/loop/stop', { workspaceId: activeWorkspace.id }, undefined);
      setActiveWorkspace({ ...activeWorkspace, loopMode: { ...activeWorkspace.loopMode!, enabled: false } });
    } else {
      await apiPost('/api/loop/start', { workspaceId: activeWorkspace.id, config: { intervalMinutes: 10 } }, undefined);
      setActiveWorkspace({ ...activeWorkspace, loopMode: { enabled: true, intervalMinutes: 10 } });
    }
  };

  // ─── Connection Screen ──────────────────────────────────────

  if (showConnect) {
    return (
      <div className="h-full flex items-center justify-center p-6 bg-[var(--color-bg)]">
        <div className="w-full max-w-sm">
          <div className="flex items-center justify-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-[var(--color-primary)] flex items-center justify-center">
              <span className="text-white font-bold text-xl">J</span>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center mb-1">Jarvis Mobile</h1>
          <p className="text-sm text-[var(--color-text-muted)] text-center mb-8">
            Remote access to your AI agent
          </p>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="ws://192.168.x.x:3927"
            className="w-full px-4 py-3 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-sm outline-none mb-4"
          />
          <button
            onClick={() => connect(serverUrl)}
            className="w-full py-3 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm active:opacity-80"
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  // ─── Workspace Selector ─────────────────────────────────────

  if (!activeWorkspace) {
    return (
      <div className="h-full flex flex-col bg-[var(--color-bg)]">
        <header className="h-14 flex items-center px-4 border-b border-[var(--color-border)] shrink-0">
          <h1 className="text-base font-semibold">Workspaces</h1>
          <div className="ml-auto flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => { setActiveWorkspace(w); setMessages([]); setCurrentBlocks([]); }}
              className="w-full text-left p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] active:opacity-70"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/20 flex items-center justify-center text-xs font-bold text-[var(--color-primary)]">
                  {w.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{w.name}</p>
                  {w.goal && <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">{w.goal}</p>}
                </div>
                {w.loopMode?.enabled && <RotateCw size={14} className="animate-spin text-[var(--color-primary)]" />}
              </div>
            </button>
          ))}
          {workspaces.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-12">
              No workspaces found. Create one from the desktop app.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ─── Main App with Tabs ─────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg)]">
      {/* Header */}
      <header className="h-14 flex items-center px-4 border-b border-[var(--color-border)] shrink-0">
        <button onClick={() => setActiveWorkspace(null)} className="p-2 -ml-2 mr-2 active:opacity-50">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{activeWorkspace.name}</p>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            {connected ? 'Connected' : 'Disconnected'}
            {activeWorkspace.loopMode?.enabled && ' · Loop active'}
          </p>
        </div>
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
      </header>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'chat' && (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] ${msg.role === 'user' ? '' : 'w-full'}`}>
                    {msg.role === 'user' ? (
                      <div className="rounded-2xl rounded-br-sm px-4 py-2.5 text-sm bg-[var(--color-primary)] text-white">
                        {msg.content}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {msg.blocks?.map((b) => (
                          <BlockDisplay key={b.id} block={b} />
                        )) || (
                          <div className="rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm bg-[var(--color-bg-secondary)]">
                            {msg.content}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {currentBlocks.length > 0 && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] w-full space-y-1.5">
                    {currentBlocks.map((b) => <BlockDisplay key={b.id} block={b} />)}
                  </div>
                </div>
              )}

              {isStreaming && currentBlocks.length === 0 && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm px-4 py-2.5 bg-[var(--color-bg-secondary)]">
                    <RotateCw size={14} className="animate-spin text-[var(--color-text-muted)]" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-[var(--color-border)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="Message..."
                  rows={1}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-sm outline-none resize-none max-h-24"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isStreaming}
                  className="p-2.5 rounded-xl bg-[var(--color-primary)] text-white disabled:opacity-40 shrink-0 active:opacity-80"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'status' && (
          <div className="h-full overflow-y-auto p-4 space-y-4">
            <h2 className="text-sm font-semibold">System Status</h2>
            <div className="grid grid-cols-2 gap-3">
              <StatusCard
                label="Connection"
                value={connected ? 'Online' : 'Offline'}
                icon={connected ? <Wifi size={16} className="text-green-500" /> : <WifiOff size={16} className="text-red-500" />}
              />
              <StatusCard
                label="Uptime"
                value={systemStatus?.uptime ? formatUptime(systemStatus.uptime) : '-'}
                icon={<Activity size={16} className="text-blue-500" />}
              />
              <StatusCard
                label="Memory"
                value={systemStatus?.memoryUsage ? `${Math.round(systemStatus.memoryUsage.heapUsed / 1024 / 1024)}MB` : '-'}
                icon={<Activity size={16} className="text-purple-500" />}
              />
              <StatusCard
                label="Workspaces"
                value={String(workspaces.length)}
                icon={<MessageSquare size={16} className="text-orange-500" />}
              />
            </div>
            <div className="rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-4">
              <h3 className="text-xs font-semibold mb-3 text-[var(--color-text-muted)] uppercase tracking-wider">
                Workspace Info
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Name</span><span>{activeWorkspace.name}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Goal</span><span className="text-right max-w-[60%] truncate">{activeWorkspace.goal || 'Not set'}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Loop Mode</span><span>{activeWorkspace.loopMode?.enabled ? 'Active' : 'Off'}</span></div>
              </div>
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="h-full overflow-y-auto p-4 space-y-4">
            <h2 className="text-sm font-semibold">Workspace Settings</h2>
            <div className="rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Loop Mode</label>
                <p className="text-xs text-[var(--color-text-muted)] mb-3">
                  Autonomous planning toward the workspace goal every 10-15 minutes.
                </p>
                <button
                  onClick={toggleLoop}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium w-full justify-center active:opacity-80 ${
                    activeWorkspace.loopMode?.enabled
                      ? 'bg-red-500/10 text-red-500 border border-red-500/30'
                      : 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/30'
                  }`}
                >
                  {activeWorkspace.loopMode?.enabled ? (
                    <><Square size={14} /> Stop Loop</>
                  ) : (
                    <><Play size={14} /> Start Loop</>
                  )}
                </button>
              </div>
            </div>
            <div className="rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-4">
              <label className="text-xs font-medium text-[var(--color-text-muted)] mb-2 block">Server</label>
              <p className="text-sm font-mono break-all">{serverUrl}</p>
            </div>
            <button
              onClick={() => {
                wsRef.current?.close();
                setConnected(false);
                setShowConnect(true);
                setActiveWorkspace(null);
              }}
              className="w-full py-3 rounded-xl border border-red-500/30 text-red-500 text-sm font-medium active:opacity-80"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Bottom Tab Bar */}
      <nav className="flex border-t border-[var(--color-border)] pb-[max(0px,env(safe-area-inset-bottom))]">
        {([
          { key: 'chat' as Tab, icon: MessageSquare, label: 'Chat' },
          { key: 'status' as Tab, icon: Activity, label: 'Status' },
          { key: 'settings' as Tab, icon: Settings, label: 'Settings' },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex flex-col items-center py-2 gap-0.5 text-[10px] ${
              tab === t.key ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'
            }`}
          >
            <t.icon size={18} />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────

function BlockDisplay({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(false);

  if (block.type === 'text') {
    return (
      <div className="rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm bg-[var(--color-bg-secondary)] whitespace-pre-wrap">
        {block.content}
      </div>
    );
  }

  if (block.type === 'thinking') {
    return (
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-2 px-3 py-2 rounded-xl text-xs bg-purple-500/10 border border-purple-500/20 w-full text-left"
      >
        <Brain size={12} className="text-purple-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-medium text-purple-400">Thinking</span>
          {expanded && <p className="mt-1 text-[var(--color-text-muted)] whitespace-pre-wrap">{block.content}</p>}
        </div>
        {expanded ? <ChevronDown size={12} className="text-purple-400 shrink-0" /> : <ChevronRight size={12} className="text-purple-400 shrink-0" />}
      </button>
    );
  }

  if (block.type === 'tool_use') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs bg-blue-500/10 border border-blue-500/20">
        {block.toolStatus === 'running' ? (
          <RotateCw size={12} className="animate-spin text-blue-400 shrink-0" />
        ) : (
          <Wrench size={12} className="text-blue-400 shrink-0" />
        )}
        <span className="text-blue-400 font-medium">{block.toolName}</span>
        {block.toolStatus === 'success' && <span className="ml-auto text-green-500">Done</span>}
      </div>
    );
  }

  if (block.type === 'error') {
    return (
      <div className="px-3 py-2 rounded-xl text-xs bg-red-500/10 border border-red-500/20 text-red-400">
        {block.content}
      </div>
    );
  }

  return null;
}

function StatusCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
