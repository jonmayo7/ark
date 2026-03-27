// ============================================================================
// Ark — `ark init` — Interactive Agent Scaffolding
// ============================================================================

import { createInterface } from 'node:readline';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
};

interface InitAnswers {
  name: string;
  description: string;
  provider: string;
  model: string;
  persistence: string;
  tools: boolean;
  soul: string;
}

const PROVIDER_DEFAULTS: Record<string, { model: string; env?: string; base_url?: string }> = {
  anthropic: { model: 'claude-sonnet-4-5-20250514', env: 'ANTHROPIC_API_KEY' },
  openai: { model: 'gpt-4o', env: 'OPENAI_API_KEY' },
  ollama: { model: 'qwen3:14b', base_url: 'http://localhost:11434/v1' },
  google: { model: 'gemini-2.5-flash', env: 'GOOGLE_AI_API_KEY' },
};

export async function runInit(): Promise<void> {
  console.log(`\n${COLORS.bold}ark init${COLORS.reset} — Create a new agent\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string, defaultVal?: string): Promise<string> => {
    const prompt = defaultVal
      ? `${COLORS.cyan}?${COLORS.reset} ${question} ${COLORS.dim}(${defaultVal})${COLORS.reset} `
      : `${COLORS.cyan}?${COLORS.reset} ${question} `;

    return new Promise(resolve => {
      rl.question(prompt, answer => {
        resolve(answer.trim() || defaultVal || '');
      });
    });
  };

  const askChoice = (question: string, choices: string[], defaultIdx = 0): Promise<string> => {
    const choiceStr = choices.map((c, i) =>
      i === defaultIdx ? `${COLORS.bold}${c}${COLORS.reset}` : c
    ).join(' / ');
    return ask(`${question} [${choiceStr}]`, choices[defaultIdx]);
  };

  try {
    const answers: InitAnswers = {
      name: '',
      description: '',
      provider: '',
      model: '',
      persistence: '',
      tools: true,
      soul: '',
    };

    answers.name = await ask('Agent name:', 'my-agent');
    answers.description = await ask('Description:', 'A helpful AI assistant');
    answers.provider = await askChoice('LLM provider:', ['ollama', 'anthropic', 'openai', 'google'], 0);

    const providerInfo = PROVIDER_DEFAULTS[answers.provider] || PROVIDER_DEFAULTS.ollama;
    answers.model = await ask('Model:', providerInfo.model);
    answers.persistence = await askChoice('Persistence:', ['sqlite', 'memory', 'supabase'], 0);

    const toolAnswer = await askChoice('Include tools?', ['yes', 'no'], 0);
    answers.tools = toolAnswer !== 'no';

    answers.soul = await ask('Personality (one line):', 'You are a helpful, capable AI assistant. Be direct and concise.');

    // Generate YAML
    const yaml = generateYaml(answers);
    const outputPath = resolve(`${answers.name}.yaml`);

    if (existsSync(outputPath)) {
      const overwrite = await askChoice(`${outputPath} exists. Overwrite?`, ['no', 'yes'], 0);
      if (overwrite !== 'yes') {
        console.log(`\n${COLORS.yellow}Aborted.${COLORS.reset}`);
        rl.close();
        return;
      }
    }

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, yaml);

    // Generate soul file
    const soulPath = resolve(`${answers.name}-soul.md`);
    const soulContent = generateSoul(answers);
    writeFileSync(soulPath, soulContent);

    console.log(`\n${COLORS.green}Created:${COLORS.reset}`);
    console.log(`  ${outputPath}`);
    console.log(`  ${soulPath}`);
    console.log(`\n${COLORS.dim}Start your agent:${COLORS.reset}`);
    console.log(`  npx tsx src/cli/index.ts ${outputPath}\n`);

    rl.close();
  } catch (err) {
    rl.close();
    throw err;
  }
}

function generateYaml(answers: InitAnswers): string {
  const providerInfo = PROVIDER_DEFAULTS[answers.provider] || PROVIDER_DEFAULTS.ollama;

  const lines: string[] = [
    `name: ${answers.name}`,
    `version: "1.0"`,
    `description: "${answers.description}"`,
    '',
    'identity:',
    `  soul_file: ./${answers.name}-soul.md`,
    '',
    'llm:',
    `  provider: ${answers.provider}`,
    `  model: ${answers.model}`,
  ];

  // Provider config
  if (providerInfo.env || providerInfo.base_url) {
    lines.push('  providers:');
    lines.push(`    ${answers.provider}:`);
    if (providerInfo.env) {
      lines.push(`      api_key: \${${providerInfo.env}}`);
    }
    if (providerInfo.base_url) {
      lines.push(`      base_url: ${providerInfo.base_url}`);
    }
  }

  // Persistence
  lines.push('');
  lines.push('persistence:');
  lines.push(`  adapter: ${answers.persistence}`);
  if (answers.persistence === 'sqlite') {
    lines.push(`  path: ./data/${answers.name}.db`);
  }

  // Tools
  if (answers.tools) {
    lines.push('');
    lines.push('tools:');
    lines.push('  native:');
    lines.push('    - file_read');
    lines.push('    - file_write');
    lines.push('    - file_edit');
    lines.push('    - shell');
    lines.push('    - glob');
    lines.push('    - grep');
    lines.push('    - http_fetch');
  }

  // Boot + behavior
  lines.push('');
  lines.push('boot:');
  lines.push('  load_soul: true');
  lines.push('  load_state: true');
  lines.push('  load_memory: true');
  lines.push('  load_ledger: true');
  lines.push('  load_handoff: true');
  lines.push('  memory_limit: 20');
  lines.push('');
  lines.push('behavior:');
  lines.push('  verify_actions: true');
  lines.push('  log_mistakes: true');
  lines.push('  session_handoff: true');
  lines.push('  max_tool_rounds: 10');
  lines.push('');

  return lines.join('\n');
}

function generateSoul(answers: InitAnswers): string {
  return `# ${answers.name}

${answers.soul}

## Principles

- Verify the result of actions before reporting completion.
- When you make a mistake, acknowledge it and learn from it.
- Be concise. Earn the length of every response.
- If you're unsure, say so rather than guessing.

## Communication Style

- Direct and clear.
- Lead with the answer, not the reasoning.
- Use tools when they help. Don't use them when they don't.
`;
}
