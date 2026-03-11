import React, { useEffect, useState } from 'react';
import { Plus, Play, Pause, Trash2, Clock, AlertCircle, Activity } from 'lucide-react';
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

  const statusColors: Record<string, string> = {
    active: 'text-green-500',
    paused: 'text-yellow-500',
    error: 'text-red-500',
    disabled: 'text-[var(--color-text-muted)]',
  };

  return (
    <div className="flex h-full">
      {/* List */}
      <div className="w-80 border-r border-[var(--color-border)] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold">Digital Humans</h2>
          <button
            onClick={() => setIsCreating(true)}
            className="p-1.5 rounded-lg bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]"
          >
            <Plus size={14} />
          </button>
        </div>

        {isCreating && (
          <div className="p-4 border-b border-[var(--color-border)] space-y-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Name"
              className="w-full px-3 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Description"
              className="w-full px-3 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
            <textarea
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              placeholder="Prompt / Instructions"
              rows={3}
              className="w-full px-3 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] resize-none"
            />
            <input
              value={form.schedule}
              onChange={(e) => setForm({ ...form, schedule: e.target.value })}
              placeholder="Cron (e.g. 0 * * * *)"
              className="w-full px-3 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
            <div className="flex gap-2">
              <button onClick={handleCreate} className="flex-1 py-1.5 text-xs rounded bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]">Create</button>
              <button onClick={() => setIsCreating(false)} className="flex-1 py-1.5 text-xs rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {digitalHumans.map((dh) => (
            <div
              key={dh.id}
              onClick={() => handleSelect(dh)}
              className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer text-sm transition-colors ${
                selectedDH?.id === dh.id
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text)]'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${dh.status === 'active' ? 'bg-green-500' : dh.status === 'paused' ? 'bg-yellow-500' : dh.status === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} />
                  <span className="truncate font-medium">{dh.name}</span>
                </div>
                <p className={`text-xs truncate mt-0.5 ${selectedDH?.id === dh.id ? 'text-white/70' : 'text-[var(--color-text-muted)]'}`}>
                  {dh.description}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <button onClick={(e) => { e.stopPropagation(); handleToggleStatus(dh); }} className="p-1 rounded hover:bg-white/20">
                  {dh.status === 'active' ? <Pause size={12} /> : <Play size={12} />}
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(dh.id); }} className="p-1 rounded hover:bg-white/20">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
          {digitalHumans.length === 0 && !isCreating && (
            <p className="text-xs text-[var(--color-text-muted)] text-center py-8">
              No digital humans configured.
            </p>
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto">
        {selectedDH ? (
          <div className="p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold">{selectedDH.name}</h3>
              <p className="text-sm text-[var(--color-text-secondary)] mt-1">{selectedDH.description}</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 rounded-lg bg-[var(--color-bg-secondary)]">
                <span className="text-xs text-[var(--color-text-muted)]">Status</span>
                <p className={`text-sm font-medium mt-0.5 ${statusColors[selectedDH.status]}`}>{selectedDH.status}</p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--color-bg-secondary)]">
                <span className="text-xs text-[var(--color-text-muted)]">Schedule</span>
                <p className="text-sm font-mono mt-0.5">{selectedDH.schedule}</p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--color-bg-secondary)]">
                <span className="text-xs text-[var(--color-text-muted)]">Last Run</span>
                <p className="text-sm mt-0.5">{selectedDH.lastRunAt ? new Date(selectedDH.lastRunAt).toLocaleString() : 'Never'}</p>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Activity size={14} /> Activity Log
              </h4>
              <div className="space-y-1">
                {activities.map((act) => (
                  <div key={act.id} className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--color-bg-secondary)] text-xs">
                    <span className={`w-2 h-2 rounded-full ${act.outcome === 'success' ? 'bg-green-500' : act.outcome === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} />
                    <span className="text-[var(--color-text-muted)]">{new Date(act.timestamp).toLocaleString()}</span>
                    <span className="flex-1 truncate">{act.output || act.error || act.outcome}</span>
                    <span className="text-[var(--color-text-muted)]">{act.durationMs}ms</span>
                  </div>
                ))}
                {activities.length === 0 && (
                  <p className="text-xs text-[var(--color-text-muted)] py-4 text-center">No activity yet</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
            <div className="text-center">
              <Clock size={48} className="mx-auto mb-4 opacity-30" />
              <p>Select a digital human to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
