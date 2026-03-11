import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';

interface ThinkingProcessProps {
  thoughts: string[];
  isThinking: boolean;
}

export function ThinkingProcess({ thoughts, isThinking }: ThinkingProcessProps) {
  const [expanded, setExpanded] = useState(false);

  if (thoughts.length === 0 && !isThinking) return null;

  return (
    <div className="mx-1 mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all"
        style={{
          color: 'var(--color-text-muted)',
          background: 'transparent',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-secondary)';
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-muted)';
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full"
          style={
            isThinking
              ? {
                  background: 'var(--gradient-primary)',
                  boxShadow: '0 0 8px rgba(6,214,160,0.5)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }
              : {
                  background: 'var(--color-bg-tertiary)',
                }
          }
        >
          <Brain
            size={11}
            style={{
              color: isThinking ? '#0a0e17' : 'var(--color-text-muted)',
            }}
          />
        </span>
        <span className="text-xs font-medium">
          {isThinking ? 'Thinking...' : `${thoughts.length} thought${thoughts.length !== 1 ? 's' : ''}`}
        </span>
      </button>

      {expanded && (
        <div
          className="mt-2 ml-3 rounded-xl overflow-hidden"
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderLeft: '2px solid var(--color-border-accent)',
          }}
        >
          <div className="px-4 py-3 space-y-2 max-h-48 overflow-y-auto">
            {thoughts.map((thought, i) => (
              <p
                key={i}
                className="text-xs whitespace-pre-wrap leading-relaxed"
                style={{
                  color: 'var(--color-text-secondary)',
                  fontFamily: 'JetBrains Mono, monospace',
                  borderBottom: i < thoughts.length - 1 ? '1px solid var(--color-border)' : 'none',
                  paddingBottom: i < thoughts.length - 1 ? '8px' : '0',
                }}
              >
                {thought}
              </p>
            ))}
            {isThinking && (
              <span
                className="inline-block w-1.5 h-3 animate-pulse"
                style={{ background: 'var(--color-primary)', borderRadius: '1px' }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
