import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Send, Square, Sparkles, Bot, Brain,
  ChevronDown, ChevronRight, Terminal, Check, X,
  Loader, FileText, Pencil, Search, Play,
  Trash2, Plus, AlertTriangle,
} from 'lucide-react';
import { useWorkspaceStore, ChatMessage, ContentBlock, ChatSession, EMPTY_SESSION } from '../stores/workspace-store';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { api } from '../api';

// ─── Tool icon mapping ──────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ReactNode> = {
  Read: <FileText size={12} />,
  Write: <Pencil size={12} />,
  Edit: <Pencil size={12} />,
  MultiEdit: <Pencil size={12} />,
  Bash: <Terminal size={12} />,
  Search: <Search size={12} />,
  Glob: <Search size={12} />,
  Grep: <Search size={12} />,
  LS: <Search size={12} />,
  TodoRead: <FileText size={12} />,
  TodoWrite: <Pencil size={12} />,
  WebFetch: <Search size={12} />,
  WebSearch: <Search size={12} />,
};

function getToolIcon(name: string) {
  return TOOL_ICONS[name] || <Terminal size={12} />;
}

function getToolLabel(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return name;
  switch (name) {
    case 'Read':
      return `Read ${(input.file_path || input.path || '') as string}`;
    case 'Write':
      return `Write ${(input.file_path || input.path || '') as string}`;
    case 'Edit':
    case 'MultiEdit':
      return `Edit ${(input.file_path || input.path || '') as string}`;
    case 'Bash':
      return `Run: ${String(input.command || '').slice(0, 80)}`;
    case 'Search':
    case 'Grep':
      return `Search: ${String(input.pattern || input.query || '').slice(0, 60)}`;
    case 'Glob':
      return `Glob: ${String(input.pattern || '').slice(0, 60)}`;
    case 'TodoWrite':
      return 'Update tasks';
    case 'WebFetch':
      return `Fetch: ${String(input.url || '').slice(0, 60)}`;
    case 'WebSearch':
      return `Search web: ${String(input.query || '').slice(0, 60)}`;
    default:
      return name;
  }
}

// ─── ChatView ────────────────────────────────────────────────────

export function ChatView() {
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);
  const chatSessions = useWorkspaceStore((s) => s.chatSessions);
  const sendMessage = useWorkspaceStore((s) => s.sendMessage);
  const abortStreaming = useWorkspaceStore((s) => s.abortStreaming);
  const clearSession = useWorkspaceStore((s) => s.clearSession);

  const session: ChatSession = activeWorkspace
    ? chatSessions[activeWorkspace.id] || EMPTY_SESSION
    : EMPTY_SESSION;

  const { messages, currentBlocks, isStreaming } = session;

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Auto-scroll: only scroll if user is near bottom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const threshold = 100;
      shouldAutoScroll.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (shouldAutoScroll.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, currentBlocks]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
  }, [input]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming || !activeWorkspace) return;
    setInput('');
    shouldAutoScroll.current = true;
    sendMessage(activeWorkspace.id, text);
  }, [input, isStreaming, activeWorkspace, sendMessage]);

  const handleAbort = useCallback(() => {
    if (activeWorkspace) abortStreaming(activeWorkspace.id);
  }, [activeWorkspace, abortStreaming]);

  const handleNewSession = useCallback(() => {
    if (activeWorkspace && !isStreaming) clearSession(activeWorkspace.id);
  }, [activeWorkspace, isStreaming, clearSession]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasContent = messages.length > 0 || currentBlocks.length > 0;

  return (
    <div className="cv-root">
      {/* Goal banner */}
      {activeWorkspace?.goal && (
        <div className="cv-goal">
          <Sparkles size={14} className="cv-goal-icon" />
          <span className="cv-goal-label">Goal:</span>
          <span className="cv-goal-text">{activeWorkspace.goal}</span>
        </div>
      )}

      {/* Messages area */}
      <div className="cv-messages" ref={containerRef}>
        {!hasContent && <EmptyState name={activeWorkspace?.name} />}

        {messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} />
        ))}

        {/* Streaming blocks */}
        {currentBlocks.length > 0 && (
          <div className="cv-msg cv-msg-assistant animate-fadeInUp">
            <div className="cv-avatar cv-avatar-ai">J</div>
            <div className="cv-bubble cv-bubble-ai">
              <BlockList blocks={currentBlocks} streaming={isStreaming} />
            </div>
          </div>
        )}

        {/* Streaming indicator with no blocks yet */}
        {isStreaming && currentBlocks.length === 0 && (
          <div className="cv-msg cv-msg-assistant animate-fadeInUp">
            <div className="cv-avatar cv-avatar-ai">J</div>
            <div className="cv-bubble cv-bubble-ai">
              <div className="cv-thinking-indicator">
                <div className="cv-dot-pulse">
                  <span /><span /><span />
                </div>
                <span className="cv-thinking-label">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="cv-input-area">
        <div className="cv-input-wrapper">
          {hasContent && (
            <button
              onClick={handleNewSession}
              disabled={isStreaming}
              className="cv-icon-btn"
              title="New conversation"
            >
              <Plus size={16} />
            </button>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? 'Claude is working...' : 'Message Jarvis...'}
            rows={1}
            disabled={isStreaming}
            className="cv-textarea"
          />
          <button
            onClick={isStreaming ? handleAbort : handleSend}
            disabled={!isStreaming && !input.trim()}
            className={`cv-send-btn ${
              isStreaming
                ? 'cv-send-btn--abort'
                : input.trim()
                ? 'cv-send-btn--active'
                : 'cv-send-btn--disabled'
            }`}
          >
            {isStreaming ? <Square size={16} /> : <Send size={16} />}
          </button>
        </div>
        <div className="cv-input-hint">
          <kbd>Enter</kbd> send &middot; <kbd>Shift+Enter</kbd> new line
          &middot; YOLO mode
        </div>
      </div>
    </div>
  );
}

// ─── MessageItem ─────────────────────────────────────────────────

function MessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`cv-msg ${isUser ? 'cv-msg-user' : 'cv-msg-assistant'}`}>
      <div className={`cv-avatar ${isUser ? 'cv-avatar-user' : 'cv-avatar-ai'}`}>
        {isUser ? 'U' : 'J'}
      </div>
      <div className={`cv-bubble ${isUser ? 'cv-bubble-user' : 'cv-bubble-ai'}`}>
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : message.blocks && message.blocks.length > 0 ? (
          <BlockList blocks={message.blocks} streaming={false} />
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
      </div>
    </div>
  );
}

// ─── BlockList ───────────────────────────────────────────────────

function BlockList({
  blocks,
  streaming,
}: {
  blocks: ContentBlock[];
  streaming: boolean;
}) {
  return (
    <div className="cv-blocks">
      {blocks.map((block, idx) => {
        const isLast = idx === blocks.length - 1;
        switch (block.type) {
          case 'text':
            return (
              <MarkdownRenderer
                key={block.id}
                content={block.content}
                streaming={streaming && isLast}
              />
            );
          case 'thinking':
            return <ThinkingBlock key={block.id} block={block} active={streaming && isLast} />;
          case 'tool_use':
            return <ToolUseBlock key={block.id} block={block} />;
          case 'error':
            return <ErrorBlock key={block.id} block={block} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

// ─── ThinkingBlock ───────────────────────────────────────────────

function ThinkingBlock({ block, active }: { block: ContentBlock; active: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="cv-thinking">
      <button onClick={() => setExpanded(!expanded)} className="cv-thinking-toggle">
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className={`cv-thinking-dot ${active ? 'cv-thinking-dot--active' : ''}`}>
          <Brain size={11} />
        </span>
        <span className="cv-thinking-label">
          {active ? 'Thinking...' : 'Thought process'}
        </span>
      </button>
      {expanded && (
        <div className="cv-thinking-body">
          <pre className="cv-thinking-text">{block.content}</pre>
          {active && <span className="md-cursor" />}
        </div>
      )}
    </div>
  );
}

// ─── ToolUseBlock ────────────────────────────────────────────────

function ToolUseBlock({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(false);

  const statusColor =
    block.toolStatus === 'running'
      ? 'var(--color-warning)'
      : block.toolStatus === 'success'
      ? 'var(--color-success)'
      : 'var(--color-error)';

  const statusIcon =
    block.toolStatus === 'running' ? (
      <Loader size={12} style={{ color: statusColor, animation: 'spin 1s linear infinite' }} />
    ) : block.toolStatus === 'success' ? (
      <Check size={12} style={{ color: statusColor }} />
    ) : (
      <X size={12} style={{ color: statusColor }} />
    );

  const label = getToolLabel(block.toolName || '', block.toolInput);

  return (
    <div className="cv-tool" style={{ borderLeftColor: statusColor }}>
      <button onClick={() => setExpanded(!expanded)} className="cv-tool-toggle">
        <span className="cv-tool-chevron">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
        {statusIcon}
        <span className="cv-tool-icon">{getToolIcon(block.toolName || '')}</span>
        <span className="cv-tool-label">{label}</span>
        {block.toolStatus === 'running' && (
          <span className="cv-tool-badge">running</span>
        )}
      </button>

      {expanded && (
        <div className="cv-tool-body">
          {block.toolInput && (
            <div className="cv-tool-section">
              <div className="cv-tool-section-title">Input</div>
              <pre className="cv-tool-pre">
                {JSON.stringify(block.toolInput, null, 2)}
              </pre>
            </div>
          )}
          {block.toolResult && (
            <div className="cv-tool-section">
              <div className="cv-tool-section-title">Result</div>
              <pre className="cv-tool-pre cv-tool-pre--result">
                {block.toolResult.length > 3000
                  ? block.toolResult.slice(0, 3000) + '\n... (truncated)'
                  : block.toolResult}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ErrorBlock ──────────────────────────────────────────────────

function ErrorBlock({ block }: { block: ContentBlock }) {
  return (
    <div className="cv-error">
      <AlertTriangle size={14} />
      <span>{block.content}</span>
    </div>
  );
}

// ─── EmptyState ──────────────────────────────────────────────────

function EmptyState({ name }: { name?: string }) {
  return (
    <div className="cv-empty">
      <div className="cv-empty-inner animate-fadeIn">
        <div className="cv-empty-avatar animate-float">
          <Bot size={36} style={{ color: '#0a0e17' }} />
        </div>
        <h3 className="cv-empty-title text-gradient">{name ?? 'Jarvis'}</h3>
        <p className="cv-empty-subtitle">
          Start a conversation with your AI agent
        </p>
        <p className="cv-empty-powered">
          Powered by Claude Code &middot; YOLO Mode
        </p>
        <div className="cv-empty-hint">
          Press <kbd>Enter</kbd> to send &middot;{' '}
          <kbd>Shift+Enter</kbd> for new line
        </div>
      </div>
    </div>
  );
}
