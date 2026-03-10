import React, { useEffect, useState } from 'react';
import {
  MessageSquare,
  Settings,
  Cpu,
  Wrench,
  Zap,
  Plus,
  Trash2,
  RotateCw,
  ChevronRight,
  Globe,
  Users,
  Layers,
} from 'lucide-react';
import { useWorkspaceStore, WorkspaceConfig } from '../stores/workspace-store';

type View = 'chat' | 'settings' | 'models' | 'tools' | 'skills' | 'providers' | 'digitalHumans' | 'browser';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  const {
    workspaces,
    activeWorkspace,
    setActiveWorkspace,
    loadWorkspaces,
    createWorkspace,
    deleteWorkspace,
    loadMessages,
  } = useWorkspaceStore();

  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createWorkspace(newName.trim());
    setNewName('');
    setIsCreating(false);
  };

  const handleSelectWorkspace = async (ws: WorkspaceConfig) => {
    setActiveWorkspace(ws);
    await loadMessages(ws.id);
    onViewChange('chat');
  };

  const mainNavItems: { view: View; icon: React.ReactNode; label: string }[] = [
    { view: 'chat', icon: <MessageSquare size={18} />, label: 'Chat' },
    { view: 'digitalHumans', icon: <Users size={18} />, label: 'Digital Humans' },
    { view: 'browser', icon: <Globe size={18} />, label: 'AI Browser' },
  ];

  const configNavItems: { view: View; icon: React.ReactNode; label: string }[] = [
    { view: 'providers', icon: <Layers size={18} />, label: 'Providers' },
    { view: 'models', icon: <Cpu size={18} />, label: 'Models' },
    { view: 'tools', icon: <Wrench size={18} />, label: 'Tools' },
    { view: 'skills', icon: <Zap size={18} />, label: 'CC Skills' },
    { view: 'settings', icon: <Settings size={18} />, label: 'Settings' },
  ];

  return (
    <aside
      className="fixed left-0 top-0 h-full flex flex-col bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)]"
      style={{ width: 'var(--sidebar-width)' }}
    >
      {/* Header */}
      <div className="titlebar-drag h-12 flex items-center px-4 border-b border-[var(--color-border)]">
        <span className="titlebar-no-drag text-base font-bold text-[var(--color-primary)]">
          Jarvis
        </span>
      </div>

      {/* Workspaces */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
            Workspaces
          </span>
          <button
            onClick={() => setIsCreating(true)}
            className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <Plus size={14} />
          </button>
        </div>

        {isCreating && (
          <div className="mb-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setIsCreating(false);
              }}
              placeholder="Workspace name..."
              className="w-full px-3 py-1.5 text-sm rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]"
            />
          </div>
        )}

        <div className="space-y-0.5">
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              onClick={() => handleSelectWorkspace(ws)}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                activeWorkspace?.id === ws.id
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)]'
              }`}
            >
              <ChevronRight size={14} />
              <span className="flex-1 truncate">{ws.name}</span>
              {ws.loopMode?.enabled && (
                <RotateCw size={12} className="animate-spin opacity-60" />
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteWorkspace(ws.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/20"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        {workspaces.length === 0 && !isCreating && (
          <p className="text-xs text-[var(--color-text-muted)] text-center py-8">
            No workspaces yet.
            <br />
            Click + to create one.
          </p>
        )}
      </div>

      {/* Main Navigation */}
      <nav className="border-t border-[var(--color-border)] p-2">
        {mainNavItems.map((item) => (
          <button
            key={item.view}
            onClick={() => onViewChange(item.view)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              currentView === item.view
                ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)]'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      {/* Config Navigation */}
      <nav className="border-t border-[var(--color-border)] p-2">
        <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider px-3 mb-1 block">
          Config
        </span>
        {configNavItems.map((item) => (
          <button
            key={item.view}
            onClick={() => onViewChange(item.view)}
            className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              currentView === item.view
                ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)]'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
