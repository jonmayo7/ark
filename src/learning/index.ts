// ============================================================================
// Ark — Self-Correction Loop
// Closes the feedback loop: tool errors → ledger → pattern detection → soul
// ============================================================================

import type { Store } from '../persistence/types.js';
import type { BehaviorConfig } from '../types.js';

export interface LearningEngine {
  /** Log a tool error as a mistake in the ledger */
  logToolError(toolName: string, args: Record<string, unknown>, error: string): Promise<void>;

  /** Log a win (successful outcome worth remembering) */
  logWin(what: string, why?: string): Promise<void>;

  /** Check if any patterns should be promoted to soul directives */
  promotePatterns(): Promise<PromotionResult[]>;
}

export interface PromotionResult {
  pattern: string;
  count: number;
  directive: string;
}

const DEFAULT_PROMOTION_THRESHOLD = 3;

/**
 * Creates a LearningEngine that closes the self-correction loop.
 *
 * When `behavior.log_mistakes` is true:
 * 1. Tool errors are automatically logged to the ledger with pattern detection
 * 2. After each error, patterns are counted
 * 3. When a pattern recurs >= threshold times, it's promoted to a soul directive
 *
 * This makes the agent genuinely self-correcting — not just storing data,
 * but building behavioral rules from observed failure patterns.
 */
export function createLearningEngine(
  store: Store,
  behavior?: BehaviorConfig,
  promotionThreshold = DEFAULT_PROMOTION_THRESHOLD,
): LearningEngine {
  const enabled = behavior?.log_mistakes !== false; // default true

  return {
    async logToolError(toolName: string, args: Record<string, unknown>, error: string): Promise<void> {
      if (!enabled) return;

      // Derive a pattern name from the tool and error type
      const pattern = derivePattern(toolName, error);

      await store.addLedgerEntry({
        entry_type: 'mistake',
        what: `Tool "${toolName}" failed: ${truncate(error, 200)}`,
        why: `Called with args: ${truncate(JSON.stringify(args), 150)}`,
        should_have: inferCorrection(toolName, error),
        pattern,
        severity: 'minor',
      });

      // Check if this pattern should be promoted
      const count = await store.countPattern(pattern);
      if (count >= promotionThreshold) {
        await promoteToSoul(store, pattern, count, toolName, error);
      }
    },

    async logWin(what: string, why?: string): Promise<void> {
      if (!enabled) return;

      await store.addLedgerEntry({
        entry_type: 'win',
        what,
        why,
      });
    },

    async promotePatterns(): Promise<PromotionResult[]> {
      if (!enabled) return [];

      const ledger = await store.getLedger(100);
      const patternCounts = new Map<string, { count: number; latest: string }>();

      for (const entry of ledger) {
        if (entry.entry_type === 'mistake' && entry.pattern) {
          const existing = patternCounts.get(entry.pattern);
          if (existing) {
            existing.count++;
          } else {
            patternCounts.set(entry.pattern, { count: 1, latest: entry.what });
          }
        }
      }

      const results: PromotionResult[] = [];
      const existingSoul = await store.getSoul();
      const existingDirectives = new Set(existingSoul.map(s => s.category));

      for (const [pattern, { count, latest }] of patternCounts) {
        if (count >= promotionThreshold && !existingDirectives.has(`auto:${pattern}`)) {
          const directive = `Recurring issue (${count}x): ${latest}. Be cautious with this pattern.`;
          await store.addSoulDirective({
            directive,
            category: `auto:${pattern}`,
            priority: 5,
            active: true,
          });
          results.push({ pattern, count, directive });
        }
      }

      return results;
    },
  };
}

/** Derive a pattern name from a tool error */
function derivePattern(toolName: string, error: string): string {
  const errorLower = error.toLowerCase();

  if (errorLower.includes('not found') || errorLower.includes('no such file'))
    return `${toolName}_not_found`;
  if (errorLower.includes('permission') || errorLower.includes('denied'))
    return `${toolName}_permission`;
  if (errorLower.includes('timeout'))
    return `${toolName}_timeout`;
  if (errorLower.includes('syntax') || errorLower.includes('parse'))
    return `${toolName}_syntax`;
  if (errorLower.includes('blocked') || errorLower.includes('ssrf'))
    return `${toolName}_blocked`;

  return `${toolName}_error`;
}

/** Infer what should have been done differently */
function inferCorrection(toolName: string, error: string): string {
  const errorLower = error.toLowerCase();

  if (errorLower.includes('not found'))
    return 'Verify the target exists before attempting the operation';
  if (errorLower.includes('permission'))
    return 'Check permissions before attempting the operation';
  if (errorLower.includes('timeout'))
    return 'Consider using a shorter operation or checking connectivity first';
  if (errorLower.includes('syntax'))
    return 'Validate input format before submitting';

  return 'Review the error and adjust the approach';
}

/** Promote a recurring pattern to a soul directive */
async function promoteToSoul(
  store: Store,
  pattern: string,
  count: number,
  toolName: string,
  latestError: string,
): Promise<void> {
  // Check if already promoted
  const existing = await store.getSoul();
  const alreadyExists = existing.some(s => s.category === `auto:${pattern}`);
  if (alreadyExists) return;

  const directive = `AUTO-PROMOTED (${count}x ${pattern}): Tool "${toolName}" has repeatedly failed with: "${truncate(latestError, 100)}". Before using this tool, verify prerequisites are met.`;

  await store.addSoulDirective({
    directive,
    category: `auto:${pattern}`,
    priority: 5,
    active: true,
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}
