import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const { TEST_HOME } = vi.hoisted(() => {
  // vi.hoisted runs before imports, so we can't use `os` or `path` here
  const tmpdir = process.env.TMPDIR || process.env.TEMP || '/tmp';
  return { TEST_HOME: `${tmpdir}/jarvis-skills-test-${process.pid}` };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    default: {
      ...actual,
      homedir: () => TEST_HOME,
    },
    homedir: () => TEST_HOME,
  };
});

import { SkillManager } from './skill-manager';

const MOCK_SKILLS_DIR = path.join(TEST_HOME, '.claude', 'commands');

describe('SkillManager', () => {
  let mgr: SkillManager;

  beforeEach(() => {
    fs.mkdirSync(MOCK_SKILLS_DIR, { recursive: true });
    mgr = new SkillManager();
  });

  afterEach(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  describe('install', () => {
    it('should install a skill as a markdown file', () => {
      const skill = mgr.install('my-skill', '# My Skill\nDo something useful');

      expect(skill.name).toBe('my-skill');
      expect(skill.description).toBe('My Skill');
      expect(skill.content).toBe('# My Skill\nDo something useful');
      expect(skill.installPath).toContain('my-skill.md');
      expect(fs.existsSync(skill.installPath)).toBe(true);
    });

    it('should strip .md from name if provided', () => {
      const skill = mgr.install('my-skill.md', '# My Skill\nContent');
      expect(skill.name).toBe('my-skill');
    });

    it('should extract description from first heading', () => {
      const skill = mgr.install('test', '# Cool Tool\nRest of content');
      expect(skill.description).toBe('Cool Tool');
    });

    it('should overwrite existing skill', () => {
      mgr.install('overwrite-me', '# V1');
      mgr.install('overwrite-me', '# V2');

      const content = fs.readFileSync(
        path.join(MOCK_SKILLS_DIR, 'overwrite-me.md'),
        'utf-8',
      );
      expect(content).toBe('# V2');
    });
  });

  describe('uninstall', () => {
    it('should remove an installed skill', () => {
      mgr.install('to-remove', '# Removable');
      const result = mgr.uninstall('to-remove');

      expect(result).toBe(true);
      expect(fs.existsSync(path.join(MOCK_SKILLS_DIR, 'to-remove.md'))).toBe(false);
    });

    it('should return false for non-existent skill', () => {
      expect(mgr.uninstall('non-existent')).toBe(false);
    });
  });

  describe('list', () => {
    it('should list all installed skills', () => {
      mgr.install('skill-a', '# Skill A\nContent A');
      mgr.install('skill-b', '# Skill B\nContent B');

      const skills = mgr.list();
      expect(skills).toHaveLength(2);
      const names = skills.map(s => s.name);
      expect(names).toContain('skill-a');
      expect(names).toContain('skill-b');
    });

    it('should return empty array when no skills installed', () => {
      const files = fs.readdirSync(MOCK_SKILLS_DIR);
      for (const f of files) {
        fs.unlinkSync(path.join(MOCK_SKILLS_DIR, f));
      }
      expect(mgr.list()).toEqual([]);
    });

    it('should only list .md files', () => {
      mgr.install('valid', '# Valid');
      fs.writeFileSync(path.join(MOCK_SKILLS_DIR, 'not-a-skill.txt'), 'text', 'utf-8');

      const skills = mgr.list();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('valid');
    });
  });

  describe('exists', () => {
    it('should return true for installed skill', () => {
      mgr.install('exists-test', '# Test');
      expect(mgr.exists('exists-test')).toBe(true);
    });

    it('should return false for non-existent skill', () => {
      expect(mgr.exists('nope')).toBe(false);
    });
  });

  describe('read', () => {
    it('should read skill content', () => {
      mgr.install('readable', '# Readable\nContent here');
      expect(mgr.read('readable')).toBe('# Readable\nContent here');
    });

    it('should return null for non-existent skill', () => {
      expect(mgr.read('missing')).toBeNull();
    });
  });

  describe('getSkillPath', () => {
    it('should return the expected file path', () => {
      const p = mgr.getSkillPath('my-skill');
      expect(p).toContain('my-skill.md');
      expect(p).toContain('.claude');
      expect(p).toContain('commands');
    });
  });
});
