import { openDatabase } from './db.js';

export interface AgentPlaybookRow {
  key: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

function safeJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function upsertPlaybook(input: {
  key: string;
  title: string;
  content: string;
  tags?: string[];
}): void {
  const db = openDatabase();
  db.prepare(
    `
    INSERT INTO agent_playbooks (key, title, content, tags_json)
    VALUES (@key, @title, @content, @tagsJson)
    ON CONFLICT(key) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      tags_json = excluded.tags_json,
      updated_at = datetime('now')
  `
  ).run({
    key: input.key,
    title: input.title,
    content: input.content,
    tagsJson: safeJson(input.tags ?? []),
  });
}

export function getPlaybook(key: string): AgentPlaybookRow | null {
  const db = openDatabase();
  const row = db
    .prepare(
      `
      SELECT
        key,
        title,
        content,
        tags_json as tagsJson,
        created_at as createdAt,
        updated_at as updatedAt
      FROM agent_playbooks
      WHERE key = ?
      LIMIT 1
    `
    )
    .get(key) as
    | {
        key: string;
        title: string;
        content: string;
        tagsJson: string | null;
        createdAt: string;
        updatedAt: string;
      }
    | undefined;

  if (!row) return null;
  return {
    key: row.key,
    title: row.title,
    content: row.content,
    tags: parseJson<string[]>(row.tagsJson) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function searchPlaybooks(params: {
  query: string;
  limit?: number;
}): AgentPlaybookRow[] {
  const db = openDatabase();
  const q = params.query.trim();
  if (!q) return [];
  const limit = Math.max(1, Math.min(50, Number(params.limit ?? 8) || 8));

  // Simple LIKE search. Good enough for now; QMD can later index playbooks.
  const like = `%${q}%`;
  const rows = db
    .prepare(
      `
      SELECT
        key,
        title,
        content,
        tags_json as tagsJson,
        created_at as createdAt,
        updated_at as updatedAt
      FROM agent_playbooks
      WHERE title LIKE @like OR content LIKE @like
      ORDER BY updated_at DESC
      LIMIT @limit
    `
    )
    .all({ like, limit }) as Array<{
    key: string;
    title: string;
    content: string;
    tagsJson: string | null;
    createdAt: string;
    updatedAt: string;
  }>;

  return rows.map((row) => ({
    key: row.key,
    title: row.title,
    content: row.content,
    tags: parseJson<string[]>(row.tagsJson) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

