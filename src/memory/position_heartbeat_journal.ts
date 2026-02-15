import { openDatabase } from './db.js';
import { storeDecisionArtifact } from './decision_artifacts.js';

export type PositionHeartbeatOutcome = 'ok' | 'failed' | 'rejected' | 'skipped' | 'info';

export type PositionHeartbeatDecision = {
  kind: 'position_heartbeat';
  symbol: string;
  timestamp: string; // ISO
  triggers: string[];
  decision: Record<string, unknown>;
  outcome: PositionHeartbeatOutcome;
  snapshot?: Record<string, unknown> | null;
};

export function recordPositionHeartbeatDecision(entry: PositionHeartbeatDecision): void {
  const fingerprint = `${entry.symbol}:${entry.timestamp}`;
  storeDecisionArtifact({
    source: 'heartbeat',
    kind: entry.kind,
    marketId: entry.symbol,
    fingerprint,
    outcome: entry.outcome,
    payload: entry,
  });
}

export function listPositionHeartbeatDecisions(params?: {
  symbol?: string;
  limit?: number;
}): PositionHeartbeatDecision[] {
  const db = openDatabase();
  const limit = Math.min(Math.max(params?.limit ?? 50, 1), 500);
  const symbol = params?.symbol ?? null;
  const rows = db
    .prepare(
      `
        SELECT payload
        FROM decision_artifacts
        WHERE kind = 'position_heartbeat'
          AND (? IS NULL OR market_id = ?)
        ORDER BY created_at DESC
        LIMIT ?
      `
    )
    .all(symbol, symbol, limit) as Array<{ payload?: string }>;

  const out: PositionHeartbeatDecision[] = [];
  for (const row of rows) {
    if (!row?.payload) continue;
    try {
      const parsed = JSON.parse(row.payload) as PositionHeartbeatDecision;
      if (parsed && parsed.kind === 'position_heartbeat') {
        out.push(parsed);
      }
    } catch {
      // ignore unparseable payloads
    }
  }
  return out;
}

