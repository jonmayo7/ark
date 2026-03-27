// ============================================================================
// Ark — Tool Types
// ============================================================================

import type { ToolDefinition, JSONSchema } from '../llm/types.js';

/** Result from executing a tool */
export interface ToolResult {
  content: string;
  is_error: boolean;
  metadata?: Record<string, unknown>;
}

/** A registered tool with its definition and executor */
export interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
}

/** Function that executes a tool call */
export type ToolExecutor = (
  args: Record<string, unknown>,
) => Promise<ToolResult>;

/** Tool registry interface */
export interface IToolRegistry {
  register(tool: RegisteredTool): void;
  get(name: string): RegisteredTool | undefined;
  list(): RegisteredTool[];
  getDefinitions(): ToolDefinition[];
  execute(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

export type { ToolDefinition, JSONSchema };
