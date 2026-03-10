import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from './config';

describe('ConfigManager', () => {
  let tmpDir: string;
  let configPath: string;
  let mgr: ConfigManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-config-test-'));
    configPath = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function create() {
    mgr = new ConfigManager(configPath);
    return mgr;
  }

  it('should create config file with defaults if none exists', () => {
    create();
    expect(fs.existsSync(configPath)).toBe(true);
    const config = mgr.getAll();
    expect(config.version).toBe('0.1.0');
    expect(config.logLevel).toBe('info');
    expect(config.models).toEqual([]);
    expect(config.workspaces).toEqual([]);
  });

  it('should get individual config values', () => {
    create();
    expect(mgr.get('version')).toBe('0.1.0');
    expect(mgr.get('logLevel')).toBe('info');
  });

  it('should set and persist config values', () => {
    create();
    mgr.set('logLevel', 'debug');
    expect(mgr.get('logLevel')).toBe('debug');

    // Verify persisted
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(raw.logLevel).toBe('debug');
  });

  it('should update with partial config', () => {
    create();
    mgr.update({ logLevel: 'warn', version: '0.2.0' });
    expect(mgr.get('logLevel')).toBe('warn');
    expect(mgr.get('version')).toBe('0.2.0');
  });

  it('should reset to defaults', () => {
    create();
    mgr.set('logLevel', 'debug');
    mgr.reset();
    expect(mgr.get('logLevel')).toBe('info');
  });

  it('should reload config from disk', () => {
    create();
    // Modify file externally
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.logLevel = 'error';
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf-8');

    mgr.reload();
    expect(mgr.get('logLevel')).toBe('error');
  });

  it('should merge with defaults on load (missing fields)', () => {
    // Write a partial config
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ version: '1.0.0' }), 'utf-8');

    create();
    expect(mgr.get('version')).toBe('1.0.0');
    expect(mgr.get('logLevel')).toBe('info'); // default
    expect(mgr.get('scheduler').maxConcurrentTasks).toBe(5);
  });

  it('should handle corrupt config file gracefully', () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'invalid json{{{', 'utf-8');

    create();
    // Should fall back to defaults
    expect(mgr.get('version')).toBe('0.1.0');
  });

  it('should return config path', () => {
    create();
    expect(mgr.getConfigPath()).toBe(configPath);
  });

  it('should return default model when no chat model configured', () => {
    create();
    expect(mgr.defaultModel).toBe('claude-sonnet-4-20250514');
  });

  it('should return configured chat model', () => {
    create();
    mgr.set('models', [
      {
        provider: 'openai',
        modelName: 'gpt-4o',
        apiKey: 'test',
        purpose: 'chat',
      },
    ]);
    expect(mgr.defaultModel).toBe('gpt-4o');
  });

  it('should return default short term memory limit', () => {
    create();
    expect(mgr.defaultShortTermMemoryLimit).toBe(50);
  });

  it('should return getDataDir and ensure it exists', () => {
    create();
    const dataDir = mgr.getDataDir();
    expect(fs.existsSync(dataDir)).toBe(true);
  });
});
