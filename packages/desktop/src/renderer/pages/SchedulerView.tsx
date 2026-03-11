import React, { useEffect, useState, useCallback } from 'react';
import { Calendar, Plus, Trash2, RefreshCw, Play, Pause, Clock } from 'lucide-react';
import { useWorkspaceStore } from '../stores/workspace-store';
import { api } from '../api';

interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  action: string;
  enabled: boolean;
  lastRun: number | null;
  nextRun: number | null;
  workspaceId: string;
}

export function SchedulerView() {
  const { activeWorkspace } = useWorkspaceStore();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({ name: '', cron: '*/10 * * * *', action: '' });

  const loadTasks = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const result = await api.scheduler.list(activeWorkspace.id);
      setTasks(result || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [activeWorkspace]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleCreate = async () => {
    if (!activeWorkspace || !newTask.name.trim() || !newTask.action.trim()) return;
    try {
      await api.scheduler.create(activeWorkspace.id, newTask);
      setNewTask({ name: '', cron: '*/10 * * * *', action: '' });
      setShowCreate(false);
      await loadTasks();
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  };

  const handleToggle = async (task: ScheduledTask) => {
    try {
      await api.scheduler.update(task.id, { enabled: !task.enabled });
      await loadTasks();
    } catch (err) {
      console.error('Failed to toggle task:', err);
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await api.scheduler.delete(taskId);
      await loadTasks();
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  const formatTime = (ts: number | null): string => {
    if (!ts) return '--';
    return new Date(ts).toLocaleString();
  };

  // Common cron presets
  const CRON_PRESETS = [
    { label: 'Every 10 min', value: '*/10 * * * *' },
    { label: 'Every 30 min', value: '*/30 * * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Daily at 9am', value: '0 9 * * *' },
    { label: 'Weekly Mon 9am', value: '0 9 * * 1' },
  ];

  if (!activeWorkspace) return null;

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8 animate-fadeInUp">
        <h2 className="text-2xl font-bold text-gradient mb-1">Scheduled Tasks</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Manage cron-based automation for this workspace
        </p>
      </div>

      {/* Action bar */}
      <div className="flex gap-2 mb-6 animate-fadeInUp" style={{ animationDelay: '0.05s' }}>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className={`btn ${showCreate ? 'btn-primary' : 'btn-ghost'} flex items-center gap-1.5 px-3 py-1.5`}
        >
          <Plus size={13} />
          <span className="text-sm">New Task</span>
        </button>
        <button
          onClick={loadTasks}
          className="btn btn-ghost p-1.5"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Create panel */}
      {showCreate && (
        <section className="card-glow p-5 mb-6 animate-fadeInUp">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-[var(--color-text)]">
            <Calendar size={14} className="text-[var(--color-primary)]" />
            Create Scheduled Task
          </h3>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-[var(--color-text-muted)]">Task Name</label>
              <input
                value={newTask.name}
                onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
                placeholder="e.g., Daily progress check"
                className="input w-full"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1 text-[var(--color-text-muted)]">
                Schedule (cron)
              </label>
              <input
                value={newTask.cron}
                onChange={(e) => setNewTask({ ...newTask, cron: e.target.value })}
                placeholder="*/10 * * * *"
                className="input w-full font-mono"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {CRON_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => setNewTask({ ...newTask, cron: preset.value })}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      newTask.cron === preset.value
                        ? 'bg-[var(--color-primary-subtle)] border-[var(--color-border-accent)] text-[var(--color-primary)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-hover)]'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1 text-[var(--color-text-muted)]">
                Action (prompt or command)
              </label>
              <textarea
                value={newTask.action}
                onChange={(e) => setNewTask({ ...newTask, action: e.target.value })}
                placeholder="e.g., Check progress toward the workspace goal and summarize findings"
                rows={3}
                className="input w-full"
                style={{ resize: 'none' }}
              />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleCreate}
              disabled={!newTask.name.trim() || !newTask.action.trim()}
              className="btn btn-primary px-4 py-1.5"
            >
              Create
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="btn btn-ghost px-4 py-1.5"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Task list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={20} className="animate-spin text-[var(--color-text-muted)]" />
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task, index) => (
            <div
              key={task.id}
              className={`card-glow p-4 animate-fadeInUp ${!task.enabled ? 'opacity-60' : ''}`}
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className="w-8 h-8 rounded-lg bg-[var(--color-bg-tertiary)] flex items-center justify-center shrink-0 mt-0.5">
                  <Calendar size={14} className={task.enabled ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-[var(--color-text)]">{task.name}</span>
                    <span className="badge font-mono text-[10px]">{task.cron}</span>
                    {task.enabled && <span className="status-dot active" />}
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] truncate">{task.action}</p>
                  <div className="flex gap-4 mt-2 text-[10px] text-[var(--color-text-muted)]">
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      Last: {formatTime(task.lastRun)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      Next: {formatTime(task.nextRun)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleToggle(task)}
                    className="btn btn-ghost p-1.5"
                    title={task.enabled ? 'Pause' : 'Resume'}
                  >
                    {task.enabled ? <Pause size={13} /> : <Play size={13} />}
                  </button>
                  <button
                    onClick={() => handleDelete(task.id)}
                    className="btn btn-ghost p-1.5 hover:text-[var(--color-error)]"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-full bg-[var(--color-bg-tertiary)] flex items-center justify-center mx-auto mb-4">
                <Calendar size={24} className="text-[var(--color-text-muted)] opacity-40" />
              </div>
              <p className="text-sm text-[var(--color-text-muted)]">No scheduled tasks.</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1 opacity-60">
                Create a task to automate recurring agent actions.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
