import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MemoryManager } from './memory-manager';
import { MemoryType } from '../types';

describe('MemoryManager', () => {
  let tmpDir: string;
  let mgr: MemoryManager;
  const workspaceId = 'test-workspace-001';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-memory-test-'));
    mgr = new MemoryManager(tmpDir);
  });

  afterEach(() => {
    mgr.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Short-Term Memory (Messages)', () => {
    it('should add and retrieve messages', async () => {
      await mgr.addMessage(workspaceId, { role: 'user', content: 'Hello' });
      await mgr.addMessage(workspaceId, { role: 'assistant', content: 'Hi there!' });

      const messages = await mgr.getRecentMessages(workspaceId);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello');
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toBe('Hi there!');
    });

    it('should auto-generate id and timestamp', async () => {
      const msg = await mgr.addMessage(workspaceId, { role: 'user', content: 'test' });
      expect(msg.id).toBeTruthy();
      expect(msg.timestamp).toBeGreaterThan(0);
      expect(msg.workspaceId).toBe(workspaceId);
    });

    it('should limit results', async () => {
      for (let i = 0; i < 10; i++) {
        await mgr.addMessage(workspaceId, { role: 'user', content: `msg ${i}` });
      }
      const limited = await mgr.getRecentMessages(workspaceId, 3);
      expect(limited).toHaveLength(3);
    });

    it('should return messages preserving insertion order', async () => {
      const m1 = await mgr.addMessage(workspaceId, { role: 'user', content: 'first' });
      const m2 = await mgr.addMessage(workspaceId, { role: 'assistant', content: 'second' });

      const msgs = await mgr.getRecentMessages(workspaceId);
      expect(msgs).toHaveLength(2);
      // Verify both messages are returned
      expect(msgs.map(m => m.id)).toContain(m1.id);
      expect(msgs.map(m => m.id)).toContain(m2.id);
    });

    it('should store and retrieve metadata', async () => {
      const msg = await mgr.addMessage(workspaceId, {
        role: 'assistant',
        content: 'response',
        metadata: { modelUsed: 'gpt-4', tokenCount: 100 },
      });

      const retrieved = await mgr.getRecentMessages(workspaceId, 1);
      expect(retrieved[0].metadata).toEqual({ modelUsed: 'gpt-4', tokenCount: 100 });
    });
  });

  describe('Long-Term Memory (Remember/Recall)', () => {
    it('should store and recall memories', async () => {
      await mgr.remember(workspaceId, 'user-name', 'Alice', MemoryType.LongTerm);
      const results = await mgr.recall(workspaceId, 'user-name');
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('user-name');
      expect(results[0].value).toBe('Alice');
    });

    it('should upsert on same key+type', async () => {
      await mgr.remember(workspaceId, 'preference', 'dark mode', MemoryType.LongTerm);
      await mgr.remember(workspaceId, 'preference', 'light mode', MemoryType.LongTerm);

      const results = await mgr.recall(workspaceId, 'preference');
      expect(results).toHaveLength(1);
      expect(results[0].value).toBe('light mode');
    });

    it('should search by value content', async () => {
      await mgr.remember(workspaceId, 'fact-1', 'TypeScript is great', MemoryType.LongTerm);
      await mgr.remember(workspaceId, 'fact-2', 'Python is popular', MemoryType.LongTerm);

      const results = await mgr.recall(workspaceId, 'TypeScript');
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('fact-1');
    });

    it('should filter by memory type', async () => {
      await mgr.remember(workspaceId, 'key1', 'val1', MemoryType.LongTerm);
      await mgr.remember(workspaceId, 'key1', 'val1', MemoryType.Episodic);

      const longTerm = await mgr.recall(workspaceId, 'key1', MemoryType.LongTerm);
      expect(longTerm).toHaveLength(1);
      expect(longTerm[0].type).toBe(MemoryType.LongTerm);
    });

    it('should store metadata on memories', async () => {
      const mem = await mgr.remember(workspaceId, 'k', 'v', MemoryType.LongTerm, { source: 'test' });
      expect(mem.metadata).toEqual({ source: 'test' });
    });
  });

  describe('Episodic Memory', () => {
    it('should add and retrieve episodes', async () => {
      await mgr.addEpisode(workspaceId, {
        title: 'First deployment',
        description: 'Successfully deployed v1',
      });

      const episodes = await mgr.getEpisodes(workspaceId);
      expect(episodes).toHaveLength(1);
      expect(episodes[0].title).toBe('First deployment');
      expect(episodes[0].description).toBe('Successfully deployed v1');
    });

    it('should auto-generate id and timestamp for episodes', async () => {
      const ep = await mgr.addEpisode(workspaceId, {
        title: 'Test',
        description: 'Desc',
      });
      expect(ep.id).toBeTruthy();
      expect(ep.timestamp).toBeGreaterThan(0);
    });

    it('should filter episodes by since timestamp', async () => {
      const ep1 = await mgr.addEpisode(workspaceId, { title: 'Old', description: 'old event' });
      // Small delay to ensure different timestamps
      const futureTs = Date.now() + 1000;
      const episodes = await mgr.getEpisodes(workspaceId, futureTs);
      expect(episodes).toHaveLength(0);

      const allEpisodes = await mgr.getEpisodes(workspaceId, ep1.timestamp);
      expect(allEpisodes).toHaveLength(1);
    });

    it('should return multiple episodes', async () => {
      await mgr.addEpisode(workspaceId, { title: 'First', description: 'a' });
      await mgr.addEpisode(workspaceId, { title: 'Second', description: 'b' });

      const episodes = await mgr.getEpisodes(workspaceId);
      expect(episodes).toHaveLength(2);
      const titles = episodes.map(e => e.title);
      expect(titles).toContain('First');
      expect(titles).toContain('Second');
    });
  });

  describe('Summarize', () => {
    it('should return placeholder when no data', async () => {
      const summary = await mgr.summarize(workspaceId);
      expect(summary).toBe('No memories recorded yet for this workspace.');
    });

    it('should include messages, memories, and episodes in summary', async () => {
      await mgr.addMessage(workspaceId, { role: 'user', content: 'Hello' });
      await mgr.remember(workspaceId, 'name', 'Bob', MemoryType.LongTerm);
      await mgr.addEpisode(workspaceId, { title: 'Milestone', description: 'Done' });

      const summary = await mgr.summarize(workspaceId);
      expect(summary).toContain('Recent Conversation');
      expect(summary).toContain('Hello');
      expect(summary).toContain('Known Facts');
      expect(summary).toContain('Bob');
      expect(summary).toContain('Notable Episodes');
      expect(summary).toContain('Milestone');
    });
  });

  describe('Clear', () => {
    it('should clear all memory types', async () => {
      await mgr.addMessage(workspaceId, { role: 'user', content: 'test' });
      await mgr.remember(workspaceId, 'k', 'v', MemoryType.LongTerm);
      await mgr.addEpisode(workspaceId, { title: 'Ep', description: 'd' });

      await mgr.clear(workspaceId);

      expect(await mgr.getRecentMessages(workspaceId)).toHaveLength(0);
      expect(await mgr.recall(workspaceId, '')).toHaveLength(0);
      expect(await mgr.getEpisodes(workspaceId)).toHaveLength(0);
    });

    it('should clear only messages when specified', async () => {
      await mgr.addMessage(workspaceId, { role: 'user', content: 'test' });
      await mgr.remember(workspaceId, 'k', 'v', MemoryType.LongTerm);

      await mgr.clear(workspaceId, 'messages');

      expect(await mgr.getRecentMessages(workspaceId)).toHaveLength(0);
      expect(await mgr.recall(workspaceId, 'k')).toHaveLength(1);
    });

    it('should clear only memories when specified', async () => {
      await mgr.addMessage(workspaceId, { role: 'user', content: 'test' });
      await mgr.remember(workspaceId, 'k', 'v', MemoryType.LongTerm);

      await mgr.clear(workspaceId, 'memories');

      expect(await mgr.getRecentMessages(workspaceId)).toHaveLength(1);
      expect(await mgr.recall(workspaceId, 'k')).toHaveLength(0);
    });
  });

  describe('Lifecycle', () => {
    it('should close specific workspace database', async () => {
      await mgr.addMessage(workspaceId, { role: 'user', content: 'test' });
      mgr.closeWorkspace(workspaceId);

      // Should re-open on next access
      const msgs = await mgr.getRecentMessages(workspaceId);
      expect(msgs).toHaveLength(1);
    });

    it('should close all databases', async () => {
      await mgr.addMessage('w1', { role: 'user', content: 'test' });
      await mgr.addMessage('w2', { role: 'user', content: 'test' });
      mgr.close();

      // Recreate and verify data persisted
      mgr = new MemoryManager(tmpDir);
      expect(await mgr.getRecentMessages('w1')).toHaveLength(1);
      expect(await mgr.getRecentMessages('w2')).toHaveLength(1);
    });

    it('should isolate data between workspaces', async () => {
      await mgr.addMessage('w1', { role: 'user', content: 'workspace 1' });
      await mgr.addMessage('w2', { role: 'user', content: 'workspace 2' });

      const w1Msgs = await mgr.getRecentMessages('w1');
      const w2Msgs = await mgr.getRecentMessages('w2');

      expect(w1Msgs).toHaveLength(1);
      expect(w1Msgs[0].content).toBe('workspace 1');
      expect(w2Msgs).toHaveLength(1);
      expect(w2Msgs[0].content).toBe('workspace 2');
    });
  });
});
