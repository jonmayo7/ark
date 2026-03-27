// ============================================================================
// Ark — Persistence Types
// ============================================================================

/** Abstract store interface — implemented by SQLite, Supabase, Memory */
export interface Store {
  /** Initialize the store (create tables, run migrations) */
  init(): Promise<void>;

  /** Close the store */
  close(): Promise<void>;

  // --- Soul (behavioral directives) ---
  getSoul(): Promise<SoulDirective[]>;
  addSoulDirective(directive: Omit<SoulDirective, 'id' | 'created_at'>): Promise<string>;
  updateSoulDirective(id: string, updates: Partial<SoulDirective>): Promise<void>;

  // --- Mind (knowledge graph) ---
  getMind(limit?: number): Promise<MindNode[]>;
  addMindNode(node: Omit<MindNode, 'id' | 'created_at' | 'updated_at'>): Promise<string>;
  updateMindNode(id: string, updates: Partial<MindNode>): Promise<void>;
  searchMind(query: string, limit?: number): Promise<MindNode[]>;

  // --- Ledger (wins & mistakes) ---
  getLedger(limit?: number): Promise<LedgerEntry[]>;
  addLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'created_at'>): Promise<string>;
  countPattern(pattern: string): Promise<number>;

  // --- State (key-value runtime state) ---
  getState(key: string): Promise<unknown | null>;
  getAllState(): Promise<Record<string, unknown>>;
  setState(key: string, value: unknown): Promise<void>;

  // --- Handoff (session continuity) ---
  getLatestHandoff(): Promise<SessionHandoff | null>;
  writeHandoff(handoff: Omit<SessionHandoff, 'id' | 'created_at'>): Promise<string>;

  // --- Conversations ---
  getConversation(session_id: string): Promise<ConversationTurn[]>;
  addConversationTurn(turn: Omit<ConversationTurn, 'id' | 'created_at'>): Promise<string>;
  listSessions(limit?: number): Promise<string[]>;
}

// --- Data Models ---

export interface SoulDirective {
  id: string;
  directive: string;
  category?: string;
  priority: number;
  active: boolean;
  created_at: string;
}

export interface MindNode {
  id: string;
  content: string;
  node_type: 'fact' | 'insight' | 'decision' | 'principle';
  domain?: string;
  signal: number;
  heat: number;
  depth: number;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface LedgerEntry {
  id: string;
  entry_type: 'win' | 'mistake';
  what: string;
  why?: string;
  should_have?: string;
  pattern?: string;
  severity?: string;
  created_at: string;
}

export interface SessionHandoff {
  id: string;
  active_work?: string;
  key_decisions?: string;
  open_questions?: string;
  next_actions?: string;
  context_for_next?: string;
  created_at: string;
}

export interface ConversationTurn {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: string;
  tool_call_id?: string;
  created_at: string;
}
