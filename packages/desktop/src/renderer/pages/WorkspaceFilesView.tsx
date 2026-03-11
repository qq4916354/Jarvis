import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Save, RefreshCw, Check } from 'lucide-react';
import { useWorkspaceStore } from '../stores/workspace-store';
import { api } from '../api';

type FileTab = 'soul.md' | 'agent.md' | 'user.md';

const FILE_TABS: { key: FileTab; label: string; description: string }[] = [
  { key: 'soul.md', label: 'Soul', description: 'Agent personality and core identity' },
  { key: 'agent.md', label: 'Agent', description: 'Agent capabilities and instructions' },
  { key: 'user.md', label: 'User', description: 'User preferences and context' },
];

export function WorkspaceFilesView() {
  const { activeWorkspace } = useWorkspaceStore();
  const [activeTab, setActiveTab] = useState<FileTab>('soul.md');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const loadFile = useCallback(async (fileName: FileTab) => {
    if (!activeWorkspace) return;
    setLoading(true);
    try {
      const result = await api.workspaceFiles.read(activeWorkspace.id, fileName);
      setContent(result ?? '');
      setDirty(false);
    } catch {
      setContent('');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    loadFile(activeTab);
  }, [activeTab, activeWorkspace?.id, loadFile]);

  const handleSave = async () => {
    if (!activeWorkspace || saving) return;
    setSaving(true);
    try {
      await api.workspaceFiles.write(activeWorkspace.id, activeTab, content);
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save file:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  if (!activeWorkspace) return null;

  const tabInfo = FILE_TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="h-full flex flex-col p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 animate-fadeInUp">
        <h2 className="text-2xl font-bold text-gradient mb-1">Workspace Files</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Edit agent persona, capabilities, and user context
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 animate-fadeInUp" style={{ animationDelay: '0.05s' }}>
        {FILE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`file-tab${activeTab === tab.key ? ' active' : ''}`}
          >
            <FileText size={13} />
            <span>{tab.label}</span>
            {activeTab === tab.key && dirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)]" />
            )}
          </button>
        ))}
      </div>

      {/* Description */}
      <p className="text-xs text-[var(--color-text-muted)] mb-3 px-1">
        {tabInfo.description}
      </p>

      {/* Editor */}
      <div className="flex-1 min-h-0 animate-fadeInUp" style={{ animationDelay: '0.1s' }}>
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <RefreshCw size={20} className="animate-spin text-[var(--color-text-muted)]" />
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => { setContent(e.target.value); setDirty(true); }}
            onKeyDown={handleKeyDown}
            className="file-editor"
            placeholder={`Write your ${tabInfo.label.toLowerCase()} configuration here...\n\nSupports Markdown format.`}
            spellCheck={false}
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-4 animate-fadeInUp" style={{ animationDelay: '0.15s' }}>
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <kbd className="chat-kbd">Ctrl+S</kbd> to save
          {dirty && <span className="text-[var(--color-warning)]">Unsaved changes</span>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => loadFile(activeTab)}
            className="btn btn-ghost p-2"
            title="Reload"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className={`btn btn-primary gap-2 px-4 py-2${saved ? ' bg-[var(--color-success)]' : ''}`}
          >
            {saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
