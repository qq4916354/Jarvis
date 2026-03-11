import React, { useEffect, useState } from 'react';
import { Wrench, Plus, RefreshCw } from 'lucide-react';
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
      {/* 页面标题 */}
      <div className="mb-8 animate-fadeInUp">
        <h2 className="text-2xl font-bold text-gradient mb-1">Tools</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Manage and generate workspace tools
        </p>
      </div>

      {/* 生成新工具 */}
      <section className="card-glow p-5 mb-6 animate-fadeInUp" style={{ animationDelay: '0.05s' }}>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[var(--color-text)]">
          <Plus size={14} className="text-[var(--color-primary)]" />
          Generate New Tool
          <span className="text-[var(--color-text-muted)] font-normal">via Claude Code</span>
        </h3>
        <div className="flex gap-3 items-end">
          <textarea
            value={newToolDesc}
            onChange={(e) => setNewToolDesc(e.target.value)}
            placeholder="Describe the tool you need... e.g., 'A tool that fetches stock prices from Yahoo Finance'"
            rows={2}
            className="input flex-1"
            style={{ resize: 'none' }}
          />
          <button
            onClick={handleGenerateTool}
            disabled={isGenerating || !newToolDesc.trim()}
            className="btn btn-primary px-4 py-2 whitespace-nowrap"
          >
            {isGenerating ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <>
                <Plus size={14} />
                <span className="ml-1.5 text-sm">Generate</span>
              </>
            )}
          </button>
        </div>
      </section>

      {/* 工具列表 */}
      <div className="space-y-2">
        {tools.map((tool, index) => (
          <div
            key={tool.name}
            className="card-glow p-3.5 animate-fadeInUp"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-bg-tertiary)] flex items-center justify-center shrink-0">
                <Wrench size={14} className="text-[var(--color-primary)]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[var(--color-text)]">{tool.name}</span>
                  {tool.builtIn && (
                    <span className="badge badge-primary" style={{ fontSize: '10px' }}>Built-in</span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{tool.description}</p>
              </div>
            </div>
          </div>
        ))}

        {tools.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-[var(--color-bg-tertiary)] flex items-center justify-center mx-auto mb-4">
              <Wrench size={24} className="text-[var(--color-text-muted)] opacity-40" />
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">No tools loaded.</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 opacity-60">
              Built-in tools will appear when the core is initialized.
            </p>
          </div>
        )}
      </div>

      {/* 刷新按钮（右下角） */}
      <div className="flex justify-end mt-4">
        <button
          onClick={loadTools}
          className="btn btn-ghost p-2"
          title="Refresh"
        >
          <RefreshCw size={15} />
        </button>
      </div>
    </div>
  );
}
