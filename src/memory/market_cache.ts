import { openDatabase } from './db.js';

export interface MarketCacheRecord {
  id: string;
  question: string;
  description?: string | null;
  outcomes?: string[] | null;
  prices?: Record<string, number> | null;
  volume?: number | null;
  liquidity?: number | null;
  endDate?: string | null;
  category?: string | null;
  resolved?: boolean | null;
  resolution?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

function serialize(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

function parseObject<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function upsertMarketCache(market: MarketCacheRecord): void {
  const db = openDatabase();
  db.prepare(
    `
      INSERT INTO market_cache (
        id,
        question,
        description,
        outcomes,
        prices,
        volume,
        liquidity,
        end_date,
        category,
        resolved,
        resolution,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @question,
        @description,
        @outcomes,
        @prices,
        @volume,
        @liquidity,
        @endDate,
        @category,
        @resolved,
        @resolution,
        @createdAt,
        datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        question = excluded.question,
        description = excluded.description,
        outcomes = excluded.outcomes,
        prices = excluded.prices,
        volume = excluded.volume,
        liquidity = excluded.liquidity,
        end_date = excluded.end_date,
        category = excluded.category,
        resolved = excluded.resolved,
        resolution = excluded.resolution,
        updated_at = datetime('now')
    `
  ).run({
    id: market.id,
    question: market.question,
    description: market.description ?? null,
    outcomes: serialize(market.outcomes ?? null),
    prices: serialize(market.prices ?? null),
    volume: market.volume ?? null,
    liquidity: market.liquidity ?? null,
    endDate: market.endDate ?? null,
    category: market.category ?? null,
    resolved: market.resolved ? 1 : 0,
    resolution: market.resolution ?? null,
    createdAt: market.createdAt ?? null,
  });
}

export function upsertMarketCacheBatch(markets: MarketCacheRecord[]): void {
  for (const market of markets) {
    upsertMarketCache(market);
  }
}

export function getMarketCache(id: string): MarketCacheRecord | null {
  const db = openDatabase();
  const row = db
    .prepare(
      `
        SELECT
          id,
          question,
          description,
          outcomes,
          prices,
          volume,
          liquidity,
          end_date as endDate,
          category,
          resolved,
          resolution,
          created_at as createdAt,
          updated_at as updatedAt
        FROM market_cache
        WHERE id = ?
      `
    )
    .get(id) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    id: String(row.id),
    question: String(row.question),
    description: (row.description as string | null) ?? null,
    outcomes: parseObject<string[]>((row.outcomes as string | null) ?? null),
    prices: parseObject<Record<string, number>>((row.prices as string | null) ?? null),
    volume: row.volume as number | null,
    liquidity: row.liquidity as number | null,
    endDate: (row.endDate as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    resolved: row.resolved === null ? null : Boolean(row.resolved),
    resolution: (row.resolution as string | null) ?? null,
    createdAt: (row.createdAt as string | null) ?? null,
    updatedAt: (row.updatedAt as string | null) ?? null,
  };
}

export function listMarketCache(limit = 50): MarketCacheRecord[] {
  const db = openDatabase();
  const rows = db
    .prepare(
      `
        SELECT
          id,
          question,
          description,
          outcomes,
          prices,
          volume,
          liquidity,
          end_date as endDate,
          category,
          resolved,
          resolution,
          created_at as createdAt,
          updated_at as updatedAt
        FROM market_cache
        WHERE resolved = 0
        ORDER BY volume DESC
        LIMIT ?
      `
    )
    .all(limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    question: String(row.question),
    description: (row.description as string | null) ?? null,
    outcomes: parseObject<string[]>((row.outcomes as string | null) ?? null),
    prices: parseObject<Record<string, number>>((row.prices as string | null) ?? null),
    volume: row.volume as number | null,
    liquidity: row.liquidity as number | null,
    endDate: (row.endDate as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    resolved: row.resolved === null ? null : Boolean(row.resolved),
    resolution: (row.resolution as string | null) ?? null,
    createdAt: (row.createdAt as string | null) ?? null,
    updatedAt: (row.updatedAt as string | null) ?? null,
  }));
}

export function searchMarketCache(query: string, limit = 50): MarketCacheRecord[] {
  const db = openDatabase();
  const categoryMatch = query.match(/\b(?:category|cat):([^\s]+)/i);
  const category = categoryMatch?.[1]?.toLowerCase();
  const cleanedQuery = categoryMatch
    ? query.replace(categoryMatch[0], '').trim()
    : query.trim();

  const intradayPattern = /\b(15[-\s]*min(?:ute)?|15m|intraday|up\s*or\s*down|updown|short[-\s]*term)\b/i;
  const wantsIntraday = intradayPattern.test(cleanedQuery);
  const assetPattern = /\b(bitcoin|btc|ethereum|eth|solana|sol|xrp)\b/i;
  const assetMatch = cleanedQuery.match(assetPattern);
  const asset = assetMatch?.[1]?.toLowerCase();

  const baseQuery = cleanedQuery.replace(intradayPattern, ' ').trim();
  const needle = baseQuery ? `%${baseQuery.toLowerCase()}%` : null;

  const whereClauses: string[] = ['resolved = 0'];
  const params: Array<string | number> = [];

  if (category) {
    whereClauses.push('LOWER(category) LIKE ?');
    params.push(`%${category}%`);
  }

  const searchFilters: string[] = [];
  if (needle) {
    searchFilters.push('(LOWER(question) LIKE ? OR LOWER(description) LIKE ?)');
    params.push(needle, needle);
  }

  if (wantsIntraday) {
    searchFilters.push("LOWER(question) LIKE '%up or down%'");
    searchFilters.push("(LOWER(question) LIKE '%am%' OR LOWER(question) LIKE '%pm%')");
  }

  if (asset) {
    searchFilters.push('LOWER(question) LIKE ?');
    params.push(`%${asset}%`);
  }

  if (searchFilters.length > 0) {
    whereClauses.push(searchFilters.map((filter) => `(${filter})`).join(' AND '));
  }

  if (searchFilters.length === 0 && !category) {
    return listMarketCache(limit);
  }

  const rows = db
    .prepare(
      `
        SELECT
          id,
          question,
          description,
          outcomes,
          prices,
          volume,
          liquidity,
          end_date as endDate,
          category,
          resolved,
          resolution,
          created_at as createdAt,
          updated_at as updatedAt
        FROM market_cache
        WHERE ${whereClauses.join(' AND ')}
        ORDER BY volume DESC
        LIMIT ?
      `
    )
    .all(...params, limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    question: String(row.question),
    description: (row.description as string | null) ?? null,
    outcomes: parseObject<string[]>((row.outcomes as string | null) ?? null),
    prices: parseObject<Record<string, number>>((row.prices as string | null) ?? null),
    volume: row.volume as number | null,
    liquidity: row.liquidity as number | null,
    endDate: (row.endDate as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    resolved: row.resolved === null ? null : Boolean(row.resolved),
    resolution: (row.resolution as string | null) ?? null,
    createdAt: (row.createdAt as string | null) ?? null,
    updatedAt: (row.updatedAt as string | null) ?? null,
  }));
}

export function getMarketCacheStats(): { count: number; latestUpdatedAt: string | null } {
  const db = openDatabase();
  const row = db
    .prepare(
      `
        SELECT COUNT(*) as count, MAX(updated_at) as latestUpdatedAt
        FROM market_cache
      `
    )
    .get() as Record<string, unknown> | undefined;

  return {
    count: Number(row?.count ?? 0),
    latestUpdatedAt: (row?.latestUpdatedAt as string | null) ?? null,
  };
}

export function listMarketCategories(limit = 20): Array<{ category: string; count: number }> {
  const db = openDatabase();
  const rows = db
    .prepare(
      `
        SELECT
          category,
          COUNT(*) as count
        FROM market_cache
        WHERE resolved = 0
          AND category IS NOT NULL
          AND category != ''
        GROUP BY category
        ORDER BY count DESC
        LIMIT ?
      `
    )
    .all(limit) as Array<{ category: string; count: number }>;

  return rows.map((row) => ({
    category: row.category,
    count: Number(row.count ?? 0),
  }));
}
