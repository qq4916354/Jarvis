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

  /**
   * Build a context window with the most relevant memories and history,
   * staying within a token budget.  Uses a simple character-based estimate
   * (1 token ~ 4 chars) when an exact tokeniser is unavailable.
   */
  buildContextWindow(
    workspaceId: string,
    task: string,
    options?: {
      memories?: string[];
      history?: string[];
      maxTokens?: number;
    },
  ): string {
    const maxTokens = options?.maxTokens ?? 4000;
    const maxChars = maxTokens * 4;

    const parts: string[] = [];
    let usedChars = 0;

    // 1) Task description always comes first
    const taskSection = `## Current Task\n${task}`;
    parts.push(taskSection);
    usedChars += taskSection.length;

    // 2) Relevant memories (most recent / relevant first)
    if (options?.memories && options.memories.length > 0) {
      const memHeader = '## Relevant Memories';
      usedChars += memHeader.length + 1;
      const memLines: string[] = [];
      for (const mem of options.memories) {
        if (usedChars + mem.length + 3 > maxChars) break;
        memLines.push(`- ${mem}`);
        usedChars += mem.length + 3;
      }
      if (memLines.length > 0) {
        parts.push(`${memHeader}\n${memLines.join('\n')}`);
      }
    }

    // 3) Conversation history (most recent first, reversed for display)
    if (options?.history && options.history.length > 0) {
      const histHeader = '## Recent History';
      usedChars += histHeader.length + 1;
      const histLines: string[] = [];
      for (const entry of options.history) {
        if (usedChars + entry.length + 3 > maxChars) break;
        histLines.push(`- ${entry}`);
        usedChars += entry.length + 3;
      }
      if (histLines.length > 0) {
        parts.push(`${histHeader}\n${histLines.join('\n')}`);
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Enhanced goal planning prompt that includes sub-task progress,
   * lessons learned, and tool usage suggestions.
   */
  buildEnhancedGoalPlanningPrompt(
    goal: string,
    options?: {
      previousActions?: string[];
      subTaskProgress?: { task: string; status: string }[];
      lessonsLearned?: string[];
      suggestedTools?: string[];
    },
  ): string {
    let prompt = `You are working toward the following goal:\n\n**Goal:** ${goal}\n\n`;

    if (options?.previousActions && options.previousActions.length > 0) {
      prompt += `**Previous actions taken:**\n${options.previousActions.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\n`;
    }

    if (options?.subTaskProgress && options.subTaskProgress.length > 0) {
      prompt += `**Sub-task progress:**\n${options.subTaskProgress.map((t) => `- [${t.status}] ${t.task}`).join('\n')}\n\n`;
    }

    if (options?.lessonsLearned && options.lessonsLearned.length > 0) {
      prompt += `**Lessons learned from previous attempts:**\n${options.lessonsLearned.map((l) => `- ${l}`).join('\n')}\n\n`;
    }

    if (options?.suggestedTools && options.suggestedTools.length > 0) {
      prompt += `**Available tools you may use:**\n${options.suggestedTools.map((t) => `- ${t}`).join('\n')}\n\n`;
    }

    prompt += `Analyze the current state and determine the next concrete steps to make progress toward this goal.
Be specific and actionable. If the goal has been achieved, say so clearly.

Respond with:
1. **Status**: Current progress assessment
2. **Next Steps**: List of specific actions to take
3. **Blockers**: Any issues that need to be resolved
4. **Tools**: Which tools to use for each step`;

    return prompt;
  }

  /**
   * Build a ReAct (Reasoning + Acting) prompt that implements
   * the Observation -> Thought -> Action loop.
   */
  buildReActPrompt(
    task: string,
    observations: { observation: string; thought?: string; action?: string }[],
  ): string {
    let prompt = `You are an AI agent that solves tasks using the ReAct framework.
For each step, you Observe the environment, Think about what to do, then Act.

**Task:** ${task}

`;

    if (observations.length > 0) {
      prompt += `**Previous steps:**\n`;
      for (let i = 0; i < observations.length; i++) {
        const obs = observations[i];
        prompt += `\nStep ${i + 1}:\n`;
        prompt += `  Observation: ${obs.observation}\n`;
        if (obs.thought) {
          prompt += `  Thought: ${obs.thought}\n`;
        }
        if (obs.action) {
          prompt += `  Action: ${obs.action}\n`;
        }
      }
      prompt += '\n';
    }

    prompt += `Now provide your next step in this format:
  Observation: [What you observe from the current state]
  Thought: [Your reasoning about what to do next]
  Action: [The specific action to take, including tool name and parameters if applicable]

If the task is complete, respond with:
  Thought: The task is complete.
  Action: FINISH[summary of what was accomplished]`;

    return prompt;
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
