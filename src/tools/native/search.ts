// ============================================================================
// Ark — Native Search Tools (glob, grep)
// ============================================================================

import { statSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import type { RegisteredTool } from '../types.js';

export const globTool: RegisteredTool = {
  definition: {
    name: 'glob',
    description: 'Find files matching a glob pattern. Returns paths sorted by modification time.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.js")' },
        path: { type: 'string', description: 'Base directory to search in (default: cwd)' },
        limit: { type: 'number', description: 'Max results (default: 100)' },
      },
      required: ['pattern'],
    },
  },
  async execute(args) {
    const pattern = args.pattern as string;
    const basePath = resolve((args.path as string) || process.cwd());
    const limit = (args.limit as number) || 100;

    try {
      // Use find + glob-like matching
      const matches = findFiles(basePath, pattern);
      const sorted = matches
        .map(f => {
          try {
            const stat = statSync(f);
            return { path: f, mtime: stat.mtimeMs };
          } catch {
            return { path: f, mtime: 0 };
          }
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);

      if (sorted.length === 0) {
        return { content: 'No files found matching the pattern.', is_error: false };
      }

      const paths = sorted.map(f => f.path).join('\n');
      return {
        content: paths,
        is_error: false,
        metadata: { count: sorted.length },
      };
    } catch (err) {
      return { content: `Glob error: ${(err as Error).message}`, is_error: true };
    }
  },
};

export const grepTool: RegisteredTool = {
  definition: {
    name: 'grep',
    description: 'Search file contents using regex. Uses ripgrep if available, falls back to native.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'File or directory to search (default: cwd)' },
        glob: { type: 'string', description: 'File glob filter (e.g., "*.ts")' },
        case_insensitive: { type: 'boolean', description: 'Case insensitive search' },
        context: { type: 'number', description: 'Lines of context around matches' },
        mode: {
          type: 'string',
          description: 'Output mode: "files" (file paths only), "content" (matching lines), "count"',
          enum: ['files', 'content', 'count'],
        },
        limit: { type: 'number', description: 'Max results (default: 50)' },
      },
      required: ['pattern'],
    },
  },
  async execute(args) {
    const pattern = args.pattern as string;
    const searchPath = resolve((args.path as string) || process.cwd());
    const mode = (args.mode as string) || 'files';
    const limit = (args.limit as number) || 50;

    // Try ripgrep first
    const rgPath = findRipgrep();

    if (rgPath) {
      try {
        const rgArgs: string[] = [];

        if (mode === 'files') rgArgs.push('-l');
        else if (mode === 'count') rgArgs.push('-c');
        else rgArgs.push('-n');

        if (args.case_insensitive) rgArgs.push('-i');
        if (args.context) rgArgs.push('-C', String(args.context));
        if (args.glob) rgArgs.push('--glob', args.glob as string);

        rgArgs.push('--max-count', String(limit));
        rgArgs.push('--', pattern, searchPath);

        const rg = spawnSync(rgPath, rgArgs, {
          encoding: 'utf-8',
          maxBuffer: 50 * 1024 * 1024,
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        if (rg.status === 1) {
          return { content: 'No matches found.', is_error: false };
        }
        if (rg.error || (rg.status !== 0 && rg.status !== null)) {
          throw new Error(rg.stderr || rg.error?.message || 'ripgrep failed');
        }

        const output = rg.stdout;

        const lines = output.trim().split('\n').filter(Boolean);
        return {
          content: lines.slice(0, limit).join('\n') || 'No matches found.',
          is_error: false,
          metadata: { count: lines.length, engine: 'ripgrep' },
        };
      } catch {
        // Fall through to native
      }
    }

    // Native fallback using Node.js
    try {
      return nativeGrep(pattern, searchPath, args);
    } catch (err) {
      return { content: `Grep error: ${(err as Error).message}`, is_error: true };
    }
  },
};

// --- Helpers ---

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.cache']);

function findFiles(basePath: string, pattern: string): string[] {
  const results: string[] = [];
  const regex = globToRegex(pattern);

  function walk(dir: string, depth: number) {
    if (depth > 20) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.isFile()) {
          const rel = relative(basePath, full);
          if (regex.test(rel)) results.push(full);
        }
      }
    } catch {
      // Skip unreadable dirs
    }
  }

  walk(basePath, 0);
  return results;
}

function globToRegex(glob: string): RegExp {
  let result = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        result += '(.+/)?';
        i += 3;
      } else {
        result += '.*';
        i += 2;
      }
    } else if (c === '*') {
      result += '[^/]*';
      i += 1;
    } else if (c === '?') {
      result += '[^/]';
      i += 1;
    } else if ('.+^${}()|[]\\'.includes(c)) {
      result += '\\' + c;
      i += 1;
    } else {
      result += c;
      i += 1;
    }
  }
  return new RegExp('^' + result + '$');
}

function findRipgrep(): string | null {
  const paths = ['/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg'];

  // Check Claude's bundled rg
  const home = process.env.HOME || '';
  if (home) {
    try {
      const claudeDir = join(home, '.local', 'share', 'claude', 'versions');
      const entries = readdirSync(claudeDir);
      for (const entry of entries) {
        const candidate = join(claudeDir, entry);
        try {
          const stat = statSync(candidate);
          if (stat.isFile()) {
            // Verify it's actually rg by running --version
            const check = spawnSync(candidate, ['--version'], { encoding: 'utf-8', timeout: 3000 });
            if (check.stdout?.includes('ripgrep')) {
              paths.unshift(candidate);
              break;
            }
          }
        } catch { continue; }
      }
    } catch { /* no Claude dir */ }
  }

  for (const p of paths) {
    try {
      statSync(p);
      return p;
    } catch {
      continue;
    }
  }
  return null;
}

import { readFileSync } from 'node:fs';

function nativeGrep(
  pattern: string,
  searchPath: string,
  args: Record<string, unknown>,
): { content: string; is_error: boolean; metadata?: Record<string, unknown> } {
  const mode = (args.mode as string) || 'files';
  const limit = (args.limit as number) || 50;
  const flags = args.case_insensitive ? 'gi' : 'g';
  const regex = new RegExp(pattern, flags);

  const files = findFiles(searchPath, args.glob as string || '**/*');
  const results: string[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      let matched = false;

      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matched = true;
          if (mode === 'content') {
            results.push(`${file}:${i + 1}: ${lines[i]}`);
            if (results.length >= limit) break;
          }
        }
        regex.lastIndex = 0;
      }

      if (matched && mode === 'files') {
        results.push(file);
      }

      if (results.length >= limit) break;
    } catch {
      // Skip unreadable files
    }
  }

  return {
    content: results.join('\n') || 'No matches found.',
    is_error: false,
    metadata: { count: results.length, engine: 'native' },
  };
}
