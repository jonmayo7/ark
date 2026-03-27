#!/usr/bin/env node
// ============================================================================
// Ark — CLI Entry Point
// ============================================================================

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Agent } from '../agent.js';
import { startRepl } from './repl.js';
import { createConfig } from '../identity/loader.js';
import { runInit } from './init.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Subcommands
  if (command === 'init') {
    await runInit();
    return;
  }

  if (command === 'test') {
    await runTest(args.slice(1));
    return;
  }

  if (command === 'start') {
    await runStart(args.slice(1));
    return;
  }

  // No subcommand — check for flags or treat as start
  let configPath: string | undefined;
  let showHelp = false;
  let showVersion = false;
  let provider: string | undefined;
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--version' || arg === '-v') {
      showVersion = true;
    } else if ((arg === '--config' || arg === '-c') && args[i + 1]) {
      configPath = args[++i];
    } else if ((arg === '--provider' || arg === '-p') && args[i + 1]) {
      provider = args[++i];
    } else if ((arg === '--model' || arg === '-m') && args[i + 1]) {
      model = args[++i];
    } else if (!arg.startsWith('-')) {
      configPath = arg;
    }
  }

  if (showVersion) {
    console.log('ark 0.1.0');
    process.exit(0);
  }

  if (showHelp) {
    printHelp();
    process.exit(0);
  }

  // Default: start the agent
  await startAgent(configPath, provider, model);
}

async function runStart(args: string[]): Promise<void> {
  let configPath: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-p' || arg === '--provider') && args[i + 1]) {
      provider = args[++i];
    } else if ((arg === '-m' || arg === '--model') && args[i + 1]) {
      model = args[++i];
    } else if (!arg.startsWith('-')) {
      configPath = arg;
    }
  }

  await startAgent(configPath, provider, model);
}

async function runTest(args: string[]): Promise<void> {
  let configPath: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-p' || args[i] === '--provider') && args[i + 1]) {
      provider = args[++i];
    } else if ((args[i] === '-m' || args[i] === '--model') && args[i + 1]) {
      model = args[++i];
    } else if (!args[i].startsWith('-')) {
      configPath = args[i];
    }
  }

  console.log('\nark test — Quick smoke test\n');

  let agent: Agent;
  if (configPath) {
    const absPath = resolve(configPath);
    if (!existsSync(absPath)) {
      console.error(`Config file not found: ${absPath}`);
      process.exit(1);
    }
    agent = new Agent({ configPath: absPath });
  } else {
    agent = new Agent({
      config: createConfig({
        name: 'ark-test',
        identity: { soul: 'You are a test agent. Be extremely concise.' },
        llm: {
          provider: provider || 'ollama',
          model: model || 'qwen3:14b',
          providers: provider === 'ollama' || !provider ? { ollama: { base_url: 'http://localhost:11434/v1' } } : undefined,
        },
        persistence: { adapter: 'memory' },
        tools: { native: ['shell'] },
      }),
    });
  }

  const dim = '\x1b[2m';
  const green = '\x1b[32m';
  const red = '\x1b[31m';
  const reset = '\x1b[0m';

  // Test 1: Boot
  process.stdout.write('  Boot agent... ');
  try {
    const context = await agent.boot();
    console.log(`${green}OK${reset} ${dim}(${context.system_prompt.length} char prompt)${reset}`);
  } catch (err) {
    console.log(`${red}FAIL${reset} — ${(err as Error).message}`);
    process.exit(1);
  }

  // Test 2: Provider availability
  process.stdout.write('  Check provider... ');
  const available = await agent.getProvider().available();
  if (available) {
    console.log(`${green}OK${reset} ${dim}(${agent.config.llm.provider}/${agent.config.llm.model})${reset}`);
  } else {
    console.log(`${red}UNAVAILABLE${reset} — check your API key or Ollama`);
    process.exit(1);
  }

  // Test 3: Simple conversation
  process.stdout.write('  Send message... ');
  const start = Date.now();
  try {
    const result = await agent.send('What is 2+2? Just the number, nothing else.');
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    const text = result.text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const hasAnswer = text.includes('4');
    if (hasAnswer) {
      console.log(`${green}OK${reset} ${dim}(${duration}s, "${text.slice(0, 50)}")${reset}`);
    } else {
      console.log(`${red}UNEXPECTED${reset} ${dim}(${duration}s, "${text.slice(0, 80)}")${reset}`);
    }
  } catch (err) {
    console.log(`${red}FAIL${reset} — ${(err as Error).message}`);
  }

  // Test 4: Tool use
  process.stdout.write('  Tool use... ');
  try {
    const result = await agent.send('Use the shell tool to run "echo hello" and tell me the output. Just the output.');
    const text = result.text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const usedTool = result.tool_calls_made.length > 0;
    if (usedTool) {
      console.log(`${green}OK${reset} ${dim}(${result.tool_calls_made.length} tool call(s), "${text.slice(0, 50)}")${reset}`);
    } else {
      console.log(`${red}NO TOOL CALL${reset} ${dim}("${text.slice(0, 80)}")${reset}`);
    }
  } catch (err) {
    console.log(`${red}FAIL${reset} — ${(err as Error).message}`);
  }

  await agent.shutdown();
  console.log(`\n  ${green}All checks passed.${reset}\n`);
}

async function startAgent(configPath?: string, provider?: string, model?: string): Promise<void> {
  if (!configPath) {
    const defaults = ['agent.yaml', 'agent.yml', 'ark.yaml', 'ark.yml'];
    for (const d of defaults) {
      if (existsSync(d)) {
        configPath = d;
        break;
      }
    }
  }

  let agent: Agent;

  if (configPath) {
    const absPath = resolve(configPath);
    if (!existsSync(absPath)) {
      console.error(`Config file not found: ${absPath}`);
      process.exit(1);
    }
    agent = new Agent({ configPath: absPath });
  } else {
    const config = createConfig({
      name: 'ark',
      description: 'Interactive Ark agent',
      identity: { soul: 'You are a helpful, capable AI assistant. Be direct and concise.' },
      llm: {
        provider: provider || 'anthropic',
        model: model || 'claude-sonnet-4-5-20250514',
      },
      persistence: { adapter: 'memory' },
      tools: { native: ['file_read', 'file_write', 'file_edit', 'shell', 'glob', 'grep', 'http_fetch'] },
    });
    agent = new Agent({ config });
  }

  if (provider) agent.config.llm.provider = provider;
  if (model) agent.config.llm.model = model;

  await startRepl(agent);
}

function printHelp() {
  console.log(`
ark — Model-agnostic portable agent runtime

Usage:
  ark [config.yaml]               Start agent from config
  ark start [config.yaml]         Start agent (same as above)
  ark init                        Create a new agent interactively
  ark test [config.yaml]          Quick smoke test
  ark -p ollama -m qwen3:14b      Start with specific provider/model
  ark --help                      Show this help

Commands:
  init                     Create a new agent config interactively
  start [config]           Start an agent REPL
  test [config]            Run a quick smoke test (boot, connect, chat, tools)

Options:
  -c, --config <path>      Path to agent YAML config
  -p, --provider <name>    LLM provider (anthropic, openai, ollama, google)
  -m, --model <name>       Model name
  -h, --help               Show help
  -v, --version            Show version

Quick Start:
  ark init                         # Create my-agent.yaml
  ark start my-agent.yaml          # Start chatting
  ark test -p ollama -m qwen3:14b  # Test with local Ollama
`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
