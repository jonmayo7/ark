// ============================================================================
// Ark — Native File Tools (read, write, edit)
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { RegisteredTool } from '../types.js';

export const fileReadTool: RegisteredTool = {
  definition: {
    name: 'file_read',
    description: 'Read a file from the filesystem. Returns content with line numbers.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to read' },
        offset: { type: 'number', description: 'Line number to start reading from (1-based)' },
        limit: { type: 'number', description: 'Number of lines to read (default: 2000)' },
      },
      required: ['path'],
    },
  },
  async execute(args) {
    const filePath = resolve(args.path as string);
    if (!existsSync(filePath)) {
      return { content: `File not found: ${filePath}`, is_error: true };
    }

    try {
      const raw = readFileSync(filePath);
      // Binary check — scan first 8KB for null bytes
      const probe = raw.subarray(0, Math.min(8192, raw.length));
      if (probe.includes(0)) {
        return { content: `Binary file (${raw.length} bytes): ${filePath}`, is_error: false };
      }

      const text = raw.toString('utf-8');
      const lines = text.split('\n');
      const offset = Math.max(1, (args.offset as number) || 1);
      const limit = (args.limit as number) || 2000;
      const slice = lines.slice(offset - 1, offset - 1 + limit);

      const numbered = slice.map((line, i) => `${(offset + i).toString().padStart(5)}  ${line}`).join('\n');
      const total = lines.length;
      const shown = slice.length;
      const header = `${filePath} (${total} lines, showing ${offset}-${offset + shown - 1})`;

      return { content: `${header}\n${numbered}`, is_error: false, metadata: { total, shown } };
    } catch (err) {
      return { content: `Error reading ${filePath}: ${(err as Error).message}`, is_error: true };
    }
  },
};

export const fileWriteTool: RegisteredTool = {
  definition: {
    name: 'file_write',
    description: 'Write content to a file. Creates parent directories if needed. Uses atomic write.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to write to' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  async execute(args) {
    const filePath = resolve(args.path as string);
    const content = args.content as string;

    try {
      mkdirSync(dirname(filePath), { recursive: true });
      // Atomic write: write to temp, then rename
      const tmpPath = `${filePath}.tmp-${randomBytes(4).toString('hex')}`;
      writeFileSync(tmpPath, content, 'utf-8');
      renameSync(tmpPath, filePath);

      const lines = content.split('\n').length;
      const bytes = Buffer.byteLength(content, 'utf-8');
      return {
        content: `Written ${bytes} bytes (${lines} lines) to ${filePath}`,
        is_error: false,
        metadata: { bytes, lines },
      };
    } catch (err) {
      return { content: `Error writing ${filePath}: ${(err as Error).message}`, is_error: true };
    }
  },
};

export const fileEditTool: RegisteredTool = {
  definition: {
    name: 'file_edit',
    description: 'Replace a string in a file. The old_string must be unique unless replace_all is true.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to edit' },
        old_string: { type: 'string', description: 'Exact string to find and replace' },
        new_string: { type: 'string', description: 'Replacement string' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  async execute(args) {
    const filePath = resolve(args.path as string);
    const oldStr = args.old_string as string;
    const newStr = args.new_string as string;
    const replaceAll = (args.replace_all as boolean) || false;

    if (!existsSync(filePath)) {
      return { content: `File not found: ${filePath}`, is_error: true };
    }

    try {
      const content = readFileSync(filePath, 'utf-8');

      // Count occurrences
      let count = 0;
      let pos = 0;
      while ((pos = content.indexOf(oldStr, pos)) !== -1) {
        count++;
        pos += oldStr.length;
      }

      if (count === 0) {
        return { content: `String not found in ${filePath}. Make sure it matches exactly.`, is_error: true };
      }

      if (count > 1 && !replaceAll) {
        return {
          content: `Found ${count} occurrences of the string. Use replace_all: true to replace all, or provide more context to make it unique.`,
          is_error: true,
        };
      }

      let updated: string;
      if (replaceAll) {
        updated = content.split(oldStr).join(newStr);
      } else {
        const idx = content.indexOf(oldStr);
        updated = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
      }

      // Atomic write
      const tmpPath = `${filePath}.tmp-${randomBytes(4).toString('hex')}`;
      writeFileSync(tmpPath, updated, 'utf-8');
      renameSync(tmpPath, filePath);

      const replaced = replaceAll ? count : 1;
      return {
        content: `Replaced ${replaced} occurrence(s) in ${filePath}`,
        is_error: false,
        metadata: { replaced },
      };
    } catch (err) {
      return { content: `Error editing ${filePath}: ${(err as Error).message}`, is_error: true };
    }
  },
};
