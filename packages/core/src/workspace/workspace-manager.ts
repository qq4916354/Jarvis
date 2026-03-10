// ============================================================================
// WorkspaceManager - CRUD operations for Jarvis workspaces
// ============================================================================
//
// Each workspace is stored as a directory under ~/.jarvis/data/workspaces/{id}/
// with the following structure:
//   config.json  - workspace configuration
//   soul.md      - agent persona/soul file (personality, rules, behavior)
//   agent.md     - agent role and responsibilities
//   tools/       - custom tool definitions
//   memory/      - memory storage (SQLite databases)
//   history/     - conversation history
//   user.md      - user profile and preferences
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import type {
  Id,
  WorkspaceConfig,
  Workspace,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  WorkspaceSettings,
} from '../types/index.js';
import logger from '../utils/logger.js';
import eventBus from '../utils/event-bus.js';
import config from '../utils/config.js';

// ----------------------------------------------------------------------------
// Default Templates
// ----------------------------------------------------------------------------

const DEFAULT_SOUL_MD = `# Soul

You are Jarvis, a helpful and capable AI assistant.

## Personality
- Professional yet approachable
- Clear and concise in communication
- Proactive in offering relevant suggestions
- Honest about limitations and uncertainties

## Rules
- Always prioritize user safety and privacy
- Be transparent about what you can and cannot do
- Ask clarifying questions when the request is ambiguous
- Provide sources and reasoning when making claims

## Behavior
- Adapt communication style to the user's preferences
- Remember context from previous conversations
- Break complex tasks into manageable steps
- Offer follow-up actions when appropriate
`;

const DEFAULT_AGENT_MD = `# Agent

## Role
General-purpose AI assistant capable of handling a wide variety of tasks.

## Responsibilities
- Answer questions accurately and thoroughly
- Help with research, analysis, and problem-solving
- Assist with writing, editing, and content creation
- Provide technical guidance and code assistance
- Manage tasks, reminders, and scheduling
- Learn from interactions to improve over time

## Capabilities
- Natural language understanding and generation
- Code generation and review
- Data analysis and summarization
- Task planning and execution
- Tool usage and integration

## Constraints
- Operate within the bounds of available tools
- Respect workspace-specific configurations
- Maintain conversation context within memory limits
`;

const DEFAULT_USER_MD = `# User Profile

## Preferences
- Language: English
- Response style: Balanced (concise but thorough)

## Notes
<!-- The agent will learn and update this file over time -->
`;

// ----------------------------------------------------------------------------
// Workspace Subdirectory Names
// ----------------------------------------------------------------------------

const WORKSPACE_DIRS = ['tools', 'memory', 'history'] as const;
const CONFIG_FILE = 'config.json';
const SOUL_FILE = 'soul.md';
const AGENT_FILE = 'agent.md';
const USER_FILE = 'user.md';

// ----------------------------------------------------------------------------
// WorkspaceManager
// ----------------------------------------------------------------------------

export class WorkspaceManager {
  private readonly workspacesDir: string;

  constructor(workspacesDir?: string) {
    this.workspacesDir = workspacesDir ?? config.workspacesDir;
    fs.mkdirSync(this.workspacesDir, { recursive: true });
    logger.info('WorkspaceManager initialized', { workspacesDir: this.workspacesDir });
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Create a new workspace with default template files.
   */
  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    const id = uuidv4();
    const now = Date.now();
    const workspacePath = this.getWorkspacePath(id);

    const settings: WorkspaceSettings = {
      shortTermMemoryLimit: input.settings?.shortTermMemoryLimit ?? config.defaultShortTermMemoryLimit,
      model: input.settings?.model ?? config.defaultModel,
      metadata: input.settings?.metadata ?? {},
    };

    const workspaceConfig: WorkspaceConfig = {
      id,
      name: input.name,
      description: input.description,
      createdAt: now,
      updatedAt: now,
      settings,
    };

    // Create directory structure
    fs.mkdirSync(workspacePath, { recursive: true });
    for (const dir of WORKSPACE_DIRS) {
      fs.mkdirSync(path.join(workspacePath, dir), { recursive: true });
    }

    // Write config and template files
    this.writeJson(path.join(workspacePath, CONFIG_FILE), workspaceConfig);
    fs.writeFileSync(path.join(workspacePath, SOUL_FILE), DEFAULT_SOUL_MD, 'utf-8');
    fs.writeFileSync(path.join(workspacePath, AGENT_FILE), DEFAULT_AGENT_MD, 'utf-8');
    fs.writeFileSync(path.join(workspacePath, USER_FILE), DEFAULT_USER_MD, 'utf-8');

    const workspace: Workspace = { config: workspaceConfig, path: workspacePath };

    logger.info('Workspace created', { id, name: input.name });
    eventBus.emitEvent('workspace:created', { workspace });

    return workspace;
  }

  /**
   * Get a workspace by ID.
   */
  async get(id: Id): Promise<Workspace | null> {
    const workspacePath = this.getWorkspacePath(id);
    const configPath = path.join(workspacePath, CONFIG_FILE);

    if (!fs.existsSync(configPath)) {
      return null;
    }

    const workspaceConfig = this.readJson<WorkspaceConfig>(configPath);
    return { config: workspaceConfig, path: workspacePath };
  }

  /**
   * List all workspaces.
   */
  async list(): Promise<Workspace[]> {
    if (!fs.existsSync(this.workspacesDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.workspacesDir, { withFileTypes: true });
    const workspaces: Workspace[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const configPath = path.join(this.workspacesDir, entry.name, CONFIG_FILE);
      if (!fs.existsSync(configPath)) continue;

      try {
        const workspaceConfig = this.readJson<WorkspaceConfig>(configPath);
        workspaces.push({
          config: workspaceConfig,
          path: path.join(this.workspacesDir, entry.name),
        });
      } catch (err) {
        logger.warn('Failed to read workspace config', { dir: entry.name, error: err });
      }
    }

    // Sort by creation time, newest first
    workspaces.sort((a, b) => b.config.createdAt - a.config.createdAt);
    return workspaces;
  }

  /**
   * Update a workspace's configuration.
   */
  async update(id: Id, input: UpdateWorkspaceInput): Promise<Workspace | null> {
    const existing = await this.get(id);
    if (!existing) {
      logger.warn('Workspace not found for update', { id });
      return null;
    }

    const updatedConfig: WorkspaceConfig = {
      ...existing.config,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      updatedAt: Date.now(),
      settings: {
        ...existing.config.settings,
        ...(input.settings ?? {}),
      },
    };

    const configPath = path.join(existing.path, CONFIG_FILE);
    this.writeJson(configPath, updatedConfig);

    const workspace: Workspace = { config: updatedConfig, path: existing.path };

    logger.info('Workspace updated', { id, changes: Object.keys(input) });
    eventBus.emitEvent('workspace:updated', { workspace });

    return workspace;
  }

  /**
   * Delete a workspace and all its contents.
   */
  async delete(id: Id): Promise<boolean> {
    const workspacePath = this.getWorkspacePath(id);

    if (!fs.existsSync(workspacePath)) {
      logger.warn('Workspace not found for deletion', { id });
      return false;
    }

    fs.rmSync(workspacePath, { recursive: true, force: true });

    logger.info('Workspace deleted', { id });
    eventBus.emitEvent('workspace:deleted', { workspaceId: id });

    return true;
  }

  /**
   * Get the filesystem path for a workspace by ID.
   */
  getWorkspacePath(id: Id): string {
    return path.join(this.workspacesDir, id);
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private writeJson(filePath: string, data: unknown): void {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private readJson<T>(filePath: string): T {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  }
}

export default WorkspaceManager;
