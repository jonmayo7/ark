// ============================================================================
// Ark — Anthropic Provider (Claude)
// ============================================================================

import type {
  LLMProvider, LLMResponse, LLMCallOptions, Message,
  ToolDefinition, ToolCall, StreamChunk, ProviderOptions,
  TokenUsage, ContentBlock,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

// Pricing per 1M tokens (as of May 2025)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-sonnet-4-5-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
};

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(options: ProviderOptions = {}) {
    this.apiKey = options.api_key || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = options.base_url || DEFAULT_BASE_URL;
    this.defaultModel = options.default_model || 'claude-sonnet-4-5-20250514';
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  formatTools(tools: ToolDefinition[]): unknown {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  formatMessages(messages: Message[], system?: string): unknown {
    const formatted: unknown[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        const content: ContentBlock[] = [];
        if (typeof msg.content === 'string' && msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        formatted.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        // Anthropic needs tool results wrapped in user message with tool_result blocks
        const lastFormatted = formatted[formatted.length - 1] as { role: string; content: ContentBlock[] } | undefined;
        const block: ContentBlock = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        };

        if (lastFormatted?.role === 'user' && Array.isArray(lastFormatted.content)) {
          lastFormatted.content.push(block);
        } else {
          formatted.push({ role: 'user', content: [block] });
        }
      } else {
        formatted.push({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : msg.content,
        });
      }
    }

    return formatted;
  }

  async chat(messages: Message[], options: LLMCallOptions = {}): Promise<LLMResponse> {
    const model = options.model || this.defaultModel;
    const start = Date.now();

    const systemMsg = options.system || messages.find(m => m.role === 'system')?.content;
    const body: Record<string, unknown> = {
      model,
      messages: this.formatMessages(messages, typeof systemMsg === 'string' ? systemMsg : undefined),
      max_tokens: options.max_tokens || 4096,
    };

    if (typeof systemMsg === 'string' && systemMsg) {
      body.system = systemMsg;
    }

    if (options.tools?.length) {
      body.tools = this.formatTools(options.tools);
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 120000);

    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${error}`);
      }

      const data = await res.json() as {
        content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
        usage: { input_tokens: number; output_tokens: number };
        stop_reason: string;
        model: string;
      };

      const duration_ms = Date.now() - start;
      let text = '';
      const tool_calls: ToolCall[] = [];

      for (const block of data.content) {
        if (block.type === 'text' && block.text) {
          text += block.text;
        } else if (block.type === 'tool_use') {
          tool_calls.push({
            id: block.id!,
            name: block.name!,
            arguments: block.input || {},
          });
        }
      }

      const pricing = PRICING[model] || { input: 3, output: 15 };
      const cost_usd =
        (data.usage.input_tokens / 1_000_000) * pricing.input +
        (data.usage.output_tokens / 1_000_000) * pricing.output;

      const usage: TokenUsage = {
        input_tokens: data.usage.input_tokens,
        output_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens,
        model: data.model,
        provider: this.name,
        duration_ms,
        cost_usd,
      };

      return {
        text,
        tool_calls,
        usage,
        done: data.stop_reason !== 'tool_use',
        raw: data,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(messages: Message[], options: LLMCallOptions = {}): AsyncIterable<StreamChunk> {
    const model = options.model || this.defaultModel;
    const start = Date.now();

    const systemMsg = options.system || messages.find(m => m.role === 'system')?.content;
    const body: Record<string, unknown> = {
      model,
      messages: this.formatMessages(messages, typeof systemMsg === 'string' ? systemMsg : undefined),
      max_tokens: options.max_tokens || 4096,
      stream: true,
    };

    if (typeof systemMsg === 'string' && systemMsg) {
      body.system = systemMsg;
    }

    if (options.tools?.length) {
      body.tools = this.formatTools(options.tools);
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 300000);

    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${error}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let currentToolCall: Partial<ToolCall> | null = null;
      let toolInputJson = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json || json === '[DONE]') continue;

          try {
            const event = JSON.parse(json) as Record<string, unknown>;
            const type = event.type as string;

            if (type === 'message_start') {
              const msg = event.message as { usage?: { input_tokens?: number } };
              inputTokens = msg?.usage?.input_tokens || 0;
            } else if (type === 'content_block_start') {
              const block = event.content_block as { type: string; id?: string; name?: string };
              if (block?.type === 'tool_use') {
                currentToolCall = { id: block.id, name: block.name, arguments: {} };
                toolInputJson = '';
                yield { type: 'tool_call_start', tool_call: currentToolCall };
              }
            } else if (type === 'content_block_delta') {
              const delta = event.delta as { type: string; text?: string; partial_json?: string };
              if (delta?.type === 'text_delta' && delta.text) {
                yield { type: 'text', text: delta.text };
              } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
                toolInputJson += delta.partial_json;
              }
            } else if (type === 'content_block_stop') {
              if (currentToolCall) {
                try {
                  currentToolCall.arguments = JSON.parse(toolInputJson || '{}');
                } catch {
                  currentToolCall.arguments = {};
                }
                yield { type: 'tool_call_end', tool_call: currentToolCall };
                currentToolCall = null;
                toolInputJson = '';
              }
            } else if (type === 'message_delta') {
              const usage = (event as { usage?: { output_tokens?: number } }).usage;
              outputTokens = usage?.output_tokens || outputTokens;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      const duration_ms = Date.now() - start;
      const pricing = PRICING[model] || { input: 3, output: 15 };
      const cost_usd =
        (inputTokens / 1_000_000) * pricing.input +
        (outputTokens / 1_000_000) * pricing.output;

      yield {
        type: 'usage',
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
          model,
          provider: this.name,
          duration_ms,
          cost_usd,
        },
      };
      yield { type: 'done' };
    } finally {
      clearTimeout(timeout);
    }
  }
}
