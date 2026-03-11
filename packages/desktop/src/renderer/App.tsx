import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './pages/ChatView';
import { SettingsView } from './pages/SettingsView';
import { ModelsView } from './pages/ModelsView';
import { ToolsView } from './pages/ToolsView';
import { SkillsView } from './pages/SkillsView';
import { ProvidersView } from './pages/ProvidersView';
import { DigitalHumansView } from './pages/DigitalHumansView';
import { useWorkspaceStore } from './stores/workspace-store';
import './i18n';

export type View = 'chat' | 'settings' | 'models' | 'tools' | 'skills' | 'providers' | 'digitalHumans' | 'browser';

export function App() {
  const [currentView, setCurrentView] = useState<View>('chat');
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden" style={{ marginLeft: 'var(--sidebar-width)' }}>
        {/* Header */}
        <header className="h-12 flex items-center px-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold">
              {activeWorkspace?.name || 'Jarvis'}
            </h1>
            {activeWorkspace?.loopMode?.enabled && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--color-primary)] text-white">
                Loop Mode
              </span>
            )}
          </div>
        </header>

        {/* Content Area */}
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
              {currentView === 'browser' && <BrowserPlaceholder />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function WelcomeScreen() {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-2">Welcome to Jarvis</h2>
        <p className="text-[var(--color-text-secondary)] mb-6">
          Create a workspace to get started
        </p>
        <p className="text-sm text-[var(--color-text-muted)]">
          Self-evolving AI agent platform
        </p>
      </div>
    </div>
  );
}

function BrowserPlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">AI Browser</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Embedded browser with AI control coming soon
        </p>
      </div>
    </div>
  );
}
