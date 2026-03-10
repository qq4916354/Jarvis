import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceManager } from './workspace-manager';

describe('WorkspaceManager', () => {
  let tmpDir: string;
  let mgr: WorkspaceManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-workspace-test-'));
    mgr = new WorkspaceManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a workspace with default files', async () => {
      const ws = await mgr.create({ name: 'Test Workspace' });

      expect(ws.config.name).toBe('Test Workspace');
      expect(ws.config.id).toBeTruthy();
      expect(ws.config.createdAt).toBeGreaterThan(0);
      expect(ws.path).toBe(path.join(tmpDir, ws.config.id));

      // Verify directory structure
      expect(fs.existsSync(path.join(ws.path, 'config.json'))).toBe(true);
      expect(fs.existsSync(path.join(ws.path, 'soul.md'))).toBe(true);
      expect(fs.existsSync(path.join(ws.path, 'agent.md'))).toBe(true);
      expect(fs.existsSync(path.join(ws.path, 'user.md'))).toBe(true);
      expect(fs.existsSync(path.join(ws.path, 'tools'))).toBe(true);
      expect(fs.existsSync(path.join(ws.path, 'memory'))).toBe(true);
      expect(fs.existsSync(path.join(ws.path, 'history'))).toBe(true);
    });

    it('should use provided description and settings', async () => {
      const ws = await mgr.create({
        name: 'Dev',
        description: 'Development workspace',
        settings: { model: 'gpt-4o', shortTermMemoryLimit: 100 },
      });

      expect(ws.config.description).toBe('Development workspace');
      expect(ws.config.settings?.model).toBe('gpt-4o');
      expect(ws.config.settings?.shortTermMemoryLimit).toBe(100);
    });

    it('should create soul.md with default content', async () => {
      const ws = await mgr.create({ name: 'Test' });
      const soul = fs.readFileSync(path.join(ws.path, 'soul.md'), 'utf-8');
      expect(soul).toContain('# Soul');
      expect(soul).toContain('Jarvis');
    });
  });

  describe('get', () => {
    it('should return workspace by id', async () => {
      const ws = await mgr.create({ name: 'Test' });
      const found = await mgr.get(ws.config.id);

      expect(found).not.toBeNull();
      expect(found!.config.name).toBe('Test');
      expect(found!.path).toBe(ws.path);
    });

    it('should return null for non-existent workspace', async () => {
      const found = await mgr.get('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('list', () => {
    it('should list all workspaces', async () => {
      await mgr.create({ name: 'First' });
      await mgr.create({ name: 'Second' });
      await mgr.create({ name: 'Third' });

      const list = await mgr.list();
      expect(list).toHaveLength(3);
      const names = list.map(w => w.config.name);
      expect(names).toContain('First');
      expect(names).toContain('Second');
      expect(names).toContain('Third');
    });

    it('should return empty array when no workspaces', async () => {
      const list = await mgr.list();
      expect(list).toEqual([]);
    });

    it('should skip directories without config.json', async () => {
      await mgr.create({ name: 'Valid' });
      // Create a directory without config
      fs.mkdirSync(path.join(tmpDir, 'invalid-workspace'), { recursive: true });

      const list = await mgr.list();
      expect(list).toHaveLength(1);
      expect(list[0].config.name).toBe('Valid');
    });
  });

  describe('update', () => {
    it('should update workspace name', async () => {
      const ws = await mgr.create({ name: 'Original' });
      const updated = await mgr.update(ws.config.id, { name: 'Updated' });

      expect(updated).not.toBeNull();
      expect(updated!.config.name).toBe('Updated');
      expect(updated!.config.updatedAt).toBeGreaterThanOrEqual(ws.config.createdAt);
    });

    it('should update workspace description', async () => {
      const ws = await mgr.create({ name: 'Test' });
      const updated = await mgr.update(ws.config.id, { description: 'New description' });

      expect(updated!.config.description).toBe('New description');
    });

    it('should merge settings', async () => {
      const ws = await mgr.create({
        name: 'Test',
        settings: { model: 'gpt-4', shortTermMemoryLimit: 50 },
      });

      const updated = await mgr.update(ws.config.id, {
        settings: { model: 'gpt-4o' },
      });

      expect(updated!.config.settings?.model).toBe('gpt-4o');
      expect(updated!.config.settings?.shortTermMemoryLimit).toBe(50);
    });

    it('should return null for non-existent workspace', async () => {
      const result = await mgr.update('non-existent', { name: 'test' });
      expect(result).toBeNull();
    });

    it('should persist updates to disk', async () => {
      const ws = await mgr.create({ name: 'Original' });
      await mgr.update(ws.config.id, { name: 'Persisted' });

      // Reload from disk
      const retrieved = await mgr.get(ws.config.id);
      expect(retrieved!.config.name).toBe('Persisted');
    });
  });

  describe('delete', () => {
    it('should delete workspace and all files', async () => {
      const ws = await mgr.create({ name: 'ToDelete' });
      const result = await mgr.delete(ws.config.id);

      expect(result).toBe(true);
      expect(fs.existsSync(ws.path)).toBe(false);
    });

    it('should return false for non-existent workspace', async () => {
      const result = await mgr.delete('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getWorkspacePath', () => {
    it('should return the expected path', () => {
      const p = mgr.getWorkspacePath('my-id');
      expect(p).toBe(path.join(tmpDir, 'my-id'));
    });
  });
});
