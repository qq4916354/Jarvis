// ============================================================================
// Jarvis Tool Manager – register, manage, and execute tools
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { v4 as uuid } from 'uuid';

import type {
  UUID,
  ToolDefinition,
  ToolParametersSchema,
} from '../types';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolExecutionContext {
  workspaceId: UUID;
  userId?: string;
  [key: string]: unknown;
}

export interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface CreateToolSpec {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  code: string;
}

// ---------------------------------------------------------------------------
// Built-in tool factories
// ---------------------------------------------------------------------------

function createBuiltinTools(): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // ---- web_read ----
  tools.push({
    name: 'web_read',
    description: 'Fetch and read the contents of a web page URL, returning text/markdown.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        extractMarkdown: { type: 'string', description: 'Whether to convert to markdown (true/false)', default: 'true' },
      },
      required: ['url'],
    },
    execute: async (params) => {
      const url = params.url as string;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Jarvis/1.0' },
        signal: AbortSignal.timeout(30_000),
      });
      const text = await resp.text();
      return { url, status: resp.status, content: text.slice(0, 50_000) };
    },
  });

  // ---- file_read ----
  tools.push({
    name: 'file_read',
    description: 'Read the contents of a file from the local filesystem.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        encoding: { type: 'string', description: 'File encoding', default: 'utf-8' },
      },
      required: ['path'],
    },
    execute: async (params) => {
      const filePath = params.path as string;
      const encoding = (params.encoding as BufferEncoding) ?? 'utf-8';
      const content = fs.readFileSync(filePath, encoding);
      return { path: filePath, content };
    },
  });

  // ---- file_write ----
  tools.push({
    name: 'file_write',
    description: 'Write content to a file on the local filesystem.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'Content to write' },
        append: { type: 'string', description: 'Append instead of overwrite (true/false)', default: 'false' },
      },
      required: ['path', 'content'],
    },
    execute: async (params) => {
      const filePath = params.path as string;
      const content = params.content as string;
      const append = params.append === 'true';
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      if (append) {
        fs.appendFileSync(filePath, content, 'utf-8');
      } else {
        fs.writeFileSync(filePath, content, 'utf-8');
      }
      return { path: filePath, written: true, bytes: Buffer.byteLength(content, 'utf-8') };
    },
  });

  // ---- shell_exec ----
  tools.push({
    name: 'shell_exec',
    description: 'Execute a shell command and return the output.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory' },
        timeoutMs: { type: 'string', description: 'Timeout in milliseconds', default: '30000' },
      },
      required: ['command'],
    },
    execute: async (params) => {
      const command = params.command as string;
      const cwd = (params.cwd as string) || process.cwd();
      const timeoutMs = parseInt(params.timeoutMs as string, 10) || 30_000;

      return new Promise((resolve) => {
        exec(command, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
          resolve({
            command,
            exitCode: error?.code ?? 0,
            stdout: stdout.slice(0, 50_000),
            stderr: stderr.slice(0, 10_000),
          });
        });
      });
    },
  });

  // ---- image_generate ----
  tools.push({
    name: 'image_generate',
    description: 'Generate an image from a text prompt (placeholder – requires external API integration).',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Text description of the image to generate' },
        size: { type: 'string', description: 'Image size (e.g. 1024x1024)', default: '1024x1024' },
        outputPath: { type: 'string', description: 'Path to save the generated image' },
      },
      required: ['prompt'],
    },
    execute: async (params) => {
      // Placeholder – actual implementation depends on model provider
      logger.warn('image_generate tool is a placeholder; integrate an image model provider');
      return {
        prompt: params.prompt,
        size: params.size ?? '1024x1024',
        status: 'not_implemented',
        message: 'Image generation requires an external API (e.g., DALL-E, Stable Diffusion).',
      };
    },
  });

  // ---- search ----
  tools.push({
    name: 'search',
    description: 'Search the web for information (placeholder – requires search API integration).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'string', description: 'Maximum number of results', default: '5' },
      },
      required: ['query'],
    },
    execute: async (params) => {
      logger.warn('search tool is a placeholder; integrate a search API provider');
      return {
        query: params.query,
        status: 'not_implemented',
        message: 'Search requires an external API (e.g., SerpAPI, Tavily, Brave Search).',
        results: [],
      };
    },
  });

  return tools;
}

// ---------------------------------------------------------------------------
// ToolManager
// ---------------------------------------------------------------------------

export class ToolManager {
  private tools = new Map<string, ToolDefinition>();
  private workspaceToolsLoaded = new Set<UUID>();

  constructor() {
    // Register all built-in tools
    for (const tool of createBuiltinTools()) {
      this.tools.set(tool.name, tool);
    }
    logger.info(`[ToolManager] Initialized with ${this.tools.size} built-in tools`);
  }

  // -----------------------------------------------------------------------
  // register / unregister
  // -----------------------------------------------------------------------

  /**
   * Register a tool. Overwrites if a tool with the same name exists.
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    logger.info(`[ToolManager] Registered tool: ${tool.name}`);
  }

  /**
   * Unregister a tool by name.
   */
  unregister(name: string): boolean {
    const deleted = this.tools.delete(name);
    if (deleted) {
      logger.info(`[ToolManager] Unregistered tool: ${name}`);
    }
    return deleted;
  }

  // -----------------------------------------------------------------------
  // execute
  // -----------------------------------------------------------------------

  /**
   * Execute a named tool with the given parameters and context.
   */
  async execute(
    name: string,
    params: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        toolName: name,
        success: false,
        error: `Tool "${name}" not found`,
        durationMs: 0,
      };
    }

    const start = Date.now();
    try {
      logger.debug(`[ToolManager] Executing tool: ${name}`, { params, workspaceId: context.workspaceId });
      const result = await tool.execute(params);
      const durationMs = Date.now() - start;
      logger.info(`[ToolManager] Tool ${name} completed in ${durationMs}ms`);
      return { toolName: name, success: true, result, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`[ToolManager] Tool ${name} failed: ${error}`);
      return { toolName: name, success: false, error, durationMs };
    }
  }

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------

  /**
   * List available tools. If workspaceId is provided, ensure workspace tools
   * are loaded first.
   */
  list(workspaceId?: UUID): Array<{ name: string; description: string }> {
    if (workspaceId && !this.workspaceToolsLoaded.has(workspaceId)) {
      this.loadWorkspaceTools(workspaceId);
    }

    const result: Array<{ name: string; description: string }> = [];
    for (const tool of this.tools.values()) {
      result.push({ name: tool.name, description: tool.description });
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Workspace custom tools
  // -----------------------------------------------------------------------

  /**
   * Load custom tools from a workspace's tools/ directory.
   * Each .js file should export a ToolDefinition as default.
   */
  loadWorkspaceTools(workspaceId: UUID): void {
    const toolsDir = path.join(os.homedir(), '.jarvis', 'workspaces', workspaceId, 'tools');

    if (!fs.existsSync(toolsDir)) {
      this.workspaceToolsLoaded.add(workspaceId);
      return;
    }

    const files = fs.readdirSync(toolsDir).filter((f) => f.endsWith('.js'));
    for (const file of files) {
      try {
        const fullPath = path.join(toolsDir, file);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(fullPath);
        const tool: ToolDefinition = mod.default ?? mod;

        if (tool && tool.name && typeof tool.execute === 'function') {
          this.tools.set(tool.name, tool);
          logger.info(`[ToolManager] Loaded workspace tool: ${tool.name} from ${fullPath}`);
        }
      } catch (err) {
        logger.error(`[ToolManager] Failed to load workspace tool ${file}:`, err);
      }
    }

    this.workspaceToolsLoaded.add(workspaceId);
  }

  /**
   * Create a new custom tool for a workspace. Writes a .ts file into the
   * workspace tools/ directory.
   */
  async createTool(workspaceId: UUID, spec: CreateToolSpec): Promise<string> {
    const toolsDir = path.join(os.homedir(), '.jarvis', 'workspaces', workspaceId, 'tools');
    fs.mkdirSync(toolsDir, { recursive: true });

    const filePath = path.join(toolsDir, `${spec.name}.ts`);
    const content = [
      `// Auto-generated tool: ${spec.name}`,
      `// ${spec.description}`,
      '',
      `import type { ToolDefinition } from '@jarvis/core';`,
      '',
      spec.code,
      '',
      'export default tool;',
      '',
    ].join('\n');

    fs.writeFileSync(filePath, content, 'utf-8');
    logger.info(`[ToolManager] Created custom tool at ${filePath}`);

    return filePath;
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  /**
   * Check whether a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get a tool definition by name.
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
}
