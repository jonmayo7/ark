// ============================================================================
// Ark — SQLite Store (default, local-first persistence)
// ============================================================================

import type {
  Store, SoulDirective, MindNode, LedgerEntry,
  SessionHandoff, ConversationTurn,
} from './types.js';
import { SCHEMA_SQL } from './schema.js';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class SQLiteStore implements Store {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(path: string = './data/agent.db') {
    this.dbPath = path;
  }

  async init(): Promise<void> {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private get conn(): Database.Database {
    if (!this.db) throw new Error('Store not initialized — call init() first');
    return this.db;
  }

  // --- Soul ---
  async getSoul(): Promise<SoulDirective[]> {
    const rows = this.conn.prepare(
      'SELECT * FROM agent_soul WHERE active = 1 ORDER BY priority ASC',
    ).all() as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: r.id as string,
      directive: r.directive as string,
      category: r.category as string | undefined,
      priority: r.priority as number,
      active: Boolean(r.active),
      created_at: r.created_at as string,
    }));
  }

  async addSoulDirective(directive: Omit<SoulDirective, 'id' | 'created_at'>): Promise<string> {
    const id = randomUUID();
    this.conn.prepare(
      'INSERT INTO agent_soul (id, directive, category, priority, active) VALUES (?, ?, ?, ?, ?)',
    ).run(id, directive.directive, directive.category || null, directive.priority, directive.active ? 1 : 0);
    return id;
  }

  async updateSoulDirective(id: string, updates: Partial<SoulDirective>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (updates.directive !== undefined) { sets.push('directive = ?'); vals.push(updates.directive); }
    if (updates.category !== undefined) { sets.push('category = ?'); vals.push(updates.category); }
    if (updates.priority !== undefined) { sets.push('priority = ?'); vals.push(updates.priority); }
    if (updates.active !== undefined) { sets.push('active = ?'); vals.push(updates.active ? 1 : 0); }

    if (sets.length > 0) {
      vals.push(id);
      this.conn.prepare(`UPDATE agent_soul SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
  }

  // --- Mind ---
  async getMind(limit = 20): Promise<MindNode[]> {
    const rows = this.conn.prepare(
      'SELECT * FROM agent_mind ORDER BY (heat * signal * depth) DESC LIMIT ?',
    ).all(limit) as Array<Record<string, unknown>>;
    return rows.map(rowToMindNode);
  }

  async addMindNode(node: Omit<MindNode, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const id = randomUUID();
    this.conn.prepare(
      `INSERT INTO agent_mind (id, content, node_type, domain, signal, heat, depth, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, node.content, node.node_type, node.domain || null, node.signal, node.heat, node.depth, JSON.stringify(node.tags));
    return id;
  }

  async updateMindNode(id: string, updates: Partial<MindNode>): Promise<void> {
    const sets: string[] = ["updated_at = datetime('now')"];
    const vals: unknown[] = [];

    if (updates.content !== undefined) { sets.push('content = ?'); vals.push(updates.content); }
    if (updates.node_type !== undefined) { sets.push('node_type = ?'); vals.push(updates.node_type); }
    if (updates.domain !== undefined) { sets.push('domain = ?'); vals.push(updates.domain); }
    if (updates.signal !== undefined) { sets.push('signal = ?'); vals.push(updates.signal); }
    if (updates.heat !== undefined) { sets.push('heat = ?'); vals.push(updates.heat); }
    if (updates.depth !== undefined) { sets.push('depth = ?'); vals.push(updates.depth); }
    if (updates.tags !== undefined) { sets.push('tags = ?'); vals.push(JSON.stringify(updates.tags)); }

    vals.push(id);
    this.conn.prepare(`UPDATE agent_mind SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  async searchMind(query: string, limit = 10): Promise<MindNode[]> {
    const rows = this.conn.prepare(
      `SELECT * FROM agent_mind
       WHERE content LIKE ? OR tags LIKE ?
       ORDER BY (heat * signal) DESC LIMIT ?`,
    ).all(`%${query}%`, `%${query}%`, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToMindNode);
  }

  // --- Ledger ---
  async getLedger(limit = 15): Promise<LedgerEntry[]> {
    const rows = this.conn.prepare(
      'SELECT * FROM agent_ledger ORDER BY created_at DESC LIMIT ?',
    ).all(limit) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: r.id as string,
      entry_type: r.entry_type as 'win' | 'mistake',
      what: r.what as string,
      why: r.why as string | undefined,
      should_have: r.should_have as string | undefined,
      pattern: r.pattern as string | undefined,
      severity: r.severity as string | undefined,
      created_at: r.created_at as string,
    }));
  }

  async addLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'created_at'>): Promise<string> {
    const id = randomUUID();
    this.conn.prepare(
      `INSERT INTO agent_ledger (id, entry_type, what, why, should_have, pattern, severity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, entry.entry_type, entry.what, entry.why || null, entry.should_have || null, entry.pattern || null, entry.severity || null);
    return id;
  }

  async countPattern(pattern: string): Promise<number> {
    const row = this.conn.prepare(
      'SELECT COUNT(*) as count FROM agent_ledger WHERE pattern = ?',
    ).get(pattern) as { count: number };
    return row.count;
  }

  // --- State ---
  async getState(key: string): Promise<unknown | null> {
    const row = this.conn.prepare(
      'SELECT value FROM agent_state WHERE key = ?',
    ).get(key) as { value: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  async getAllState(): Promise<Record<string, unknown>> {
    const rows = this.conn.prepare('SELECT key, value FROM agent_state').all() as Array<{ key: string; value: string }>;
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try { result[row.key] = JSON.parse(row.value); } catch { result[row.key] = row.value; }
    }
    return result;
  }

  async setState(key: string, value: unknown): Promise<void> {
    this.conn.prepare(
      `INSERT INTO agent_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, JSON.stringify(value));
  }

  // --- Handoff ---
  async getLatestHandoff(): Promise<SessionHandoff | null> {
    const row = this.conn.prepare(
      'SELECT * FROM agent_handoff ORDER BY rowid DESC LIMIT 1',
    ).get() as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      active_work: row.active_work as string | undefined,
      key_decisions: row.key_decisions as string | undefined,
      open_questions: row.open_questions as string | undefined,
      next_actions: row.next_actions as string | undefined,
      context_for_next: row.context_for_next as string | undefined,
      created_at: row.created_at as string,
    };
  }

  async writeHandoff(handoff: Omit<SessionHandoff, 'id' | 'created_at'>): Promise<string> {
    const id = randomUUID();
    this.conn.prepare(
      `INSERT INTO agent_handoff (id, active_work, key_decisions, open_questions, next_actions, context_for_next)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, handoff.active_work || null, handoff.key_decisions || null,
          handoff.open_questions || null, handoff.next_actions || null, handoff.context_for_next || null);
    return id;
  }

  // --- Conversations ---
  async getConversation(session_id: string): Promise<ConversationTurn[]> {
    const rows = this.conn.prepare(
      'SELECT * FROM agent_conversations WHERE session_id = ? ORDER BY created_at ASC',
    ).all(session_id) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: r.id as string,
      session_id: r.session_id as string,
      role: r.role as 'user' | 'assistant' | 'system' | 'tool',
      content: r.content as string,
      tool_calls: r.tool_calls as string | undefined,
      tool_call_id: r.tool_call_id as string | undefined,
      created_at: r.created_at as string,
    }));
  }

  async addConversationTurn(turn: Omit<ConversationTurn, 'id' | 'created_at'>): Promise<string> {
    const id = randomUUID();
    this.conn.prepare(
      `INSERT INTO agent_conversations (id, session_id, role, content, tool_calls, tool_call_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, turn.session_id, turn.role, turn.content, turn.tool_calls || null, turn.tool_call_id || null);
    return id;
  }

  async listSessions(limit = 10): Promise<string[]> {
    const rows = this.conn.prepare(
      `SELECT DISTINCT session_id FROM agent_conversations
       ORDER BY created_at DESC LIMIT ?`,
    ).all(limit) as Array<{ session_id: string }>;
    return rows.map(r => r.session_id);
  }
}

function rowToMindNode(r: Record<string, unknown>): MindNode {
  let tags: string[] = [];
  try {
    tags = JSON.parse(r.tags as string || '[]');
  } catch {
    tags = [];
  }
  return {
    id: r.id as string,
    content: r.content as string,
    node_type: r.node_type as MindNode['node_type'],
    domain: r.domain as string | undefined,
    signal: r.signal as number,
    heat: r.heat as number,
    depth: r.depth as number,
    tags,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}
