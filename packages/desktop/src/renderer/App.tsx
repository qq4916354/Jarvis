import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './pages/ChatView';
import { SettingsView } from './pages/SettingsView';
import { ModelsView } from './pages/ModelsView';
import { ToolsView } from './pages/ToolsView';
import { SkillsView } from './pages/SkillsView';
import { ProvidersView } from './pages/ProvidersView';
import { DigitalHumansView } from './pages/DigitalHumansView';
import { BrowserView } from './pages/BrowserView';
import { WorkspaceFilesView } from './pages/WorkspaceFilesView';
import { SystemView } from './pages/SystemView';
import { SchedulerView } from './pages/SchedulerView';
import { useWorkspaceStore } from './stores/workspace-store';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sparkles } from 'lucide-react';
import './i18n';

export type View = 'chat' | 'settings' | 'models' | 'tools' | 'skills' | 'providers' | 'digitalHumans' | 'browser' | 'workspaceFiles' | 'system' | 'scheduler';

export function App() {
  const [currentView, setCurrentView] = useState<View>('chat');
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

  return (
    <div className="flex h-screen" style={{ background: 'var(--color-bg)' }}>
      {/* Sidebar */}
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />

      {/* Main Content */}
      <main
        className="flex-1 flex flex-col overflow-hidden"
        style={{ marginLeft: 'var(--sidebar-width)' }}
      >
        {/* 顶部 Header：使用 page-header CSS 类 */}
        <header className="page-header">
          <div className="flex items-center gap-3 flex-1">
            {/* Workspace name or current view title */}
            <h1
              className="text-sm font-semibold"
              style={{ color: 'var(--color-text)', letterSpacing: '-0.01em' }}
            >
              {activeWorkspace?.name || (
                <span className="text-gradient">Jarvis</span>
              )}
            </h1>

            {activeWorkspace?.loopMode?.enabled && (
              <span className="badge badge-primary animate-breathe">
                Loop Mode
              </span>
            )}
          </div>

          {/* Header right - subtle gradient accent line */}
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--gradient-primary)',
              boxShadow: 'var(--shadow-glow)',
            }}
          />
        </header>

        {/* Content Area */}
        <ErrorBoundary>
          <div className="flex-1 overflow-hidden">
            {!activeWorkspace && currentView === 'chat' ? (
              <WelcomeScreen />
            ) : (
              <>
                {currentView === 'chat' && <ChatView />}
                {currentView === 'settings' && <SettingsView />}
                {currentView === 'models' && <ModelsView />}
                {currentView === 'tools' && <ToolsView />}
                {currentView === 'skills' && <SkillsView />}
                {currentView === 'providers' && <ProvidersView />}
                {currentView === 'digitalHumans' && <DigitalHumansView />}
                {currentView === 'browser' && <BrowserView />}
                {currentView === 'workspaceFiles' && <WorkspaceFilesView />}
                {currentView === 'system' && <SystemView />}
                {currentView === 'scheduler' && <SchedulerView />}
              </>
            )}
          </div>
        </ErrorBoundary>
      </main>
    </div>
  );
}

function WelcomeScreen() {
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);

  const handleCreate = async () => {
    await createWorkspace('My Workspace');
  };

  return (
    <div
      className="flex-1 flex items-center justify-center h-full relative overflow-hidden"
      style={{ background: 'var(--color-bg)' }}
    >
      {/* 背景辉光 */}
      <div className="welcome-bg-glow" />

      {/* 浮动光晕球 */}
      <div className="welcome-orb welcome-orb-primary" />
      <div className="welcome-orb welcome-orb-secondary" />
      <div className="welcome-orb welcome-orb-tertiary" />

      {/* 细格线背景 */}
      <div className="welcome-grid" />

      {/* Main content */}
      <div className="relative text-center px-8 max-w-lg">
        {/* Logo mark */}
        <div className="animate-fadeInUp flex justify-center mb-6">
          <div
            className="animate-pulseGlow flex items-center justify-center font-bold text-2xl"
            style={{
              width: 72,
              height: 72,
              borderRadius: 'var(--radius-xl)',
              background: 'var(--gradient-primary)',
              color: '#0a0e17',
              boxShadow: 'var(--shadow-glow-lg)',
              fontFamily: "'Outfit', sans-serif",
              letterSpacing: '-0.03em',
            }}
          >
            J
          </div>
        </div>

        {/* Title */}
        <h1
          className="text-gradient animate-fadeInUp animate-delay-1 font-bold mb-3"
          style={{ fontSize: 52, lineHeight: 1.1, letterSpacing: '-0.03em' }}
        >
          Jarvis
        </h1>

        {/* Subtitle */}
        <p
          className="animate-fadeInUp animate-delay-2 mb-2 font-medium"
          style={{ fontSize: 18, color: 'var(--color-text-secondary)', letterSpacing: '-0.01em' }}
        >
          Self-Evolving AI Agent Platform
        </p>
        <p
          className="animate-fadeInUp animate-delay-3 mb-8 text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Create a workspace to start your first AI agent session
        </p>

        {/* CTA Button */}
        <div className="animate-fadeInUp animate-delay-4 flex justify-center">
          <button
            onClick={handleCreate}
            className="btn btn-primary animate-pulseGlow gap-2"
            style={{
              padding: '12px 28px',
              fontSize: 15,
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-glow)',
            }}
          >
            <Sparkles size={16} />
            Create Your First Workspace
          </button>
        </div>

        {/* Feature hints */}
        <div className="animate-fadeInUp animate-delay-5 flex items-center justify-center gap-6 mt-10">
          {['Multi-agent', 'Self-upgrading', 'Loop Mode'].map((feat) => (
            <div key={feat} className="flex items-center gap-1.5">
              <div className="status-dot active" style={{ width: 6, height: 6 }} />
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{feat}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
