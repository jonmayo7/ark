// ============================================================================
// Ark — Self-Correction Loop Tests
// ============================================================================

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLearningEngine, type LearningEngine } from '../src/learning/index.js';
import { MemoryStore } from '../src/persistence/memory.js';
import type { Store } from '../src/persistence/types.js';

describe('Self-Correction Loop', () => {
  let store: Store;
  let engine: LearningEngine;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.init();
    engine = createLearningEngine(store, { log_mistakes: true });
  });

  describe('logToolError', () => {
    it('logs a tool error to the ledger', async () => {
      await engine.logToolError('file_read', { path: '/missing' }, 'No such file');

      const ledger = await store.getLedger();
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].entry_type, 'mistake');
      assert.ok(ledger[0].what.includes('file_read'));
      assert.ok(ledger[0].what.includes('No such file'));
      assert.equal(ledger[0].pattern, 'file_read_not_found');
    });

    it('derives correct patterns from errors', async () => {
      await engine.logToolError('shell', {}, 'Permission denied');
      await engine.logToolError('http_fetch', {}, 'Request timeout after 30s');
      await engine.logToolError('file_write', {}, 'Syntax error in JSON');
      await engine.logToolError('glob', {}, 'Something unknown happened');

      const ledger = await store.getLedger();
      const patterns = ledger.map(e => e.pattern);

      assert.ok(patterns.includes('shell_permission'));
      assert.ok(patterns.includes('http_fetch_timeout'));
      assert.ok(patterns.includes('file_write_syntax'));
      assert.ok(patterns.includes('glob_error'));
    });

    it('includes correction suggestion', async () => {
      await engine.logToolError('file_read', { path: '/x' }, 'File not found');

      const ledger = await store.getLedger();
      assert.ok(ledger[0].should_have);
      assert.ok(ledger[0].should_have!.includes('Verify'));
    });
  });

  describe('logWin', () => {
    it('logs a win to the ledger', async () => {
      await engine.logWin('Refactored auth module', 'Reduced complexity');

      const ledger = await store.getLedger();
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].entry_type, 'win');
      assert.equal(ledger[0].what, 'Refactored auth module');
      assert.equal(ledger[0].why, 'Reduced complexity');
    });
  });

  describe('pattern promotion', () => {
    it('promotes a pattern to soul directive after threshold', async () => {
      // Log the same pattern 3 times (default threshold)
      await engine.logToolError('file_read', { path: '/a' }, 'No such file /a');
      await engine.logToolError('file_read', { path: '/b' }, 'No such file /b');
      await engine.logToolError('file_read', { path: '/c' }, 'No such file /c');

      // The 3rd call should have triggered promotion
      const soul = await store.getSoul();
      const autoDirectives = soul.filter(s => s.category?.startsWith('auto:'));

      assert.equal(autoDirectives.length, 1);
      assert.ok(autoDirectives[0].directive.includes('AUTO-PROMOTED'));
      assert.ok(autoDirectives[0].directive.includes('file_read'));
      assert.equal(autoDirectives[0].category, 'auto:file_read_not_found');
    });

    it('does not promote below threshold', async () => {
      await engine.logToolError('shell', {}, 'Permission denied');
      await engine.logToolError('shell', {}, 'Permission denied');
      // Only 2 — below default threshold of 3

      const soul = await store.getSoul();
      assert.equal(soul.filter(s => s.category?.startsWith('auto:')).length, 0);
    });

    it('does not duplicate promotions', async () => {
      await engine.logToolError('file_read', {}, 'Not found');
      await engine.logToolError('file_read', {}, 'Not found');
      await engine.logToolError('file_read', {}, 'Not found');
      // Promoted once

      await engine.logToolError('file_read', {}, 'Not found');
      // 4th time — should not create duplicate

      const soul = await store.getSoul();
      const autoDirectives = soul.filter(s => s.category?.startsWith('auto:'));
      assert.equal(autoDirectives.length, 1);
    });

    it('respects custom threshold', async () => {
      const customEngine = createLearningEngine(store, { log_mistakes: true }, 2);

      await customEngine.logToolError('shell', {}, 'Timeout');
      await customEngine.logToolError('shell', {}, 'Timeout');

      const soul = await store.getSoul();
      assert.equal(soul.filter(s => s.category?.startsWith('auto:')).length, 1);
    });

    it('promotePatterns scans ledger and promotes', async () => {
      // Manually add mistakes without auto-promotion
      const noAutoEngine = createLearningEngine(store, { log_mistakes: true }, 999);

      await noAutoEngine.logToolError('glob', {}, 'Some error');
      await noAutoEngine.logToolError('glob', {}, 'Some error');
      await noAutoEngine.logToolError('glob', {}, 'Some error');

      // Now use an engine with threshold=3 to check
      const checkEngine = createLearningEngine(store, { log_mistakes: true }, 3);
      const results = await checkEngine.promotePatterns();

      assert.equal(results.length, 1);
      assert.equal(results[0].pattern, 'glob_error');
      assert.equal(results[0].count, 3);
    });
  });

  describe('disabled', () => {
    it('does nothing when log_mistakes is false', async () => {
      const disabledEngine = createLearningEngine(store, { log_mistakes: false });

      await disabledEngine.logToolError('file_read', {}, 'Not found');
      await disabledEngine.logWin('something');

      const ledger = await store.getLedger();
      assert.equal(ledger.length, 0);
    });
  });
});
