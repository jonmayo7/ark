// ============================================================================
// Ark — Native Tool Registry
// ============================================================================

import type { RegisteredTool } from '../types.js';
import { fileReadTool, fileWriteTool, fileEditTool } from './file.js';
import { shellTool } from './shell.js';
import { globTool, grepTool } from './search.js';
import { httpFetchTool } from './http.js';

/** All native tools, keyed by name */
export const NATIVE_TOOLS: Record<string, RegisteredTool> = {
  file_read: fileReadTool,
  file_write: fileWriteTool,
  file_edit: fileEditTool,
  shell: shellTool,
  glob: globTool,
  grep: grepTool,
  http_fetch: httpFetchTool,
};

/** Get a subset of native tools by name */
export function getNativeTools(names?: string[]): RegisteredTool[] {
  if (!names) return Object.values(NATIVE_TOOLS);
  return names
    .filter(n => n in NATIVE_TOOLS)
    .map(n => NATIVE_TOOLS[n]);
}
