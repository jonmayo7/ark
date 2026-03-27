// ============================================================================
// Ark — LLM Provider Tests
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicProvider } from '../src/llm/anthropic.js';
import { OpenAIProvider } from '../src/llm/openai.js';
import { GoogleProvider } from '../src/llm/google.js';
import { CascadeRouter, createProvider } from '../src/llm/router.js';
import type { Message, ToolDefinition } from '../src/llm/types.js';

describe('Provider Construction', () => {
  it('creates Anthropic provider', () => {
    const p = new AnthropicProvider({ api_key: 'test' });
    assert.equal(p.name, 'anthropic');
  });

  it('creates OpenAI provider', () => {
    const p = new OpenAIProvider({ api_key: 'test' });
    assert.equal(p.name, 'openai');
  });

  it('creates Google provider', () => {
    const p = new GoogleProvider({ api_key: 'test' });
    assert.equal(p.name, 'google');
  });

  it('creates Ollama provider (OpenAI-compatible)', () => {
    const p = createProvider('ollama', { base_url: 'http://localhost:11434/v1' });
    assert.equal(p.name, 'ollama');
  });
});

describe('Provider Availability', () => {
  it('Anthropic requires API key', async () => {
    const withKey = new AnthropicProvider({ api_key: 'sk-test' });
    const withoutKey = new AnthropicProvider({ api_key: '' });
    assert.equal(await withKey.available(), true);
    assert.equal(await withoutKey.available(), false);
  });

  it('OpenAI requires API key', async () => {
    const withKey = new OpenAIProvider({ api_key: 'sk-test' });
    const withoutKey = new OpenAIProvider({ api_key: '' });
    assert.equal(await withKey.available(), true);
    assert.equal(await withoutKey.available(), false);
  });

  it('Google requires API key', async () => {
    const withKey = new GoogleProvider({ api_key: 'AIzaTest' });
    const withoutKey = new GoogleProvider({ api_key: '' });
    assert.equal(await withKey.available(), true);
    assert.equal(await withoutKey.available(), false);
  });
});

describe('Tool Format Conversion', () => {
  const tool: ToolDefinition = {
    name: 'get_weather',
    description: 'Get weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
      },
      required: ['location'],
    },
  };

  it('Anthropic format', () => {
    const p = new AnthropicProvider({ api_key: 'test' });
    const formatted = p.formatTools([tool]) as Array<Record<string, unknown>>;
    assert.equal(formatted.length, 1);
    assert.equal(formatted[0].name, 'get_weather');
    assert.ok(formatted[0].input_schema);
  });

  it('OpenAI format', () => {
    const p = new OpenAIProvider({ api_key: 'test' });
    const formatted = p.formatTools([tool]) as Array<Record<string, unknown>>;
    assert.equal(formatted.length, 1);
    assert.equal(formatted[0].type, 'function');
    const fn = formatted[0].function as Record<string, unknown>;
    assert.equal(fn.name, 'get_weather');
    assert.ok(fn.parameters);
  });

  it('Google format', () => {
    const p = new GoogleProvider({ api_key: 'test' });
    const formatted = p.formatTools([tool]) as Array<Record<string, unknown>>;
    assert.equal(formatted.length, 1);
    const decls = formatted[0].functionDeclarations as Array<Record<string, unknown>>;
    assert.equal(decls.length, 1);
    assert.equal(decls[0].name, 'get_weather');
  });
});

describe('Message Format Conversion', () => {
  const messages: Message[] = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
    { role: 'user', content: 'What is 2+2?' },
  ];

  it('Anthropic message format', () => {
    const p = new AnthropicProvider({ api_key: 'test' });
    const formatted = p.formatMessages(messages) as Array<Record<string, unknown>>;
    assert.equal(formatted.length, 3);
    assert.equal(formatted[0].role, 'user');
    assert.equal(formatted[1].role, 'assistant');
  });

  it('OpenAI message format', () => {
    const p = new OpenAIProvider({ api_key: 'test' });
    const formatted = p.formatMessages(messages, 'You are helpful') as Array<Record<string, unknown>>;
    // Should have system + 3 messages
    assert.equal(formatted.length, 4);
    assert.equal(formatted[0].role, 'system');
  });

  it('Google message format', () => {
    const p = new GoogleProvider({ api_key: 'test' });
    const formatted = p.formatMessages(messages) as Array<Record<string, unknown>>;
    assert.equal(formatted.length, 3);
    assert.equal(formatted[0].role, 'user');
    assert.equal(formatted[1].role, 'model'); // Google uses 'model' not 'assistant'
  });

  it('Anthropic handles tool call messages', () => {
    const p = new AnthropicProvider({ api_key: 'test' });
    const toolMessages: Message[] = [
      { role: 'user', content: 'Get weather' },
      {
        role: 'assistant',
        content: 'Checking...',
        tool_calls: [{ id: 'tc1', name: 'get_weather', arguments: { location: 'NYC' } }],
      },
      { role: 'tool', content: '72°F', tool_call_id: 'tc1' },
    ];

    const formatted = p.formatMessages(toolMessages) as Array<Record<string, unknown>>;
    assert.ok(formatted.length >= 3);
  });

  it('OpenAI handles tool call messages', () => {
    const p = new OpenAIProvider({ api_key: 'test' });
    const toolMessages: Message[] = [
      { role: 'user', content: 'Get weather' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'tc1', name: 'get_weather', arguments: { location: 'NYC' } }],
      },
      { role: 'tool', content: '72°F', tool_call_id: 'tc1' },
    ];

    const formatted = p.formatMessages(toolMessages) as Array<Record<string, unknown>>;
    assert.ok(formatted.length >= 3);
    const assistantMsg = formatted[1] as Record<string, unknown>;
    assert.ok(assistantMsg.tool_calls);
    const toolMsg = formatted[2] as Record<string, unknown>;
    assert.equal(toolMsg.role, 'tool');
  });
});

describe('Cascade Router', () => {
  it('constructs with multiple providers', () => {
    const router = new CascadeRouter(
      [
        { provider: 'anthropic', model: 'claude-sonnet-4-5-20250514' },
        { provider: 'ollama', model: 'qwen3:14b' },
      ],
      {
        anthropic: { api_key: 'test' },
      },
    );
    assert.equal(router.name, 'cascade');
  });

  it('reports available when any provider is available', async () => {
    const router = new CascadeRouter(
      [{ provider: 'anthropic', model: 'test' }],
      { anthropic: { api_key: 'test-key' } },
    );
    assert.equal(await router.available(), true);
  });

  it('reports unavailable when no providers available', async () => {
    const router = new CascadeRouter(
      [{ provider: 'anthropic', model: 'test' }],
      { anthropic: { api_key: '' } },
    );
    assert.equal(await router.available(), false);
  });
});

describe('createProvider', () => {
  it('creates correct provider types', () => {
    assert.equal(createProvider('anthropic', { api_key: 'test' }).name, 'anthropic');
    assert.equal(createProvider('openai', { api_key: 'test' }).name, 'openai');
    assert.equal(createProvider('google', { api_key: 'test' }).name, 'google');
    assert.equal(createProvider('gemini', { api_key: 'test' }).name, 'google');
    assert.equal(createProvider('ollama', {}).name, 'ollama');
  });

  it('treats unknown providers as OpenAI-compatible', () => {
    const p = createProvider('together', { api_key: 'test', base_url: 'https://api.together.xyz/v1' });
    assert.equal(p.name, 'together');
  });
});
