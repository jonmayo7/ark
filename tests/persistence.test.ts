// ============================================================================
// Ark — Persistence Layer Tests
// ============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/persistence/memory.js';
import { SQLiteStore } from '../src/persistence/sqlite.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Store } from '../src/persistence/types.js';

// Run the same test suite against both stores
function testStore(name: string, createFn: () => { store: Store; cleanup: () => void }) {
  describe(`${name} Store`, () => {
    let store: Store;
    let cleanup: () => void;

    before(async () => {
      const result = createFn();
      store = result.store;
      cleanup = result.cleanup;
      await store.init();
    });

    after(async () => {
      await store.close();
      cleanup();
    });

    // --- Soul ---
    describe('Soul Directives', () => {
      it('starts empty', async () => {
        const soul = await store.getSoul();
        assert.equal(soul.length, 0);
      });

      it('adds a directive', async () => {
        const id = await store.addSoulDirective({
          directive: 'Be direct and concise.',
          category: 'communication',
          priority: 1,
          active: true,
        });
        assert.ok(id);

        const soul = await store.getSoul();
        assert.equal(soul.length, 1);
        assert.equal(soul[0].directive, 'Be direct and concise.');
        assert.equal(soul[0].category, 'communication');
        assert.equal(soul[0].priority, 1);
      });

      it('adds multiple directives sorted by priority', async () => {
        await store.addSoulDirective({
          directive: 'Low priority directive',
          category: 'general',
          priority: 5,
          active: true,
        });
        await store.addSoulDirective({
          directive: 'High priority directive',
          category: 'critical',
          priority: 1,
          active: true,
        });

        const soul = await store.getSoul();
        assert.ok(soul.length >= 3);
        // Should be sorted by priority
        for (let i = 1; i < soul.length; i++) {
          assert.ok(soul[i].priority >= soul[i - 1].priority);
        }
      });

      it('updates a directive', async () => {
        const soul = await store.getSoul();
        const first = soul[0];
        await store.updateSoulDirective(first.id, { active: false });

        const updated = await store.getSoul();
        // Inactive directive should be filtered out
        assert.ok(!updated.find(s => s.id === first.id));
      });
    });

    // --- Mind ---
    describe('Mind (Knowledge Graph)', () => {
      it('adds and retrieves mind nodes', async () => {
        const id = await store.addMindNode({
          content: 'SQLite is a serverless database engine.',
          node_type: 'fact',
          domain: 'tech',
          signal: 0.8,
          heat: 1.0,
          depth: 3,
          tags: ['database', 'sqlite'],
        });
        assert.ok(id);

        const mind = await store.getMind(10);
        assert.ok(mind.length >= 1);
        const node = mind.find(n => n.id === id);
        assert.ok(node);
        assert.equal(node.content, 'SQLite is a serverless database engine.');
        assert.equal(node.node_type, 'fact');
        assert.deepEqual(node.tags, ['database', 'sqlite']);
      });

      it('searches mind nodes', async () => {
        await store.addMindNode({
          content: 'TypeScript adds static types to JavaScript.',
          node_type: 'fact',
          domain: 'tech',
          signal: 0.9,
          heat: 1.0,
          depth: 2,
          tags: ['typescript', 'javascript'],
        });

        const results = await store.searchMind('TypeScript');
        assert.ok(results.length >= 1);
        assert.ok(results[0].content.includes('TypeScript'));
      });

      it('updates a mind node', async () => {
        const mind = await store.getMind(1);
        const node = mind[0];
        await store.updateMindNode(node.id, { heat: 0.5, signal: 0.3 });

        const updated = await store.getMind(100);
        const found = updated.find(n => n.id === node.id);
        assert.ok(found);
        assert.equal(found.heat, 0.5);
        assert.equal(found.signal, 0.3);
      });
    });

    // --- Ledger ---
    describe('Ledger (Wins & Mistakes)', () => {
      it('logs a win', async () => {
        const id = await store.addLedgerEntry({
          entry_type: 'win',
          what: 'Completed task ahead of schedule',
          pattern: 'efficient-execution',
        });
        assert.ok(id);
      });

      it('logs a mistake', async () => {
        const id = await store.addLedgerEntry({
          entry_type: 'mistake',
          what: 'Forgot to verify file write',
          why: 'Assumed tool output meant success',
          should_have: 'Read the file back to confirm',
          pattern: 'incomplete-verification',
          severity: 'medium',
        });
        assert.ok(id);
      });

      it('retrieves ledger entries', async () => {
        const entries = await store.getLedger();
        assert.ok(entries.length >= 2);
      });

      it('counts patterns', async () => {
        await store.addLedgerEntry({
          entry_type: 'mistake',
          what: 'Another verification miss',
          pattern: 'incomplete-verification',
        });

        const count = await store.countPattern('incomplete-verification');
        assert.ok(count >= 2);
      });
    });

    // --- State ---
    describe('State (Key-Value)', () => {
      it('sets and gets state', async () => {
        await store.setState('emotional_state', { state: 'focused', trigger: 'deep work' });
        const val = await store.getState('emotional_state');
        assert.deepEqual(val, { state: 'focused', trigger: 'deep work' });
      });

      it('returns null for missing key', async () => {
        const val = await store.getState('nonexistent');
        assert.equal(val, null);
      });

      it('overwrites existing state', async () => {
        await store.setState('counter', 1);
        await store.setState('counter', 2);
        const val = await store.getState('counter');
        assert.equal(val, 2);
      });

      it('gets all state', async () => {
        const all = await store.getAllState();
        assert.ok('emotional_state' in all);
        assert.ok('counter' in all);
      });
    });

    // --- Handoff ---
    describe('Session Handoff', () => {
      it('starts with no handoff', async () => {
        const h = await store.getLatestHandoff();
        assert.equal(h, null);
      });

      it('writes and retrieves handoff', async () => {
        await store.writeHandoff({
          active_work: 'Building ark agent system',
          key_decisions: 'Using SQLite as default store',
          open_questions: 'MCP integration approach',
          next_actions: 'Write tests, then CLI',
          context_for_next: 'All core modules complete',
        });

        const h = await store.getLatestHandoff();
        assert.ok(h);
        assert.equal(h.active_work, 'Building ark agent system');
        assert.equal(h.key_decisions, 'Using SQLite as default store');
      });

      it('returns latest handoff', async () => {
        await store.writeHandoff({
          active_work: 'Running tests',
          next_actions: 'Fix any failures',
        });

        const h = await store.getLatestHandoff();
        assert.ok(h);
        assert.equal(h.active_work, 'Running tests');
      });
    });

    // --- Conversations ---
    describe('Conversations', () => {
      const sessionId = 'test-session-001';

      it('adds conversation turns', async () => {
        await store.addConversationTurn({
          session_id: sessionId,
          role: 'user',
          content: 'Hello, how are you?',
        });
        await store.addConversationTurn({
          session_id: sessionId,
          role: 'assistant',
          content: 'I am well. How can I help?',
        });

        const turns = await store.getConversation(sessionId);
        assert.equal(turns.length, 2);
        assert.equal(turns[0].role, 'user');
        assert.equal(turns[1].role, 'assistant');
      });

      it('lists sessions', async () => {
        // Add another session
        await store.addConversationTurn({
          session_id: 'test-session-002',
          role: 'user',
          content: 'New session',
        });

        const sessions = await store.listSessions();
        assert.ok(sessions.length >= 2);
      });
    });
  });
}

// Run tests for Memory store
testStore('Memory', () => ({
  store: new MemoryStore(),
  cleanup: () => {},
}));

// Run tests for SQLite store
testStore('SQLite', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ark-test-'));
  const dbPath = join(tmpDir, 'test.db');
  return {
    store: new SQLiteStore(dbPath),
    cleanup: () => {
      try { rmSync(tmpDir, { recursive: true }); } catch {}
    },
  };
});
