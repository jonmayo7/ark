// ============================================================================
// Ark — Tool Registry
// ============================================================================

import type { IToolRegistry, RegisteredTool, ToolResult, ToolDefinition } from './types.js';

export class ToolRegistry implements IToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map(t => t.definition);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: `Unknown tool: ${name}`,
        is_error: true,
      };
    }

    try {
      return await tool.execute(args);
    } catch (err) {
      return {
        content: `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
        is_error: true,
      };
    }
  }
}
