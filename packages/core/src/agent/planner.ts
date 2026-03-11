/**
 * TaskPlanner - Multi-step reasoning and tool orchestration for the AI agent
 *
 * The planner decomposes complex tasks into sub-task trees, selects appropriate
 * tools, and supports self-reflection after execution.  It relies on ModelService
 * to call an LLM for planning decisions.
 */

import { v4 as uuid } from 'uuid';

import type { ModelService } from '../models/model-service.js';
import type { ChatMessage } from '../types.js';
import type { ToolDefinition } from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskPlan {
  id: string;
  goal: string;
  steps: TaskStep[];
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
  requiredTools: string[];
  status: 'planning' | 'executing' | 'completed' | 'failed';
}

export interface TaskStep {
  id: string;
  action: string;
  description: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  dependencies: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
  output?: string;
}

export interface ToolSelection {
  toolName: string;
  reason: string;
  priority: number;
  requiredParams: string[];
}

export interface Reflection {
  success: boolean;
  qualityScore: number;
  lessonsLearned: string[];
  improvements: string[];
  shouldRemember: { key: string; value: string }[];
}

export interface PlanContext {
  workspaceId: string;
  memories?: string;
  previousPlans?: TaskPlan[];
  availableTools?: string[];
}

export interface TaskResult {
  success: boolean;
  output?: string;
  error?: string;
  stepsCompleted: number;
  stepsTotal: number;
}

// ---------------------------------------------------------------------------
// TaskPlanner
// ---------------------------------------------------------------------------

export class TaskPlanner {
  private modelService: ModelService;
  private defaultModel: string;

  constructor(modelService: ModelService, defaultModel?: string) {
    this.modelService = modelService;
    this.defaultModel = defaultModel ?? 'gpt-4';
  }

  // -------------------------------------------------------------------------
  // Plan a task
  // -------------------------------------------------------------------------

  /**
   * Decompose a complex task into a sub-task tree via LLM reasoning.
   */
  async planTask(task: string, context?: PlanContext): Promise<TaskPlan> {
    const systemPrompt = this.buildPlanningSystemPrompt(context);
    const userPrompt = this.buildPlanningUserPrompt(task, context);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.modelService.chat(messages, {
      model: this.defaultModel,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    return this.parsePlanResponse(content, task);
  }

  // -------------------------------------------------------------------------
  // Select tools
  // -------------------------------------------------------------------------

  /**
   * Given a task description and a list of available tools, pick the best
   * tool combination ranked by relevance.
   */
  async selectTools(
    task: string,
    availableTools: ToolDefinition[],
  ): Promise<ToolSelection[]> {
    const toolDescriptions = availableTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: Object.keys(t.parameters.properties),
    }));

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a tool selection assistant. Given a task and available tools, select the most appropriate tools and rank them by priority.

Respond in JSON format:
{
  "selections": [
    {
      "toolName": "tool_name",
      "reason": "why this tool is relevant",
      "priority": 1,
      "requiredParams": ["param1", "param2"]
    }
  ]
}

Only select tools that are genuinely useful for the task. Prioritize from most important (1) to least.`,
      },
      {
        role: 'user',
        content: `Task: ${task}\n\nAvailable tools:\n${JSON.stringify(toolDescriptions, null, 2)}`,
      },
    ];

    const response = await this.modelService.chat(messages, {
      model: this.defaultModel,
      temperature: 0.1,
      responseFormat: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    return this.parseToolSelectionResponse(content);
  }

  // -------------------------------------------------------------------------
  // Reflect
  // -------------------------------------------------------------------------

  /**
   * After completing a task, reflect on the outcome to extract lessons and
   * potential improvements.
   */
  async reflect(
    task: string,
    result: TaskResult,
    plan: TaskPlan,
  ): Promise<Reflection> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a reflective AI assistant. Analyze the execution of a task plan and provide insights.

Respond in JSON format:
{
  "success": true/false,
  "qualityScore": 0.0-1.0,
  "lessonsLearned": ["lesson1", "lesson2"],
  "improvements": ["improvement1", "improvement2"],
  "shouldRemember": [{"key": "key1", "value": "value1"}]
}

Be honest about failures and specific about improvements.`,
      },
      {
        role: 'user',
        content: `Task: ${task}

Plan:
${JSON.stringify(plan, null, 2)}

Result:
- Success: ${result.success}
- Steps completed: ${result.stepsCompleted}/${result.stepsTotal}
- Output: ${result.output ?? 'N/A'}
- Error: ${result.error ?? 'None'}`,
      },
    ];

    const response = await this.modelService.chat(messages, {
      model: this.defaultModel,
      temperature: 0.3,
      responseFormat: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    return this.parseReflectionResponse(content);
  }

  // -------------------------------------------------------------------------
  // Adjust plan
  // -------------------------------------------------------------------------

  /**
   * Dynamically adjust an existing plan based on new feedback or changed
   * circumstances.
   */
  async adjustPlan(plan: TaskPlan, feedback: string): Promise<TaskPlan> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a task planning assistant. Given an existing plan and feedback, adjust the plan accordingly.

Respond in JSON format:
{
  "steps": [
    {
      "action": "action_name",
      "description": "what to do",
      "toolName": "optional_tool",
      "toolParams": {},
      "dependencies": ["step_id1"]
    }
  ],
  "estimatedComplexity": "simple" | "moderate" | "complex",
  "requiredTools": ["tool1", "tool2"]
}

Preserve completed steps and adjust pending ones based on feedback.`,
      },
      {
        role: 'user',
        content: `Current plan:\n${JSON.stringify(plan, null, 2)}\n\nFeedback: ${feedback}`,
      },
    ];

    const response = await this.modelService.chat(messages, {
      model: this.defaultModel,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    return this.parseAdjustedPlanResponse(content, plan);
  }

  // -------------------------------------------------------------------------
  // Prompt builders (private)
  // -------------------------------------------------------------------------

  private buildPlanningSystemPrompt(context?: PlanContext): string {
    let prompt = `You are an expert task planner. Decompose tasks into clear, actionable steps.

Respond in JSON format:
{
  "steps": [
    {
      "action": "action_name",
      "description": "detailed description of what to do",
      "toolName": "optional_tool_name",
      "toolParams": {},
      "dependencies": []
    }
  ],
  "estimatedComplexity": "simple" | "moderate" | "complex",
  "requiredTools": ["tool1", "tool2"]
}

Guidelines:
- Break complex tasks into 2-8 concrete steps
- Identify dependencies between steps
- Suggest specific tools when applicable
- Keep descriptions clear and actionable`;

    if (context?.availableTools && context.availableTools.length > 0) {
      prompt += `\n\nAvailable tools: ${context.availableTools.join(', ')}`;
    }

    return prompt;
  }

  private buildPlanningUserPrompt(task: string, context?: PlanContext): string {
    let prompt = `Plan the following task:\n\n${task}`;

    if (context?.memories) {
      prompt += `\n\nRelevant memories:\n${context.memories}`;
    }

    if (context?.previousPlans && context.previousPlans.length > 0) {
      const summaries = context.previousPlans.map(
        (p) => `- "${p.goal}" (${p.status}, ${p.steps.length} steps)`,
      );
      prompt += `\n\nPrevious related plans:\n${summaries.join('\n')}`;
    }

    return prompt;
  }

  // -------------------------------------------------------------------------
  // Response parsers (private)
  // -------------------------------------------------------------------------

  private parsePlanResponse(content: string, goal: string): TaskPlan {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      return this.createFallbackPlan(goal);
    }

    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const steps: TaskStep[] = rawSteps.map(
      (s: Record<string, unknown>, idx: number) => ({
        id: uuid(),
        action: String(s.action ?? `step_${idx + 1}`),
        description: String(s.description ?? ''),
        toolName: s.toolName ? String(s.toolName) : undefined,
        toolParams: (s.toolParams as Record<string, unknown>) ?? undefined,
        dependencies: Array.isArray(s.dependencies)
          ? s.dependencies.map(String)
          : [],
        status: 'pending' as const,
      }),
    );

    const complexity = this.parseComplexity(parsed.estimatedComplexity);
    const requiredTools = Array.isArray(parsed.requiredTools)
      ? parsed.requiredTools.map(String)
      : [];

    return {
      id: uuid(),
      goal,
      steps,
      estimatedComplexity: complexity,
      requiredTools,
      status: 'planning',
    };
  }

  private parseToolSelectionResponse(content: string): ToolSelection[] {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      return [];
    }

    const raw = Array.isArray(parsed.selections) ? parsed.selections : [];
    return raw.map((s: Record<string, unknown>) => ({
      toolName: String(s.toolName ?? ''),
      reason: String(s.reason ?? ''),
      priority: typeof s.priority === 'number' ? s.priority : 99,
      requiredParams: Array.isArray(s.requiredParams)
        ? s.requiredParams.map(String)
        : [],
    }));
  }

  private parseReflectionResponse(content: string): Reflection {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      return {
        success: false,
        qualityScore: 0,
        lessonsLearned: ['Failed to parse reflection response'],
        improvements: [],
        shouldRemember: [],
      };
    }

    return {
      success: Boolean(parsed.success),
      qualityScore: Math.max(
        0,
        Math.min(1, typeof parsed.qualityScore === 'number' ? parsed.qualityScore : 0),
      ),
      lessonsLearned: Array.isArray(parsed.lessonsLearned)
        ? parsed.lessonsLearned.map(String)
        : [],
      improvements: Array.isArray(parsed.improvements)
        ? parsed.improvements.map(String)
        : [],
      shouldRemember: Array.isArray(parsed.shouldRemember)
        ? parsed.shouldRemember.map((r: Record<string, unknown>) => ({
            key: String(r.key ?? ''),
            value: String(r.value ?? ''),
          }))
        : [],
    };
  }

  private parseAdjustedPlanResponse(
    content: string,
    originalPlan: TaskPlan,
  ): TaskPlan {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      return originalPlan;
    }

    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];

    // Preserve completed steps from the original plan
    const completedSteps = originalPlan.steps.filter(
      (s) => s.status === 'done',
    );

    const newSteps: TaskStep[] = rawSteps.map(
      (s: Record<string, unknown>, idx: number) => ({
        id: uuid(),
        action: String(s.action ?? `step_${idx + 1}`),
        description: String(s.description ?? ''),
        toolName: s.toolName ? String(s.toolName) : undefined,
        toolParams: (s.toolParams as Record<string, unknown>) ?? undefined,
        dependencies: Array.isArray(s.dependencies)
          ? s.dependencies.map(String)
          : [],
        status: 'pending' as const,
      }),
    );

    const complexity = this.parseComplexity(parsed.estimatedComplexity);
    const requiredTools = Array.isArray(parsed.requiredTools)
      ? parsed.requiredTools.map(String)
      : originalPlan.requiredTools;

    return {
      ...originalPlan,
      steps: [...completedSteps, ...newSteps],
      estimatedComplexity: complexity,
      requiredTools,
      status: 'planning',
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private parseComplexity(
    value: unknown,
  ): 'simple' | 'moderate' | 'complex' {
    if (value === 'simple' || value === 'moderate' || value === 'complex') {
      return value;
    }
    return 'moderate';
  }

  private createFallbackPlan(goal: string): TaskPlan {
    return {
      id: uuid(),
      goal,
      steps: [
        {
          id: uuid(),
          action: 'execute',
          description: goal,
          dependencies: [],
          status: 'pending',
        },
      ],
      estimatedComplexity: 'simple',
      requiredTools: [],
      status: 'planning',
    };
  }
}
