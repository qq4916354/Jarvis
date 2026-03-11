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
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h2 className="text-lg font-semibold">AI Providers</h2>
      <p className="text-sm text-[var(--color-text-secondary)]">
        Configure your AI provider API keys and settings.
      </p>

      <div className="space-y-4">
        {providers.map((provider) => (
          <div key={provider.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full ${provider.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                <h3 className="font-medium">{provider.name}</h3>
                <span className="text-xs text-[var(--color-text-muted)] font-mono">{provider.id}</span>
              </div>
              {editingId === provider.id ? (
                <div className="flex gap-2">
                  <button onClick={saveEdit} className="p-1.5 rounded bg-green-500/10 text-green-500 hover:bg-green-500/20"><Check size={14} /></button>
                  <button onClick={cancelEdit} className="p-1.5 rounded bg-red-500/10 text-red-500 hover:bg-red-500/20"><X size={14} /></button>
                </div>
              ) : (
                <button onClick={() => startEdit(provider)} className="px-3 py-1 text-xs rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg)] text-[var(--color-text-secondary)]">
                  Edit
                </button>
              )}
            </div>

            <div className="p-4 space-y-3">
              {editingId === provider.id ? (
                <>
                  <div>
                    <label className="text-xs text-[var(--color-text-muted)] block mb-1">API Key</label>
                    <input
                      type="password"
                      value={editForm.apiKey}
                      onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                      placeholder="sk-..."
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--color-text-muted)] block mb-1">Base URL</label>
                    <input
                      value={editForm.baseUrl}
                      onChange={(e) => setEditForm({ ...editForm, baseUrl: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editForm.enabled}
                      onChange={(e) => setEditForm({ ...editForm, enabled: e.target.checked })}
                      className="rounded"
                    />
                    Enabled
                  </label>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--color-text-muted)]">API Key:</span>
                    <span className="text-sm font-mono">
                      {showApiKey[provider.id]
                        ? provider.apiKey || '(not set)'
                        : provider.apiKey ? '••••••••' + provider.apiKey.slice(-4) : '(not set)'}
                    </span>
                    <button onClick={() => setShowApiKey({ ...showApiKey, [provider.id]: !showApiKey[provider.id] })} className="p-0.5">
                      {showApiKey[provider.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--color-text-muted)]">Base URL: </span>
                    <span className="text-sm font-mono">{provider.baseUrl}</span>
                  </div>
                </>
              )}

              <div>
                <span className="text-xs text-[var(--color-text-muted)] block mb-1">Models</span>
                <div className="flex flex-wrap gap-1.5">
                  {provider.models.map((model) => (
                    <span key={model.id} className="px-2 py-0.5 text-xs rounded-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
                      {model.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
