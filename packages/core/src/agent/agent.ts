/**
 * Agent - The core AI agent that orchestrates workspace interactions
 *
 * An Agent is bound to a workspace and has:
 * - A soul (personality, rules, behavior)
 * - A role (responsibilities, capabilities)
 * - Access to tools
 * - Memory (short-term, long-term, episodic)
 * - Model configuration per purpose
 */

import { EventEmitter } from 'eventemitter3';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface AgentConfig {
  workspaceId: string;
  workspacePath: string;
  name?: string;
}

interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AgentEvents {
  'message': (msg: { role: string; content: string }) => void;
  'chunk': (chunk: string) => void;
  'error': (error: Error) => void;
  'tool:call': (tool: string, params: any) => void;
  'tool:result': (tool: string, result: any) => void;
  'thinking': (thought: string) => void;
}

export class Agent extends EventEmitter<AgentEvents> {
  readonly workspaceId: string;
  readonly workspacePath: string;
  private name: string;
  private soulContent: string = '';
  private agentContent: string = '';
  private userContent: string = '';

  constructor(config: AgentConfig) {
    super();
    this.workspaceId = config.workspaceId;
    this.workspacePath = config.workspacePath;
    this.name = config.name || 'Jarvis';
    this.loadPersona();
  }

  private loadPersona() {
    const soulPath = join(this.workspacePath, 'soul.md');
    const agentPath = join(this.workspacePath, 'agent.md');
    const userPath = join(this.workspacePath, 'user.md');

    if (existsSync(soulPath)) {
      this.soulContent = readFileSync(soulPath, 'utf-8');
    }
    if (existsSync(agentPath)) {
      this.agentContent = readFileSync(agentPath, 'utf-8');
    }
    if (existsSync(userPath)) {
      this.userContent = readFileSync(userPath, 'utf-8');
    }
  }

  /**
   * Build the system prompt from soul, agent, and user files
   */
  buildSystemPrompt(): string {
    const parts: string[] = [];

    if (this.soulContent) {
      parts.push(`## Soul\n${this.soulContent}`);
    }

    if (this.agentContent) {
      parts.push(`## Role & Responsibilities\n${this.agentContent}`);
    }

    if (this.userContent) {
      parts.push(`## User Profile\n${this.userContent}`);
    }

    if (parts.length === 0) {
      return `You are ${this.name}, an intelligent AI assistant. You are helpful, accurate, and thoughtful.`;
    }

    return parts.join('\n\n');
  }

  /**
   * Build messages array for model call, including system prompt and context
   */
  buildMessages(
    recentMessages: AgentMessage[],
    additionalContext?: string
  ): AgentMessage[] {
    const messages: AgentMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
    ];

    if (additionalContext) {
      messages.push({ role: 'system', content: additionalContext });
    }

    messages.push(...recentMessages);
    return messages;
  }

  /**
   * Plan next actions toward a goal (used in loop mode)
   */
  buildGoalPlanningPrompt(goal: string, previousActions?: string[]): string {
    let prompt = `You are working toward the following goal:\n\n**Goal:** ${goal}\n\n`;

    if (previousActions && previousActions.length > 0) {
      prompt += `**Previous actions taken:**\n${previousActions.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\n`;
    }

    prompt += `Analyze the current state and determine the next concrete steps to make progress toward this goal.
Be specific and actionable. If the goal has been achieved, say so clearly.

Respond with:
1. **Status**: Current progress assessment
2. **Next Steps**: List of specific actions to take
3. **Blockers**: Any issues that need to be resolved`;

    return prompt;
  }

  /**
   * Reload persona files (useful after self-upgrade modifies them)
   */
  reload() {
    this.loadPersona();
  }

  getSoulContent(): string {
    return this.soulContent;
  }

  getAgentContent(): string {
    return this.agentContent;
  }

  getUserContent(): string {
    return this.userContent;
  }

  getName(): string {
    return this.name;
  }
}
