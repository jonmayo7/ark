// ============================================================================
// Ark — Native Shell Tool
// ============================================================================

import { execSync } from 'node:child_process';
import type { RegisteredTool } from '../types.js';

export const shellTool: RegisteredTool = {
  definition: {
    name: 'shell',
    description: 'Execute a shell command and return its output. Timeout: 120 seconds.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 120000)' },
      },
      required: ['command'],
    },
  },
  async execute(args) {
    const command = args.command as string;
    const cwd = (args.cwd as string) || process.cwd();
    const timeout = (args.timeout as number) || 120000;

    try {
      const output = execSync(command, {
        cwd,
        timeout,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return {
        content: output || '(no output)',
        is_error: false,
        metadata: { command, cwd },
      };
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; status?: number; message: string };
      const output = [
        error.stdout || '',
        error.stderr || '',
        `Exit code: ${error.status ?? 'unknown'}`,
      ].filter(Boolean).join('\n');

      return {
        content: output || error.message,
        is_error: true,
        metadata: { command, exit_code: error.status },
      };
    }
  },
};
