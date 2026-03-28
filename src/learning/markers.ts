// ============================================================================
// Ark — Marker Processing
// Extract structured data from LLM responses via invisible markers
//
// Ported from Lee (roryteehan.com/liora-lee) — proven in production.
// The LLM emits markers like [MEMORY]{json}[/MEMORY] in its response.
// These are invisible to the end user but drive persistence updates.
// ============================================================================

import type { Store } from '../persistence/types.js';

// --- Types ---

export interface MarkerResult {
  /** The response text with all markers stripped */
  cleanText: string;
  /** Markers that were extracted and processed */
  processed: ProcessedMarker[];
  /** Markers that failed to parse or save */
  errors: MarkerError[];
}

export interface ProcessedMarker {
  type: string;
  data: Record<string, unknown>;
}

export interface MarkerError {
  type: string;
  raw: string;
  error: string;
}

// --- Marker Processor ---

/**
 * Process an LLM response, extracting and applying all markers.
 *
 * Supported markers:
 * - [MEMORY]{"content":"...","category":"...","importance":0.5}[/MEMORY]
 * - [STATE]{"key":"value",...}[/STATE]
 * - [WIN]{"what":"..."}[/WIN]
 * - [MISTAKE]{"what":"...","why":"...","should_have":"...","pattern":"..."}[/MISTAKE]
 * - [SOUL]{"directive":"...","category":"..."}[/SOUL]
 *
 * All markers are stripped from the returned cleanText.
 */
export async function processMarkers(text: string, store: Store): Promise<MarkerResult> {
  const processed: ProcessedMarker[] = [];
  const errors: MarkerError[] = [];

  let cleanText = text;

  // Process each marker type
  for (const { type, regex, handler } of MARKER_HANDLERS) {
    cleanText = cleanText.replace(regex, (_match, json) => {
      try {
        const data = JSON.parse(json.trim()) as Record<string, unknown>;
        // Queue the handler (we'll await all at once)
        processed.push({ type, data });
        handler(store, data).catch(err => {
          errors.push({ type, raw: json, error: err.message });
        });
      } catch (err) {
        errors.push({
          type,
          raw: json,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return ''; // Strip the marker from visible text
    });
  }

  // Wait for all async handlers to complete
  // (handlers were fire-and-forget above, but errors are captured)
  // Give a tick for any pending promises to settle
  await new Promise(resolve => setTimeout(resolve, 0));

  // Clean up extra whitespace from marker removal
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();

  return { cleanText, processed, errors };
}

/**
 * Get the system prompt instructions that tell the LLM how to emit markers.
 * Add this to the agent's system prompt to enable marker processing.
 */
export function getMarkerInstructions(): string {
  return `
## Invisible Markers

You can emit special markers in your responses to persist information. These markers are invisible to the user — they are stripped before display. Use them to learn and remember.

### Memory (save knowledge for future sessions)
[MEMORY]{"content": "what to remember", "category": "preference|fact|routine|goal", "importance": 0.5}[/MEMORY]

### State (update runtime state)
[STATE]{"emotional_state": "...", "ongoing_threads": "...", "owner_context": "..."}[/STATE]

### Win (log something you did well)
[WIN]{"what": "description of success"}[/WIN]

### Mistake (log an error for self-improvement)
[MISTAKE]{"what": "what went wrong", "why": "root cause", "should_have": "better approach", "pattern": "pattern_name"}[/MISTAKE]

### Soul (add a behavioral directive)
[SOUL]{"directive": "new behavioral rule", "category": "style|behavior|tone"}[/SOUL]

Only emit markers when you have genuine information to persist. Do not force markers into every response.`.trim();
}

// --- Internal Handlers ---

type MarkerHandler = (store: Store, data: Record<string, unknown>) => Promise<void>;

interface MarkerDef {
  type: string;
  regex: RegExp;
  handler: MarkerHandler;
}

const MARKER_HANDLERS: MarkerDef[] = [
  {
    type: 'MEMORY',
    regex: /\[MEMORY\]([\s\S]*?)\[\/MEMORY\]/g,
    handler: async (store, data) => {
      await store.addMindNode({
        content: data.content as string,
        node_type: 'fact',
        domain: data.category as string || undefined,
        signal: (data.importance as number) || 0.5,
        heat: 1.0,
        depth: 1,
        tags: data.category ? [data.category as string] : [],
      });
    },
  },
  {
    type: 'STATE',
    regex: /\[STATE\]([\s\S]*?)\[\/STATE\]/g,
    handler: async (store, data) => {
      for (const [key, value] of Object.entries(data)) {
        await store.setState(key, value);
      }
    },
  },
  {
    type: 'WIN',
    regex: /\[WIN\]([\s\S]*?)\[\/WIN\]/g,
    handler: async (store, data) => {
      await store.addLedgerEntry({
        entry_type: 'win',
        what: data.what as string,
        why: data.why as string || undefined,
      });
    },
  },
  {
    type: 'MISTAKE',
    regex: /\[MISTAKE\]([\s\S]*?)\[\/MISTAKE\]/g,
    handler: async (store, data) => {
      await store.addLedgerEntry({
        entry_type: 'mistake',
        what: data.what as string,
        why: data.why as string || undefined,
        should_have: data.should_have as string || undefined,
        pattern: data.pattern as string || undefined,
        severity: data.severity as string || 'minor',
      });
    },
  },
  {
    type: 'SOUL',
    regex: /\[SOUL\]([\s\S]*?)\[\/SOUL\]/g,
    handler: async (store, data) => {
      await store.addSoulDirective({
        directive: data.directive as string,
        category: data.category as string || undefined,
        priority: (data.priority as number) || 5,
        active: true,
      });
    },
  },
];
