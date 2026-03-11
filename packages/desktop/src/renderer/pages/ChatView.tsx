import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Send, Square, Globe, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { useWorkspaceStore, Message } from '../stores/workspace-store';
import { ThinkingProcess } from '../components/ThinkingProcess';
import { ToolCallDisplay, ToolCallInfo } from '../components/ToolCallDisplay';
import { ArtifactPanel } from '../components/ArtifactPanel';
import { api } from '../api';

export function ChatView() {
  const {
    activeWorkspace,
    messages,
    isStreaming,
    streamingContent,
    sendMessage,
  } = useWorkspaceStore();

  const [input, setInput] = useState('');
  const [thoughts, setThoughts] = useState<string[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null);
  const [artifactContent, setArtifactContent] = useState<string | null>(null);
  const [ccStreaming, setCcStreaming] = useState(false);
  const [ccContent, setCcContent] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Subscribe to CC session events
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(api.cc.onMessage((data: { workspaceId: string; text: string }) => {
      if (data.workspaceId !== activeWorkspace?.id) return;
      setCcContent((prev) => prev + data.text);
    }));

    unsubs.push(api.cc.onThinking((data: { workspaceId: string; text: string }) => {
      if (data.workspaceId !== activeWorkspace?.id) return;
      setIsThinking(true);
      setThoughts((prev) => {
        const last = prev[prev.length - 1];
        if (last !== undefined) {
          return [...prev.slice(0, -1), last + data.text];
        }
        return [data.text];
      });
    }));

    unsubs.push(api.cc.onToolUse((data: { workspaceId: string; name: string; input: any }) => {
      if (data.workspaceId !== activeWorkspace?.id) return;
      setIsThinking(false);
      const tc: ToolCallInfo = {
        id: Date.now().toString(),
        name: data.name,
        input: data.input,
        status: 'running',
      };
      setToolCalls((prev) => [...prev, tc]);
    }));

    unsubs.push(api.cc.onToolResult((data: { workspaceId: string; name: string; content: string }) => {
      if (data.workspaceId !== activeWorkspace?.id) return;
      setToolCalls((prev) =>
        prev.map((tc) =>
          tc.status === 'running' && tc.name === data.name
            ? { ...tc, result: data.content, status: 'success' as const }
            : tc
        )
      );
      setThoughts((prev) => [...prev, '']);
      setIsThinking(true);
    }));

    unsubs.push(api.cc.onResult((data: { workspaceId: string; text: string; sessionId: string }) => {
      if (data.workspaceId !== activeWorkspace?.id) return;
      setCcStreaming(false);
      setIsThinking(false);
    }));

    unsubs.push(api.cc.onError((data: { workspaceId: string; error: string }) => {
      if (data.workspaceId !== activeWorkspace?.id) return;
      setCcStreaming(false);
      setIsThinking(false);
    }));

    unsubs.push(api.cc.onDone((data: { workspaceId: string; code: number | null }) => {
      if (data.workspaceId !== activeWorkspace?.id) return;
      setCcStreaming(false);
      setIsThinking(false);
    }));

    return () => unsubs.forEach((fn) => fn());
  }, [activeWorkspace?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, ccContent]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming || ccStreaming) return;
    setInput('');
    setThoughts([]);
    setToolCalls([]);
    setCcContent('');
    setIsThinking(false);

    if (activeWorkspace) {
      setCcStreaming(true);
      api.cc.send(activeWorkspace.id, text)?.catch((err: Error) => {
        console.error('CC send failed:', err);
        setCcStreaming(false);
      });
      sendMessage(text);
    } else {
      sendMessage(text);
    }
  }, [input, isStreaming, ccStreaming, activeWorkspace, sendMessage]);

  const handleAbort = useCallback(() => {
    if (activeWorkspace) {
      api.cc.abort(activeWorkspace.id);
      setCcStreaming(false);
      setIsThinking(false);
    }
  }, [activeWorkspace]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSelectArtifact = async (filePath: string) => {
    setSelectedArtifactPath(filePath);
    try {
      const content = await api.artifacts.content(filePath);
      setArtifactContent(content);
    } catch {
      setArtifactContent(null);
    }
  };

  const workspaceMessages = messages.filter(
    (m) => m.workspaceId === activeWorkspace?.id
  );

  const isBusy = isStreaming || ccStreaming;

  return (
    <div className="flex h-full">
      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Goal Banner */}
        {activeWorkspace?.goal && (
          <div className="px-4 py-2 bg-[var(--color-bg-tertiary)] border-b border-[var(--color-border)] text-sm">
            <span className="text-[var(--color-text-muted)]">Goal: </span>
            <span className="text-[var(--color-text)]">{activeWorkspace.goal}</span>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {workspaceMessages.length === 0 && !ccContent && (
            <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
              <div className="text-center">
                <Globe size={48} className="mx-auto mb-4 opacity-30" />
                <p>Start a conversation with your agent</p>
                <p className="text-xs mt-1">Powered by Claude Code subprocess</p>
              </div>
            </div>
          )}

          {workspaceMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Thinking Process */}
          <ThinkingProcess thoughts={thoughts.filter(Boolean)} isThinking={isThinking} />

          {/* Tool Calls */}
          <ToolCallDisplay toolCalls={toolCalls} />

          {/* CC Streaming content */}
          {ccContent && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--color-primary)] flex items-center justify-center shrink-0 text-white text-xs font-bold">
                J
              </div>
              <div className="flex-1 bg-[var(--color-bg-secondary)] rounded-2xl rounded-tl-sm px-4 py-3 text-sm whitespace-pre-wrap">
                {ccContent}
                {ccStreaming && (
                  <span className="inline-block w-1.5 h-4 bg-[var(--color-primary)] ml-0.5 animate-pulse" />
                )}
              </div>
            </div>
          )}

          {/* Legacy streaming indicator */}
          {isStreaming && streamingContent && !ccContent && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--color-primary)] flex items-center justify-center shrink-0 text-white text-xs font-bold">
                J
              </div>
              <div className="flex-1 bg-[var(--color-bg-secondary)] rounded-2xl rounded-tl-sm px-4 py-3 text-sm whitespace-pre-wrap">
                {streamingContent}
                <span className="inline-block w-1.5 h-4 bg-[var(--color-primary)] ml-0.5 animate-pulse" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-[var(--color-border)] p-4">
          <div className="flex items-end gap-3 max-w-4xl mx-auto">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
              rows={1}
              className="flex-1 resize-none px-4 py-3 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)] transition-colors max-h-32"
              style={{ minHeight: '44px' }}
            />
            <button
              onClick={() => setShowArtifacts(!showArtifacts)}
              className="p-3 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-tertiary)] transition-colors shrink-0"
              title="Toggle artifacts panel"
            >
              {showArtifacts ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </button>
            <button
              onClick={isBusy ? handleAbort : handleSend}
              disabled={!isBusy && !input.trim()}
              className="p-3 rounded-xl bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {isBusy ? <Square size={18} /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>

      {/* Artifacts Panel */}
      {showArtifacts && (
        <div className="w-80 shrink-0">
          <ArtifactPanel
            artifacts={artifacts}
            selectedPath={selectedArtifactPath}
            onSelectFile={handleSelectArtifact}
            fileContent={artifactContent}
            onClose={() => setShowArtifacts(false)}
          />
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
          isUser
            ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]'
            : 'bg-[var(--color-primary)] text-white'
        }`}
      >
        {isUser ? 'U' : 'J'}
      </div>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-[var(--color-primary)] text-white rounded-tr-sm'
            : 'bg-[var(--color-bg-secondary)] text-[var(--color-text)] rounded-tl-sm'
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
