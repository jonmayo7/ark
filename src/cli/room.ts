// ============================================================================
// Ark — Chat Room (multi-agent conversation)
// ============================================================================

import { createInterface } from 'node:readline';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Agent } from '../agent.js';
import type { AgentConfig } from '../types.js';

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
  white: '\x1b[37m',
};

const AGENT_COLORS = [
  '\x1b[36m', // cyan
  '\x1b[33m', // yellow
  '\x1b[35m', // magenta
  '\x1b[32m', // green
  '\x1b[34m', // blue
  '\x1b[31m', // red
];

interface RoomMessage {
  speaker: string;
  content: string;
  timestamp: string;
  is_operator: boolean;
}

interface RoomConfig {
  topic?: string;
  rounds?: number;
  log_file?: string;
}

export async function startRoom(
  agents: Agent[],
  config: RoomConfig = {},
): Promise<void> {
  const topic = config.topic || 'Introduce yourselves and discuss what you find most interesting about AI agents.';
  const maxRounds = config.rounds || 20;
  const logFile = config.log_file || `data/room-${Date.now()}.log`;

  const transcript: RoomMessage[] = [];
  const agentNames = agents.map(a => a.config.name);

  // Boot all agents
  console.log(`${COLORS.dim}Booting ${agents.length} agents...${COLORS.reset}`);
  for (const agent of agents) {
    await agent.boot();
  }
  console.log(`${COLORS.green}All agents online.${COLORS.reset}\n`);

  // Header
  console.log(`${COLORS.bold}╔══════════════════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLORS.bold}║                  Ark Chat Room                   ║${COLORS.reset}`);
  console.log(`${COLORS.bold}╚══════════════════════════════════════════════════╝${COLORS.reset}`);
  console.log();
  console.log(`${COLORS.dim}Agents:${COLORS.reset}`);
  agents.forEach((a, i) => {
    const color = AGENT_COLORS[i % AGENT_COLORS.length];
    console.log(`  ${color}■${COLORS.reset} ${a.config.name} ${COLORS.dim}(${a.config.llm.provider}/${a.config.llm.model})${COLORS.reset}`);
  });
  console.log(`${COLORS.dim}Topic: ${topic}${COLORS.reset}`);
  console.log(`${COLORS.dim}Max rounds: ${maxRounds} | Type /say <msg> to interject | /stop to end${COLORS.reset}`);
  console.log();

  // Build the system context for each agent so they know who's in the room
  const roomContext = agentNames
    .map((name, i) => `- ${name}${i === 0 ? ' (you)' : ''}`)
    .join('\n');

  // Set up readline for operator interjections
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  let operatorMessage: string | null = null;
  let stopRequested = false;

  // Listen for operator input in background
  process.stdin.setRawMode?.(false);
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed === '/stop' || trimmed === '/quit') {
      stopRequested = true;
    } else if (trimmed.startsWith('/say ')) {
      operatorMessage = trimmed.slice(5);
    }
  });

  // Main conversation loop
  for (let round = 0; round < maxRounds; round++) {
    if (stopRequested) break;

    // Check for operator interjection
    if (operatorMessage) {
      const msg = operatorMessage;
      operatorMessage = null;
      printMessage('Operator', msg, -1);
      transcript.push({
        speaker: 'Operator',
        content: msg,
        timestamp: new Date().toISOString(),
        is_operator: true,
      });
    }

    // Each agent takes a turn
    for (let i = 0; i < agents.length; i++) {
      if (stopRequested) break;

      const agent = agents[i];
      const name = agentNames[i];

      // Build the prompt: conversation history + room context
      const prompt = buildPrompt(name, agentNames, transcript, topic, round === 0 && i === 0);

      try {
        const result = await agent.send(prompt);
        let text = result.text
          .replace(/<think>[\s\S]*?<\/think>/g, '')
          .trim();

        // Clean up any self-attribution the LLM might add
        text = text.replace(new RegExp(`^${name}:\\s*`, 'i'), '');

        printMessage(name, text, i);

        transcript.push({
          speaker: name,
          content: text,
          timestamp: new Date().toISOString(),
          is_operator: false,
        });

        // Brief pause between agents for readability
        await sleep(500);
      } catch (err) {
        console.log(`${COLORS.red}[${name} error: ${(err as Error).message}]${COLORS.reset}`);
      }
    }

    // Round separator
    if (round < maxRounds - 1 && !stopRequested) {
      console.log(`${COLORS.dim}${'─'.repeat(60)} round ${round + 1}${COLORS.reset}\n`);
    }
  }

  // Shutdown
  console.log(`\n${COLORS.dim}Room closing...${COLORS.reset}`);
  rl.close();

  // Save transcript
  try {
    const logPath = resolve(logFile);
    mkdirSync(dirname(logPath), { recursive: true });
    const logContent = formatTranscript(transcript, topic, agentNames);
    writeFileSync(logPath, logContent);
    console.log(`${COLORS.dim}Transcript saved: ${logPath}${COLORS.reset}`);
  } catch (err) {
    console.log(`${COLORS.dim}Could not save transcript: ${(err as Error).message}${COLORS.reset}`);
  }

  // Shutdown agents
  for (const agent of agents) {
    try { await agent.shutdown(); } catch {}
  }

  console.log(`${COLORS.green}Room closed.${COLORS.reset}\n`);
}

function buildPrompt(
  myName: string,
  allNames: string[],
  transcript: RoomMessage[],
  topic: string,
  isFirstMessage: boolean,
): string {
  const otherNames = allNames.filter(n => n !== myName);

  if (isFirstMessage) {
    return [
      `You are ${myName} in a group chat room with: ${otherNames.join(', ')}.`,
      `The topic is: "${topic}"`,
      '',
      'You are starting the conversation. Introduce yourself briefly and share your opening thoughts on the topic.',
      'Keep your response to 2-4 sentences. Be yourself — speak from your personality and perspective.',
      'Do not prefix your response with your name.',
    ].join('\n');
  }

  // Build recent conversation context (last 10 messages to avoid context overflow)
  const recent = transcript.slice(-10);
  const history = recent
    .map(m => `${m.speaker}: ${m.content}`)
    .join('\n\n');

  return [
    `You are ${myName} in a group chat room with: ${otherNames.join(', ')}.`,
    `The topic is: "${topic}"`,
    '',
    'Recent conversation:',
    history,
    '',
    `It's your turn to respond. React to what others have said, build on ideas, disagree if you disagree, ask questions.`,
    'Keep your response to 2-4 sentences. Be yourself. Do not prefix your response with your name.',
    `Do not repeat what others have said. Add something new.`,
  ].join('\n');
}

function printMessage(name: string, text: string, agentIndex: number): void {
  const color = agentIndex >= 0
    ? AGENT_COLORS[agentIndex % AGENT_COLORS.length]
    : COLORS.white;
  const ts = new Date().toISOString().split('T')[1].slice(0, 8);

  console.log(`${COLORS.dim}${ts}${COLORS.reset} ${color}${COLORS.bold}${name}${COLORS.reset}`);

  // Word-wrap at 80 chars with indent
  const words = text.split(' ');
  let line = '  ';
  for (const word of words) {
    if (line.length + word.length > 80) {
      console.log(line);
      line = '  ' + word;
    } else {
      line += (line.length > 2 ? ' ' : '') + word;
    }
  }
  if (line.trim()) console.log(line);
  console.log();
}

function formatTranscript(
  transcript: RoomMessage[],
  topic: string,
  agents: string[],
): string {
  const lines: string[] = [
    'Ark Chat Room Transcript',
    '=' .repeat(50),
    `Date: ${new Date().toISOString()}`,
    `Topic: ${topic}`,
    `Agents: ${agents.join(', ')}`,
    `Messages: ${transcript.length}`,
    '',
    '---',
    '',
  ];

  for (const msg of transcript) {
    const ts = msg.timestamp.split('T')[1].slice(0, 8);
    lines.push(`[${ts}] ${msg.speaker}:`);
    lines.push(msg.content);
    lines.push('');
  }

  return lines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
