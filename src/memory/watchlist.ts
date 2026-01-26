import { openDatabase } from './db.js';

export function addWatchlist(marketId: string, notes?: string): void {
  const db = openDatabase();
  const stmt = db.prepare(
    `
      INSERT OR REPLACE INTO watchlist (market_id, notes)
      VALUES (?, ?)
    `
  );
  stmt.run(marketId, notes ?? null);
}

export function listWatchlist(limit = 50): Array<{ marketId: string; notes?: string }> {
  const db = openDatabase();
  const stmt = db.prepare(
    `
      SELECT market_id as marketId, notes
      FROM watchlist
      ORDER BY added_at DESC
      LIMIT ?
    `
  );
  return stmt.all(limit).map((row: any) => ({
    marketId: String(row.marketId),
    notes: row.notes ?? undefined,
  }));
}
