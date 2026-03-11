import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Terminal, Check, X, Loader } from 'lucide-react';

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  status: 'running' | 'success' | 'error';
}

interface ToolCallDisplayProps {
  toolCalls: ToolCallInfo[];
}

export function ToolCallDisplay({ toolCalls }: ToolCallDisplayProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className="space-y-1.5 mx-1 mb-2">
      {toolCalls.map((tc) => (
        <ToolCallItem key={tc.id} toolCall={tc} />
      ))}
    </div>
  );
}

function ToolCallItem({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);

  const statusColor =
    toolCall.status === 'running'
      ? '#f59e0b'
      : toolCall.status === 'success'
      ? '#10b981'
      : '#ef4444';

  const statusIcon =
    toolCall.status === 'running' ? (
      <Loader size={11} style={{ color: statusColor, animation: 'spin 1s linear infinite' }} />
    ) : toolCall.status === 'success' ? (
      <Check size={11} style={{ color: statusColor }} />
    ) : (
      <X size={11} style={{ color: statusColor }} />
    );

  return (
    <div
      className="rounded-xl overflow-hidden text-xs"
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderLeft: `3px solid ${statusColor}`,
        transition: 'border-color var(--transition-base)',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 transition-colors"
        style={{ background: 'transparent' }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-tertiary)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
        {statusIcon}
        <Terminal size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        <span
          className="font-medium"
          style={{ color: 'var(--color-text)', fontFamily: 'JetBrains Mono, monospace' }}
        >
          {toolCall.name}
        </span>
        {toolCall.status === 'running' && (
          <span
            className="ml-1 px-1.5 py-0.5 rounded text-xs animate-shimmer"
            style={{
              background: 'rgba(245,158,11,0.15)',
              color: '#f59e0b',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            running
          </span>
        )}
        <span
          className="truncate flex-1 text-left"
          style={{ color: 'var(--color-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}
        >
          {JSON.stringify(toolCall.input).slice(0, 60)}
        </span>
      </button>

      {expanded && (
        <div
          className="px-3 py-2.5 space-y-2.5"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <div>
            <div
              className="text-xs mb-1.5 font-medium"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Input
            </div>
            <pre
              className="p-3 rounded-lg text-xs overflow-x-auto leading-relaxed"
              style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>
          {toolCall.result && (
            <div>
              <div
                className="text-xs mb-1.5 font-medium"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Result
              </div>
              <pre
                className="p-3 rounded-lg text-xs overflow-x-auto max-h-48 leading-relaxed"
                style={{
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {toolCall.result.slice(0, 2000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
