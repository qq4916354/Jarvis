// ============================================================================
// Jarvis Skill Manager – manage Claude Code slash-command skills
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { v4 as uuid } from 'uuid';

import type { CCSkill } from '../types';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'commands');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function normalizeSkillName(name: string): string {
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

function skillFileName(name: string): string {
  const normalized = normalizeSkillName(name);
  return `${normalized}.md`;
}

/**
 * Run Claude Code in --print mode and return stdout.
 */
function runCCPrint(prompt: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc: ChildProcess = spawn('claude', ['--print', prompt], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
  });
}

// ---------------------------------------------------------------------------
// SkillManager
// ---------------------------------------------------------------------------

export class SkillManager {

  // -----------------------------------------------------------------------
  // install
  // -----------------------------------------------------------------------

  /**
   * Install a skill (markdown file) to ~/.claude/commands/.
   */
  install(name: string, content: string): CCSkill {
    ensureDir(SKILLS_DIR);
    const normalized = normalizeSkillName(name);
    const fileName = skillFileName(normalized);
    const installPath = path.join(SKILLS_DIR, fileName);

    fs.writeFileSync(installPath, content, 'utf-8');
    logger.info(`[SkillManager] Installed skill: ${normalized} at ${installPath}`);

    return {
      name: normalized,
      description: content.split('\n')[0]?.replace(/^#\s*/, '') ?? normalized,
      content,
      installPath,
    };
  }

  // -----------------------------------------------------------------------
  // uninstall
  // -----------------------------------------------------------------------

  /**
   * Remove a skill by name.
   */
  uninstall(name: string): boolean {
    const normalized = normalizeSkillName(name);
    const installPath = path.join(SKILLS_DIR, skillFileName(normalized));

    if (!fs.existsSync(installPath)) {
      logger.warn(`[SkillManager] Skill not found for uninstall: ${normalized}`);
      return false;
    }

    fs.unlinkSync(installPath);
    logger.info(`[SkillManager] Uninstalled skill: ${normalized}`);
    return true;
  }

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------

  /**
   * List all installed skills in ~/.claude/commands/.
   */
  list(): CCSkill[] {
    ensureDir(SKILLS_DIR);
    const files = fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md'));

    return files.map((fileName) => {
      const installPath = path.join(SKILLS_DIR, fileName);
      const content = fs.readFileSync(installPath, 'utf-8');
      const name = normalizeSkillName(fileName);

      return {
        name,
        description: content.split('\n')[0]?.replace(/^#\s*/, '') ?? name,
        content,
        installPath,
      };
    });
  }

  // -----------------------------------------------------------------------
  // generate
  // -----------------------------------------------------------------------

  /**
   * Use CC to generate a new skill from a natural-language description,
   * then install it.
   */
  async generate(description: string): Promise<CCSkill | null> {
    const prompt = [
      'Generate a Claude Code slash command skill in Markdown format.',
      'The skill should follow this structure:',
      '  - A top-level heading with a short skill name',
      '  - A brief description paragraph',
      '  - Step-by-step instructions for Claude to follow when the skill is invoked',
      '  - Any relevant constraints or best practices',
      '',
      '--- Desired Skill ---',
      description,
      '',
      'Output ONLY the Markdown content for the skill file. Do not wrap in code fences.',
    ].join('\n');

    const result = await runCCPrint(prompt);

    if (result.exitCode !== 0) {
      logger.error(`[SkillManager] Failed to generate skill: ${result.stderr}`);
      return null;
    }

    const generatedContent = result.stdout.trim();

    // Derive name from first heading line
    const firstLine = generatedContent.split('\n')[0] ?? '';
    const derivedName = firstLine
      .replace(/^#\s*/, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase()
      .replace(/^-|-$/g, '') || `skill-${uuid().slice(0, 8)}`;

    const skill = this.install(derivedName, generatedContent);
    logger.info(`[SkillManager] Generated and installed skill: ${derivedName}`);
    return skill;
  }

  // -----------------------------------------------------------------------
  // getSkillPath
  // -----------------------------------------------------------------------

  /**
   * Get the file path for a named skill.
   */
  getSkillPath(name: string): string {
    const normalized = normalizeSkillName(name);
    return path.join(SKILLS_DIR, skillFileName(normalized));
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  /**
   * Check whether a skill is installed.
   */
  exists(name: string): boolean {
    return fs.existsSync(this.getSkillPath(name));
  }

  /**
   * Read the content of an installed skill.
   */
  read(name: string): string | null {
    const skillPath = this.getSkillPath(name);
    if (!fs.existsSync(skillPath)) return null;
    return fs.readFileSync(skillPath, 'utf-8');
  }
}
