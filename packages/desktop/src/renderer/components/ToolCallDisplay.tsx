import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Terminal, Check, X } from 'lucide-react';

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
    <div className="space-y-1 mx-4 mb-2">
      {toolCalls.map((tc) => (
        <ToolCallItem key={tc.id} toolCall={tc} />
      ))}
    </div>
  );
}

function ToolCallItem({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = toolCall.status === 'running'
    ? <Terminal size={12} className="animate-pulse text-yellow-500" />
    : toolCall.status === 'success'
    ? <Check size={12} className="text-green-500" />
    : <X size={12} className="text-red-500" />;

  return (
    <div className="rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] text-xs overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--color-bg-secondary)] transition-colors"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {statusIcon}
        <span className="font-mono font-medium text-[var(--color-text)]">{toolCall.name}</span>
        <span className="text-[var(--color-text-muted)] truncate flex-1 text-left">
          {JSON.stringify(toolCall.input).slice(0, 80)}
        </span>
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-[var(--color-border)] space-y-2">
          <div>
            <span className="text-[var(--color-text-muted)]">Input:</span>
            <pre className="mt-0.5 p-2 rounded bg-[var(--color-bg)] text-[var(--color-text)] overflow-x-auto">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>
          {toolCall.result && (
            <div>
              <span className="text-[var(--color-text-muted)]">Result:</span>
              <pre className="mt-0.5 p-2 rounded bg-[var(--color-bg)] text-[var(--color-text)] overflow-x-auto max-h-48">
                {toolCall.result.slice(0, 2000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
