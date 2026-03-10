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
