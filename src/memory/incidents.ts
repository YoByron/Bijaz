import { openDatabase } from './db.js';

export type AgentBlockerKind =
  | 'hyperliquid_missing_signer'
  | 'hyperliquid_missing_account'
  | 'hyperliquid_insufficient_collateral'
  | 'hyperliquid_min_deposit'
  | 'network_or_rate_limit'
  | 'unknown';

export interface AgentIncidentInput {
  goal?: string | null;
  mode?: string | null;
  toolName?: string | null;
  error?: string | null;
  blockerKind?: AgentBlockerKind | null;
  details?: Record<string, unknown> | null;
}

export interface AgentIncidentRow {
  id: number;
  createdAt: string;
  goal: string | null;
  mode: string | null;
  toolName: string | null;
  error: string | null;
  blockerKind: AgentBlockerKind;
  details: Record<string, unknown> | null;
  resolvedAt: string | null;
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

export function recordAgentIncident(input: AgentIncidentInput): number {
  const db = openDatabase();
  const res = db
    .prepare(
      `
      INSERT INTO agent_incidents (
        goal,
        mode,
        tool_name,
        error,
        blocker_kind,
        details_json
      ) VALUES (
        @goal,
        @mode,
        @toolName,
        @error,
        @blockerKind,
        @detailsJson
      )
    `
    )
    .run({
      goal: input.goal ?? null,
      mode: input.mode ?? null,
      toolName: input.toolName ?? null,
      error: input.error ?? null,
      blockerKind: input.blockerKind ?? 'unknown',
      detailsJson: safeJson(input.details ?? null),
    });

  return Number(res.lastInsertRowid ?? 0);
}

export function listRecentAgentIncidents(limit = 20): AgentIncidentRow[] {
  const db = openDatabase();
  const rows = db
    .prepare(
      `
      SELECT
        id,
        created_at as createdAt,
        goal,
        mode,
        tool_name as toolName,
        error,
        blocker_kind as blockerKind,
        details_json as detailsJson,
        resolved_at as resolvedAt
      FROM agent_incidents
      ORDER BY created_at DESC
      LIMIT ?
    `
    )
    .all(Math.max(1, Math.min(200, Number(limit) || 20))) as Array<{
    id: number;
    createdAt: string;
    goal: string | null;
    mode: string | null;
    toolName: string | null;
    error: string | null;
    blockerKind: AgentBlockerKind | null;
    detailsJson: string | null;
    resolvedAt: string | null;
  }>;

  return rows.map((row) => ({
    id: Number(row.id),
    createdAt: row.createdAt,
    goal: row.goal,
    mode: row.mode,
    toolName: row.toolName,
    error: row.error,
    blockerKind: (row.blockerKind ?? 'unknown') as AgentBlockerKind,
    details: parseJson<Record<string, unknown>>(row.detailsJson),
    resolvedAt: row.resolvedAt,
  }));
}

