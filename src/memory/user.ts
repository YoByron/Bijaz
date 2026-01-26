import { openDatabase } from './db.js';

export interface UserContext {
  userId: string;
  preferences?: Record<string, unknown>;
  domainsOfInterest?: string[];
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
  updatedAt: string;
}

export function getUserContext(userId: string): UserContext | null {
  const db = openDatabase();
  const row = db
    .prepare(
      `
        SELECT user_id as userId, preferences, domains_of_interest as domainsOfInterest,
               risk_tolerance as riskTolerance, updated_at as updatedAt
        FROM user_context
        WHERE user_id = ?
        LIMIT 1
      `
    )
    .get(userId) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  return {
    userId: String(row.userId),
    preferences: row.preferences ? JSON.parse(String(row.preferences)) : undefined,
    domainsOfInterest: row.domainsOfInterest
      ? (JSON.parse(String(row.domainsOfInterest)) as string[])
      : undefined,
    riskTolerance: row.riskTolerance as UserContext['riskTolerance'],
    updatedAt: String(row.updatedAt),
  };
}

export function updateUserContext(
  userId: string,
  updates: Partial<Pick<UserContext, 'preferences' | 'domainsOfInterest' | 'riskTolerance'>>
): void {
  const db = openDatabase();
  const existing = getUserContext(userId);
  const merged = {
    preferences: { ...(existing?.preferences ?? {}), ...(updates.preferences ?? {}) },
    domainsOfInterest: updates.domainsOfInterest ?? existing?.domainsOfInterest ?? [],
    riskTolerance: updates.riskTolerance ?? existing?.riskTolerance ?? 'moderate',
  };

  db.prepare(
    `
      INSERT INTO user_context (user_id, preferences, domains_of_interest, risk_tolerance, updated_at)
      VALUES (@userId, @preferences, @domainsOfInterest, @riskTolerance, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        preferences = excluded.preferences,
        domains_of_interest = excluded.domains_of_interest,
        risk_tolerance = excluded.risk_tolerance,
        updated_at = datetime('now')
    `
  ).run({
    userId,
    preferences: JSON.stringify(merged.preferences ?? {}),
    domainsOfInterest: JSON.stringify(merged.domainsOfInterest ?? []),
    riskTolerance: merged.riskTolerance ?? 'moderate',
  });
}
