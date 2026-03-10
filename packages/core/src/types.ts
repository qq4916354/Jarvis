// ============================================================
// Jarvis Core Type Definitions
// ============================================================

// ------------------------------------------------------------
// Utility / Primitive Types
// ------------------------------------------------------------

/** ISO-8601 timestamp string */
export type ISOTimestamp = string;

/** UUID v4 string */
export type UUID = string;

/** Cron expression string, e.g. "0 0/5 * * * *" */
export type CronExpression = string;

// ------------------------------------------------------------
// Backward-compatible aliases used by existing modules
// ------------------------------------------------------------

/** Alias for UUID, used by memory and workspace modules */
export type Id = string;

/** Numeric timestamp (milliseconds since epoch) used by memory layer */
export type Timestamp = number;

// ------------------------------------------------------------
// Model Configuration
// ------------------------------------------------------------

export type ModelPurpose = 'chat' | 'image' | 'video' | 'heartbeat' | 'task';

export interface ModelConfig {
  /** Provider identifier, e.g. 'openai', 'anthropic', 'ollama' */
  provider: string;
  /** Model name/id, e.g. 'gpt-4o', 'claude-sonnet-4-20250514' */
  modelName: string;
  /** Alias for modelName, used by ModelService for workspace-purpose mapping */
  modelId?: string;
  /** API key for the provider */
  apiKey: string;
  /** Optional custom base URL for API requests */
  baseUrl?: string;
  /** What this model is used for */
  purpose: ModelPurpose;
  /** Workspace this config is scoped to (when used in workspace-purpose mapping) */
  workspaceId?: UUID;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Sampling temperature 0-2 */
  temperature?: number;
}

// ------------------------------------------------------------
// Memory Types
// ------------------------------------------------------------

export interface ShortTermMemory {
  workspaceId: UUID;
  messages: Message[];
  maxMessages: number;
}

export interface LongTermMemoryEntry {
  id: UUID;
  workspaceId: UUID;
  content: string;
  embedding?: number[];
  tags: string[];
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface EpisodicMemoryEntry {
  id: UUID;
  workspaceId: UUID;
  episode: string;
  summary: string;
  outcome: 'success' | 'failure' | 'partial';
  lessons: string[];
  timestamp: ISOTimestamp;
}

export interface MemoryConfig {
  shortTermMaxMessages: number;
  longTermEnabled: boolean;
  episodicEnabled: boolean;
  /** Path to the SQLite database file for persistent memory */
  dbPath?: string;
}

// ------------------------------------------------------------
// Lark / Feishu Configuration
// ------------------------------------------------------------

export interface LarkConfig {
  appId: string;
  appSecret: string;
  /** Lark group chat ID for message routing */
  groupId?: string;
  /** Webhook URL for incoming/outgoing messages */
  webhookUrl?: string;
}

// ------------------------------------------------------------
// Loop Mode Configuration
// ------------------------------------------------------------

export interface LoopModeConfig {
  enabled: boolean;
  /** Minutes between autonomous loop iterations */
  intervalMinutes: number;
  /** The goal the agent is working toward in loop mode */
  goal: string;
  /** Maximum iterations before the loop auto-stops (0 = unlimited) */
  maxIterations: number;
}

// ------------------------------------------------------------
// Tool Definition
// ------------------------------------------------------------

export interface ToolParameterProperty {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

export interface ToolParametersSchema {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

// ------------------------------------------------------------
// Agent Types
// ------------------------------------------------------------

export type AgentRole = 'assistant' | 'planner' | 'coder' | 'reviewer' | 'custom';

export interface AgentConfig {
  /** The role this agent plays */
  role: AgentRole;
  /** Short persona description or system prompt */
  persona: string;
  /** Path to a detailed "soul" file with extended persona instructions */
  soulFilePath?: string;
  /** Names of tools this agent is allowed to use */
  tools: string[];
  /** Model configurations for different purposes */
  modelConfigs: ModelConfig[];
}

// ------------------------------------------------------------
// Message Types
// ------------------------------------------------------------

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface MessageMetadata {
  /** Which model produced this message */
  modelUsed?: string;
  /** Total token count for the generation */
  tokenCount?: number;
  /** Round-trip latency in milliseconds */
  latencyMs?: number;
  /** Names of tools invoked during generation */
  toolCalls?: string[];
  /** Extensible metadata */
  [key: string]: unknown;
}

export interface Message {
  id: UUID;
  workspaceId: UUID;
  role: MessageRole;
  content: string;
  timestamp: ISOTimestamp | Timestamp;
  metadata?: MessageMetadata;
}

// ------------------------------------------------------------
// Workspace Configuration
// ------------------------------------------------------------

export interface WorkspaceConfig {
  id: UUID;
  name: string;
  description?: string;
  goal?: string;
  agent?: AgentConfig;
  memory?: MemoryConfig;
  settings?: WorkspaceSettings;
  lark?: LarkConfig;
  loopMode?: LoopModeConfig;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ------------------------------------------------------------
// Task / Scheduler Types
// ------------------------------------------------------------

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskDefinition {
  id: UUID;
  workspaceId: UUID;
  name: string;
  description: string;
  status: TaskStatus;
  /** Cron expression for recurring tasks */
  cronExpression?: CronExpression;
  /** Fixed interval in milliseconds for recurring tasks */
  intervalMs?: number;
  /** Handler function identifier (module path or registered name) */
  handler: string;
  /** Arbitrary payload passed to the handler */
  payload?: Record<string, unknown>;
  lastRunAt?: ISOTimestamp;
  nextRunAt?: ISOTimestamp;
  createdAt: ISOTimestamp;
}

export interface SchedulerConfig {
  maxConcurrentTasks: number;
  defaultTimeoutMs: number;
}

// ------------------------------------------------------------
// CC (Claude Code) Skill Types
// ------------------------------------------------------------

export interface CCSkill {
  name: string;
  description: string;
  /** The skill content / prompt template */
  content: string;
  /** Filesystem path where the skill is installed */
  installPath: string;
  version?: string;
  tags?: string[];
}

// ------------------------------------------------------------
// Health / Daemon Monitoring
// ------------------------------------------------------------

export type ServiceStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  message?: string;
  lastCheckAt: ISOTimestamp;
}

export interface HealthStatus {
  overall: ServiceStatus;
  /** Daemon uptime in seconds */
  uptime: number;
  services: ServiceHealth[];
  workspaceCount: number;
  activeTaskCount: number;
  /** Resident memory usage in megabytes */
  memoryUsageMb: number;
  timestamp: ISOTimestamp;
}

// ------------------------------------------------------------
// Self-Upgrade Types
// ------------------------------------------------------------

export type UpgradeScope = 'skill' | 'prompt' | 'tool' | 'config' | 'code';

export interface UpgradeRequest {
  id: UUID;
  workspaceId: UUID;
  scope: UpgradeScope;
  description: string;
  reason: string;
  proposedChanges: string;
  requestedAt: ISOTimestamp;
}

export interface UpgradeResult {
  requestId: UUID;
  success: boolean;
  scope: UpgradeScope;
  appliedChanges?: string;
  error?: string;
  rollbackAvailable: boolean;
  completedAt: ISOTimestamp;
}

// ------------------------------------------------------------
// WebPage Types (Web Reading Capability)
// ------------------------------------------------------------

export interface WebPage {
  url: string;
  title: string;
  content: string;
  markdown?: string;
  excerpt?: string;
  fetchedAt: ISOTimestamp;
  statusCode: number;
  headers?: Record<string, string>;
}

export interface WebReadOptions {
  url: string;
  /** CSS selector to extract specific content */
  selector?: string;
  /** Wait for this selector to appear before extracting */
  waitForSelector?: string;
  timeoutMs?: number;
  extractMarkdown?: boolean;
}

// ------------------------------------------------------------
// Legacy Workspace types (used by WorkspaceManager)
// ------------------------------------------------------------

export interface WorkspaceSettings {
  shortTermMemoryLimit?: number;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface Workspace {
  config: WorkspaceConfig;
  path: string;
}

export interface CreateWorkspaceInput {
  name: string;
  description?: string;
  settings?: Partial<WorkspaceSettings>;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
  settings?: Partial<WorkspaceSettings>;
}

// ------------------------------------------------------------
// Legacy Memory types (used by MemoryManager)
// ------------------------------------------------------------

export enum MemoryType {
  ShortTerm = 'short_term',
  LongTerm = 'long_term',
  Episodic = 'episodic',
}

export interface Memory {
  id: Id;
  workspaceId: Id;
  key: string;
  value: string;
  type: MemoryType;
  timestamp: Timestamp;
  metadata?: Record<string, unknown>;
}

export interface Episode {
  id: Id;
  workspaceId: Id;
  title: string;
  description: string;
  timestamp: Timestamp;
  metadata?: Record<string, unknown>;
}

// ------------------------------------------------------------
// OpenAI-compatible API types (used by ModelService)
// ------------------------------------------------------------

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: ChatToolDefinition[];
  responseFormat?: { type: 'text' | 'json_object' };
}

export interface ChatStreamChunk {
  id: string;
  choices: {
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: string | null;
  }[];
}

export interface ChatResponse {
  id: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ImageGenerationOptions {
  model?: string;
  n?: number;
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  responseFormat?: 'url' | 'b64_json';
}

export interface ImageGenerationResult {
  created: number;
  data: {
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }[];
}

export interface VideoGenerationOptions {
  model?: string;
  duration?: number;
  size?: string;
  fps?: number;
}

export interface VideoGenerationResult {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  url?: string;
  error?: string;
}

// ------------------------------------------------------------
// Legacy Event type (backward compatibility)
// ------------------------------------------------------------

export interface JarvisEvent {
  type: string;
  payload: unknown;
  timestamp: Timestamp;
}

// ------------------------------------------------------------
// Event Bus Event Map
// ------------------------------------------------------------

export interface JarvisEventMap {
  'workspace:created': { workspaceId: UUID; name: string };
  'workspace:updated': { workspaceId: UUID; changes: Partial<WorkspaceConfig> };
  'workspace:deleted': { workspaceId: UUID };
  'agent:message': { workspaceId: UUID; message: Message };
  'agent:error': { workspaceId: UUID; error: string; stack?: string };
  'heartbeat:tick': { timestamp: ISOTimestamp; health: HealthStatus };
  'upgrade:start': { request: UpgradeRequest };
  'upgrade:complete': { result: UpgradeResult };
  'lark:message': { workspaceId: UUID; groupId: string; content: string };
  'loop:iteration': { workspaceId: UUID; iteration: number; maxIterations: number; goal: string };
  'task:started': { taskId: UUID; workspaceId: UUID };
  'task:completed': { taskId: UUID; workspaceId: UUID; result: unknown };
  'task:failed': { taskId: UUID; workspaceId: UUID; error: string };
  'memory:updated': { workspaceId: UUID; memoryType: 'short' | 'long' | 'episodic' };
}

export type JarvisEventName = keyof JarvisEventMap;

// ------------------------------------------------------------
// Global Jarvis Configuration (persisted to ~/.jarvis/config.json)
// ------------------------------------------------------------

export interface JarvisConfig {
  version: string;
  dataDir: string;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  models: ModelConfig[];
  scheduler: SchedulerConfig;
  defaultMemory: MemoryConfig;
  lark?: LarkConfig;
  workspaces: WorkspaceConfig[];
}
