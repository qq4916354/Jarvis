// ============================================================================
// DigitalHumanManager - CRUD and lifecycle for persistent automated agents
// ============================================================================
//
// A Digital Human is a persistent automated agent that runs on a schedule
// (cron) to perform tasks autonomously. Each DH is stored as a JSON file
// under {dataDir}/{id}.json with activity logs in {dataDir}/activities/{dhId}.json.
// ============================================================================

import { EventEmitter } from 'eventemitter3';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import logger from '../utils/logger.js';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type DHStatus = 'active' | 'paused' | 'error' | 'disabled';

export interface DigitalHuman {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  prompt: string;
  schedule: string;
  workspaceId?: string;
  status: DHStatus;
  maxRetries: number;
  consecutiveFailures: number;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastResult?: DHActivityEntry;
}

export type DHActivityOutcome = 'success' | 'error' | 'skipped' | 'noop';

export interface DHActivityEntry {
  id: string;
  digitalHumanId: string;
  outcome: DHActivityOutcome;
  output?: string;
  error?: string;
  durationMs: number;
  timestamp: number;
}

export interface CreateDHInput {
  name: string;
  description: string;
  prompt: string;
  schedule: string;
  workspaceId?: string;
  avatar?: string;
}

export interface DHManagerEvents {
  'dh:created': (dh: DigitalHuman) => void;
  'dh:updated': (dh: DigitalHuman) => void;
  'dh:deleted': (id: string) => void;
  'dh:executed': (entry: DHActivityEntry) => void;
  'dh:error': (id: string, error: string) => void;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const MAX_CONSECUTIVE_FAILURES = 3;
const DEFAULT_MAX_RETRIES = 3;
const ACTIVITIES_DIR = 'activities';

// ----------------------------------------------------------------------------
// DigitalHumanManager
// ----------------------------------------------------------------------------

export class DigitalHumanManager extends EventEmitter<DHManagerEvents> {
  private readonly dataDir: string;
  private readonly activitiesDir: string;
  private readonly digitalHumans: Map<string, DigitalHuman> = new Map();

  constructor(dataDir: string) {
    super();
    this.dataDir = dataDir;
    this.activitiesDir = path.join(dataDir, ACTIVITIES_DIR);

    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.activitiesDir, { recursive: true });

    this.loadFromDisk();
    logger.info(`DigitalHumanManager initialised – loaded ${this.digitalHumans.size} digital human(s)`);
  }

  // --------------------------------------------------------------------------
  // CRUD
  // --------------------------------------------------------------------------

  create(input: CreateDHInput): DigitalHuman {
    const now = Date.now();
    const dh: DigitalHuman = {
      id: uuid(),
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      schedule: input.schedule,
      workspaceId: input.workspaceId,
      avatar: input.avatar,
      status: 'active',
      maxRetries: DEFAULT_MAX_RETRIES,
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.digitalHumans.set(dh.id, dh);
    this.saveToDisk(dh);
    this.emit('dh:created', dh);
    logger.info(`Digital human created: ${dh.name} (${dh.id})`);
    return dh;
  }

  update(id: string, updates: Partial<CreateDHInput> & { status?: DHStatus }): DigitalHuman | null {
    const existing = this.digitalHumans.get(id);
    if (!existing) {
      logger.warn(`Digital human not found for update: ${id}`);
      return null;
    }

    const updated: DigitalHuman = {
      ...existing,
      ...updates,
      id: existing.id,               // immutable
      createdAt: existing.createdAt,  // immutable
      consecutiveFailures: existing.consecutiveFailures,
      updatedAt: Date.now(),
    };

    this.digitalHumans.set(id, updated);
    this.saveToDisk(updated);
    this.emit('dh:updated', updated);
    logger.info(`Digital human updated: ${updated.name} (${id})`);
    return updated;
  }

  delete(id: string): boolean {
    const existing = this.digitalHumans.get(id);
    if (!existing) {
      logger.warn(`Digital human not found for deletion: ${id}`);
      return false;
    }

    this.digitalHumans.delete(id);

    const configPath = path.join(this.dataDir, `${id}.json`);
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }

    const activityPath = path.join(this.activitiesDir, `${id}.json`);
    if (fs.existsSync(activityPath)) {
      fs.unlinkSync(activityPath);
    }

    this.emit('dh:deleted', id);
    logger.info(`Digital human deleted: ${existing.name} (${id})`);
    return true;
  }

  get(id: string): DigitalHuman | undefined {
    return this.digitalHumans.get(id);
  }

  list(): DigitalHuman[] {
    return Array.from(this.digitalHumans.values());
  }

  listByWorkspace(workspaceId: string): DigitalHuman[] {
    return this.list().filter((dh) => dh.workspaceId === workspaceId);
  }

  // --------------------------------------------------------------------------
  // Activity tracking
  // --------------------------------------------------------------------------

  recordActivity(entry: Omit<DHActivityEntry, 'id' | 'timestamp'>): DHActivityEntry {
    const full: DHActivityEntry = {
      ...entry,
      id: uuid(),
      timestamp: Date.now(),
    };

    // Persist to the activity log file
    const activityPath = path.join(this.activitiesDir, `${entry.digitalHumanId}.json`);
    const activities = this.readActivityFile(activityPath);
    activities.push(full);
    fs.writeFileSync(activityPath, JSON.stringify(activities, null, 2), 'utf-8');

    // Update the parent DH's lastRunAt / lastResult
    const dh = this.digitalHumans.get(entry.digitalHumanId);
    if (dh) {
      dh.lastRunAt = full.timestamp;
      dh.lastResult = full;
      dh.updatedAt = full.timestamp;
      this.saveToDisk(dh);
    }

    this.emit('dh:executed', full);
    return full;
  }

  getActivity(digitalHumanId: string, limit = 50): DHActivityEntry[] {
    const activityPath = path.join(this.activitiesDir, `${digitalHumanId}.json`);
    const activities = this.readActivityFile(activityPath);

    // Return most recent first, capped to limit
    return activities
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // Failure tracking
  // --------------------------------------------------------------------------

  incrementFailure(id: string): void {
    const dh = this.digitalHumans.get(id);
    if (!dh) {
      logger.warn(`Digital human not found for failure increment: ${id}`);
      return;
    }

    dh.consecutiveFailures += 1;
    dh.updatedAt = Date.now();

    if (dh.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      dh.status = 'disabled';
      logger.warn(
        `Digital human auto-disabled after ${dh.consecutiveFailures} consecutive failures: ${dh.name} (${id})`,
      );
      this.emit('dh:error', id, `Auto-disabled after ${dh.consecutiveFailures} consecutive failures`);
    }

    this.saveToDisk(dh);
  }

  resetFailures(id: string): void {
    const dh = this.digitalHumans.get(id);
    if (!dh) {
      logger.warn(`Digital human not found for failure reset: ${id}`);
      return;
    }

    dh.consecutiveFailures = 0;
    dh.updatedAt = Date.now();
    this.saveToDisk(dh);
  }

  // --------------------------------------------------------------------------
  // Persistence helpers
  // --------------------------------------------------------------------------

  private loadFromDisk(): void {
    let files: string[];
    try {
      files = fs.readdirSync(this.dataDir).filter((f) => f.endsWith('.json'));
    } catch {
      logger.warn(`Could not read digital-humans data directory: ${this.dataDir}`);
      return;
    }

    for (const file of files) {
      const filePath = path.join(this.dataDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const dh = JSON.parse(raw) as DigitalHuman;

        // Basic validation
        if (!dh.id || !dh.name || !dh.prompt || !dh.schedule) {
          logger.warn(`Skipping invalid digital human config: ${filePath}`);
          continue;
        }

        this.digitalHumans.set(dh.id, dh);
      } catch (err) {
        logger.error(`Failed to load digital human from ${filePath}: ${String(err)}`);
      }
    }
  }

  private saveToDisk(dh: DigitalHuman): void {
    const filePath = path.join(this.dataDir, `${dh.id}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(dh, null, 2), 'utf-8');
    } catch (err) {
      logger.error(`Failed to save digital human ${dh.id}: ${String(err)}`);
    }
  }

  private readActivityFile(filePath: string): DHActivityEntry[] {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as DHActivityEntry[];
    } catch {
      logger.warn(`Corrupt activity file, resetting: ${filePath}`);
      return [];
    }
  }
}
