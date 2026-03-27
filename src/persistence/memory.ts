// ============================================================================
// Ark — In-Memory Store (for testing and ephemeral agents)
// ============================================================================

import type {
  Store, SoulDirective, MindNode, LedgerEntry,
  SessionHandoff, ConversationTurn,
} from './types.js';
import { randomUUID } from 'node:crypto';

export class MemoryStore implements Store {
  private soul: Map<string, SoulDirective> = new Map();
  private mind: Map<string, MindNode> = new Map();
  private ledger: Map<string, LedgerEntry> = new Map();
  private state: Map<string, unknown> = new Map();
  private handoffs: SessionHandoff[] = [];
  private conversations: Map<string, ConversationTurn> = new Map();

  async init(): Promise<void> {
    // Nothing to initialize
  }

  async close(): Promise<void> {
    this.soul.clear();
    this.mind.clear();
    this.ledger.clear();
    this.state.clear();
    this.handoffs = [];
    this.conversations.clear();
  }

  // --- Soul ---
  async getSoul(): Promise<SoulDirective[]> {
    return [...this.soul.values()].filter(s => s.active).sort((a, b) => a.priority - b.priority);
  }

  async addSoulDirective(directive: Omit<SoulDirective, 'id' | 'created_at'>): Promise<string> {
    const id = randomUUID();
    this.soul.set(id, { ...directive, id, created_at: new Date().toISOString() });
    return id;
  }

  async updateSoulDirective(id: string, updates: Partial<SoulDirective>): Promise<void> {
    const existing = this.soul.get(id);
    if (existing) this.soul.set(id, { ...existing, ...updates });
  }

  // --- Mind ---
  async getMind(limit = 20): Promise<MindNode[]> {
    return [...this.mind.values()]
      .sort((a, b) => (b.heat * b.signal * b.depth) - (a.heat * a.signal * a.depth))
      .slice(0, limit);
  }

  async addMindNode(node: Omit<MindNode, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.mind.set(id, { ...node, id, created_at: now, updated_at: now });
    return id;
  }

  async updateMindNode(id: string, updates: Partial<MindNode>): Promise<void> {
    const existing = this.mind.get(id);
    if (existing) {
      this.mind.set(id, { ...existing, ...updates, updated_at: new Date().toISOString() });
    }
  }

  async searchMind(query: string, limit = 10): Promise<MindNode[]> {
    const lower = query.toLowerCase();
    return [...this.mind.values()]
      .filter(n => n.content.toLowerCase().includes(lower) ||
                   n.tags.some(t => t.toLowerCase().includes(lower)))
      .sort((a, b) => (b.heat * b.signal) - (a.heat * a.signal))
      .slice(0, limit);
  }

  // --- Ledger ---
  async getLedger(limit = 15): Promise<LedgerEntry[]> {
    return [...this.ledger.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  async addLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'created_at'>): Promise<string> {
    const id = randomUUID();
    this.ledger.set(id, { ...entry, id, created_at: new Date().toISOString() });
    return id;
  }

  async countPattern(pattern: string): Promise<number> {
    return [...this.ledger.values()].filter(e => e.pattern === pattern).length;
  }

  // --- State ---
  async getState(key: string): Promise<unknown | null> {
    return this.state.get(key) ?? null;
  }

  async getAllState(): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of this.state) result[k] = v;
    return result;
  }

  async setState(key: string, value: unknown): Promise<void> {
    this.state.set(key, value);
  }

  // --- Handoff ---
  async getLatestHandoff(): Promise<SessionHandoff | null> {
    return this.handoffs[this.handoffs.length - 1] || null;
  }

  async writeHandoff(handoff: Omit<SessionHandoff, 'id' | 'created_at'>): Promise<string> {
    const id = randomUUID();
    const entry = { ...handoff, id, created_at: new Date().toISOString() };
    this.handoffs.push(entry);
    return id;
  }

  // --- Conversations ---
  async getConversation(session_id: string): Promise<ConversationTurn[]> {
    return [...this.conversations.values()]
      .filter(c => c.session_id === session_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async addConversationTurn(turn: Omit<ConversationTurn, 'id' | 'created_at'>): Promise<string> {
    const id = randomUUID();
    this.conversations.set(id, { ...turn, id, created_at: new Date().toISOString() });
    return id;
  }

  async listSessions(limit = 10): Promise<string[]> {
    const sessions = new Set<string>();
    const sorted = [...this.conversations.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const turn of sorted) {
      sessions.add(turn.session_id);
      if (sessions.size >= limit) break;
    }
    return [...sessions];
  }
}
