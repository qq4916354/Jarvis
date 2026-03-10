import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save, TestTube } from 'lucide-react';
import { useWorkspaceStore } from '../stores/workspace-store';

interface ModelEntry {
  purpose: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

const MODEL_PURPOSES = [
  { value: 'chat', label: 'Chat / Conversation', description: 'Main conversation model' },
  { value: 'task', label: 'Task Execution', description: 'Complex task processing' },
  { value: 'heartbeat', label: 'Heartbeat / Check-in', description: 'Periodic health and status checks' },
  { value: 'image', label: 'Image Generation', description: 'Generate images from text' },
  { value: 'video', label: 'Video Generation', description: 'Generate videos from text' },
  { value: 'code', label: 'Code Generation', description: 'Code writing and analysis' },
];

export function ModelsView() {
  const { activeWorkspace } = useWorkspaceStore();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [globalApiKey, setGlobalApiKey] = useState('');
  const [globalBaseUrl, setGlobalBaseUrl] = useState('');

  useEffect(() => {
    if (activeWorkspace) {
      loadModels();
    }
  }, [activeWorkspace?.id]);

  const loadModels = async () => {
    if (!activeWorkspace) return;
    try {
      const config = await window.jarvis.models.getConfig(activeWorkspace.id);
      if (config) {
        const entries = Object.entries(config).map(([purpose, cfg]: [string, any]) => ({
          purpose,
          provider: cfg.provider || '',
          model: cfg.model || '',
          baseUrl: cfg.baseUrl || globalBaseUrl,
          apiKey: cfg.apiKey || globalApiKey,
        }));
        setModels(entries);
      }
    } catch { /* first load, no config yet */ }
  };

  const addModel = () => {
    setModels([
      ...models,
      {
        purpose: 'chat',
        provider: '',
        model: '',
        baseUrl: globalBaseUrl,
        apiKey: globalApiKey,
      },
    ]);
  };

  const removeModel = (index: number) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const updateModel = (index: number, field: keyof ModelEntry, value: string) => {
    const updated = [...models];
    updated[index] = { ...updated[index], [field]: value };
    setModels(updated);
  };

  const handleSave = async () => {
    if (!activeWorkspace) return;

    const config: Record<string, any> = {};
    for (const m of models) {
      config[m.purpose] = {
        provider: m.provider,
        model: m.model,
        baseUrl: m.baseUrl || globalBaseUrl,
        apiKey: m.apiKey || globalApiKey,
      };
    }

    await window.jarvis.models.setConfig(activeWorkspace.id, config);
  };

  if (!activeWorkspace) return null;

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl mx-auto">
      <h2 className="text-xl font-semibold mb-6">Model Configuration</h2>

      {/* Global API Settings */}
      <section className="mb-8 p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
        <h3 className="text-sm font-semibold mb-3">Global API Settings</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">Base URL (OpenAI Compatible)</label>
            <input
              value={globalBaseUrl}
              onChange={(e) => setGlobalBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-muted)] mb-1">API Key</label>
            <input
              type="password"
              value={globalApiKey}
              onChange={(e) => setGlobalApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </div>
        </div>
      </section>

      {/* Per-Purpose Models */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Models by Purpose</h3>
          <button
            onClick={addModel}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--color-bg-tertiary)] text-sm hover:bg-[var(--color-border)] transition-colors"
          >
            <Plus size={14} /> Add Model
          </button>
        </div>

        <div className="space-y-3">
          {models.map((m, i) => (
            <div
              key={i}
              className="p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Purpose</label>
                    <select
                      value={m.purpose}
                      onChange={(e) => updateModel(i, 'purpose', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm outline-none"
                    >
                      {MODEL_PURPOSES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Model Name</label>
                    <input
                      value={m.model}
                      onChange={(e) => updateModel(i, 'model', e.target.value)}
                      placeholder="gpt-4o / claude-sonnet-4-20250514 / ..."
                      className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">Base URL (override)</label>
                    <input
                      value={m.baseUrl}
                      onChange={(e) => updateModel(i, 'baseUrl', e.target.value)}
                      placeholder="Use global if empty"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--color-text-muted)] mb-1">API Key (override)</label>
                    <input
                      type="password"
                      value={m.apiKey}
                      onChange={(e) => updateModel(i, 'apiKey', e.target.value)}
                      placeholder="Use global if empty"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                </div>
                <button
                  onClick={() => removeModel(i)}
                  className="p-2 rounded-lg hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] hover:text-[var(--color-error)]"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}

          {models.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-8">
              No models configured. Click "Add Model" to set up model assignments.
            </p>
          )}
        </div>
      </section>

      <button
        onClick={handleSave}
        className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary-hover)] transition-colors"
      >
        <Save size={16} />
        Save Configuration
      </button>
    </div>
  );
}
