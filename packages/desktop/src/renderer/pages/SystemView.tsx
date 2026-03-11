import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Clock,
  Brain,
  Calendar,
  RefreshCw,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { api } from '../api';
import {
  StatCard,
  ProgressBar,
  Timeline,
  StatusIndicator,
  MiniChart,
} from '../components/DashboardWidgets';

// ─── Types ───────────────────────────────────────────────────────

interface DashboardData {
  system: {
    uptime: number;
    activeWorkspaces: number;
    agentStatus: 'active' | 'idle' | 'error';
    evolutionActive: boolean;
  };
  evolution: {
    currentCycle: EvolutionCycle | null;
    history: EvolutionCycle[];
  };
  memory: {
    messageCount: number;
    memoryCount: number;
    episodeCount: number;
    recentActivity: { time: string; title: string; description?: string }[];
  };
  scheduler: {
    activeTasks: SchedulerTask[];
    nextExecution: string | null;
  };
}

interface EvolutionCycle {
  id: string;
  startTime: string;
  endTime?: string;
  status: 'running' | 'completed' | 'failed';
  phases: EvolutionPhase[];
}

interface EvolutionPhase {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  duration?: number;
}

interface SchedulerTask {
  id: string;
  name: string;
  cron: string;
  nextRun: string;
  lastResult?: 'success' | 'failed' | 'unknown';
  enabled: boolean;
}

const EVOLUTION_PHASE_NAMES = [
  'Analysis',
  'Planning',
  'Implementation',
  'Testing',
  'Integration',
  'Verification',
];

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// ─── SystemStatusPanel ───────────────────────────────────────────

function SystemStatusPanel({ data }: { data: DashboardData['system'] }) {
  return (
    <div className="p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <Activity size={16} />
        System Status
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          title="Agent"
          value={data.agentStatus === 'active' ? 'Active' : data.agentStatus === 'error' ? 'Error' : 'Idle'}
          icon={<StatusIndicator status={data.agentStatus === 'active' ? 'active' : data.agentStatus === 'error' ? 'error' : 'idle'} />}
          color={
            data.agentStatus === 'active' ? 'var(--color-success)' :
            data.agentStatus === 'error' ? 'var(--color-error)' : undefined
          }
        />
        <StatCard
          title="Workspaces"
          value={data.activeWorkspaces}
          icon={<Activity size={16} />}
        />
        <StatCard
          title="Evolution"
          value={data.evolutionActive ? 'Running' : 'Idle'}
          icon={<StatusIndicator status={data.evolutionActive ? 'active' : 'idle'} />}
          color={data.evolutionActive ? 'var(--color-success)' : undefined}
        />
        <StatCard
          title="Uptime"
          value={formatUptime(data.uptime)}
          icon={<Clock size={16} />}
        />
      </div>
    </div>
  );
}

// ─── EvolutionPanel ──────────────────────────────────────────────

function EvolutionPanel({ data }: { data: DashboardData['evolution'] }) {
  const currentPhases: EvolutionPhase[] = data.currentCycle?.phases ||
    EVOLUTION_PHASE_NAMES.map((name) => ({ name, status: 'pending' as const }));

  return (
    <div className="p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <RefreshCw size={16} />
        Evolution Progress
      </h3>

      {/* Current cycle phases */}
      <div className="mb-4">
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          {data.currentCycle
            ? `Cycle ${data.currentCycle.id} - ${data.currentCycle.status}`
            : 'No active evolution cycle'}
        </p>
        {currentPhases.map((phase, i) => (
          <ProgressBar
            key={i}
            label={phase.name}
            value={phase.status === 'completed' ? 100 : phase.status === 'running' ? 50 : 0}
            max={100}
            status={phase.status}
          />
        ))}
      </div>

      {/* History */}
      {data.history.length > 0 && (
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase tracking-wider">
            Recent Cycles
          </p>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {data.history.slice(0, 10).map((cycle, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-2 py-1.5 rounded bg-[var(--color-bg)] text-xs"
              >
                <div className="flex items-center gap-2">
                  {cycle.status === 'completed' ? (
                    <CheckCircle2 size={12} className="text-[var(--color-success)]" />
                  ) : cycle.status === 'failed' ? (
                    <XCircle size={12} className="text-[var(--color-error)]" />
                  ) : (
                    <Loader2 size={12} className="text-[var(--color-primary)] animate-spin" />
                  )}
                  <span className="text-[var(--color-text-secondary)]">Cycle {cycle.id}</span>
                </div>
                <span className="text-[var(--color-text-muted)]">
                  {cycle.endTime ? formatTime(cycle.endTime) : 'In progress'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.history.length === 0 && !data.currentCycle && (
        <p className="text-xs text-[var(--color-text-muted)] text-center py-2">
          No evolution history yet
        </p>
      )}
    </div>
  );
}

// ─── MemoryStatsPanel ────────────────────────────────────────────

function MemoryStatsPanel({ data }: { data: DashboardData['memory'] }) {
  const total = data.messageCount + data.memoryCount + data.episodeCount;
  const chartData = [data.messageCount, data.memoryCount, data.episodeCount];

  // Simple horizontal bar chart for distribution
  const items = [
    { label: 'Messages', count: data.messageCount, color: 'var(--color-primary)' },
    { label: 'Long-term', count: data.memoryCount, color: 'var(--color-success)' },
    { label: 'Episodes', count: data.episodeCount, color: 'var(--color-warning)' },
  ];

  return (
    <div className="p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <Brain size={16} />
        Memory Statistics
      </h3>

      {/* Distribution bars */}
      <div className="mb-4 space-y-2">
        {items.map((item, i) => (
          <div key={i}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--color-text-secondary)]">{item.label}</span>
              <span className="text-xs font-medium text-[var(--color-text)]">{item.count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--color-bg-tertiary,#242424)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: total > 0 ? `${(item.count / total) * 100}%` : '0%',
                  backgroundColor: item.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Mini chart */}
      <div className="mb-4">
        <MiniChart data={chartData} type="bar" height={32} />
      </div>

      {/* Recent activity timeline */}
      <div>
        <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2 uppercase tracking-wider">
          Recent Activity
        </p>
        <Timeline items={data.recentActivity.slice(0, 5)} />
      </div>
    </div>
  );
}

// ─── SchedulerPanel ──────────────────────────────────────────────

function SchedulerPanel({ data }: { data: DashboardData['scheduler'] }) {
  return (
    <div className="p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <Calendar size={16} />
        Task Scheduler
      </h3>

      {data.nextExecution && (
        <div className="mb-3 px-3 py-2 rounded bg-[var(--color-bg)] text-xs">
          <span className="text-[var(--color-text-muted)]">Next execution: </span>
          <span className="text-[var(--color-text)] font-medium">{formatTime(data.nextExecution)}</span>
        </div>
      )}

      {data.activeTasks.length > 0 ? (
        <div className="space-y-2">
          {data.activeTasks.map((task, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)]"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <StatusIndicator status={task.enabled ? 'active' : 'idle'} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)] truncate">
                    {task.name}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)] font-mono">
                    {task.cron}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {task.lastResult && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    task.lastResult === 'success'
                      ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
                      : task.lastResult === 'failed'
                      ? 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
                      : 'bg-[var(--color-text-muted)]/10 text-[var(--color-text-muted)]'
                  }`}>
                    {task.lastResult}
                  </span>
                )}
                <span className="text-xs text-[var(--color-text-muted)]">
                  {formatTime(task.nextRun)}
                </span>
                {task.enabled ? (
                  <Pause size={12} className="text-[var(--color-text-muted)]" />
                ) : (
                  <Play size={12} className="text-[var(--color-text-muted)]" />
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[var(--color-text-muted)] text-center py-6">
          No scheduled tasks
        </p>
      )}
    </div>
  );
}

// ─── SystemView (Main) ──────────────────────────────────────────

const DEFAULT_DATA: DashboardData = {
  system: { uptime: 0, activeWorkspaces: 0, agentStatus: 'idle', evolutionActive: false },
  evolution: { currentCycle: null, history: [] },
  memory: { messageCount: 0, memoryCount: 0, episodeCount: 0, recentActivity: [] },
  scheduler: { activeTasks: [], nextExecution: null },
};

export function SystemView() {
  const [data, setData] = useState<DashboardData>(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchDashboard = useCallback(async () => {
    try {
      const result = await api.dashboard.get();
      if (result) {
        setData(result);
      }
    } catch {
      // keep existing data on failure
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 10000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  // WebSocket real-time updates
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    unsubscribers.push(
      api.ws.on('evolution:phase_start', (msg: any) => {
        setData((prev) => ({
          ...prev,
          system: { ...prev.system, evolutionActive: true },
        }));
      })
    );

    unsubscribers.push(
      api.ws.on('evolution:phase_complete', () => {
        fetchDashboard();
      })
    );

    unsubscribers.push(
      api.ws.on('memory:message_added', () => {
        setData((prev) => ({
          ...prev,
          memory: {
            ...prev.memory,
            messageCount: prev.memory.messageCount + 1,
          },
        }));
      })
    );

    unsubscribers.push(
      api.ws.on('memory:remembered', () => {
        setData((prev) => ({
          ...prev,
          memory: {
            ...prev.memory,
            memoryCount: prev.memory.memoryCount + 1,
          },
        }));
      })
    );

    unsubscribers.push(
      api.ws.on('scheduler:task_executed', () => {
        fetchDashboard();
      })
    );

    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };
  }, [fetchDashboard]);

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 max-w-5xl mx-auto">
        <h2 className="text-xl font-semibold">System Dashboard</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--color-text-muted)]">
            Updated {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <button
            onClick={fetchDashboard}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-5xl mx-auto">
        <SystemStatusPanel data={data.system} />
        <EvolutionPanel data={data.evolution} />
        <MemoryStatsPanel data={data.memory} />
        <SchedulerPanel data={data.scheduler} />
      </div>
    </div>
  );
}
