import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Agent } from './agent';

describe('Agent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createWorkspaceFiles(opts?: {
    soul?: string;
    agent?: string;
    user?: string;
  }) {
    if (opts?.soul !== undefined) fs.writeFileSync(path.join(tmpDir, 'soul.md'), opts.soul, 'utf-8');
    if (opts?.agent !== undefined) fs.writeFileSync(path.join(tmpDir, 'agent.md'), opts.agent, 'utf-8');
    if (opts?.user !== undefined) fs.writeFileSync(path.join(tmpDir, 'user.md'), opts.user, 'utf-8');
  }

  describe('constructor', () => {
    it('should set workspaceId and workspacePath', () => {
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });
      expect(agent.workspaceId).toBe('w1');
      expect(agent.workspacePath).toBe(tmpDir);
    });

    it('should default name to Jarvis', () => {
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });
      expect(agent.getName()).toBe('Jarvis');
    });

    it('should accept custom name', () => {
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir, name: 'Friday' });
      expect(agent.getName()).toBe('Friday');
    });

    it('should load persona files on creation', () => {
      createWorkspaceFiles({
        soul: '# My Soul',
        agent: '# My Agent',
        user: '# My User',
      });

      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });
      expect(agent.getSoulContent()).toBe('# My Soul');
      expect(agent.getAgentContent()).toBe('# My Agent');
      expect(agent.getUserContent()).toBe('# My User');
    });

    it('should handle missing persona files gracefully', () => {
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });
      expect(agent.getSoulContent()).toBe('');
      expect(agent.getAgentContent()).toBe('');
      expect(agent.getUserContent()).toBe('');
    });
  });

  describe('buildSystemPrompt', () => {
    it('should return default prompt when no persona files exist', () => {
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });
      const prompt = agent.buildSystemPrompt();
      expect(prompt).toContain('Jarvis');
      expect(prompt).toContain('intelligent AI assistant');
    });

    it('should include soul, agent, and user sections', () => {
      createWorkspaceFiles({
        soul: 'Be creative',
        agent: 'You are a coder',
        user: 'Prefers TypeScript',
      });

      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });
      const prompt = agent.buildSystemPrompt();
      expect(prompt).toContain('## Soul');
      expect(prompt).toContain('Be creative');
      expect(prompt).toContain('## Role & Responsibilities');
      expect(prompt).toContain('You are a coder');
      expect(prompt).toContain('## User Profile');
      expect(prompt).toContain('Prefers TypeScript');
    });

    it('should use custom name in default prompt', () => {
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir, name: 'Friday' });
      const prompt = agent.buildSystemPrompt();
      expect(prompt).toContain('Friday');
    });
  });

  describe('buildMessages', () => {
    it('should prepend system prompt', () => {
      createWorkspaceFiles({ soul: 'Be helpful' });
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });

      const messages = agent.buildMessages([
        { role: 'user', content: 'Hello' },
      ]);

      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toContain('Be helpful');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('Hello');
    });

    it('should include additional context as system message', () => {
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });
      const messages = agent.buildMessages(
        [{ role: 'user', content: 'Hello' }],
        'Extra context here',
      );

      expect(messages).toHaveLength(3);
      expect(messages[1].role).toBe('system');
      expect(messages[1].content).toBe('Extra context here');
    });

    it('should work without additional context', () => {
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });
      const messages = agent.buildMessages([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ]);

      expect(messages).toHaveLength(3); // system + 2 messages
    });
  });

  describe('buildGoalPlanningPrompt', () => {
    it('should include goal in prompt', () => {
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });
      const prompt = agent.buildGoalPlanningPrompt('Build a REST API');
      expect(prompt).toContain('Build a REST API');
      expect(prompt).toContain('**Goal:**');
    });

    it('should include previous actions', () => {
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });
      const prompt = agent.buildGoalPlanningPrompt('Build a REST API', [
        'Created project structure',
        'Defined routes',
      ]);
      expect(prompt).toContain('Previous actions');
      expect(prompt).toContain('1. Created project structure');
      expect(prompt).toContain('2. Defined routes');
    });

    it('should include response structure', () => {
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });
      const prompt = agent.buildGoalPlanningPrompt('Test goal');
      expect(prompt).toContain('**Status**');
      expect(prompt).toContain('**Next Steps**');
      expect(prompt).toContain('**Blockers**');
    });
  });

  describe('reload', () => {
    it('should reload persona files', () => {
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });
      expect(agent.getSoulContent()).toBe('');

      // Write files after creation
      fs.writeFileSync(path.join(tmpDir, 'soul.md'), 'Updated soul', 'utf-8');
      agent.reload();

      expect(agent.getSoulContent()).toBe('Updated soul');
    });
  });

  describe('EventEmitter', () => {
    it('should support event subscription', () => {
      const agent = new Agent({ workspaceId: 'w1', workspacePath: tmpDir });
      let received = false;
      agent.on('error', () => { received = true; });
      agent.emit('error', new Error('test'));
      expect(received).toBe(true);
    });
  });
});
