import React, { useEffect, useState } from 'react';
import { Plus, Play, Pause, Trash2, Clock, Activity, User } from 'lucide-react';
import { api } from '../api';

interface DigitalHuman {
  id: string;
  name: string;
  description: string;
  prompt: string;
  schedule: string;
  status: 'active' | 'paused' | 'error' | 'disabled';
  consecutiveFailures: number;
  lastRunAt?: number;
  createdAt: number;
}

interface ActivityEntry {
  id: string;
  outcome: string;
  output?: string;
  error?: string;
  durationMs: number;
  timestamp: number;
}

export function DigitalHumansView() {
  const [digitalHumans, setDigitalHumans] = useState<DigitalHuman[]>([]);
  const [selectedDH, setSelectedDH] = useState<DigitalHuman | null>(null);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', prompt: '', schedule: '0 * * * *' });

  useEffect(() => {
    loadDigitalHumans();
  }, []);

  const loadDigitalHumans = async () => {
    const list = await api.digitalHumans.list();
    setDigitalHumans(list);
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.prompt.trim()) return;
    await api.digitalHumans.create(form);
    setForm({ name: '', description: '', prompt: '', schedule: '0 * * * *' });
    setIsCreating(false);
    loadDigitalHumans();
  };

  const handleToggleStatus = async (dh: DigitalHuman) => {
    const newStatus = dh.status === 'active' ? 'paused' : 'active';
    await api.digitalHumans.update(dh.id, { status: newStatus });
    loadDigitalHumans();
  };

  const handleDelete = async (id: string) => {
    await api.digitalHumans.delete(id);
    if (selectedDH?.id === id) setSelectedDH(null);
    loadDigitalHumans();
  };

  const handleSelect = async (dh: DigitalHuman) => {
    setSelectedDH(dh);
    const acts = await api.digitalHumans.activity(dh.id, 20);
    setActivities(acts);
  };

  const getStatusDotClass = (status: string) => {
    if (status === 'active') return 'status-dot status-dot-active';
    if (status === 'paused') return 'status-dot status-dot-warning';
    if (status === 'error') return 'status-dot status-dot-error';
    return 'status-dot status-dot-inactive';
  };

  const getStatusBadgeClass = (status: string) => {
    if (status === 'active') return 'badge badge-success';
    if (status === 'paused') return 'badge badge-warning';
    if (status === 'error') return 'badge badge-error';
    return 'badge';
  };

  const getAvatarGradient = (name: string) => {
    const colors = [
      'from-[#06d6a0] to-[#0ea5e9]',
      'from-[#8b5cf6] to-[#06d6a0]',
      'from-[#f59e0b] to-[#ef4444]',
      'from-[#0ea5e9] to-[#8b5cf6]',
    ];
    return colors[name.charCodeAt(0) % colors.length];
  };

  return (
    <div className="flex h-full">
      {/* 左侧列表面板 */}
      <div className="w-80 border-r border-[var(--color-border)] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Digital Humans</h2>
          <button
            onClick={() => setIsCreating(true)}
            className="btn btn-primary p-1.5"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* 创建表单 */}
        {isCreating && (
          <div className="p-4 border-b border-[var(--color-border)] animate-fadeIn">
            <div className="card p-4 flex flex-col gap-2">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Name"
                className="input"
              />
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Description"
                className="input"
              />
              <textarea
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                placeholder="Prompt / Instructions"
                rows={3}
                className="input"
                style={{ resize: 'none' }}
              />
              <input
                value={form.schedule}
                onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                placeholder="Cron (e.g. 0 * * * *)"
                className="input"
              />
              <div className="flex gap-2 mt-1">
                <button onClick={handleCreate} className="btn btn-primary flex-1 text-xs py-1.5">Create</button>
                <button onClick={() => setIsCreating(false)} className="btn btn-ghost flex-1 text-xs py-1.5">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Digital Human 列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {digitalHumans.map((dh, index) => (
            <div
              key={dh.id}
              onClick={() => handleSelect(dh)}
              className={`group card cursor-pointer transition-all animate-fadeInUp ${
                selectedDH?.id === dh.id
                  ? 'border-[var(--color-border-accent)] bg-[var(--color-bg-tertiary)]'
                  : 'hover:border-[var(--color-border-accent)]'
              } p-3`}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-center gap-2.5">
                {/* 头像 */}
                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${getAvatarGradient(dh.name)} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                  {dh.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={getStatusDotClass(dh.status)} />
                    <span className="truncate text-sm font-medium text-[var(--color-text)]">{dh.name}</span>
                  </div>
                  <p className="text-xs truncate mt-0.5 text-[var(--color-text-muted)]">
                    {dh.description || 'No description'}
                  </p>
                </div>
                {/* 操作按钮（hover 时显示） */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleStatus(dh); }}
                    className="btn btn-ghost p-1"
                  >
                    {dh.status === 'active' ? <Pause size={11} /> : <Play size={11} />}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(dh.id); }}
                    className="btn btn-danger p-1"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {digitalHumans.length === 0 && !isCreating && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <User size={36} className="mb-3 text-[var(--color-text-muted)] opacity-30" />
              <p className="text-sm text-[var(--color-text-muted)]">No digital humans configured.</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1 opacity-60">Click + to create one</p>
            </div>
          )}
        </div>
      </div>

      {/* 右侧详情面板 */}
      <div className="flex-1 overflow-y-auto">
        {selectedDH ? (
          <div className="p-6 space-y-5 animate-fadeIn">
            {/* 详情头部 */}
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${getAvatarGradient(selectedDH.name)} flex items-center justify-center text-white text-xl font-bold`}>
                {selectedDH.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--color-text)]">{selectedDH.name}</h3>
                <p className="text-sm text-[var(--color-text-secondary)]">{selectedDH.description}</p>
              </div>
              <div className="ml-auto">
                <span className={getStatusBadgeClass(selectedDH.status)}>{selectedDH.status}</span>
              </div>
            </div>

            {/* 统计信息卡片 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="card p-3">
                <span className="text-xs text-[var(--color-text-muted)]">Status</span>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={getStatusDotClass(selectedDH.status)} />
                  <p className="text-sm font-medium text-[var(--color-text)] capitalize">{selectedDH.status}</p>
                </div>
              </div>
              <div className="card p-3">
                <span className="text-xs text-[var(--color-text-muted)]">Schedule</span>
                <p className="text-sm font-mono mt-1 text-[var(--color-text)]">{selectedDH.schedule}</p>
              </div>
              <div className="card p-3">
                <span className="text-xs text-[var(--color-text-muted)]">Last Run</span>
                <p className="text-xs mt-1 text-[var(--color-text)]">
                  {selectedDH.lastRunAt ? new Date(selectedDH.lastRunAt).toLocaleString() : 'Never'}
                </p>
              </div>
            </div>

            {/* 活动日志 */}
            <div className="card-glow p-4">
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2 text-[var(--color-text)]">
                <Activity size={14} className="text-[var(--color-primary)]" />
                Activity Log
              </h4>
              {activities.length > 0 ? (
                <div className="relative space-y-1 pl-4">
                  {/* 时间轴连接线 */}
                  <div className="absolute left-1.5 top-2 bottom-2 w-px bg-[var(--color-border)]" />
                  {activities.map((act) => (
                    <div key={act.id} className="relative flex items-start gap-3 py-2">
                      {/* 时间轴节点 */}
                      <span
                        className={`absolute -left-2.5 mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                          act.outcome === 'success' ? 'bg-[#22c55e]' :
                          act.outcome === 'error' ? 'bg-[#ef4444]' : 'bg-[var(--color-text-muted)]'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] text-[var(--color-text-muted)]">
                            {new Date(act.timestamp).toLocaleString()}
                          </span>
                          <span className={`badge text-[10px] ${act.outcome === 'success' ? 'badge-success' : act.outcome === 'error' ? 'badge-error' : ''}`}>
                            {act.outcome}
                          </span>
                          <span className="text-[11px] text-[var(--color-text-muted)] ml-auto">{act.durationMs}ms</span>
                        </div>
                        {(act.output || act.error) && (
                          <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 truncate">
                            {act.output || act.error}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Clock size={28} className="mb-2 text-[var(--color-text-muted)] opacity-30" />
                  <p className="text-sm text-[var(--color-text-muted)]">No activity yet</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center animate-fadeIn">
              <div className="w-16 h-16 rounded-full bg-[var(--color-bg-tertiary)] flex items-center justify-center mx-auto mb-4">
                <User size={32} className="text-[var(--color-text-muted)] opacity-40" />
              </div>
              <p className="text-[var(--color-text-muted)]">Select a digital human to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
