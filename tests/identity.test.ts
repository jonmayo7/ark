// ============================================================================
// Ark — Identity & Boot Tests
// ============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, createConfig } from '../src/identity/loader.js';
import { bootAgent } from '../src/identity/boot.js';
import { MemoryStore } from '../src/persistence/memory.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Config Loader', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ark-config-'));
  });

  after(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it('loads a YAML config', () => {
    const configPath = join(tmpDir, 'agent.yaml');
    writeFileSync(configPath, `
name: test-agent
identity:
  soul: "You are a test agent."
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250514
persistence:
  adapter: memory
`);

    const config = loadConfig(configPath);
    assert.equal(config.name, 'test-agent');
    assert.equal(config.identity.soul, 'You are a test agent.');
    assert.equal(config.llm.provider, 'anthropic');
    assert.equal(config.persistence.adapter, 'memory');
  });

  it('applies defaults', () => {
    const configPath = join(tmpDir, 'minimal.yaml');
    writeFileSync(configPath, `
name: minimal
identity:
  soul: "Minimal."
llm:
  provider: ollama
  model: test
persistence:
  adapter: memory
`);

    const config = loadConfig(configPath);
    assert.equal(config.boot?.load_soul, true);
    assert.equal(config.boot?.load_memory, true);
    assert.equal(config.behavior?.max_tool_rounds, 10);
    assert.equal(config.behavior?.session_handoff, true);
  });

  it('substitutes env vars', () => {
    process.env.TEST_FORGE_KEY = 'my-secret-key';
    const configPath = join(tmpDir, 'env.yaml');
    writeFileSync(configPath, `
name: env-test
identity:
  soul: "Test."
llm:
  provider: anthropic
  model: test
  providers:
    anthropic:
      api_key: \${TEST_FORGE_KEY}
persistence:
  adapter: memory
`);

    const config = loadConfig(configPath);
    assert.equal(config.llm.providers?.anthropic?.api_key, 'my-secret-key');
    delete process.env.TEST_FORGE_KEY;
  });

  it('resolves soul_file relative to config dir', () => {
    const soulPath = join(tmpDir, 'soul.md');
    writeFileSync(soulPath, 'I am a test soul.');

    const configPath = join(tmpDir, 'with-soul.yaml');
    writeFileSync(configPath, `
name: soul-test
identity:
  soul_file: ./soul.md
llm:
  provider: ollama
  model: test
persistence:
  adapter: memory
`);

    const config = loadConfig(configPath);
    assert.equal(config.identity.soul_file, soulPath);
  });

  it('throws on missing config', () => {
    assert.throws(() => loadConfig('/nonexistent/path.yaml'), {
      message: /not found/,
    });
  });
});

describe('createConfig', () => {
  it('creates minimal config with defaults', () => {
    const config = createConfig();
    assert.equal(config.name, 'agent');
    assert.ok(config.identity.soul);
    assert.equal(config.llm.provider, 'anthropic');
    assert.equal(config.persistence.adapter, 'memory');
  });

  it('accepts overrides', () => {
    const config = createConfig({
      name: 'custom',
      llm: { provider: 'ollama', model: 'qwen3:14b' },
      persistence: { adapter: 'sqlite', path: './test.db' },
    });
    assert.equal(config.name, 'custom');
    assert.equal(config.llm.provider, 'ollama');
    assert.equal(config.persistence.adapter, 'sqlite');
  });
});

describe('Boot Sequence', () => {
  it('assembles system prompt from config', async () => {
    const store = new MemoryStore();
    await store.init();

    const config = createConfig({
      name: 'boot-test',
      identity: {
        soul: 'You are a test agent. Be concise.',
        directives: ['Always verify results.', 'Log mistakes immediately.'],
      },
    });

    const context = await bootAgent(config, store);

    assert.ok(context.system_prompt.includes('You are a test agent'));
    assert.ok(context.system_prompt.includes('Always verify results'));
    assert.ok(context.system_prompt.includes('Log mistakes immediately'));
    assert.ok(context.system_prompt.includes('Current date'));
    assert.ok(context.soul.length >= 1);

    await store.close();
  });

  it('loads soul directives from store', async () => {
    const store = new MemoryStore();
    await store.init();

    await store.addSoulDirective({
      directive: 'Never skip verification.',
      category: 'discipline',
      priority: 1,
      active: true,
    });

    const config = createConfig({ name: 'soul-boot' });
    const context = await bootAgent(config, store);

    assert.ok(context.system_prompt.includes('Never skip verification'));

    await store.close();
  });

  it('loads memories from store', async () => {
    const store = new MemoryStore();
    await store.init();

    await store.addMindNode({
      content: 'SQLite is great for local agents.',
      node_type: 'fact',
      domain: 'tech',
      signal: 0.9,
      heat: 1.0,
      depth: 3,
      tags: ['sqlite'],
    });

    const config = createConfig({ name: 'memory-boot' });
    const context = await bootAgent(config, store);

    assert.ok(context.memories.length >= 1);
    assert.ok(context.system_prompt.includes('SQLite is great'));

    await store.close();
  });

  it('loads ledger entries', async () => {
    const store = new MemoryStore();
    await store.init();

    await store.addLedgerEntry({
      entry_type: 'win',
      what: 'Clean build on first try',
    });
    await store.addLedgerEntry({
      entry_type: 'mistake',
      what: 'Forgot to check return value',
      pattern: 'incomplete-verification',
    });

    const config = createConfig({ name: 'ledger-boot' });
    const context = await bootAgent(config, store);

    assert.ok(context.ledger_summary.includes('Clean build'));
    assert.ok(context.ledger_summary.includes('Forgot to check'));

    await store.close();
  });

  it('loads session handoff', async () => {
    const store = new MemoryStore();
    await store.init();

    await store.writeHandoff({
      active_work: 'Building the ark system',
      next_actions: 'Run all tests',
    });

    const config = createConfig({ name: 'handoff-boot' });
    const context = await bootAgent(config, store);

    assert.ok(context.handoff);
    assert.ok(context.handoff.includes('Building the ark system'));
    assert.ok(context.system_prompt.includes('Building the ark system'));

    await store.close();
  });

  it('respects boot config flags', async () => {
    const store = new MemoryStore();
    await store.init();

    await store.addMindNode({
      content: 'Should not appear',
      node_type: 'fact',
      signal: 1,
      heat: 1,
      depth: 1,
      tags: [],
    });

    const config = createConfig({
      name: 'selective-boot',
      boot: { load_memory: false, load_ledger: false, load_handoff: false },
    });

    const context = await bootAgent(config, store);

    assert.equal(context.memories.length, 0);
    assert.equal(context.ledger_summary, '');
    assert.equal(context.handoff, undefined);

    await store.close();
  });
});
