import React, { useRef, useEffect, useState } from 'react';
import { Send, RotateCw, Square, Globe } from 'lucide-react';
import { useWorkspaceStore, Message } from '../stores/workspace-store';

export function ChatView() {
  const {
    activeWorkspace,
    messages,
    isStreaming,
    streamingContent,
    sendMessage,
  } = useWorkspaceStore();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const workspaceMessages = messages.filter(
    (m) => m.workspaceId === activeWorkspace?.id
  );

  return (
    <div className="flex flex-col h-full">
      {/* Goal Banner */}
      {activeWorkspace?.goal && (
        <div className="px-4 py-2 bg-[var(--color-bg-tertiary)] border-b border-[var(--color-border)] text-sm">
          <span className="text-[var(--color-text-muted)]">Goal: </span>
          <span className="text-[var(--color-text)]">{activeWorkspace.goal}</span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {workspaceMessages.length === 0 && (
          <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
            <div className="text-center">
              <Globe size={48} className="mx-auto mb-4 opacity-30" />
              <p>Start a conversation with your agent</p>
              <p className="text-xs mt-1">Messages sync with Lark if configured</p>
            </div>
          </div>
        )}

        {workspaceMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming indicator */}
        {isStreaming && streamingContent && (
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

        {isStreaming && !streamingContent && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--color-primary)] flex items-center justify-center shrink-0 text-white text-xs font-bold">
              J
            </div>
            <div className="bg-[var(--color-bg-secondary)] rounded-2xl rounded-tl-sm px-4 py-3">
              <RotateCw size={16} className="animate-spin text-[var(--color-text-muted)]" />
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
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="p-3 rounded-xl bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {isStreaming ? <Square size={18} /> : <Send size={18} />}
          </button>
        </div>
      </div>
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
