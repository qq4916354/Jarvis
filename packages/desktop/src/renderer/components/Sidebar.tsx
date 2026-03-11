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
  Globe,
  Users,
  Layers,
  FileText,
  Shield,
  Calendar,
} from 'lucide-react';
import { useWorkspaceStore, WorkspaceConfig } from '../stores/workspace-store';

type View = 'chat' | 'settings' | 'models' | 'tools' | 'skills' | 'providers' | 'digitalHumans' | 'browser' | 'workspaceFiles' | 'system' | 'scheduler';

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

// 工作区头像颜色池
const AVATAR_COLORS = [
  '#06d6a0', '#38bdf8', '#818cf8', '#f472b6', '#fb923c', '#facc15',
];

function getAvatarColor(name: string | undefined): string {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
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

  // 主导航项：对话、数字人、AI浏览器
  const mainNavItems: { view: View; icon: React.ReactNode; label: string }[] = [
    { view: 'chat', icon: <MessageSquare size={16} />, label: 'Chat' },
    { view: 'workspaceFiles', icon: <FileText size={16} />, label: 'Files' },
    { view: 'digitalHumans', icon: <Users size={16} />, label: 'Digital Humans' },
    { view: 'browser', icon: <Globe size={16} />, label: 'AI Browser' },
  ];

  // 配置导航项：提供商、模型、工具、技能、设置
  const configNavItems: { view: View; icon: React.ReactNode; label: string }[] = [
    { view: 'providers', icon: <Layers size={16} />, label: 'Providers' },
    { view: 'models', icon: <Cpu size={16} />, label: 'Models' },
    { view: 'tools', icon: <Wrench size={16} />, label: 'Tools' },
    { view: 'skills', icon: <Zap size={16} />, label: 'CC Skills' },
    { view: 'scheduler', icon: <Calendar size={16} />, label: 'Scheduler' },
    { view: 'system', icon: <Shield size={16} />, label: 'System' },
    { view: 'settings', icon: <Settings size={16} />, label: 'Settings' },
  ];

  return (
    <aside
      className="fixed left-0 top-0 h-full flex flex-col animate-slideInLeft"
      style={{
        width: 'var(--sidebar-width)',
        background: 'var(--color-bg-secondary)',
        borderRight: '1px solid var(--color-border)',
      }}
    >
      {/* Logo 头部 */}
      <div
        className="shrink-0 flex items-center gap-3 px-4"
        style={{ height: 'var(--header-height)', borderBottom: '1px solid var(--color-border)' }}
      >
        {/* J 图标 */}
        <div
          className="animate-pulseGlow shrink-0 flex items-center justify-center font-bold text-sm"
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-md)',
            background: 'var(--gradient-primary)',
            color: '#0a0e17',
            boxShadow: 'var(--shadow-glow)',
            fontFamily: "'Outfit', sans-serif",
            letterSpacing: '-0.02em',
          }}
        >
          J
        </div>
        <div>
          <span
            className="text-gradient font-bold text-base leading-none"
            style={{ fontFamily: "'Outfit', sans-serif", letterSpacing: '-0.02em' }}
          >
            Jarvis
          </span>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            AI Agent Platform
          </p>
        </div>
      </div>

      {/* 工作区列表区域 */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* 区域标签 + 新建按钮 */}
        <div className="flex items-center justify-between mb-2 px-1">
          <span
            className="text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Workspaces
          </span>
          {/* 使用 icon-btn CSS 类，无需 JS hover */}
          <button
            onClick={() => setIsCreating(true)}
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            title="新建工作区"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* 新建工作区输入框 */}
        {isCreating && (
          <div className="mb-2 animate-fadeInDown">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setIsCreating(false);
              }}
              placeholder="Workspace name..."
              className="input text-sm"
              style={{ padding: '7px 10px', fontSize: 13 }}
            />
          </div>
        )}

        {/* 工作区列表 */}
        <div className="space-y-0.5">
          {workspaces.map((ws) => {
            const isActive = activeWorkspace?.id === ws.id;
            const avatarColor = getAvatarColor(ws.name);
            return (
              <div
                key={ws.id}
                onClick={() => handleSelectWorkspace(ws)}
                // 使用 workspace-item CSS 类，active 状态通过 class 切换
                className={`workspace-item${isActive ? ' active' : ''}`}
              >
                {/* 彩色头像圆圈 */}
                <div
                  className="shrink-0 flex items-center justify-center rounded-full text-[11px] font-bold"
                  style={{
                    width: 24,
                    height: 24,
                    background: `${avatarColor}22`,
                    color: avatarColor,
                    border: `1px solid ${avatarColor}44`,
                  }}
                >
                  {(ws.name || 'W').charAt(0).toUpperCase()}
                </div>

                <span className="flex-1 truncate text-[13px]">{ws.name || 'Untitled'}</span>

                {/* Loop 模式旋转图标 */}
                {ws.loopMode?.enabled && (
                  <RotateCw
                    size={11}
                    className="animate-spin shrink-0"
                    style={{ color: 'var(--color-primary)', opacity: 0.7 }}
                  />
                )}

                {/* 删除按钮：使用 workspace-delete-btn CSS 类，hover 通过 CSS 控制显示 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteWorkspace(ws.id);
                  }}
                  className="workspace-delete-btn"
                  title="删除工作区"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>

        {/* 空状态提示 */}
        {workspaces.length === 0 && !isCreating && (
          <div className="text-center py-8 animate-fadeIn">
            <div
              className="mx-auto mb-3 flex items-center justify-center rounded-xl"
              style={{
                width: 40,
                height: 40,
                background: 'var(--color-primary-subtle)',
                border: '1px solid var(--color-border-accent)',
              }}
            >
              <Plus size={18} style={{ color: 'var(--color-primary)' }} />
            </div>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              No workspaces yet.
              <br />
              Click + to create one.
            </p>
          </div>
        )}
      </div>

      {/* 分割线 */}
      <div className="divider mx-3" />

      {/* 主导航区域 */}
      <nav className="px-2 pb-1">
        <span
          className="text-[10px] font-semibold uppercase tracking-widest px-2 mb-1 block"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Main
        </span>
        {mainNavItems.map((item) => (
          <button
            key={item.view}
            onClick={() => onViewChange(item.view)}
            // 使用 nav-item CSS 类，active 通过 class 切换，无需 JS hover
            className={`nav-item${currentView === item.view ? ' active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* 分割线 */}
      <div className="divider mx-3" />

      {/* 配置导航区域 */}
      <nav className="px-2 pb-3">
        <span
          className="text-[10px] font-semibold uppercase tracking-widest px-2 mb-1 block"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Config
        </span>
        {configNavItems.map((item) => (
          <button
            key={item.view}
            onClick={() => onViewChange(item.view)}
            // 使用 nav-item CSS 类，active 通过 class 切换
            className={`nav-item${currentView === item.view ? ' active' : ''}`}
            style={{ paddingTop: 6, paddingBottom: 6 }}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
