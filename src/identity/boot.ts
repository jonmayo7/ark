// ============================================================================
// Ark — Boot Sequence (system prompt assembly)
// ============================================================================

import type { AgentConfig } from '../types.js';
import type { Store } from '../persistence/types.js';
import type { BootContext } from './types.js';
import { loadSoulFile } from './loader.js';

/** Execute the boot sequence: load identity + state → assemble system prompt */
export async function bootAgent(config: AgentConfig, store: Store): Promise<BootContext> {
  const boot = config.boot || {};

  // 1. Assemble soul/identity text
  const soulParts: string[] = [];

  // Inline soul text
  if (config.identity.soul) {
    soulParts.push(config.identity.soul);
  }

  // Soul file
  if (config.identity.soul_file) {
    const soulText = loadSoulFile(config.identity.soul_file);
    if (soulText) soulParts.push(soulText);
  }

  // Inline directives
  if (config.identity.directives?.length) {
    soulParts.push(
      'Behavioral directives:\n' +
      config.identity.directives.map(d => `- ${d}`).join('\n'),
    );
  }

  // 2. Load soul directives from DB
  if (boot.load_soul !== false) {
    try {
      const dbSoul = await store.getSoul();
      if (dbSoul.length > 0) {
        soulParts.push(
          '\nLearned directives (from experience):\n' +
          dbSoul.map(s => `- [${s.category || 'general'}] ${s.directive}`).join('\n'),
        );
      }
    } catch {
      // Store may not have soul table yet
    }
  }

  // 3. Load user profile
  if (config.identity.user_file) {
    const userText = loadSoulFile(config.identity.user_file);
    if (userText) {
      soulParts.push('\n--- Operator Profile ---\n' + userText);
    }
  }

  // 4. Load runtime state
  let state: Record<string, unknown> = {};
  if (boot.load_state !== false) {
    try {
      state = await store.getAllState();
    } catch {
      // Ignore
    }
  }

  // 5. Load memories
  const memories: string[] = [];
  if (boot.load_memory !== false) {
    try {
      const limit = boot.memory_limit || 20;
      const mind = await store.getMind(limit);
      for (const node of mind) {
        memories.push(`[${node.node_type}/${node.domain || 'general'}] ${node.content}`);
      }
    } catch {
      // Ignore
    }
  }

  // 6. Load ledger
  let ledger_summary = '';
  if (boot.load_ledger !== false) {
    try {
      const entries = await store.getLedger(10);
      if (entries.length > 0) {
        const wins = entries.filter(e => e.entry_type === 'win');
        const mistakes = entries.filter(e => e.entry_type === 'mistake');

        const parts: string[] = [];
        if (wins.length > 0) {
          parts.push('Recent wins:\n' + wins.map(w => `  + ${w.what}`).join('\n'));
        }
        if (mistakes.length > 0) {
          parts.push('Recent mistakes:\n' + mistakes.map(m =>
            `  - ${m.what}${m.pattern ? ` [pattern: ${m.pattern}]` : ''}`,
          ).join('\n'));
        }
        ledger_summary = parts.join('\n\n');
      }
    } catch {
      // Ignore
    }
  }

  // 7. Load handoff
  let handoff: string | undefined;
  if (boot.load_handoff !== false) {
    try {
      const h = await store.getLatestHandoff();
      if (h) {
        const parts: string[] = ['Previous session handoff:'];
        if (h.active_work) parts.push(`  Active work: ${h.active_work}`);
        if (h.key_decisions) parts.push(`  Key decisions: ${h.key_decisions}`);
        if (h.open_questions) parts.push(`  Open questions: ${h.open_questions}`);
        if (h.next_actions) parts.push(`  Next actions: ${h.next_actions}`);
        if (h.context_for_next) parts.push(`  Context: ${h.context_for_next}`);
        handoff = parts.join('\n');
      }
    } catch {
      // Ignore
    }
  }

  // 8. Assemble system prompt
  const sections: string[] = [];

  // Identity
  if (soulParts.length > 0) {
    sections.push(soulParts.join('\n\n'));
  }

  // Date
  sections.push(`Current date: ${new Date().toISOString().split('T')[0]}`);

  // State
  if (Object.keys(state).length > 0) {
    sections.push('Current state:\n' + JSON.stringify(state, null, 2));
  }

  // Memories
  if (memories.length > 0) {
    sections.push('Knowledge:\n' + memories.join('\n'));
  }

  // Ledger
  if (ledger_summary) {
    sections.push(ledger_summary);
  }

  // Handoff
  if (handoff) {
    sections.push(handoff);
  }

  // Tool awareness
  sections.push(
    'You have tools available. Use them to accomplish tasks. ' +
    'Always verify the result of actions before reporting completion.',
  );

  const system_prompt = sections.join('\n\n---\n\n');

  return {
    system_prompt,
    soul: soulParts,
    state,
    memories,
    ledger_summary,
    handoff,
  };
}
