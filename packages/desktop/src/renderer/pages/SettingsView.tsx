import React, { useState } from 'react';
import { Save, RotateCw, Play, Square, Link, Unlink } from 'lucide-react';
import { useWorkspaceStore } from '../stores/workspace-store';
import { api } from '../api';

export function SettingsView() {
  const { activeWorkspace } = useWorkspaceStore();

  const [goal, setGoal] = useState(activeWorkspace?.goal || '');
  const [loopEnabled, setLoopEnabled] = useState(activeWorkspace?.loopMode?.enabled || false);
  const [loopInterval, setLoopInterval] = useState(activeWorkspace?.loopMode?.intervalMinutes || 10);
  const [larkChatId, setLarkChatId] = useState(activeWorkspace?.larkChatId || '');

  if (!activeWorkspace) return null;

  const handleSave = async () => {
    await api.workspace.update(activeWorkspace.id, {
      goal,
      loopMode: { enabled: loopEnabled, intervalMinutes: loopInterval },
      larkChatId: larkChatId || undefined,
    });
  };

  const handleToggleLoop = async () => {
    const newEnabled = !loopEnabled;
    setLoopEnabled(newEnabled);

    if (newEnabled) {
      await api.loop.start(activeWorkspace.id, {
        enabled: true,
        intervalMinutes: loopInterval,
        goal,
      });
    } else {
      await api.loop.stop(activeWorkspace.id);
    }
  };

  const handleBindLark = async () => {
    if (larkChatId) {
      await api.lark.bind(activeWorkspace.id, larkChatId);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Workspace Settings</h2>

      {/* Workspace Name */}
      <section className="mb-8">
        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
          Name
        </label>
        <p className="text-lg">{activeWorkspace.name}</p>
      </section>

      {/* Goal */}
      <section className="mb-8">
        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
          Global Goal
        </label>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          placeholder="What should this agent work towards?"
          className="w-full px-4 py-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-primary)]"
        />
      </section>

      {/* Loop Mode */}
      <section className="mb-8 p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold">Infinite Loop Mode</h3>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              Periodically plan and execute actions toward the goal
            </p>
          </div>
          <button
            onClick={handleToggleLoop}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              loopEnabled
                ? 'bg-[var(--color-error)] text-white hover:bg-red-600'
                : 'bg-[var(--color-success)] text-white hover:bg-green-600'
            }`}
          >
            {loopEnabled ? (
              <>
                <Square size={14} /> Stop
              </>
            ) : (
              <>
                <Play size={14} /> Start
              </>
            )}
          </button>
        </div>

        <label className="block text-xs text-[var(--color-text-muted)] mb-1">
          Interval (minutes)
        </label>
        <input
          type="number"
          min={1}
          max={120}
          value={loopInterval}
          onChange={(e) => setLoopInterval(parseInt(e.target.value, 10))}
          className="w-32 px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm outline-none focus:border-[var(--color-primary)]"
        />

        {loopEnabled && (
          <div className="mt-3 flex items-center gap-2 text-xs text-[var(--color-success)]">
            <RotateCw size={12} className="animate-spin" />
            Running every {loopInterval} minutes
          </div>
        )}
      </section>

      {/* Lark Integration */}
      <section className="mb-8 p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
        <h3 className="text-sm font-semibold mb-3">Lark / Feishu Integration</h3>
        <div className="flex gap-3">
          <input
            value={larkChatId}
            onChange={(e) => setLarkChatId(e.target.value)}
            placeholder="Group Chat ID"
            className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm outline-none focus:border-[var(--color-primary)]"
          />
          <button
            onClick={handleBindLark}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)]"
          >
            {larkChatId ? <Link size={14} /> : <Unlink size={14} />}
            Bind
          </button>
        </div>
      </section>

      {/* Save */}
      <button
        onClick={handleSave}
        className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary-hover)] transition-colors"
      >
        <Save size={16} />
        Save Settings
      </button>
    </div>
  );
}
