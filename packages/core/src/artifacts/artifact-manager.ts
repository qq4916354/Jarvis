// ============================================================================
// ArtifactManager - Tracks files created/modified by the agent in a workspace
// ============================================================================

import { EventEmitter } from 'eventemitter3';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import logger from '../utils/logger.js';

// --- Types ------------------------------------------------------------------

export type ArtifactType = 'code' | 'html' | 'markdown' | 'image' | 'json' | 'yaml' | 'text' | 'binary';

export interface Artifact {
  id: string;
  workspaceId: string;
  filePath: string;        // relative to workspace
  absolutePath: string;
  fileName: string;
  extension: string;
  type: ArtifactType;
  size: number;
  createdAt: number;
  updatedAt: number;
  content?: string;        // cached content for preview
  diff?: string;           // diff from previous version
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  artifact?: Artifact;
}

// --- Extension mapping ------------------------------------------------------

const EXTENSION_TYPE_MAP: Record<string, ArtifactType> = {
  // Code
  '.ts': 'code',
  '.tsx': 'code',
  '.js': 'code',
  '.jsx': 'code',
  '.py': 'code',
  '.rb': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.java': 'code',
  '.c': 'code',
  '.cpp': 'code',
  '.h': 'code',
  '.hpp': 'code',
  '.cs': 'code',
  '.swift': 'code',
  '.kt': 'code',
  '.sh': 'code',
  '.bash': 'code',
  '.zsh': 'code',
  '.fish': 'code',
  '.sql': 'code',
  '.css': 'code',
  '.scss': 'code',
  '.less': 'code',
  '.vue': 'code',
  '.svelte': 'code',
  '.php': 'code',
  '.lua': 'code',
  '.r': 'code',
  '.dart': 'code',
  '.zig': 'code',
  // HTML
  '.html': 'html',
  '.htm': 'html',
  '.xhtml': 'html',
  // Markdown
  '.md': 'markdown',
  '.mdx': 'markdown',
  // Image
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.svg': 'image',
  '.webp': 'image',
  '.ico': 'image',
  '.bmp': 'image',
  // JSON
  '.json': 'json',
  '.jsonc': 'json',
  '.json5': 'json',
  // YAML
  '.yml': 'yaml',
  '.yaml': 'yaml',
  // Text
  '.txt': 'text',
  '.log': 'text',
  '.csv': 'text',
  '.tsv': 'text',
  '.env': 'text',
  '.ini': 'text',
  '.cfg': 'text',
  '.conf': 'text',
  '.toml': 'text',
  '.xml': 'text',
};

/** Maximum file size (in bytes) for reading content previews. */
const MAX_CONTENT_SIZE = 100 * 1024; // 100 KB

// --- Helpers ----------------------------------------------------------------

/**
 * Infer the artifact type from a file extension.
 */
export function inferArtifactType(extension: string): ArtifactType {
  const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return EXTENSION_TYPE_MAP[ext] ?? 'binary';
}

// --- ArtifactManager --------------------------------------------------------

interface ArtifactEvents {
  'artifact:added': (artifact: Artifact) => void;
  'artifact:updated': (artifact: Artifact) => void;
  'artifact:removed': (artifact: Artifact) => void;
}

export class ArtifactManager extends EventEmitter<ArtifactEvents> {
  private readonly artifacts = new Map<string, Artifact>();
  private readonly pathIndex = new Map<string, string>(); // filePath -> id
  private readonly workspacePath: string;
  private readonly workspaceId: string;

  constructor(workspacePath: string, workspaceId: string) {
    super();
    this.workspacePath = workspacePath;
    this.workspaceId = workspaceId;
    logger.debug(`[ArtifactManager] Initialized for workspace ${workspaceId}`);
  }

  /**
   * Track a file as an artifact. If the file is already tracked, it will be
   * updated with the latest metadata. Returns the created or updated artifact.
   */
  trackFile(absolutePath: string, diff?: string): Artifact {
    const filePath = path.relative(this.workspacePath, absolutePath);
    const fileName = path.basename(absolutePath);
    const extension = path.extname(absolutePath).toLowerCase();
    const type = inferArtifactType(extension);
    const now = Date.now();

    let size = 0;
    try {
      const stat = fs.statSync(absolutePath);
      size = stat.size;
    } catch {
      logger.warn(`[ArtifactManager] Unable to stat file: ${absolutePath}`);
    }

    const existingId = this.pathIndex.get(filePath);
    if (existingId) {
      const existing = this.artifacts.get(existingId)!;
      const updated: Artifact = {
        ...existing,
        size,
        updatedAt: now,
        diff: diff ?? existing.diff,
        content: undefined, // invalidate cached content
      };
      this.artifacts.set(existingId, updated);
      logger.debug(`[ArtifactManager] Updated artifact: ${filePath}`);
      this.emit('artifact:updated', updated);
      return updated;
    }

    const artifact: Artifact = {
      id: uuid(),
      workspaceId: this.workspaceId,
      filePath,
      absolutePath,
      fileName,
      extension,
      type,
      size,
      createdAt: now,
      updatedAt: now,
      diff,
    };

    this.artifacts.set(artifact.id, artifact);
    this.pathIndex.set(filePath, artifact.id);
    logger.debug(`[ArtifactManager] Added artifact: ${filePath}`);
    this.emit('artifact:added', artifact);
    return artifact;
  }

  /**
   * Return all tracked artifacts sorted by updatedAt descending.
   */
  getArtifacts(): Artifact[] {
    return Array.from(this.artifacts.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Get a single artifact by its id.
   */
  getArtifact(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  /**
   * Get a single artifact by its workspace-relative file path.
   */
  getArtifactByPath(filePath: string): Artifact | undefined {
    const id = this.pathIndex.get(filePath);
    return id ? this.artifacts.get(id) : undefined;
  }

  /**
   * Build a tree structure from all tracked artifacts.
   */
  getFileTree(): FileTreeNode[] {
    const root: FileTreeNode = {
      name: '',
      path: '',
      type: 'directory',
      children: [],
    };

    const artifacts = this.getArtifacts();

    for (const artifact of artifacts) {
      const parts = artifact.filePath.split(path.sep);
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;
        const currentPath = parts.slice(0, i + 1).join(path.sep);

        if (isFile) {
          current.children!.push({
            name: part,
            path: currentPath,
            type: 'file',
            artifact,
          });
        } else {
          let dir = current.children!.find(
            (child) => child.type === 'directory' && child.name === part,
          );
          if (!dir) {
            dir = {
              name: part,
              path: currentPath,
              type: 'directory',
              children: [],
            };
            current.children!.push(dir);
          }
          current = dir;
        }
      }
    }

    return root.children ?? [];
  }

  /**
   * Read file content for an artifact. Returns null if the file cannot be read
   * or exceeds the maximum content size.
   */
  readContent(id: string): string | null {
    const artifact = this.artifacts.get(id);
    if (!artifact) {
      logger.warn(`[ArtifactManager] Artifact not found: ${id}`);
      return null;
    }

    if (artifact.type === 'binary' || artifact.type === 'image') {
      logger.debug(`[ArtifactManager] Skipping content read for binary/image: ${artifact.filePath}`);
      return null;
    }

    if (artifact.size > MAX_CONTENT_SIZE) {
      logger.debug(`[ArtifactManager] File too large for content read: ${artifact.filePath} (${artifact.size} bytes)`);
      return null;
    }

    try {
      const content = fs.readFileSync(artifact.absolutePath, 'utf-8');
      // Cache the content on the artifact
      artifact.content = content;
      this.artifacts.set(id, artifact);
      return content;
    } catch (err) {
      logger.warn(`[ArtifactManager] Failed to read file: ${artifact.absolutePath}`, err);
      return null;
    }
  }

  /**
   * Clear all tracked artifacts.
   */
  clear(): void {
    const removed = Array.from(this.artifacts.values());
    this.artifacts.clear();
    this.pathIndex.clear();
    for (const artifact of removed) {
      this.emit('artifact:removed', artifact);
    }
    logger.debug(`[ArtifactManager] Cleared ${removed.length} artifacts`);
  }
}
