// ============================================================================
// Ark — LLM Types
// ============================================================================

/** A message in a conversation */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/** Content block for multi-part messages (Anthropic-style) */
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

/** A tool call requested by the LLM */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Normalized response from any LLM provider */
export interface LLMResponse {
  text: string;
  tool_calls: ToolCall[];
  usage: TokenUsage;
  done: boolean;
  raw?: unknown;
}

/** Token usage tracking */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  model: string;
  provider: string;
  duration_ms: number;
  cost_usd?: number;
}

/** Streaming chunk from an LLM */
export interface StreamChunk {
  type: 'text' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'usage' | 'done';
  text?: string;
  tool_call?: Partial<ToolCall>;
  usage?: TokenUsage;
}

/** Options for an LLM call */
export interface LLMCallOptions {
  model?: string;
  tools?: ToolDefinition[];
  max_tokens?: number;
  temperature?: number;
  timeout?: number;
  stream?: boolean;
  system?: string;
}

/** Tool definition in provider-agnostic JSON Schema format */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/** JSON Schema subset for tool parameters */
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema & { description?: string }>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

/** Abstract LLM provider interface */
export interface LLMProvider {
  readonly name: string;

  /** Send a chat completion request */
  chat(
    messages: Message[],
    options: LLMCallOptions,
  ): Promise<LLMResponse>;

  /** Stream a chat completion (optional — falls back to chat if not implemented) */
  stream?(
    messages: Message[],
    options: LLMCallOptions,
  ): AsyncIterable<StreamChunk>;

  /** Check if this provider is available (has credentials, service reachable) */
  available(): Promise<boolean>;

  /** Convert a tool definition to this provider's format */
  formatTools(tools: ToolDefinition[]): unknown;

  /** Format messages for this provider's API */
  formatMessages(messages: Message[], system?: string): unknown;
}

/** Provider constructor options */
export interface ProviderOptions {
  api_key?: string;
  base_url?: string;
  default_model?: string;
  [key: string]: unknown;
}
