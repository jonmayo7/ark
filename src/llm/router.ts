// ============================================================================
// Ark — LLM Cascade Router
// ============================================================================

import type {
  LLMProvider, LLMResponse, LLMCallOptions, Message,
  ToolDefinition, StreamChunk, ProviderOptions,
} from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GoogleProvider } from './google.js';
import type { CascadeEntry, ProviderConfig } from '../types.js';

/** Provider factory — creates provider instances by name */
export function createProvider(
  name: string,
  config: ProviderConfig = {},
  defaultModel?: string,
): LLMProvider {
  const opts: ProviderOptions = {
    api_key: config.api_key,
    base_url: config.base_url,
    default_model: defaultModel,
    ...config,
  };

  switch (name) {
    case 'anthropic':
      return new AnthropicProvider(opts);
    case 'openai':
      return new OpenAIProvider(opts);
    case 'ollama':
      return new OpenAIProvider({
        ...opts,
        base_url: opts.base_url || 'http://localhost:11434/v1',
        name: 'ollama',
      });
    case 'google':
    case 'gemini':
      return new GoogleProvider(opts);
    default:
      // Treat unknown providers as OpenAI-compatible
      return new OpenAIProvider({ ...opts, name });
  }
}

/** Cascade router — tries providers in order until one succeeds */
export class CascadeRouter implements LLMProvider {
  readonly name = 'cascade';
  private providers: Array<{ provider: LLMProvider; model?: string }> = [];

  constructor(
    cascade: CascadeEntry[],
    providerConfigs: Record<string, ProviderConfig> = {},
  ) {
    for (const entry of cascade) {
      const config = providerConfigs[entry.provider] || {};
      const provider = createProvider(entry.provider, config, entry.model);
      this.providers.push({ provider, model: entry.model });
    }
  }

  async available(): Promise<boolean> {
    for (const { provider } of this.providers) {
      if (await provider.available()) return true;
    }
    return false;
  }

  formatTools(tools: ToolDefinition[]): unknown {
    // Delegate to first available provider
    return this.providers[0]?.provider.formatTools(tools) || [];
  }

  formatMessages(messages: Message[], system?: string): unknown {
    return this.providers[0]?.provider.formatMessages(messages, system) || [];
  }

  async chat(messages: Message[], options: LLMCallOptions = {}): Promise<LLMResponse> {
    const errors: string[] = [];

    for (const { provider, model } of this.providers) {
      if (!(await provider.available())) {
        errors.push(`${provider.name}: not available`);
        continue;
      }

      try {
        const opts = { ...options, model: options.model || model };
        return await provider.chat(messages, opts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${provider.name}: ${msg}`);
      }
    }

    throw new Error(
      `All providers failed:\n${errors.map(e => `  - ${e}`).join('\n')}`,
    );
  }

  async *stream(messages: Message[], options: LLMCallOptions = {}): AsyncIterable<StreamChunk> {
    const errors: string[] = [];

    for (const { provider, model } of this.providers) {
      if (!(await provider.available())) {
        errors.push(`${provider.name}: not available`);
        continue;
      }

      try {
        const opts = { ...options, model: options.model || model };
        if (provider.stream) {
          yield* provider.stream(messages, opts);
          return;
        } else {
          // Fallback: complete response as single chunk
          const response = await provider.chat(messages, opts);
          if (response.text) yield { type: 'text', text: response.text };
          for (const tc of response.tool_calls) {
            yield { type: 'tool_call_start', tool_call: tc };
            yield { type: 'tool_call_end', tool_call: tc };
          }
          yield { type: 'usage', usage: response.usage };
          yield { type: 'done' };
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${provider.name}: ${msg}`);
      }
    }

    throw new Error(
      `All providers failed:\n${errors.map(e => `  - ${e}`).join('\n')}`,
    );
  }
}
