// ============================================================================
// Ark — Google Gemini Provider
// ============================================================================

import type {
  LLMProvider, LLMResponse, LLMCallOptions, Message,
  ToolDefinition, ToolCall, StreamChunk, ProviderOptions,
  TokenUsage,
} from './types.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

export class GoogleProvider implements LLMProvider {
  readonly name = 'google';
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(options: ProviderOptions = {}) {
    this.apiKey = options.api_key || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
    this.baseUrl = options.base_url || DEFAULT_BASE_URL;
    this.defaultModel = options.default_model || 'gemini-2.5-flash';
  }

  async available(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  formatTools(tools: ToolDefinition[]): unknown {
    return [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    }];
  }

  formatMessages(messages: Message[], system?: string): unknown {
    const contents: Array<Record<string, unknown>> = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        const parts: unknown[] = [];
        if (typeof msg.content === 'string' && msg.content) {
          parts.push({ text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          parts.push({
            functionCall: { name: tc.name, args: tc.arguments },
          });
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        contents.push({
          role: 'function',
          parts: [{
            functionResponse: {
              name: msg.name || 'tool',
              response: { result: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) },
            },
          }],
        });
      } else if (msg.role === 'assistant') {
        contents.push({
          role: 'model',
          parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }],
        });
      } else if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }],
        });
      }
    }

    return contents;
  }

  async chat(messages: Message[], options: LLMCallOptions = {}): Promise<LLMResponse> {
    const model = options.model || this.defaultModel;
    const start = Date.now();

    const systemMsg = options.system || messages.find(m => m.role === 'system')?.content;

    const body: Record<string, unknown> = {
      contents: this.formatMessages(messages, typeof systemMsg === 'string' ? systemMsg : undefined),
      generationConfig: {
        maxOutputTokens: options.max_tokens || 4096,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      },
    };

    if (typeof systemMsg === 'string' && systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg }] };
    }

    if (options.tools?.length) {
      body.tools = this.formatTools(options.tools);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 120000);

    try {
      const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Google API error ${res.status}: ${error}`);
      }

      const data = await res.json() as {
        candidates: Array<{
          content: {
            parts: Array<{
              text?: string;
              functionCall?: { name: string; args: Record<string, unknown> };
            }>;
          };
          finishReason: string;
        }>;
        usageMetadata?: {
          promptTokenCount: number;
          candidatesTokenCount: number;
          totalTokenCount: number;
        };
      };

      const duration_ms = Date.now() - start;
      const candidate = data.candidates?.[0];
      let text = '';
      const tool_calls: ToolCall[] = [];

      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.text) text += part.text;
          if (part.functionCall) {
            tool_calls.push({
              id: `call_${Math.random().toString(36).slice(2, 11)}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args || {},
            });
          }
        }
      }

      const inputTokens = data.usageMetadata?.promptTokenCount || 0;
      const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;
      const pricing = PRICING[model] || { input: 0.15, output: 0.6 };
      const cost_usd =
        (inputTokens / 1_000_000) * pricing.input +
        (outputTokens / 1_000_000) * pricing.output;

      const usage: TokenUsage = {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: data.usageMetadata?.totalTokenCount || inputTokens + outputTokens,
        model,
        provider: this.name,
        duration_ms,
        cost_usd,
      };

      const hasFunctionCalls = tool_calls.length > 0;

      return {
        text,
        tool_calls,
        usage,
        done: !hasFunctionCalls,
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
      contents: this.formatMessages(messages, typeof systemMsg === 'string' ? systemMsg : undefined),
      generationConfig: {
        maxOutputTokens: options.max_tokens || 4096,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      },
    };

    if (typeof systemMsg === 'string' && systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg }] };
    }

    if (options.tools?.length) {
      body.tools = this.formatTools(options.tools);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 300000);

    try {
      const url = `${this.baseUrl}/models/${model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Google API error ${res.status}: ${error}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let totalInput = 0;
      let totalOutput = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;

          try {
            const event = JSON.parse(json) as {
              candidates?: Array<{
                content?: {
                  parts?: Array<{
                    text?: string;
                    functionCall?: { name: string; args: Record<string, unknown> };
                  }>;
                };
              }>;
              usageMetadata?: {
                promptTokenCount?: number;
                candidatesTokenCount?: number;
              };
            };

            const parts = event.candidates?.[0]?.content?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.text) {
                  yield { type: 'text', text: part.text };
                }
                if (part.functionCall) {
                  const tc: ToolCall = {
                    id: `call_${Math.random().toString(36).slice(2, 11)}`,
                    name: part.functionCall.name,
                    arguments: part.functionCall.args || {},
                  };
                  yield { type: 'tool_call_start', tool_call: tc };
                  yield { type: 'tool_call_end', tool_call: tc };
                }
              }
            }

            if (event.usageMetadata) {
              totalInput = event.usageMetadata.promptTokenCount || totalInput;
              totalOutput = event.usageMetadata.candidatesTokenCount || totalOutput;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      const duration_ms = Date.now() - start;
      const pricing = PRICING[model] || { input: 0.15, output: 0.6 };
      yield {
        type: 'usage',
        usage: {
          input_tokens: totalInput,
          output_tokens: totalOutput,
          total_tokens: totalInput + totalOutput,
          model,
          provider: this.name,
          duration_ms,
          cost_usd: (totalInput / 1_000_000) * pricing.input + (totalOutput / 1_000_000) * pricing.output,
        },
      };
      yield { type: 'done' };
    } finally {
      clearTimeout(timeout);
    }
  }
}
