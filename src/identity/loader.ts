// ============================================================================
// Ark — Config Loader (YAML with env var substitution)
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import YAML from 'yaml';
import type { AgentConfig } from '../types.js';

/** Load an agent config from a YAML file */
export function loadConfig(configPath: string): AgentConfig {
  const absPath = resolve(configPath);

  if (!existsSync(absPath)) {
    throw new Error(`Config file not found: ${absPath}`);
  }

  const raw = readFileSync(absPath, 'utf-8');
  const substituted = substituteEnvVars(raw);
  const parsed = YAML.parse(substituted) as AgentConfig;

  // Resolve relative file paths against config directory
  const configDir = dirname(absPath);

  if (parsed.identity?.soul_file) {
    parsed.identity.soul_file = resolve(configDir, parsed.identity.soul_file);
  }
  if (parsed.identity?.user_file) {
    parsed.identity.user_file = resolve(configDir, parsed.identity.user_file);
  }
  if (parsed.persistence?.path) {
    parsed.persistence.path = resolve(configDir, parsed.persistence.path);
  }

  // Defaults
  parsed.boot = {
    load_soul: true,
    load_state: true,
    load_memory: true,
    load_ledger: true,
    load_handoff: true,
    memory_limit: 20,
    ...parsed.boot,
  };

  parsed.behavior = {
    verify_actions: true,
    log_mistakes: true,
    session_handoff: true,
    max_tool_rounds: 10,
    ...parsed.behavior,
  };

  return parsed;
}

/** Load a soul/personality file */
export function loadSoulFile(filePath: string): string {
  if (!existsSync(filePath)) return '';
  return readFileSync(filePath, 'utf-8');
}

/** Substitute ${ENV_VAR} references in a string */
function substituteEnvVars(text: string): string {
  return text.replace(/\$\{(\w+)\}/g, (match, name) => {
    const value = process.env[name];
    if (value === undefined) return match; // Leave unresolved refs as-is
    return value;
  });
}

/** Create a minimal config programmatically */
export function createConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'agent',
    identity: { soul: 'You are a helpful assistant.' },
    llm: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250514' },
    persistence: { adapter: 'memory' },
    ...overrides,
    boot: {
      load_soul: true,
      load_state: true,
      load_memory: true,
      load_ledger: true,
      load_handoff: true,
      memory_limit: 20,
      ...overrides.boot,
    },
    behavior: {
      verify_actions: true,
      log_mistakes: true,
      session_handoff: true,
      max_tool_rounds: 10,
      ...overrides.behavior,
    },
  };
}
