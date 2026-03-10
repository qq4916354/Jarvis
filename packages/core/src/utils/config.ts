// ============================================================================
// Config - File-backed configuration manager for Jarvis
// ============================================================================

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { JarvisConfig, MemoryConfig, SchedulerConfig } from '../types.js';
import { createLogger } from './logger.js';

const logger = createLogger('Config');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const JARVIS_HOME = path.join(os.homedir(), '.jarvis');
const CONFIG_PATH = path.join(JARVIS_HOME, 'config.json');
const DATA_DIR = path.join(JARVIS_HOME, 'data');

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MEMORY: MemoryConfig = {
  shortTermMaxMessages: 50,
  longTermEnabled: true,
  episodicEnabled: true,
};

const DEFAULT_SCHEDULER: SchedulerConfig = {
  maxConcurrentTasks: 5,
  defaultTimeoutMs: 60_000,
};

function createDefaultConfig(): JarvisConfig {
  return {
    version: '0.1.0',
    dataDir: DATA_DIR,
    logLevel: 'info',
    models: [],
    scheduler: { ...DEFAULT_SCHEDULER },
    defaultMemory: { ...DEFAULT_MEMORY },
    workspaces: [],
  };
}

// ---------------------------------------------------------------------------
// ConfigManager
// ---------------------------------------------------------------------------

/**
 * Manages reading, writing, and live access to the Jarvis global configuration
 * file at `~/.jarvis/config.json`.
 *
 * The manager keeps an in-memory copy of the config and persists changes to
 * disk on every `set()` / `save()` call.
 */
class ConfigManager {
  private config: JarvisConfig;
  private readonly configPath: string;

  constructor(configPath: string = CONFIG_PATH) {
    this.configPath = configPath;
    this.ensureDirectories();
    this.config = this.load();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Return the full config object (shallow-frozen to discourage direct mutation).
   */
  getAll(): Readonly<JarvisConfig> {
    return this.config;
  }

  /**
   * Read a top-level config value by key.
   */
  get<K extends keyof JarvisConfig>(key: K): JarvisConfig[K] {
    return this.config[key];
  }

  /**
   * Set a top-level config value and persist to disk.
   */
  set<K extends keyof JarvisConfig>(key: K, value: JarvisConfig[K]): void {
    this.config[key] = value;
    this.save();
  }

  /**
   * Merge a partial config object into the current config and persist.
   */
  update(partial: Partial<JarvisConfig>): void {
    this.config = { ...this.config, ...partial };
    this.save();
  }

  /**
   * Reset configuration to defaults and persist.
   */
  reset(): void {
    this.config = createDefaultConfig();
    this.save();
    logger.info('Configuration reset to defaults');
  }

  /**
   * Persist the current in-memory config to disk.
   */
  save(): void {
    try {
      const json = JSON.stringify(this.config, null, 2);
      fs.writeFileSync(this.configPath, json, 'utf-8');
      logger.debug('Configuration saved', { path: this.configPath });
    } catch (err) {
      logger.error('Failed to save configuration', { error: err });
      throw err;
    }
  }

  /**
   * Reload configuration from disk, merging with defaults for any missing keys.
   */
  reload(): JarvisConfig {
    this.config = this.load();
    logger.info('Configuration reloaded');
    return this.config;
  }

  /**
   * Return the resolved path to the data directory, ensuring it exists.
   */
  getDataDir(): string {
    const dir = this.config.dataDir;
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Convenience accessor: path to the workspaces subdirectory.
   */
  get workspacesDir(): string {
    const dir = path.join(this.config.dataDir, 'workspaces');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Convenience accessor: default short-term memory message limit.
   */
  get defaultShortTermMemoryLimit(): number {
    return this.config.defaultMemory.shortTermMaxMessages;
  }

  /**
   * Convenience accessor: default model name.
   */
  get defaultModel(): string {
    const chatModel = this.config.models.find(m => m.purpose === 'chat');
    return chatModel?.modelName ?? 'claude-sonnet-4-20250514';
  }

  /**
   * Return the path to the config file on disk.
   */
  getConfigPath(): string {
    return this.configPath;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Ensure the ~/.jarvis and ~/.jarvis/data directories exist.
   */
  private ensureDirectories(): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  /**
   * Load config from disk, falling back to defaults for missing fields.
   */
  private load(): JarvisConfig {
    const defaults = createDefaultConfig();

    if (!fs.existsSync(this.configPath)) {
      logger.info('No config file found, creating with defaults', { path: this.configPath });
      this.config = defaults;
      this.save();
      return defaults;
    }

    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<JarvisConfig>;

      // Merge: disk values override defaults, but defaults fill in any gaps.
      const merged: JarvisConfig = {
        ...defaults,
        ...parsed,
        scheduler: { ...defaults.scheduler, ...parsed.scheduler },
        defaultMemory: { ...defaults.defaultMemory, ...parsed.defaultMemory },
      };

      return merged;
    } catch (err) {
      logger.warn('Failed to parse config file, using defaults', { error: err });
      return defaults;
    }
  }
}

/** Singleton configuration manager. */
const configManager = new ConfigManager();

export { ConfigManager, CONFIG_PATH, DATA_DIR, JARVIS_HOME };
export default configManager;
