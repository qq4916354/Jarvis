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
    <div className="mx-4 mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} className={isThinking ? 'animate-pulse text-[var(--color-primary)]' : ''} />
        <span>{isThinking ? 'Thinking...' : `${thoughts.length} thought(s)`}</span>
      </button>
      {expanded && (
        <div className="mt-1 pl-6 border-l-2 border-[var(--color-border)] space-y-1">
          {thoughts.map((thought, i) => (
            <p key={i} className="text-xs text-[var(--color-text-muted)] italic whitespace-pre-wrap">
              {thought}
            </p>
          ))}
          {isThinking && (
            <span className="inline-block w-1.5 h-3 bg-[var(--color-primary)] animate-pulse" />
          )}
        </div>
      )}
    </div>
  );
}
