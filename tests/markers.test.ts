// ============================================================================
// Ark — Marker Processing Tests
// ============================================================================

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { processMarkers, getMarkerInstructions } from '../src/learning/markers.js';
import { MemoryStore } from '../src/persistence/memory.js';
import type { Store } from '../src/persistence/types.js';

describe('Marker Processing', () => {
  let store: Store;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.init();
  });

  describe('processMarkers', () => {
    it('strips markers from visible text', async () => {
      const text = 'Hello! How are you?[MEMORY]{"content":"User greeted me","category":"interaction","importance":0.3}[/MEMORY] Have a great day!';
      const result = await processMarkers(text, store);

      assert.equal(result.cleanText, 'Hello! How are you? Have a great day!');
    });

    it('processes MEMORY markers', async () => {
      const text = 'Sure![MEMORY]{"content":"Prefers dark mode","category":"preference","importance":0.7}[/MEMORY]';
      const result = await processMarkers(text, store);

      assert.equal(result.processed.length, 1);
      assert.equal(result.processed[0].type, 'MEMORY');

      // Give async handler time to complete
      await new Promise(r => setTimeout(r, 10));

      const mind = await store.getMind();
      assert.equal(mind.length, 1);
      assert.equal(mind[0].content, 'Prefers dark mode');
      assert.equal(mind[0].signal, 0.7);
    });

    it('processes STATE markers', async () => {
      const text = 'Got it.[STATE]{"emotional_state":"focused","current_topic":"debugging"}[/STATE]';
      const result = await processMarkers(text, store);

      assert.equal(result.processed.length, 1);
      assert.equal(result.processed[0].type, 'STATE');

      await new Promise(r => setTimeout(r, 10));

      const emotion = await store.getState('emotional_state');
      assert.equal(emotion, 'focused');
      const topic = await store.getState('current_topic');
      assert.equal(topic, 'debugging');
    });

    it('processes WIN markers', async () => {
      const text = 'Done![WIN]{"what":"Refactored the auth module successfully"}[/WIN]';
      const result = await processMarkers(text, store);

      assert.equal(result.processed.length, 1);

      await new Promise(r => setTimeout(r, 10));

      const ledger = await store.getLedger();
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].entry_type, 'win');
      assert.ok(ledger[0].what.includes('auth module'));
    });

    it('processes MISTAKE markers', async () => {
      const text = 'Oops.[MISTAKE]{"what":"Used wrong API endpoint","why":"Assumed v1 when it was v2","should_have":"Checked docs first","pattern":"api_version"}[/MISTAKE]';
      const result = await processMarkers(text, store);

      assert.equal(result.processed.length, 1);

      await new Promise(r => setTimeout(r, 10));

      const ledger = await store.getLedger();
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].entry_type, 'mistake');
      assert.equal(ledger[0].pattern, 'api_version');
    });

    it('processes SOUL markers', async () => {
      const text = 'Noted.[SOUL]{"directive":"Always confirm before deleting files","category":"behavior"}[/SOUL]';
      const result = await processMarkers(text, store);

      assert.equal(result.processed.length, 1);

      await new Promise(r => setTimeout(r, 10));

      const soul = await store.getSoul();
      assert.equal(soul.length, 1);
      assert.ok(soul[0].directive.includes('confirm before deleting'));
    });

    it('handles multiple markers in one response', async () => {
      const text = [
        'Here is your answer.',
        '[MEMORY]{"content":"User likes TypeScript","category":"preference","importance":0.6}[/MEMORY]',
        '[STATE]{"mood":"happy"}[/STATE]',
        '[WIN]{"what":"Answered correctly on first try"}[/WIN]',
        'Anything else?',
      ].join('\n');

      const result = await processMarkers(text, store);

      assert.equal(result.processed.length, 3);
      assert.ok(result.cleanText.includes('Here is your answer.'));
      assert.ok(result.cleanText.includes('Anything else?'));
      assert.ok(!result.cleanText.includes('[MEMORY]'));
      assert.ok(!result.cleanText.includes('[STATE]'));
      assert.ok(!result.cleanText.includes('[WIN]'));
    });

    it('handles malformed JSON gracefully', async () => {
      const text = 'Hello[MEMORY]{bad json}[/MEMORY] world';
      const result = await processMarkers(text, store);

      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].type, 'MEMORY');
      assert.equal(result.cleanText, 'Hello world');
    });

    it('returns clean result when no markers present', async () => {
      const text = 'Just a normal response with no markers.';
      const result = await processMarkers(text, store);

      assert.equal(result.cleanText, text);
      assert.equal(result.processed.length, 0);
      assert.equal(result.errors.length, 0);
    });

    it('collapses extra whitespace after marker removal', async () => {
      const text = 'Line 1\n\n\n[MEMORY]{"content":"x","category":"y","importance":0.1}[/MEMORY]\n\n\nLine 2';
      const result = await processMarkers(text, store);

      assert.ok(!result.cleanText.includes('\n\n\n'));
    });
  });

  describe('getMarkerInstructions', () => {
    it('returns non-empty instruction string', () => {
      const instructions = getMarkerInstructions();
      assert.ok(instructions.length > 100);
      assert.ok(instructions.includes('[MEMORY]'));
      assert.ok(instructions.includes('[STATE]'));
      assert.ok(instructions.includes('[WIN]'));
      assert.ok(instructions.includes('[MISTAKE]'));
      assert.ok(instructions.includes('[SOUL]'));
    });
  });
});
