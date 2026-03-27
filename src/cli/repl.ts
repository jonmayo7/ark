// ============================================================================
// Ark — Interactive REPL
// ============================================================================

import { createInterface, Interface as ReadlineInterface } from 'node:readline';
import { Agent } from '../agent.js';
import type { StreamChunk } from '../llm/types.js';
import type { ToolResult } from '../tools/types.js';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

export async function startRepl(agent: Agent): Promise<void> {
  const config = agent.config;

  // Boot
  console.log(`${COLORS.dim}Booting ${COLORS.bold}${config.name}${COLORS.reset}${COLORS.dim}...${COLORS.reset}`);

  try {
    const context = await agent.boot();
    console.log(`${COLORS.green}✓${COLORS.reset} ${COLORS.bold}${config.name}${COLORS.reset} online`);
    console.log(`${COLORS.dim}  Provider: ${config.llm.provider} / ${config.llm.model}${COLORS.reset}`);
    console.log(`${COLORS.dim}  Store: ${config.persistence.adapter}${COLORS.reset}`);

    const toolCount = agent.getTools().getDefinitions().length;
    if (toolCount > 0) {
      console.log(`${COLORS.dim}  Tools: ${toolCount} available${COLORS.reset}`);
    }

    if (context.handoff) {
      console.log(`${COLORS.yellow}  ⚡ Previous session handoff loaded${COLORS.reset}`);
    }

    console.log(`${COLORS.dim}  Session: ${agent.sessionId}${COLORS.reset}`);
    console.log();
  } catch (err) {
    console.error(`${COLORS.red}Boot failed:${COLORS.reset} ${(err as Error).message}`);
    process.exit(1);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${COLORS.cyan}>${COLORS.reset} `,
    terminal: true,
  });

  // Handle Ctrl+C gracefully
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${COLORS.dim}Shutting down...${COLORS.reset}`);

    try {
      await agent.shutdown();
      console.log(`${COLORS.green}✓${COLORS.reset} Session handoff written.`);
    } catch (err) {
      console.error(`${COLORS.red}Shutdown error:${COLORS.reset} ${(err as Error).message}`);
    }

    rl.close();
    process.exit(0);
  };

  rl.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // Built-in commands
    if (input === '/quit' || input === '/exit' || input === '/q') {
      await shutdown();
      return;
    }

    if (input === '/usage') {
      const usage = agent.getUsage();
      const totalIn = usage.reduce((s, u) => s + u.input_tokens, 0);
      const totalOut = usage.reduce((s, u) => s + u.output_tokens, 0);
      const totalCost = usage.reduce((s, u) => s + (u.cost_usd || 0), 0);
      console.log(`${COLORS.dim}Tokens: ${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out`);
      console.log(`Cost: $${totalCost.toFixed(4)}`);
      console.log(`Calls: ${usage.length}${COLORS.reset}`);
      rl.prompt();
      return;
    }

    if (input === '/history') {
      const msgs = agent.getMessages();
      for (const msg of msgs) {
        const role = msg.role.toUpperCase().padEnd(10);
        const content = typeof msg.content === 'string'
          ? msg.content.slice(0, 100)
          : '[complex content]';
        console.log(`${COLORS.dim}${role}${COLORS.reset} ${content}`);
      }
      rl.prompt();
      return;
    }

    if (input === '/help') {
      console.log(`${COLORS.dim}Commands:`);
      console.log(`  /quit, /exit, /q  — Shutdown agent`);
      console.log(`  /usage            — Show token usage & cost`);
      console.log(`  /history          — Show conversation history`);
      console.log(`  /help             — Show this help${COLORS.reset}`);
      rl.prompt();
      return;
    }

    // Send to agent (streaming)
    try {
      const provider = agent.getProvider();
      const hasStreaming = typeof provider.stream === 'function';

      if (hasStreaming) {
        await handleStreamingResponse(agent, input);
      } else {
        await handleCompleteResponse(agent, input);
      }
    } catch (err) {
      console.error(`\n${COLORS.red}Error:${COLORS.reset} ${(err as Error).message}`);
    }

    console.log();
    rl.prompt();
  });

  rl.on('close', () => {
    if (!shuttingDown) shutdown();
  });
}

async function handleStreamingResponse(agent: Agent, input: string): Promise<void> {
  process.stdout.write('\n');

  for await (const chunk of agent.stream(input) as AsyncIterable<StreamChunk & { tool_result?: ToolResult }>) {
    switch (chunk.type) {
      case 'text':
        if (chunk.text) process.stdout.write(chunk.text);
        break;

      case 'tool_call_start':
        if (chunk.tool_call?.name) {
          process.stdout.write(
            `\n${COLORS.yellow}⚡ ${chunk.tool_call.name}${COLORS.reset}`,
          );
        }
        break;

      case 'tool_call_end':
        if (chunk.tool_call?.name) {
          const args = chunk.tool_call.arguments || {};
          const summary = Object.entries(args)
            .slice(0, 3)
            .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v)}`)
            .join(', ');
          process.stdout.write(
            `${COLORS.dim}(${summary})${COLORS.reset}\n`,
          );
        }
        break;

      case 'usage':
        if (chunk.usage) {
          const u = chunk.usage;
          process.stdout.write(
            `\n${COLORS.dim}[${u.provider}/${u.model} | ${u.input_tokens + u.output_tokens} tokens | ${u.duration_ms}ms${u.cost_usd ? ` | $${u.cost_usd.toFixed(4)}` : ''}]${COLORS.reset}`,
          );
        }
        break;

      default:
        // tool_result, done — handled implicitly
        if (chunk.tool_result) {
          const r = chunk.tool_result;
          const preview = r.content.slice(0, 200);
          process.stdout.write(
            `${COLORS.dim}  → ${r.is_error ? COLORS.red + 'ERROR: ' : ''}${preview}${COLORS.reset}\n`,
          );
        }
        break;
    }
  }
}

async function handleCompleteResponse(agent: Agent, input: string): Promise<void> {
  const result = await agent.send(input);

  // Show tool calls
  for (const tc of result.tool_calls_made) {
    console.log(`${COLORS.yellow}⚡ ${tc.name}${COLORS.reset}${COLORS.dim} → ${tc.result.slice(0, 100)}${COLORS.reset}`);
  }

  // Show response
  console.log(`\n${result.text}`);

  // Show usage
  for (const u of result.usage) {
    console.log(
      `${COLORS.dim}[${u.provider}/${u.model} | ${u.input_tokens + u.output_tokens} tokens | ${u.duration_ms}ms${u.cost_usd ? ` | $${u.cost_usd.toFixed(4)}` : ''}]${COLORS.reset}`,
    );
  }
}
