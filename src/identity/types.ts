// ============================================================================
// Ark — Identity Types
// ============================================================================

/** Assembled boot context for an agent */
export interface BootContext {
  system_prompt: string;
  soul: string[];
  state: Record<string, unknown>;
  memories: string[];
  ledger_summary: string;
  handoff?: string;
}

/** Lifecycle hooks for the agent */
export interface AgentHooks {
  onBoot?: (context: BootContext) => Promise<void>;
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<void>;
  onToolResult?: (name: string, result: string, is_error: boolean) => Promise<void>;
  onResponse?: (text: string) => Promise<void>;
  onError?: (error: Error) => Promise<void>;
  onShutdown?: () => Promise<void>;
}
