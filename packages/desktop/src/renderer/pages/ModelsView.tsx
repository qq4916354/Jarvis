import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save, Check } from 'lucide-react';
import { useWorkspaceStore } from '../stores/workspace-store';
import { api } from '../api';

interface ModelEntry {
  purpose: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

const MODEL_PURPOSES = [
  { value: 'chat', label: 'Chat / Conversation', description: 'Main conversation model', icon: '💬' },
  { value: 'task', label: 'Task Execution', description: 'Complex task processing', icon: '⚡' },
  { value: 'heartbeat', label: 'Heartbeat / Check-in', description: 'Periodic health and status checks', icon: '💓' },
  { value: 'image', label: 'Image Generation', description: 'Generate images from text', icon: '🎨' },
  { value: 'video', label: 'Video Generation', description: 'Generate videos from text', icon: '🎬' },
  { value: 'code', label: 'Code Generation', description: 'Code writing and analysis', icon: '🖥' },
];

const PURPOSE_ICON: Record<string, string> = {
  chat: '💬',
  task: '⚡',
  heartbeat: '💓',
  image: '🎨',
  video: '🎬',
  code: '🖥',
};

export function ModelsView() {
  const { activeWorkspace } = useWorkspaceStore();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [globalApiKey, setGlobalApiKey] = useState('');
  const [globalBaseUrl, setGlobalBaseUrl] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (activeWorkspace) {
      loadModels();
    }
  }, [activeWorkspace?.id]);

  const loadModels = async () => {
    if (!activeWorkspace) return;
    try {
      const config = await api.models.getConfig(activeWorkspace.id);
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
    } catch { /* 首次加载，尚未配置 */ }
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

    await api.models.setConfig(activeWorkspace.id, config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!activeWorkspace) return null;

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl mx-auto">
      {/* 页面标题 */}
      <div className="mb-8 animate-fadeInUp">
        <h2 className="text-2xl font-bold text-gradient mb-1">Model Configuration</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Assign AI models to specific purposes for this workspace
        </p>
      </div>

      {/* 全局 API 设置 */}
      <section
        className="mb-8 animate-fadeInUp glass border border-[var(--color-border-accent)] rounded-[var(--radius-lg)] p-5"
        style={{ animationDelay: '0.05s' }}
      >
        <h3 className="text-sm font-semibold mb-4 text-[var(--color-primary)]">
          Global API Settings
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1 text-[var(--color-text-muted)]">
              Base URL (OpenAI Compatible)
            </label>
            <input
              value={globalBaseUrl}
              onChange={(e) => setGlobalBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs mb-1 text-[var(--color-text-muted)]">
              API Key
            </label>
            <input
              type="password"
              value={globalApiKey}
              onChange={(e) => setGlobalApiKey(e.target.value)}
              placeholder="sk-..."
              className="input w-full"
            />
          </div>
        </div>
      </section>

      {/* 按用途配置模型 */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-4 animate-fadeInUp" style={{ animationDelay: '0.1s' }}>
          <h3 className="text-sm font-semibold">Models by Purpose</h3>
          <button onClick={addModel} className="btn btn-ghost gap-1.5">
            <Plus size={14} /> Add Model
          </button>
        </div>

        <div className="space-y-3">
          {models.map((m, i) => (
            <div
              key={i}
              className="card-glow p-4 animate-fadeInUp"
              style={{ animationDelay: `${0.15 + i * 0.05}s` }}
            >
              <div className="flex items-start gap-3">
                {/* 用途图标 */}
                <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center text-lg rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
                  {PURPOSE_ICON[m.purpose] || '🤖'}
                </div>

                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs mb-1 text-[var(--color-text-muted)]">
                      Purpose
                    </label>
                    <select
                      value={m.purpose}
                      onChange={(e) => updateModel(i, 'purpose', e.target.value)}
                      className="input w-full"
                    >
                      {MODEL_PURPOSES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.icon} {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs mb-1 text-[var(--color-text-muted)]">
                      Model Name
                    </label>
                    <input
                      value={m.model}
                      onChange={(e) => updateModel(i, 'model', e.target.value)}
                      placeholder="gpt-4o / claude-sonnet-4-20250514 / ..."
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1 text-[var(--color-text-muted)]">
                      Base URL (override)
                    </label>
                    <input
                      value={m.baseUrl}
                      onChange={(e) => updateModel(i, 'baseUrl', e.target.value)}
                      placeholder="Use global if empty"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1 text-[var(--color-text-muted)]">
                      API Key (override)
                    </label>
                    <input
                      type="password"
                      value={m.apiKey}
                      onChange={(e) => updateModel(i, 'apiKey', e.target.value)}
                      placeholder="Use global if empty"
                      className="input w-full"
                    />
                  </div>
                </div>

                {/* 删除按钮：用 Tailwind hover 类替代 JS hover 事件 */}
                <button
                  onClick={() => removeModel(i)}
                  className="p-2 rounded-lg transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-error)]"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}

          {models.length === 0 && (
            <p className="text-sm text-center py-10 animate-fadeIn text-[var(--color-text-muted)]">
              No models configured. Click "Add Model" to set up model assignments.
            </p>
          )}
        </div>
      </section>

      {/* 保存按钮 */}
      <button
        onClick={handleSave}
        className="btn btn-primary gap-2 px-6 py-2.5 animate-fadeInUp"
        style={{ animationDelay: '0.2s' }}
      >
        {saved ? (
          <>
            <Check size={16} />
            Saved!
          </>
        ) : (
          <>
            <Save size={16} />
            Save Configuration
          </>
        )}
      </button>
    </div>
  );
}
