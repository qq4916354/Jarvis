import React, { useEffect, useState } from 'react';
import { Save, RotateCw, Link, Unlink, Dna, Play, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { useWorkspaceStore } from '../stores/workspace-store';
import { api } from '../api';

interface EvolutionLog {
  message: string;
  timestamp: number;
}

interface EvolutionPhaseInfo {
  phase: string;
  status: string;
  output?: string;
}

export function SettingsView() {
  const { activeWorkspace } = useWorkspaceStore();

  const [goal, setGoal] = useState(activeWorkspace?.goal || '');
  const [loopEnabled, setLoopEnabled] = useState(activeWorkspace?.loopMode?.enabled || false);
  const [loopInterval, setLoopInterval] = useState(activeWorkspace?.loopMode?.intervalMinutes || 10);
  const [larkChatId, setLarkChatId] = useState(activeWorkspace?.larkChatId || '');
  const [saved, setSaved] = useState(false);
  const [evoRunning, setEvoRunning] = useState(false);
  const [evoGoal, setEvoGoal] = useState('');
  const [evoLogs, setEvoLogs] = useState<EvolutionLog[]>([]);
  const [evoPhases, setEvoPhases] = useState<EvolutionPhaseInfo[]>([]);
  const [evoHistory, setEvoHistory] = useState<any[]>([]);

  useEffect(() => {
    api.evolution.history().then(setEvoHistory);

    const unsubs = [
      api.evolution.onLog((data: any) => {
        setEvoLogs(prev => [...prev.slice(-50), { message: data.message, timestamp: Date.now() }]);
      }),
      api.evolution.onPhase((data: any) => {
        setEvoPhases(prev => {
          const existing = prev.findIndex(p => p.phase === data.phase);
          const updated = { phase: data.phase, status: data.status, output: data.output };
          if (existing >= 0) {
            const copy = [...prev];
            copy[existing] = updated;
            return copy;
          }
          return [...prev, updated];
        });
      }),
      api.evolution.onComplete(() => {
        setEvoRunning(false);
        api.evolution.history().then(setEvoHistory);
      }),
      api.evolution.onError(() => {
        setEvoRunning(false);
      }),
    ];
    return () => { unsubs.forEach(fn => fn?.()); };
  }, []);

  if (!activeWorkspace) return null;

  const handleSave = async () => {
    await api.workspace.update(activeWorkspace.id, {
      goal,
      loopMode: { enabled: loopEnabled, intervalMinutes: loopInterval },
      larkChatId: larkChatId || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
      {/* 页面标题 */}
      <div className="mb-8 animate-fadeInUp">
        <h2 className="text-2xl font-bold text-gradient mb-1">Workspace Settings</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Configure behaviour and integrations for this workspace
        </p>
      </div>

      {/* 工作区名称 */}
      <section className="card p-5 mb-5 animate-fadeInUp" style={{ animationDelay: '0.05s' }}>
        <label className="block text-xs font-medium mb-1 text-[var(--color-text-muted)]">
          Workspace Name
        </label>
        <p className="text-base font-semibold">{activeWorkspace.name}</p>
      </section>

      {/* 目标设置 */}
      <section className="card p-5 mb-5 animate-fadeInUp" style={{ animationDelay: '0.1s' }}>
        <label className="block text-sm font-medium mb-2 text-[var(--color-text-secondary)]">
          Global Goal
        </label>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          placeholder="What should this agent work towards?"
          className="input w-full"
          style={{ resize: 'vertical', minHeight: '4.5rem' }}
        />
      </section>

      {/* 循环模式 */}
      <section
        className={`card p-5 mb-5 animate-fadeInUp ${loopEnabled ? 'border-[var(--color-border-accent)]' : ''}`}
        style={{
          animationDelay: '0.15s',
          transition: 'border-color var(--transition-base)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold">Infinite Loop Mode</h3>
              {loopEnabled && <span className="status-dot active animate-breathe" />}
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Periodically plan and execute actions toward the goal
            </p>
          </div>

          {/* Toggle：使用 global.css 的 .toggle 和 .toggle.active */}
          <div
            className={`toggle${loopEnabled ? ' active' : ''}`}
            onClick={handleToggleLoop}
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-[var(--color-text-muted)]">
            Interval (minutes)
          </label>
          <div className="flex items-center">
            <input
              type="number"
              min={1}
              max={120}
              value={loopInterval}
              onChange={(e) => setLoopInterval(parseInt(e.target.value, 10))}
              className="input"
              style={{ width: '5rem', borderRadius: 'var(--radius-md) 0 0 var(--radius-md)' }}
            />
            <span
              className="px-3 py-2 text-xs flex items-center bg-[var(--color-bg-elevated)] border border-[var(--color-border)] border-l-0 text-[var(--color-text-muted)]"
              style={{ borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}
            >
              min
            </span>
          </div>
        </div>

        {loopEnabled && (
          <div className="mt-3 flex items-center gap-2 text-xs animate-fadeIn text-[var(--color-primary)]">
            <RotateCw size={12} className="animate-spin" />
            Running every {loopInterval} minutes
          </div>
        )}
      </section>

      {/* Lark 集成 */}
      <section className="card p-5 mb-8 animate-fadeInUp" style={{ animationDelay: '0.2s' }}>
        <h3 className="text-sm font-semibold mb-3">Lark / Feishu Integration</h3>
        <div className="flex gap-3">
          <input
            value={larkChatId}
            onChange={(e) => setLarkChatId(e.target.value)}
            placeholder="Group Chat ID"
            className="input flex-1"
          />
          <button
            onClick={handleBindLark}
            className="btn btn-primary gap-2 px-4"
          >
            {larkChatId ? <Link size={14} /> : <Unlink size={14} />}
            Bind
          </button>
        </div>
      </section>

      {/* 保存按钮 */}
      <button
        onClick={handleSave}
        className={`btn btn-primary gap-2 px-6 py-2.5 animate-fadeInUp${saved ? ' bg-[var(--color-success)]' : ''}`}
        style={{ animationDelay: '0.25s' }}
      >
        <Save size={16} />
        {saved ? 'Saved!' : 'Save Settings'}
      </button>

      {/* 自我进化引擎 */}
      <section className="card p-5 mt-8 mb-5 animate-fadeInUp" style={{ animationDelay: '0.3s' }}>
        <div className="flex items-center gap-2 mb-1">
          <Dna size={16} style={{ color: 'var(--color-primary)' }} />
          <h3 className="text-sm font-semibold">Self-Evolution Engine</h3>
          {evoRunning && <span className="status-dot active animate-breathe" />}
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          Autonomous improvement cycle: Research → Design → Requirements → Plan → Develop → Test
        </p>

        <div className="flex gap-3 mb-4">
          <input
            value={evoGoal}
            onChange={(e) => setEvoGoal(e.target.value)}
            placeholder="Evolution goal (e.g., 'Improve error handling')"
            className="input flex-1"
            disabled={evoRunning}
          />
          <button
            onClick={async () => {
              try {
                setEvoRunning(true);
                setEvoLogs([{ message: 'Initiating self-evolution...', timestamp: Date.now() }]);
                setEvoPhases([
                  { phase: 'research', status: 'pending' },
                  { phase: 'design', status: 'pending' },
                  { phase: 'requirements', status: 'pending' },
                  { phase: 'plan', status: 'pending' },
                  { phase: 'develop', status: 'pending' },
                  { phase: 'test', status: 'pending' },
                ]);
                const result = await api.evolution.start(evoGoal || undefined);
                if (result) {
                  setEvoLogs(prev => [...prev, { message: `Evolution started: ${result.goal}`, timestamp: Date.now() }]);
                } else {
                  setEvoLogs(prev => [...prev, { message: 'Failed to start evolution (API returned null)', timestamp: Date.now() }]);
                  setEvoRunning(false);
                }
              } catch (err: any) {
                setEvoLogs(prev => [...prev, { message: `Error: ${err.message || err}`, timestamp: Date.now() }]);
                setEvoRunning(false);
              }
            }}
            disabled={evoRunning}
            className="btn btn-primary gap-2 px-4"
          >
            {evoRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {evoRunning ? 'Running...' : 'Evolve'}
          </button>
        </div>

        {/* Phase progress */}
        {evoPhases.length > 0 && (
          <div className="space-y-2 mb-4">
            {evoPhases.map((p) => (
              <div key={p.phase} className="flex items-center gap-2 text-xs">
                {p.status === 'completed' && <CheckCircle size={12} className="text-green-500 shrink-0" />}
                {p.status === 'running' && <Loader2 size={12} className="animate-spin text-blue-500 shrink-0" />}
                {p.status === 'failed' && <XCircle size={12} className="text-red-500 shrink-0" />}
                {p.status === 'pending' && <Clock size={12} className="text-[var(--color-text-muted)] shrink-0" />}
                <span className={`font-medium capitalize ${p.status === 'running' ? 'text-blue-500' : ''}`}>
                  {p.phase}
                </span>
                <span className="text-[var(--color-text-muted)]">{p.status}</span>
              </div>
            ))}
          </div>
        )}

        {/* Live logs */}
        {evoLogs.length > 0 && (
          <div
            className="rounded-lg p-3 text-xs font-mono space-y-1 max-h-40 overflow-y-auto"
            style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)' }}
          >
            {evoLogs.map((log, i) => (
              <div key={i} className="text-[var(--color-text-muted)]">{log.message}</div>
            ))}
          </div>
        )}
      </section>

      {/* Evolution history */}
      {evoHistory.length > 0 && (
        <section className="card p-5 mb-5 animate-fadeInUp" style={{ animationDelay: '0.35s' }}>
          <h3 className="text-sm font-semibold mb-3">Evolution History</h3>
          <div className="space-y-2">
            {evoHistory.slice(-5).reverse().map((cycle: any) => (
              <div
                key={cycle.id}
                className="flex items-center justify-between p-3 rounded-lg text-xs"
                style={{ background: 'var(--color-bg-inset)', border: '1px solid var(--color-border)' }}
              >
                <div>
                  <div className="font-medium">Cycle #{cycle.iteration}</div>
                  <div className="text-[var(--color-text-muted)] truncate max-w-[300px]">{cycle.goal}</div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  cycle.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                  cycle.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                  'bg-blue-500/10 text-blue-500'
                }`}>
                  {cycle.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
