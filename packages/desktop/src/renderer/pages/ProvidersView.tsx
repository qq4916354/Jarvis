import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Check, X } from 'lucide-react';
import { api } from '../api';

interface ProviderModel {
  id: string;
  name: string;
  maxTokens?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
}

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  models: ProviderModel[];
}

export function ProvidersView() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ apiKey: string; baseUrl: string; enabled: boolean }>({ apiKey: '', baseUrl: '', enabled: false });
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    const list = await api.providers.list();
    setProviders(list);
  };

  const startEdit = (provider: Provider) => {
    setEditingId(provider.id);
    setEditForm({ apiKey: provider.apiKey, baseUrl: provider.baseUrl, enabled: provider.enabled });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await api.providers.update(editingId, editForm);
    setEditingId(null);
    loadProviders();
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* 页面标题 */}
      <div className="mb-8 animate-fadeInUp">
        <h2 className="text-2xl font-bold text-gradient mb-1">AI Providers</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Configure your AI provider API keys and settings.
        </p>
      </div>

      <div className="space-y-4">
        {providers.map((provider, idx) => (
          <div
            key={provider.id}
            className="card-glow animate-fadeInUp overflow-hidden"
            style={{ animationDelay: `${idx * 0.06}s` }}
          >
            {/* Provider 标题栏 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
              <div className="flex items-center gap-3">
                <span className={`status-dot ${provider.enabled ? 'active' : 'disabled'}`} />
                <h3 className="font-semibold">{provider.name}</h3>
                <span className="text-xs font-mono text-[var(--color-text-muted)]">
                  {provider.id}
                </span>
              </div>

              {editingId === provider.id ? (
                <div className="flex gap-2">
                  {/* 保存按钮：用 Tailwind hover 类替代 JS hover 事件 */}
                  <button
                    onClick={saveEdit}
                    className="p-1.5 rounded-lg transition-colors bg-[rgba(6,214,160,0.1)] text-[var(--color-primary)] hover:bg-[rgba(6,214,160,0.2)]"
                  >
                    <Check size={14} />
                  </button>
                  {/* 取消按钮：用 Tailwind hover 类替代 JS hover 事件 */}
                  <button
                    onClick={cancelEdit}
                    className="p-1.5 rounded-lg transition-colors bg-[rgba(239,68,68,0.1)] text-[var(--color-error)] hover:bg-[rgba(239,68,68,0.2)]"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => startEdit(provider)}
                  className="btn btn-ghost text-xs px-3 py-1"
                >
                  Edit
                </button>
              )}
            </div>

            {/* Provider 内容区 */}
            <div className="p-5 space-y-4">
              {editingId === provider.id ? (
                <>
                  <div>
                    <label className="block text-xs mb-1 text-[var(--color-text-muted)]">
                      API Key
                    </label>
                    <input
                      type="password"
                      value={editForm.apiKey}
                      onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                      className="input w-full"
                      placeholder="sk-..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1 text-[var(--color-text-muted)]">
                      Base URL
                    </label>
                    <input
                      value={editForm.baseUrl}
                      onChange={(e) => setEditForm({ ...editForm, baseUrl: e.target.value })}
                      className="input w-full"
                    />
                  </div>
                  {/* 启用/禁用 Toggle：使用 global.css 的 .toggle 和 .toggle.active */}
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <div
                      className={`toggle${editForm.enabled ? ' active' : ''}`}
                      onClick={() => setEditForm({ ...editForm, enabled: !editForm.enabled })}
                    />
                    <span className="text-sm">Enabled</span>
                  </label>
                </>
              ) : (
                <>
                  {/* API Key 显示行 */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--color-text-muted)]">API Key:</span>
                    <span className="text-sm font-mono text-[var(--color-text-secondary)]" style={{ letterSpacing: '0.05em' }}>
                      {showApiKey[provider.id]
                        ? provider.apiKey || '(not set)'
                        : provider.apiKey ? '••••••••' + provider.apiKey.slice(-4) : '(not set)'}
                    </span>
                    {/* 眼睛按钮：用 Tailwind hover 类替代 JS hover 事件 */}
                    <button
                      onClick={() => setShowApiKey({ ...showApiKey, [provider.id]: !showApiKey[provider.id] })}
                      className="p-0.5 rounded transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    >
                      {showApiKey[provider.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>

                  {/* Base URL 显示行 */}
                  <div>
                    <span className="text-xs text-[var(--color-text-muted)]">Base URL: </span>
                    <span className="text-sm font-mono text-[var(--color-text-secondary)]">
                      {provider.baseUrl}
                    </span>
                  </div>
                </>
              )}

              {/* 模型列表 */}
              <div>
                <span className="block text-xs mb-2 text-[var(--color-text-muted)]">
                  Models
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {provider.models.map((model) => (
                    <span key={model.id} className="badge badge-primary">
                      {model.name}
                    </span>
                  ))}
                  {provider.models.length === 0 && (
                    <span className="text-xs text-[var(--color-text-muted)]">
                      No models listed
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}

        {providers.length === 0 && (
          <p className="text-sm text-center py-12 animate-fadeIn text-[var(--color-text-muted)]">
            No providers found.
          </p>
        )}
      </div>
    </div>
  );
}
