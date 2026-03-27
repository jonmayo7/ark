// ============================================================================
// Ark — Supabase Store (cloud persistence, multi-terminal)
// ============================================================================

import type {
  Store, SoulDirective, MindNode, LedgerEntry,
  SessionHandoff, ConversationTurn,
} from './types.js';

export class SupabaseStore implements Store {
  private url: string;
  private key: string;

  constructor(url: string, key: string) {
    this.url = url.replace(/\/$/, '');
    this.key = key;
  }

  private async query<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(options.headers as Record<string, string> || {}),
    };

    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase error ${res.status}: ${text}`);
    }

    const text = await res.text();
    if (!text) return [] as unknown as T;
    return JSON.parse(text) as T;
  }

  async init(): Promise<void> {
    // Tables should already exist in Supabase
    // Verify connectivity
    await this.query('agent_state?select=key&limit=1');
  }

  async close(): Promise<void> {
    // No persistent connection to close
  }

  // --- Soul ---
  async getSoul(): Promise<SoulDirective[]> {
    return this.query<SoulDirective[]>(
      'agent_soul?active=eq.true&order=priority.asc',
    );
  }

  async addSoulDirective(directive: Omit<SoulDirective, 'id' | 'created_at'>): Promise<string> {
    const rows = await this.query<SoulDirective[]>('agent_soul', {
      method: 'POST',
      body: JSON.stringify(directive),
    });
    return rows[0].id;
  }

  async updateSoulDirective(id: string, updates: Partial<SoulDirective>): Promise<void> {
    await this.query(`agent_soul?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  // --- Mind ---
  async getMind(limit = 20): Promise<MindNode[]> {
    return this.query<MindNode[]>(
      `agent_mind?order=heat.desc,signal.desc&limit=${limit}`,
    );
  }

  async addMindNode(node: Omit<MindNode, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const rows = await this.query<MindNode[]>('agent_mind', {
      method: 'POST',
      body: JSON.stringify(node),
    });
    return rows[0].id;
  }

  async updateMindNode(id: string, updates: Partial<MindNode>): Promise<void> {
    await this.query(`agent_mind?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
    });
  }

  async searchMind(query: string, limit = 10): Promise<MindNode[]> {
    return this.query<MindNode[]>(
      `agent_mind?or=(content.ilike.*${encodeURIComponent(query)}*)&order=heat.desc,signal.desc&limit=${limit}`,
    );
  }

  // --- Ledger ---
  async getLedger(limit = 15): Promise<LedgerEntry[]> {
    return this.query<LedgerEntry[]>(
      `agent_ledger?order=created_at.desc&limit=${limit}`,
    );
  }

  async addLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'created_at'>): Promise<string> {
    const rows = await this.query<LedgerEntry[]>('agent_ledger', {
      method: 'POST',
      body: JSON.stringify(entry),
    });
    return rows[0].id;
  }

  async countPattern(pattern: string): Promise<number> {
    const rows = await this.query<Array<Record<string, unknown>>>(
      `agent_ledger?pattern=eq.${encodeURIComponent(pattern)}&select=id`,
      { headers: { 'Prefer': 'count=exact' } },
    );
    return rows.length;
  }

  // --- State ---
  async getState(key: string): Promise<unknown | null> {
    const rows = await this.query<Array<{ key: string; value: unknown }>>(
      `agent_state?key=eq.${encodeURIComponent(key)}&limit=1`,
    );
    return rows[0]?.value ?? null;
  }

  async getAllState(): Promise<Record<string, unknown>> {
    const rows = await this.query<Array<{ key: string; value: unknown }>>(
      'agent_state?select=key,value',
    );
    const result: Record<string, unknown> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  }

  async setState(key: string, value: unknown): Promise<void> {
    // Upsert
    await this.query('agent_state', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });
  }

  // --- Handoff ---
  async getLatestHandoff(): Promise<SessionHandoff | null> {
    const rows = await this.query<SessionHandoff[]>(
      'agent_handoff?order=created_at.desc&limit=1',
    );
    return rows[0] || null;
  }

  async writeHandoff(handoff: Omit<SessionHandoff, 'id' | 'created_at'>): Promise<string> {
    const rows = await this.query<SessionHandoff[]>('agent_handoff', {
      method: 'POST',
      body: JSON.stringify(handoff),
    });
    return rows[0].id;
  }

  // --- Conversations ---
  async getConversation(session_id: string): Promise<ConversationTurn[]> {
    return this.query<ConversationTurn[]>(
      `agent_conversations?session_id=eq.${encodeURIComponent(session_id)}&order=created_at.asc`,
    );
  }

  async addConversationTurn(turn: Omit<ConversationTurn, 'id' | 'created_at'>): Promise<string> {
    const rows = await this.query<ConversationTurn[]>('agent_conversations', {
      method: 'POST',
      body: JSON.stringify(turn),
    });
    return rows[0].id;
  }

  async listSessions(limit = 10): Promise<string[]> {
    const rows = await this.query<Array<{ session_id: string }>>(
      `agent_conversations?select=session_id&order=created_at.desc&limit=${limit * 5}`,
    );
    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of rows) {
      if (!seen.has(row.session_id)) {
        seen.add(row.session_id);
        result.push(row.session_id);
        if (result.length >= limit) break;
      }
    }
    return result;
  }
}
