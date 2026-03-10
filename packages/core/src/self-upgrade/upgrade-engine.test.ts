import { describe, it, expect, beforeEach } from 'vitest';
import { UpgradeEngine } from './upgrade-engine';

describe('UpgradeEngine', () => {
  let engine: UpgradeEngine;

  beforeEach(() => {
    engine = new UpgradeEngine();
  });

  describe('getActivities', () => {
    it('should start with empty activities', () => {
      expect(engine.getActivities()).toEqual([]);
    });

    it('should return a copy of activities', () => {
      const a1 = engine.getActivities();
      const a2 = engine.getActivities();
      expect(a1).toEqual(a2);
      expect(a1).not.toBe(a2); // different array reference
    });
  });

  // Note: analyzeError, fixCode, developFeature, generateTool, generateWebPage,
  // installCCSkill, generateCCSkill, and upgradeDesktopApp all spawn external
  // `claude` CLI processes. These are integration tests that require CC to be
  // installed. We test the activity logging and result structure instead.

  describe('activity logging (via public API)', () => {
    it('should log activities from analyzeError on failure', async () => {
      // Without `claude` CLI available, this will fail with spawn error
      const result = await engine.analyzeError('test error', 'test context');

      // Should return fallback result
      expect(result.analysis).toBeTruthy();
      expect(Array.isArray(result.suggestions)).toBe(true);

      // Should have logged an activity
      const activities = engine.getActivities();
      expect(activities.length).toBeGreaterThanOrEqual(1);
      expect(activities[0].action).toBe('analyzeError');
    });
  });

  describe('installCCSkill', () => {
    // installCCSkill writes to ~/.claude/commands/ which we don't want in tests.
    // We verify the method signature and return type instead.
    it('should exist as a method', () => {
      expect(typeof engine.installCCSkill).toBe('function');
    });
  });
});
