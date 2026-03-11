// ============================================================================
// MemoryManager - Per-workspace memory storage using better-sqlite3
// ============================================================================
//
// Three memory types:
//   1. Short-term  – recent conversation messages (last N, configurable)
//   2. Long-term   – important facts / learned preferences (key-value)
//   3. Episodic    – significant events and milestones with timestamps
//
// Each workspace gets its own SQLite database stored at:
//   ~/.jarvis/data/workspaces/{workspaceId}/memory/memory.db
// ============================================================================

import path from 'node:path';
import fs from 'node:fs';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

import type {
  Id,
  Message,
  MessageRole,
  Memory,
  MemoryType,
  Episode,
  SemanticSearchOptions,
  SemanticSearchResult,
  MemoryImportance,
  ConsolidationResult,
} from '../types/index.js';
import logger from '../utils/logger.js';
import eventBus from '../utils/event-bus.js';
import config from '../utils/config.js';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const MEMORY_DB_FILE = 'memory.db';
const DEFAULT_RECENT_LIMIT = 50;

// ----------------------------------------------------------------------------
// SQL Statements (executed once per database initialization)
// ----------------------------------------------------------------------------

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    role          TEXT NOT NULL,
    content       TEXT NOT NULL,
    timestamp     INTEGER NOT NULL,
    metadata      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_messages_workspace_ts
    ON messages (workspace_id, timestamp DESC);

  CREATE TABLE IF NOT EXISTS memories (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    key           TEXT NOT NULL,
    value         TEXT NOT NULL,
    type          TEXT NOT NULL,
    timestamp     INTEGER NOT NULL,
    metadata      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_memories_workspace_type
    ON memories (workspace_id, type);

  CREATE INDEX IF NOT EXISTS idx_memories_workspace_key
    ON memories (workspace_id, key);

  CREATE TABLE IF NOT EXISTS episodes (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    timestamp     INTEGER NOT NULL,
    metadata      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_episodes_workspace_ts
    ON episodes (workspace_id, timestamp DESC);

  CREATE TABLE IF NOT EXISTS embeddings (
    memory_id     TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    vector        TEXT NOT NULL,
    model         TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_embeddings_workspace
    ON embeddings (workspace_id);
`;

/**
 * Migration SQL to add the importance column to the memories table.
 * Uses a safe ALTER TABLE that is ignored if the column already exists.
 */
const MIGRATION_IMPORTANCE_COLUMN = `
  ALTER TABLE memories ADD COLUMN importance REAL DEFAULT NULL;
`;

// ----------------------------------------------------------------------------
// MemoryManager
// ----------------------------------------------------------------------------

export class MemoryManager {
  /** Cache of open database connections keyed by workspace ID. */
  private databases: Map<string, DatabaseType> = new Map();

  private readonly workspacesDir: string;

  constructor(workspacesDir?: string) {
    this.workspacesDir = workspacesDir ?? config.workspacesDir;
    logger.info('MemoryManager initialized', { workspacesDir: this.workspacesDir });
  }

  // --------------------------------------------------------------------------
  // Short-Term Memory (Messages)
  // --------------------------------------------------------------------------

  /**
   * Add a message to short-term memory.
   */
  async addMessage(
    workspaceId: Id,
    message: Omit<Message, 'id' | 'workspaceId' | 'timestamp'>,
  ): Promise<Message> {
    const db = this.getDatabase(workspaceId);
    const now = Date.now();
    const id = uuidv4();

    const full: Message = {
      id,
      workspaceId,
      role: message.role,
      content: message.content,
      timestamp: now,
      metadata: message.metadata,
    };

    const stmt = db.prepare(`
      INSERT INTO messages (id, workspace_id, role, content, timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      full.id,
      full.workspaceId,
      full.role,
      full.content,
      full.timestamp,
      full.metadata ? JSON.stringify(full.metadata) : null,
    );

    logger.debug('Message added to short-term memory', { workspaceId, messageId: id });
    eventBus.emitEvent('memory:message_added', { workspaceId, message: full });

    return full;
  }

  /**
   * Get the most recent messages for a workspace.
   */
  async getRecentMessages(workspaceId: Id, limit?: number): Promise<Message[]> {
    const db = this.getDatabase(workspaceId);
    const effectiveLimit = limit ?? DEFAULT_RECENT_LIMIT;

    const stmt = db.prepare(`
      SELECT id, workspace_id, role, content, timestamp, metadata
      FROM messages
      WHERE workspace_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(workspaceId, effectiveLimit) as RawMessageRow[];

    // Return in chronological order (oldest first)
    return rows.reverse().map(this.rowToMessage);
  }

  // --------------------------------------------------------------------------
  // Long-Term & General Memory
  // --------------------------------------------------------------------------

  /**
   * Store a memory (long-term or episodic key-value pair).
   * If a memory with the same key and type already exists for this workspace,
   * it will be updated (upsert behaviour).
   */
  async remember(
    workspaceId: Id,
    key: string,
    value: string,
    type: MemoryType,
    metadata?: Record<string, unknown>,
  ): Promise<Memory> {
    const db = this.getDatabase(workspaceId);
    const now = Date.now();

    // Check for existing memory with same key + type
    const existing = db
      .prepare(
        `SELECT id FROM memories WHERE workspace_id = ? AND key = ? AND type = ?`,
      )
      .get(workspaceId, key, type) as { id: string } | undefined;

    let id: string;

    if (existing) {
      id = existing.id;
      db.prepare(
        `UPDATE memories SET value = ?, timestamp = ?, metadata = ? WHERE id = ?`,
      ).run(value, now, metadata ? JSON.stringify(metadata) : null, id);
    } else {
      id = uuidv4();
      db.prepare(`
        INSERT INTO memories (id, workspace_id, key, value, type, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        workspaceId,
        key,
        value,
        type,
        now,
        metadata ? JSON.stringify(metadata) : null,
      );
    }

    const memory: Memory = { id, workspaceId, key, value, type, timestamp: now, metadata };

    logger.debug('Memory stored', { workspaceId, key, type });
    eventBus.emitEvent('memory:remembered', { workspaceId, memory });

    // Best-effort: generate and store embedding in the background
    this.storeEmbedding(workspaceId, id, `${key}: ${value}`).catch(() => {});

    return memory;
  }

  /**
   * Search memories by query string (simple LIKE-based search).
   * Optionally filter by memory type.
   */
  async recall(
    workspaceId: Id,
    query: string,
    type?: MemoryType,
  ): Promise<Memory[]> {
    const db = this.getDatabase(workspaceId);
    const likePattern = `%${query}%`;

    let sql = `
      SELECT id, workspace_id, key, value, type, timestamp, metadata
      FROM memories
      WHERE workspace_id = ?
        AND (key LIKE ? OR value LIKE ?)
    `;
    const params: unknown[] = [workspaceId, likePattern, likePattern];

    if (type !== undefined) {
      sql += ` AND type = ?`;
      params.push(type);
    }

    sql += ` ORDER BY timestamp DESC`;

    const rows = db.prepare(sql).all(...params) as RawMemoryRow[];
    return rows.map(this.rowToMemory);
  }

  // --------------------------------------------------------------------------
  // Episodic Memory
  // --------------------------------------------------------------------------

  /**
   * Record an episode (significant event or milestone).
   */
  async addEpisode(
    workspaceId: Id,
    episode: Omit<Episode, 'id' | 'workspaceId' | 'timestamp'>,
  ): Promise<Episode> {
    const db = this.getDatabase(workspaceId);
    const id = uuidv4();
    const now = Date.now();

    const full: Episode = {
      id,
      workspaceId,
      title: episode.title,
      description: episode.description,
      timestamp: now,
      metadata: episode.metadata,
    };

    db.prepare(`
      INSERT INTO episodes (id, workspace_id, title, description, timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      full.id,
      full.workspaceId,
      full.title,
      full.description,
      full.timestamp,
      full.metadata ? JSON.stringify(full.metadata) : null,
    );

    logger.debug('Episode recorded', { workspaceId, episodeId: id, title: episode.title });
    eventBus.emitEvent('memory:episode_added', { workspaceId, episode: full });

    return full;
  }

  /**
   * Get episodic memories, optionally filtered to episodes after a given timestamp.
   */
  async getEpisodes(workspaceId: Id, since?: number): Promise<Episode[]> {
    const db = this.getDatabase(workspaceId);

    let sql = `
      SELECT id, workspace_id, title, description, timestamp, metadata
      FROM episodes
      WHERE workspace_id = ?
    `;
    const params: unknown[] = [workspaceId];

    if (since !== undefined) {
      sql += ` AND timestamp >= ?`;
      params.push(since);
    }

    sql += ` ORDER BY timestamp DESC`;

    const rows = db.prepare(sql).all(...params) as RawEpisodeRow[];
    return rows.map(this.rowToEpisode);
  }

  // --------------------------------------------------------------------------
  // Semantic Search
  // --------------------------------------------------------------------------

  /**
   * Perform a semantic search over memories using embedding vectors.
   * Falls back to LIKE-based search if the embedding API is unavailable.
   *
   * @param workspaceId  Target workspace
   * @param query        Natural-language search query
   * @param options      Optional search parameters
   */
  async semanticSearch(
    workspaceId: Id,
    query: string,
    options?: SemanticSearchOptions,
  ): Promise<SemanticSearchResult[]> {
    const limit = options?.limit ?? 10;
    const threshold = options?.threshold ?? 0.5;

    // Try to get an embedding for the query
    let queryVector: number[] | null = null;
    try {
      queryVector = await this.getEmbedding(query);
    } catch (err) {
      logger.warn('Embedding API unavailable, falling back to LIKE search', { error: err });
    }

    // Fallback: use the existing LIKE-based recall
    if (!queryVector) {
      const memories = await this.recall(workspaceId, query, options?.type);
      return memories.slice(0, limit).map((memory) => ({ memory, score: 1.0 }));
    }

    // Load all embeddings for this workspace and compute cosine similarity
    const db = this.getDatabase(workspaceId);

    let memorySql = `
      SELECT m.id, m.workspace_id, m.key, m.value, m.type, m.timestamp, m.metadata, m.importance,
             e.vector
      FROM memories m
      INNER JOIN embeddings e ON e.memory_id = m.id
      WHERE m.workspace_id = ?
    `;
    const params: unknown[] = [workspaceId];

    if (options?.type !== undefined) {
      memorySql += ` AND m.type = ?`;
      params.push(options.type);
    }

    const rows = db.prepare(memorySql).all(...params) as (RawMemoryRow & { vector: string; importance: number | null })[];

    const scored: SemanticSearchResult[] = [];
    for (const row of rows) {
      let storedVector: number[];
      try {
        storedVector = JSON.parse(row.vector);
      } catch {
        continue;
      }
      const score = cosineSimilarity(queryVector, storedVector);
      if (score >= threshold) {
        scored.push({ memory: this.rowToMemory(row), score });
      }
    }

    // Sort by score descending, limit results
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // Importance Scoring
  // --------------------------------------------------------------------------

  /**
   * Compute and persist an importance score for a memory entry.
   * Uses a simple heuristic based on content length, recency, and metadata.
   */
  async scoreImportance(memory: Memory): Promise<MemoryImportance> {
    let score = 0.5;
    const reasons: string[] = [];

    // Factor 1: Content length (longer = potentially more important, up to a point)
    const contentLength = memory.value.length;
    if (contentLength > 200) {
      score += 0.1;
      reasons.push('detailed content');
    } else if (contentLength < 20) {
      score -= 0.1;
      reasons.push('very short content');
    }

    // Factor 2: Recency (memories from the last 24h get a boost)
    const ageMs = Date.now() - memory.timestamp;
    const oneDay = 24 * 60 * 60 * 1000;
    if (ageMs < oneDay) {
      score += 0.15;
      reasons.push('recent memory');
    } else if (ageMs > 30 * oneDay) {
      score -= 0.1;
      reasons.push('older than 30 days');
    }

    // Factor 3: Memory type (long-term tends to be more curated)
    if (memory.type === ('long_term' as MemoryType)) {
      score += 0.1;
      reasons.push('long-term memory');
    }

    // Factor 4: Has metadata (structured data suggests intentional storage)
    if (memory.metadata && Object.keys(memory.metadata).length > 0) {
      score += 0.05;
      reasons.push('has metadata');
    }

    // Clamp to [0, 1]
    score = Math.max(0, Math.min(1, score));

    // Persist the score
    const db = this.getDatabase(memory.workspaceId);
    db.prepare(`UPDATE memories SET importance = ? WHERE id = ?`).run(score, memory.id);

    const result: MemoryImportance = {
      memoryId: memory.id,
      score,
      reason: reasons.join('; ') || 'default scoring',
    };

    logger.debug('Importance scored', { memoryId: memory.id, score });
    return result;
  }

  // --------------------------------------------------------------------------
  // Auto-Summarize (Extract facts from conversation)
  // --------------------------------------------------------------------------

  /**
   * Extract key facts and preferences from a list of conversation messages
   * and automatically store them as long-term memories.
   *
   * Uses a simple keyword/pattern extraction approach that works without
   * an external LLM call.  For richer extraction, callers can pre-process
   * messages through the ModelService before invoking this method.
   */
  async autoSummarize(
    workspaceId: Id,
    messages: Array<{ role: string; content: string }>,
  ): Promise<Memory[]> {
    const extracted: Array<{ key: string; value: string }> = [];

    // Patterns that often indicate facts / preferences
    const factPatterns: Array<{ regex: RegExp; keyPrefix: string }> = [
      { regex: /(?:my name is|I'm called|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi, keyPrefix: 'user_name' },
      { regex: /(?:I (?:like|love|prefer|enjoy))\s+(.{3,60}?)(?:\.|,|!|$)/gi, keyPrefix: 'preference' },
      { regex: /(?:I (?:dislike|hate|don't like|avoid))\s+(.{3,60}?)(?:\.|,|!|$)/gi, keyPrefix: 'dislike' },
      { regex: /(?:I (?:work|am working) (?:at|for|with))\s+(.{3,60}?)(?:\.|,|!|$)/gi, keyPrefix: 'workplace' },
      { regex: /(?:I (?:live|am living|stay) (?:in|at))\s+(.{3,60}?)(?:\.|,|!|$)/gi, keyPrefix: 'location' },
      { regex: /(?:remember that|note that|important:)\s+(.{3,120}?)(?:\.|!|$)/gi, keyPrefix: 'noted_fact' },
    ];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      for (const pattern of factPatterns) {
        let match: RegExpExecArray | null;
        // Reset lastIndex for global regex
        pattern.regex.lastIndex = 0;
        while ((match = pattern.regex.exec(msg.content)) !== null) {
          const value = match[1].trim();
          if (value.length >= 3) {
            extracted.push({
              key: `${pattern.keyPrefix}_${extracted.length}`,
              value,
            });
          }
        }
      }
    }

    // Store extracted facts as long-term memories
    const stored: Memory[] = [];
    for (const fact of extracted) {
      const memory = await this.remember(
        workspaceId,
        fact.key,
        fact.value,
        'long_term' as MemoryType,
        { source: 'auto_summarize', extractedAt: Date.now() },
      );
      stored.push(memory);
    }

    if (stored.length > 0) {
      logger.info('Auto-summarize extracted facts', { workspaceId, count: stored.length });
    }

    return stored;
  }

  // --------------------------------------------------------------------------
  // Memory Consolidation
  // --------------------------------------------------------------------------

  /**
   * Consolidate memories for a workspace by:
   * 1. Merging near-duplicate memories (same key or very similar values)
   * 2. Removing low-importance memories older than 30 days
   */
  async consolidate(workspaceId: Id): Promise<ConsolidationResult> {
    const db = this.getDatabase(workspaceId);
    let merged = 0;
    let removed = 0;

    // Step 1: Merge memories with duplicate keys (keep the most recent)
    const dupeRows = db.prepare(`
      SELECT key, type, COUNT(*) as cnt
      FROM memories
      WHERE workspace_id = ?
      GROUP BY key, type
      HAVING cnt > 1
    `).all(workspaceId) as Array<{ key: string; type: string; cnt: number }>;

    for (const dupe of dupeRows) {
      // Keep the newest entry, delete the rest
      const entries = db.prepare(`
        SELECT id FROM memories
        WHERE workspace_id = ? AND key = ? AND type = ?
        ORDER BY timestamp DESC
      `).all(workspaceId, dupe.key, dupe.type) as Array<{ id: string }>;

      for (let i = 1; i < entries.length; i++) {
        db.prepare(`DELETE FROM memories WHERE id = ?`).run(entries[i].id);
        db.prepare(`DELETE FROM embeddings WHERE memory_id = ?`).run(entries[i].id);
        merged++;
      }
    }

    // Step 2: Remove low-importance old memories
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const lowValueResult = db.prepare(`
      DELETE FROM memories
      WHERE workspace_id = ?
        AND importance IS NOT NULL
        AND importance < 0.3
        AND timestamp < ?
    `).run(workspaceId, thirtyDaysAgo);
    removed = lowValueResult.changes;

    // Clean up orphaned embeddings
    db.prepare(`
      DELETE FROM embeddings
      WHERE workspace_id = ?
        AND memory_id NOT IN (SELECT id FROM memories WHERE workspace_id = ?)
    `).run(workspaceId, workspaceId);

    // Count remaining
    const remainingRow = db.prepare(
      `SELECT COUNT(*) as cnt FROM memories WHERE workspace_id = ?`,
    ).get(workspaceId) as { cnt: number };

    const result: ConsolidationResult = {
      merged,
      removed,
      remaining: remainingRow.cnt,
    };

    logger.info('Memory consolidation complete', { workspaceId, ...result });
    eventBus.emitEvent('memory:updated', { workspaceId, memoryType: 'long' });

    return result;
  }

  // --------------------------------------------------------------------------
  // Embedding Helpers
  // --------------------------------------------------------------------------

  /**
   * Store an embedding vector for a memory entry.
   * Called automatically when remember() succeeds and the embedding API is available.
   */
  private async storeEmbedding(
    workspaceId: Id,
    memoryId: Id,
    text: string,
  ): Promise<void> {
    try {
      const vector = await this.getEmbedding(text);
      if (!vector) return;

      const db = this.getDatabase(workspaceId);
      db.prepare(`
        INSERT OR REPLACE INTO embeddings (memory_id, workspace_id, vector, model, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(memoryId, workspaceId, JSON.stringify(vector), 'text-embedding-ada-002', Date.now());
    } catch (err) {
      // Non-fatal: embedding is a best-effort enhancement
      logger.debug('Failed to store embedding', { memoryId, error: err });
    }
  }

  /**
   * Call the OpenAI-compatible embeddings API to get a vector for the given text.
   * Returns null if the API is not configured or fails.
   */
  private async getEmbedding(text: string): Promise<number[] | null> {
    // Read embedding config from environment or config
    const models = config.get('models') ?? [];
    const firstModel = models[0];
    const baseUrl = process.env.JARVIS_EMBEDDING_BASE_URL
      || process.env.JARVIS_API_BASE_URL
      || firstModel?.baseUrl
      || null;
    const apiKey = process.env.JARVIS_EMBEDDING_API_KEY
      || process.env.JARVIS_API_KEY
      || firstModel?.apiKey
      || null;
    const model = process.env.JARVIS_EMBEDDING_MODEL || 'text-embedding-ada-002';

    if (!baseUrl || !apiKey) {
      return null;
    }

    const url = `${(baseUrl as string).replace(/\/+$/, '')}/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: text }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data?.[0]?.embedding ?? null;
  }

  // --------------------------------------------------------------------------
  // Summarization
  // --------------------------------------------------------------------------

  /**
   * Create a textual summary of the current workspace memory context.
   * This aggregates recent messages, key memories, and recent episodes
   * into a single string suitable for injection into a prompt.
   */
  async summarize(workspaceId: Id): Promise<string> {
    const [messages, longTermMemories, episodes] = await Promise.all([
      this.getRecentMessages(workspaceId, 10),
      this.recall(workspaceId, '', 'long_term' as MemoryType),
      this.getEpisodes(workspaceId),
    ]);

    const parts: string[] = [];

    // Recent conversation
    if (messages.length > 0) {
      parts.push('## Recent Conversation');
      for (const msg of messages) {
        parts.push(`[${msg.role}]: ${msg.content}`);
      }
    }

    // Long-term memories
    if (longTermMemories.length > 0) {
      parts.push('');
      parts.push('## Known Facts & Preferences');
      for (const mem of longTermMemories) {
        parts.push(`- **${mem.key}**: ${mem.value}`);
      }
    }

    // Recent episodes
    if (episodes.length > 0) {
      parts.push('');
      parts.push('## Notable Episodes');
      for (const ep of episodes.slice(0, 10)) {
        const date = new Date(ep.timestamp).toISOString().split('T')[0];
        parts.push(`- [${date}] ${ep.title}: ${ep.description}`);
      }
    }

    if (parts.length === 0) {
      return 'No memories recorded yet for this workspace.';
    }

    return parts.join('\n');
  }

  // --------------------------------------------------------------------------
  // Clearing
  // --------------------------------------------------------------------------

  /**
   * Clear memories for a workspace.
   * If type is provided, only that category is cleared; otherwise all are cleared.
   */
  async clear(workspaceId: Id, type?: 'messages' | 'memories' | 'episodes'): Promise<void> {
    const db = this.getDatabase(workspaceId);

    if (!type || type === 'messages') {
      db.prepare(`DELETE FROM messages WHERE workspace_id = ?`).run(workspaceId);
    }
    if (!type || type === 'memories') {
      db.prepare(`DELETE FROM memories WHERE workspace_id = ?`).run(workspaceId);
    }
    if (!type || type === 'episodes') {
      db.prepare(`DELETE FROM episodes WHERE workspace_id = ?`).run(workspaceId);
    }

    logger.info('Memory cleared', { workspaceId, type: type ?? 'all' });
    eventBus.emitEvent('memory:cleared', { workspaceId, type: type ?? 'all' });
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Close all open database connections. Call on shutdown.
   */
  close(): void {
    for (const [id, db] of this.databases) {
      try {
        db.close();
      } catch (err) {
        logger.warn('Error closing memory database', { workspaceId: id, error: err });
      }
    }
    this.databases.clear();
    logger.info('MemoryManager: all database connections closed');
  }

  /**
   * Close the database connection for a specific workspace.
   */
  closeWorkspace(workspaceId: Id): void {
    const db = this.databases.get(workspaceId);
    if (db) {
      db.close();
      this.databases.delete(workspaceId);
      logger.debug('Database connection closed', { workspaceId });
    }
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /**
   * Get (or lazily create) the SQLite database for a given workspace.
   */
  private getDatabase(workspaceId: Id): DatabaseType {
    const cached = this.databases.get(workspaceId);
    if (cached) return cached;

    const memoryDir = path.join(this.workspacesDir, workspaceId, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });

    const dbPath = path.join(memoryDir, MEMORY_DB_FILE);
    const db = new Database(dbPath);

    // Enable WAL mode for better concurrent read performance
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Initialize schema
    db.exec(SCHEMA_SQL);

    // Run migrations (safe to re-run)
    try {
      db.exec(MIGRATION_IMPORTANCE_COLUMN);
    } catch {
      // Column already exists – ignore the error
    }

    this.databases.set(workspaceId, db);
    logger.debug('Database initialized for workspace', { workspaceId, dbPath });

    return db;
  }

  /** Map a raw SQLite row to a Message. */
  private rowToMessage(row: RawMessageRow): Message {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      role: row.role as MessageRole,
      content: row.content,
      timestamp: row.timestamp,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /** Map a raw SQLite row to a Memory. */
  private rowToMemory(row: RawMemoryRow): Memory {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      key: row.key,
      value: row.value,
      type: row.type as MemoryType,
      timestamp: row.timestamp,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /** Map a raw SQLite row to an Episode. */
  private rowToEpisode(row: RawEpisodeRow): Episode {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      description: row.description,
      timestamp: row.timestamp,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

// ----------------------------------------------------------------------------
// Vector Math Utilities
// ----------------------------------------------------------------------------

/**
 * Compute the cosine similarity between two vectors of equal length.
 * Returns a value between -1 and 1 (1 = identical direction).
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ----------------------------------------------------------------------------
// Raw row types (as returned by better-sqlite3)
// ----------------------------------------------------------------------------

interface RawMessageRow {
  id: string;
  workspace_id: string;
  role: string;
  content: string;
  timestamp: number;
  metadata: string | null;
}

interface RawMemoryRow {
  id: string;
  workspace_id: string;
  key: string;
  value: string;
  type: string;
  timestamp: number;
  metadata: string | null;
  importance?: number | null;
}

interface RawEpisodeRow {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  timestamp: number;
  metadata: string | null;
}

export default MemoryManager;
