// ============================================================================
// @jarvis/core - Main barrel export
// ============================================================================

// --- Types -------------------------------------------------------------------
export * from './types.js';

// --- Utilities ---------------------------------------------------------------
export { createLogger } from './utils/logger.js';
export { default as logger } from './utils/logger.js';

export { JarvisEventBus } from './utils/event-bus.js';
export { default as eventBus } from './utils/event-bus.js';

export { ConfigManager, CONFIG_PATH, DATA_DIR, JARVIS_HOME } from './utils/config.js';
export { default as configManager } from './utils/config.js';

// --- Agent ------------------------------------------------------------------
export { Agent } from './agent/index.js';
export { CCSession } from './agent/index.js';
export type { CCSessionOptions, CCStreamEvent } from './agent/index.js';
export { TaskPlanner } from './agent/index.js';
export type {
  TaskPlan,
  TaskStep,
  ToolSelection,
  Reflection,
  PlanContext,
  TaskResult,
} from './agent/index.js';

// --- Workspace --------------------------------------------------------------
export { WorkspaceManager } from './workspace/index.js';

// --- Memory -----------------------------------------------------------------
export { MemoryManager } from './memory/index.js';
export type { SemanticSearchOptions, SemanticSearchResult, MemoryImportance, ConsolidationResult } from './memory/index.js';

// --- Models -----------------------------------------------------------------
export { ModelService } from './models/index.js';
export { ProviderRegistry } from './models/index.js';
export type { ProviderConfig, ProviderModel, ProviderId } from './models/index.js';

// --- Scheduler --------------------------------------------------------------
export { Scheduler } from './scheduler/index.js';

// --- Self-Upgrade -----------------------------------------------------------
export { UpgradeEngine } from './self-upgrade/index.js';

// --- Evolution --------------------------------------------------------------
export { EvolutionEngine } from './evolution/index.js';
export type { EvolutionEngineOptions } from './evolution/index.js';

// --- Tools ------------------------------------------------------------------
export { ToolManager } from './tools/index.js';

// --- Skills -----------------------------------------------------------------
export { SkillManager } from './skills/index.js';

// --- Artifacts --------------------------------------------------------------
export { ArtifactManager } from './artifacts/index.js';
export type { Artifact, ArtifactType, FileTreeNode } from './artifacts/index.js';

// --- Digital Humans ---------------------------------------------------------
export { DigitalHumanManager } from './digital-humans/index.js';
export type { DigitalHuman, DHStatus, DHActivityEntry, DHActivityOutcome, CreateDHInput } from './digital-humans/index.js';

// --- Browser ----------------------------------------------------------------
export { BrowserService } from './browser/index.js';
export type { PageSnapshot } from './browser/index.js';
export { ResearchAgent } from './browser/index.js';
export type { ResearchConfig, ResearchFinding, ResearchReport, ResearchEvents, SummarizerFn } from './browser/index.js';


// --- Lark -------------------------------------------------------------------
export { LarkService } from './lark/index.js';
