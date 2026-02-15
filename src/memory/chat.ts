import { randomUUID } from 'node:crypto';

import { openDatabase } from './db.js';

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export function storeChatMessage(params: {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
}): string {
  const db = openDatabase();
  const id = randomUUID();
  const createdAt = params.createdAt ?? new Date().toISOString();

  db.prepare(
    `
      INSERT INTO chat_messages (id, session_id, role, content, created_at)
      VALUES (@id, @sessionId, @role, @content, @createdAt)
    `
  ).run({
    id,
    sessionId: params.sessionId,
    role: params.role,
    content: params.content,
    createdAt,
  });

  return id;
}

export function listChatMessagesByIds(ids: string[]): ChatMessageRecord[] {
  if (ids.length === 0) {
    return [];
  }
  const db = openDatabase();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `
        SELECT id, session_id as sessionId, role, content, created_at as createdAt
        FROM chat_messages
        WHERE id IN (${placeholders})
      `
    )
    .all(...ids) as Array<Record<string, unknown>>;

  const map = new Map(rows.map((row) => [String(row.id), row]));
  return ids
    .map((id) => map.get(id))
    .filter(Boolean)
    .map((row) => ({
      id: String(row!.id),
      sessionId: String(row!.sessionId),
      role: row!.role as ChatMessageRecord['role'],
      content: String(row!.content),
      createdAt: String(row!.createdAt),
    }));
}

export function clearChatMessages(sessionId: string): void {
  const db = openDatabase();
  db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(sessionId);
  db.prepare(
    `
      DELETE FROM chat_embeddings
      WHERE message_id NOT IN (SELECT id FROM chat_messages)
    `
  ).run();
}

export function pruneChatMessages(retentionDays: number): number {
  const days = Math.max(1, Math.floor(retentionDays));
  const db = openDatabase();
  const cutoff = `-${days} days`;
  const toDelete = db
    .prepare(
      `
        SELECT id FROM chat_messages
        WHERE created_at < datetime('now', ?)
      `
    )
    .all(cutoff) as Array<{ id: string }>;

  if (toDelete.length === 0) {
    return 0;
  }

  const ids = toDelete.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(
    `DELETE FROM chat_embeddings WHERE message_id IN (${placeholders})`
  ).run(...ids);
  const result = db
    .prepare(`DELETE FROM chat_messages WHERE id IN (${placeholders})`)
    .run(...ids);

  return result.changes ?? 0;
}

function normalizeTerms(query: string): string[] {
  const stop = new Set([
    'the','and','for','with','that','this','from','have','your','you','are','was','were','can','cant','cannot','will',
    'just','like','what','why','how','when','where','who','does','did','done','into','onto','over','under','then','than',
  ]);
  const raw = query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 4)
    .filter((t) => !stop.has(t));
  return Array.from(new Set(raw)).slice(0, 8);
}

export function searchChatMessagesLexical(params: {
  sessionId: string;
  query: string;
  limit?: number;
}): Array<Pick<ChatMessageRecord, 'id' | 'sessionId' | 'role' | 'content' | 'createdAt'>> {
  const sessionId = params.sessionId;
  const limit = Math.min(Math.max(params.limit ?? 8, 1), 20);
  const terms = normalizeTerms(params.query);
  if (terms.length === 0) return [];

  // Pull a small candidate pool via LIKE, then score in JS for a stable ranking.
  const db = openDatabase();
  const like = terms.map(() => `content LIKE ?`).join(' OR ');
  const args = terms.map((t) => `%${t}%`);
  const rows = db
    .prepare(
      `
        SELECT id, session_id as sessionId, role, content, created_at as createdAt
        FROM chat_messages
        WHERE session_id = ?
          AND (${like})
        ORDER BY created_at DESC
        LIMIT 200
      `
    )
    .all(sessionId, ...args) as Array<Record<string, unknown>>;

  const scored = rows
    .map((r) => {
      const content = String(r.content ?? '');
      const lc = content.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (lc.includes(t)) score += 1;
      }
      // Prefer user messages slightly when tie-breaking; they usually contain constraints/preferences.
      if (String(r.role) === 'user') score += 0.1;
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const out: Array<Pick<ChatMessageRecord, 'id' | 'sessionId' | 'role' | 'content' | 'createdAt'>> = [];
  const seen = new Set<string>();
  for (const item of scored) {
    const id = String(item.r.id ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      sessionId: String(item.r.sessionId ?? ''),
      role: item.r.role as ChatMessageRecord['role'],
      content: String(item.r.content ?? ''),
      createdAt: String(item.r.createdAt ?? ''),
    });
    if (out.length >= limit) break;
  }
  return out;
}
