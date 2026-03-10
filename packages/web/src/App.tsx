import React, { useEffect, useRef, useState } from 'react';
import { Send, Menu, ArrowLeft, Settings, RotateCw } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface Workspace {
  id: string;
  name: string;
  goal?: string;
}

// WebSocket connection to Jarvis desktop
const WS_URL = `ws://${window.location.hostname}:3927`;

export function App() {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [serverUrl, setServerUrl] = useState(WS_URL);
  const [showConnect, setShowConnect] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const connect = (url: string) => {
    try {
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
          case 'agent:chunk':
            if (msg.workspaceId === activeWorkspace?.id) {
              setStreamContent((prev) => prev + msg.chunk);
            }
            break;
          case 'agent:response':
            setIsStreaming(false);
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: msg.payload.content,
                timestamp: Date.now(),
              },
            ]);
            setStreamContent('');
            break;
          case 'error':
            console.error('Server error:', msg.message);
            break;
        }
      };

      socket.onclose = () => {
        setConnected(false);
        setShowConnect(true);
      };

      socket.onerror = () => {
        setConnected(false);
      };

      setWs(socket);
    } catch {
      console.error('Failed to connect');
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent]);

  const sendMessage = () => {
    if (!input.trim() || !ws || !activeWorkspace || isStreaming) return;

    const text = input.trim();
    setInput('');

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: text, timestamp: Date.now() },
    ]);

    setIsStreaming(true);
    setStreamContent('');

    ws.send(
      JSON.stringify({
        type: 'agent:chat',
        payload: { workspaceId: activeWorkspace.id, message: text },
      })
    );
  };

  // Connection screen
  if (showConnect) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold text-center mb-2">Jarvis Mobile</h1>
          <p className="text-sm text-[var(--color-text-muted)] text-center mb-8">
            Connect to your Jarvis desktop instance
          </p>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="ws://192.168.x.x:3927"
            className="w-full px-4 py-3 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-sm outline-none mb-4"
          />
          <button
            onClick={() => connect(serverUrl)}
            className="w-full py-3 rounded-xl bg-[var(--color-primary)] text-white font-medium text-sm"
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  // Workspace selector
  if (!activeWorkspace) {
    return (
      <div className="h-full flex flex-col">
        <header className="h-14 flex items-center px-4 border-b border-[var(--color-border)] shrink-0">
          <h1 className="text-base font-semibold">Workspaces</h1>
          <div className="ml-auto flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => setActiveWorkspace(ws)}
              className="w-full text-left p-4 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)]"
            >
              <p className="font-medium text-sm">{ws.name}</p>
              {ws.goal && <p className="text-xs text-[var(--color-text-muted)] mt-1 truncate">{ws.goal}</p>}
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

  // Chat view
  return (
    <div className="h-full flex flex-col">
      <header className="h-14 flex items-center px-4 border-b border-[var(--color-border)] shrink-0">
        <button onClick={() => setActiveWorkspace(null)} className="p-2 -ml-2 mr-2">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{activeWorkspace.name}</p>
        </div>
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-[var(--color-primary)] text-white rounded-br-sm'
                  : 'bg-[var(--color-bg-secondary)] rounded-bl-sm'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {isStreaming && streamContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm bg-[var(--color-bg-secondary)]">
              {streamContent}
              <span className="inline-block w-1 h-3.5 bg-[var(--color-primary)] ml-0.5 animate-pulse" />
            </div>
          </div>
        )}

        {isStreaming && !streamContent && (
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Message..."
            rows={1}
            className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-sm outline-none resize-none max-h-24"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            className="p-2.5 rounded-xl bg-[var(--color-primary)] text-white disabled:opacity-40 shrink-0"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
