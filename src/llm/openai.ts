// ============================================================================
// Ark — OpenAI-Compatible Provider (OpenAI, Ollama, Together, etc.)
// ============================================================================

import type {
  LLMProvider, LLMResponse, LLMCallOptions, Message,
  ToolDefinition, ToolCall, StreamChunk, ProviderOptions,
  TokenUsage,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
};

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(options: ProviderOptions = {}) {
    this.apiKey = options.api_key || process.env.OPENAI_API_KEY || '';
    this.baseUrl = (options.base_url || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.defaultModel = options.default_model || 'gpt-4o';
    // Allow custom name for Ollama, Together, etc.
    this.name = (options.name as string) || 'openai';
  }

  async available(): Promise<boolean> {
    // Ollama doesn't need an API key
    if (this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1')) {
      try {
        const res = await fetch(this.baseUrl.replace('/v1', '/api/tags'), {
          signal: AbortSignal.timeout(3000),
        });
        return res.ok;
      } catch {
        return false;
      }
    }
    return this.apiKey.length > 0;
  }

  formatTools(tools: ToolDefinition[]): unknown {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  formatMessages(messages: Message[], system?: string): unknown {
    const formatted: Array<Record<string, unknown>> = [];

    // System message first
    if (system) {
      formatted.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        if (!system) formatted.push({ role: 'system', content: msg.content });
        continue;
      }

      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        formatted.push({
          role: 'assistant',
          content: typeof msg.content === 'string' ? msg.content || null : null,
          tool_calls: msg.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        });
      } else if (msg.role === 'tool') {
        formatted.push({
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      } else {
        formatted.push({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      }
    }

    return formatted;
  }

  async chat(messages: Message[], options: LLMCallOptions = {}): Promise<LLMResponse> {
    const model = options.model || this.defaultModel;
    const start = Date.now();

    const body: Record<string, unknown> = {
      model,
      messages: this.formatMessages(messages, options.system),
      max_tokens: options.max_tokens || 4096,
    };

    if (options.tools?.length) {
      body.tools = this.formatTools(options.tools);
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 120000);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`${this.name} API error ${res.status}: ${error}`);
      }

      const data = await res.json() as {
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason: string;
        }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        model: string;
      };

      const duration_ms = Date.now() - start;
      const choice = data.choices[0];
      const text = choice?.message?.content || '';
      const tool_calls: ToolCall[] = (choice?.message?.tool_calls || []).map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParse(tc.function.arguments),
      }));

      const inputTokens = data.usage?.prompt_tokens || 0;
      const outputTokens = data.usage?.completion_tokens || 0;
      const pricing = PRICING[model] || { input: 0, output: 0 };
      const cost_usd =
        (inputTokens / 1_000_000) * pricing.input +
        (outputTokens / 1_000_000) * pricing.output;

      const usage: TokenUsage = {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: data.usage?.total_tokens || inputTokens + outputTokens,
        model: data.model || model,
        provider: this.name,
        duration_ms,
        cost_usd: cost_usd || undefined,
      };

      return {
        text,
        tool_calls,
        usage,
        done: choice?.finish_reason !== 'tool_calls',
        raw: data,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(messages: Message[], options: LLMCallOptions = {}): AsyncIterable<StreamChunk> {
    const model = options.model || this.defaultModel;
    const start = Date.now();

    const body: Record<string, unknown> = {
      model,
      messages: this.formatMessages(messages, options.system),
      max_tokens: options.max_tokens || 4096,
      stream: true,
    };

    if (options.tools?.length) {
      body.tools = this.formatTools(options.tools);
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 300000);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`${this.name} API error ${res.status}: ${error}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      const toolCallAccumulators = new Map<number, { id: string; name: string; args: string }>();

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
            const event = JSON.parse(json) as {
              choices: Array<{
                delta: {
                  content?: string;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason?: string;
              }>;
              usage?: { prompt_tokens: number; completion_tokens: number };
            };

            const delta = event.choices?.[0]?.delta;

            if (delta?.content) {
              yield { type: 'text', text: delta.content };
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.id) {
                  toolCallAccumulators.set(tc.index, {
                    id: tc.id,
                    name: tc.function?.name || '',
                    args: tc.function?.arguments || '',
                  });
                  yield {
                    type: 'tool_call_start',
                    tool_call: { id: tc.id, name: tc.function?.name },
                  };
                } else {
                  const acc = toolCallAccumulators.get(tc.index);
                  if (acc && tc.function?.arguments) {
                    acc.args += tc.function.arguments;
                  }
                }
              }
            }

            if (event.choices?.[0]?.finish_reason) {
              // Emit completed tool calls
              for (const [, acc] of toolCallAccumulators) {
                yield {
                  type: 'tool_call_end',
                  tool_call: {
                    id: acc.id,
                    name: acc.name,
                    arguments: safeParse(acc.args),
                  },
                };
              }
              toolCallAccumulators.clear();

              if (event.usage) {
                const duration_ms = Date.now() - start;
                const pricing = PRICING[model] || { input: 0, output: 0 };
                const cost_usd =
                  (event.usage.prompt_tokens / 1_000_000) * pricing.input +
                  (event.usage.completion_tokens / 1_000_000) * pricing.output;

                yield {
                  type: 'usage',
                  usage: {
                    input_tokens: event.usage.prompt_tokens,
                    output_tokens: event.usage.completion_tokens,
                    total_tokens: event.usage.prompt_tokens + event.usage.completion_tokens,
                    model,
                    provider: this.name,
                    duration_ms,
                    cost_usd: cost_usd || undefined,
                  },
                };
              }
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      yield { type: 'done' };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json || '{}');
  } catch {
    return {};
  }
}
