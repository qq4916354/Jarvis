import { EventEmitter } from 'eventemitter3';
import logger from '../utils/logger.js';

export type ProviderId = 'anthropic' | 'openai' | 'deepseek' | 'custom';

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  models: ProviderModel[];
}

export interface ProviderModel {
  id: string;
  name: string;
  maxTokens?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
}

export interface ProviderRegistryEvents {
  'provider:added': (provider: ProviderConfig) => void;
  'provider:updated': (provider: ProviderConfig) => void;
  'provider:removed': (id: ProviderId) => void;
}

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    enabled: false,
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        maxTokens: 8192,
        supportsVision: true,
        supportsTools: true,
      },
      {
        id: 'claude-opus-4-20250514',
        name: 'Claude Opus 4',
        maxTokens: 8192,
        supportsVision: true,
        supportsTools: true,
      },
      {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5',
        maxTokens: 8192,
        supportsVision: true,
        supportsTools: true,
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    enabled: false,
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        maxTokens: 4096,
        supportsVision: true,
        supportsTools: true,
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        maxTokens: 4096,
        supportsVision: true,
        supportsTools: true,
      },
      {
        id: 'o1',
        name: 'o1',
        maxTokens: 4096,
        supportsVision: false,
        supportsTools: false,
      },
      {
        id: 'o3-mini',
        name: 'o3-mini',
        maxTokens: 4096,
        supportsVision: false,
        supportsTools: false,
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    enabled: false,
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        maxTokens: 4096,
        supportsVision: false,
        supportsTools: true,
      },
      {
        id: 'deepseek-coder',
        name: 'DeepSeek Coder',
        maxTokens: 4096,
        supportsVision: false,
        supportsTools: true,
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        maxTokens: 4096,
        supportsVision: false,
        supportsTools: false,
      },
    ],
  },
];

export class ProviderRegistry extends EventEmitter<ProviderRegistryEvents> {
  private providers: Map<ProviderId, ProviderConfig>;

  constructor() {
    super();
    this.providers = new Map();

    for (const provider of DEFAULT_PROVIDERS) {
      this.providers.set(provider.id, structuredClone(provider));
    }

    logger.info(`ProviderRegistry initialized with ${this.providers.size} default providers`);
  }

  addProvider(config: ProviderConfig): void {
    if (this.providers.has(config.id)) {
      logger.warn(`Provider "${config.id}" already exists; use updateProvider() instead`);
      return;
    }

    this.providers.set(config.id, structuredClone(config));
    logger.info(`Provider added: ${config.name} (${config.id})`);
    this.emit('provider:added', this.providers.get(config.id)!);
  }

  updateProvider(id: ProviderId, updates: Partial<ProviderConfig>): void {
    const existing = this.providers.get(id);
    if (!existing) {
      logger.warn(`Cannot update provider "${id}": not found`);
      return;
    }

    const updated: ProviderConfig = {
      ...existing,
      ...updates,
      id, // prevent id from being overwritten
    };

    this.providers.set(id, updated);
    logger.info(`Provider updated: ${updated.name} (${id})`);
    this.emit('provider:updated', updated);
  }

  removeProvider(id: ProviderId): void {
    if (!this.providers.has(id)) {
      logger.warn(`Cannot remove provider "${id}": not found`);
      return;
    }

    this.providers.delete(id);
    logger.info(`Provider removed: ${id}`);
    this.emit('provider:removed', id);
  }

  getProvider(id: ProviderId): ProviderConfig | undefined {
    const provider = this.providers.get(id);
    return provider ? structuredClone(provider) : undefined;
  }

  listProviders(): ProviderConfig[] {
    return Array.from(this.providers.values()).map((p) => structuredClone(p));
  }

  listEnabled(): ProviderConfig[] {
    return Array.from(this.providers.values())
      .filter((p) => p.enabled)
      .map((p) => structuredClone(p));
  }

  getModelsForProvider(id: ProviderId): ProviderModel[] {
    const provider = this.providers.get(id);
    if (!provider) {
      logger.warn(`Cannot get models for provider "${id}": not found`);
      return [];
    }
    return structuredClone(provider.models);
  }

  getAllModels(): Array<ProviderModel & { providerId: ProviderId }> {
    const result: Array<ProviderModel & { providerId: ProviderId }> = [];

    const providers = Array.from(this.providers.values());
    for (const provider of providers) {
      if (!provider.enabled) {
        continue;
      }
      for (const model of provider.models) {
        result.push({ ...model, providerId: provider.id });
      }
    }

    return result;
  }
}
