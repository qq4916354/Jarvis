import React, { useEffect, useState } from 'react';
import { Wrench, Plus, RefreshCw, Play } from 'lucide-react';
import { useWorkspaceStore } from '../stores/workspace-store';
import { api } from '../api';

interface ToolInfo {
  name: string;
  description: string;
  builtIn: boolean;
}

export function ToolsView() {
  const { activeWorkspace } = useWorkspaceStore();
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [newToolDesc, setNewToolDesc] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    loadTools();
  }, [activeWorkspace?.id]);

  const loadTools = async () => {
    try {
      const result = await api.tools.list(activeWorkspace?.id);
      setTools(result || []);
    } catch { /* ignore */ }
  };

  const handleGenerateTool = async () => {
    if (!newToolDesc.trim() || !activeWorkspace) return;
    setIsGenerating(true);
    try {
      await api.upgrade.generateTool({
        description: newToolDesc,
        workspaceId: activeWorkspace.id,
      });
      setNewToolDesc('');
      await loadTools();
    } catch (err) {
      console.error('Failed to generate tool:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  if (!activeWorkspace) return null;

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Tools</h2>
        <button onClick={loadTools} className="p-2 rounded-lg hover:bg-[var(--color-bg-tertiary)]">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Generate New Tool */}
      <section className="mb-8 p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
        <h3 className="text-sm font-semibold mb-3">Generate New Tool (via Claude Code)</h3>
        <div className="flex gap-3">
          <textarea
            value={newToolDesc}
            onChange={(e) => setNewToolDesc(e.target.value)}
            placeholder="Describe the tool you need... e.g., 'A tool that fetches stock prices from Yahoo Finance'"
            rows={2}
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm outline-none focus:border-[var(--color-primary)] resize-none"
          />
          <button
            onClick={handleGenerateTool}
            disabled={isGenerating || !newToolDesc.trim()}
            className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-40 self-end"
          >
            {isGenerating ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
          </button>
        </div>
      </section>

      {/* Tool List */}
      <div className="space-y-2">
        {tools.map((tool) => (
          <div
            key={tool.name}
            className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]"
          >
            <Wrench size={16} className="text-[var(--color-text-muted)] shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{tool.name}</span>
                {tool.builtIn && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]">
                    Built-in
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-muted)] truncate">{tool.description}</p>
            </div>
            <button className="p-2 rounded-lg hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]">
              <Play size={14} />
            </button>
          </div>
        ))}

        {tools.length === 0 && (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8">
            No tools loaded. Built-in tools will appear when the core is initialized.
          </p>
        )}
      </div>
    </div>
  );
}
