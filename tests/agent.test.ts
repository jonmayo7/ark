// ============================================================================
// Ark — Agent Integration Tests
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent.js';
import { createConfig } from '../src/identity/loader.js';

describe('Agent', () => {
  it('constructs with minimal config', () => {
    const agent = new Agent({
      config: createConfig({ name: 'test-agent' }),
    });
    assert.equal(agent.config.name, 'test-agent');
    assert.ok(agent.sessionId);
  });

  it('boots successfully with memory store', async () => {
    const agent = new Agent({
      config: createConfig({
        name: 'boot-test',
        identity: { soul: 'You are a test agent.' },
        persistence: { adapter: 'memory' },
      }),
    });

    const context = await agent.boot();
    assert.ok(context.system_prompt);
    assert.ok(context.system_prompt.includes('test agent'));

    await agent.shutdown();
  });

  it('registers native tools', async () => {
    const agent = new Agent({
      config: createConfig({
        name: 'tools-test',
        tools: { native: ['file_read', 'shell', 'glob'] },
      }),
    });

    await agent.boot();

    const defs = agent.getTools().getDefinitions();
    assert.equal(defs.length, 3);
    assert.ok(defs.find(d => d.name === 'file_read'));
    assert.ok(defs.find(d => d.name === 'shell'));
    assert.ok(defs.find(d => d.name === 'glob'));

    await agent.shutdown();
  });

  it('registers all native tools when not specified', async () => {
    const agent = new Agent({
      config: createConfig({ name: 'all-tools' }),
    });

    await agent.boot();

    const defs = agent.getTools().getDefinitions();
    assert.ok(defs.length >= 7);

    await agent.shutdown();
  });

  it('persists state across calls', async () => {
    const agent = new Agent({
      config: createConfig({ name: 'state-test' }),
    });

    await agent.boot();
    const store = agent.getStore();

    await store.setState('test_key', { value: 42 });
    const val = await store.getState('test_key');
    assert.deepEqual(val, { value: 42 });

    await agent.shutdown();
  });

  it('writes session handoff on shutdown', async () => {
    const agent = new Agent({
      config: createConfig({
        name: 'handoff-test',
        behavior: { session_handoff: true },
      }),
    });

    await agent.boot();
    const store = agent.getStore();

    // Manually write a handoff
    await agent.writeHandoff({
      active_work: 'Testing handoff write',
      key_decisions: 'Using memory store for tests',
    });

    const handoff = await store.getLatestHandoff();
    assert.ok(handoff);
    assert.equal(handoff.active_work, 'Testing handoff write');

    await agent.shutdown();
  });

  it('logs to ledger', async () => {
    const agent = new Agent({
      config: createConfig({ name: 'ledger-test' }),
    });

    await agent.boot();

    await agent.logLedger({
      type: 'win',
      what: 'Agent test passed',
    });

    await agent.logLedger({
      type: 'mistake',
      what: 'Missed edge case',
      pattern: 'incomplete-testing',
      severity: 'low',
    });

    const store = agent.getStore();
    const entries = await store.getLedger();
    assert.ok(entries.length >= 2);

    await agent.shutdown();
  });

  it('stores knowledge in mind', async () => {
    const agent = new Agent({
      config: createConfig({ name: 'remember-test' }),
    });

    await agent.boot();

    const id = await agent.remember(
      'Ark is a model-agnostic agent framework.',
      { node_type: 'fact', domain: 'ark', tags: ['architecture'] },
    );
    assert.ok(id);

    const store = agent.getStore();
    const mind = await store.getMind();
    assert.ok(mind.find(n => n.content.includes('model-agnostic')));

    await agent.shutdown();
  });

  it('fires lifecycle hooks', async () => {
    const events: string[] = [];

    const agent = new Agent({
      config: createConfig({ name: 'hooks-test' }),
      hooks: {
        onBoot: async () => { events.push('boot'); },
        onShutdown: async () => { events.push('shutdown'); },
      },
    });

    await agent.boot();
    assert.ok(events.includes('boot'));

    await agent.shutdown();
    assert.ok(events.includes('shutdown'));
  });

  it('provides usage stats', async () => {
    const agent = new Agent({
      config: createConfig({ name: 'usage-test' }),
    });

    await agent.boot();

    const usage = agent.getUsage();
    assert.ok(Array.isArray(usage));
    assert.equal(usage.length, 0); // No LLM calls yet

    await agent.shutdown();
  });

  it('tracks conversation messages', async () => {
    const agent = new Agent({
      config: createConfig({ name: 'messages-test' }),
    });

    await agent.boot();

    const messages = agent.getMessages();
    assert.ok(Array.isArray(messages));
    assert.equal(messages.length, 0); // No messages yet

    await agent.shutdown();
  });
});
