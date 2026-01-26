import { EventEmitter } from 'eventemitter3';

import { openDatabase } from '../../memory/db.js';

export interface SpendingLimits {
  daily: number;
  perTrade: number;
  confirmationThreshold: number;
}

export interface SpendingState {
  todaySpent: number;
  lastResetDate: string;
  todayTradeCount: number;
}

export interface LimitCheckResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
  remainingDaily?: number;
}

export interface LimitEvents {
  'limit-warning': (data: { type: string; current: number; limit: number }) => void;
  'limit-exceeded': (data: { type: string; attempted: number; limit: number }) => void;
  'daily-reset': (data: { previousSpent: number }) => void;
}

export class DbSpendingLimitEnforcer extends EventEmitter<LimitEvents> {
  private limits: SpendingLimits;
  private reserved = 0;

  constructor(limits: SpendingLimits) {
    super();
    this.limits = { ...limits };
  }

  async checkAndReserve(amount: number): Promise<LimitCheckResult> {
    const state = this.loadState();
    const normalized = this.applyDailyReset(state);

    if (amount <= 0) {
      return { allowed: false, requiresConfirmation: false, reason: 'Trade amount must be positive' };
    }

    if (amount > this.limits.perTrade) {
      this.emit('limit-exceeded', { type: 'per-trade', attempted: amount, limit: this.limits.perTrade });
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `Amount $${amount.toFixed(2)} exceeds per-trade limit of $${this.limits.perTrade.toFixed(2)}`,
      };
    }

    const projectedDaily = normalized.todaySpent + this.reserved + amount;
    if (projectedDaily > this.limits.daily) {
      this.emit('limit-exceeded', { type: 'daily', attempted: amount, limit: this.limits.daily });
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `Would exceed daily limit. Spent today: $${normalized.todaySpent.toFixed(2)}, Reserved: $${this.reserved.toFixed(2)}, Limit: $${this.limits.daily.toFixed(2)}`,
        remainingDaily: Math.max(0, this.limits.daily - normalized.todaySpent - this.reserved),
      };
    }

    if (projectedDaily > this.limits.daily * 0.8) {
      this.emit('limit-warning', { type: 'daily', current: projectedDaily, limit: this.limits.daily });
    }

    this.reserved += amount;

    const requiresConfirmation = amount > this.limits.confirmationThreshold;
    return {
      allowed: true,
      requiresConfirmation,
      reason: requiresConfirmation
        ? `Amount $${amount.toFixed(2)} requires confirmation (threshold: $${this.limits.confirmationThreshold.toFixed(2)})`
        : undefined,
      remainingDaily: this.limits.daily - projectedDaily,
    };
  }

  confirm(amount: number): void {
    const state = this.loadState();
    const normalized = this.applyDailyReset(state);
    this.reserved = Math.max(0, this.reserved - amount);
    normalized.todaySpent += amount;
    normalized.todayTradeCount += 1;
    this.saveState(normalized);
  }

  release(amount: number): void {
    this.reserved = Math.max(0, this.reserved - amount);
  }

  getRemainingDaily(): number {
    const state = this.loadState();
    const normalized = this.applyDailyReset(state);
    return Math.max(0, this.limits.daily - normalized.todaySpent - this.reserved);
  }

  private applyDailyReset(state: SpendingState): SpendingState {
    const today = this.getToday();
    if (state.lastResetDate !== today) {
      const previousSpent = state.todaySpent;
      const updated = {
        todaySpent: 0,
        todayTradeCount: 0,
        lastResetDate: today,
      };
      this.saveState(updated);
      this.reserved = 0;
      this.emit('daily-reset', { previousSpent });
      return updated;
    }
    return state;
  }

  private getToday(): string {
    return new Date().toISOString().split('T')[0]!;
  }

  private loadState(): SpendingState {
    const db = openDatabase();
    const row = db
      .prepare(
        `
          SELECT today_spent as todaySpent, last_reset_date as lastResetDate, today_trade_count as todayTradeCount
          FROM spending_state WHERE id = 1
        `
      )
      .get() as SpendingState | undefined;

    if (!row) {
      return { todaySpent: 0, lastResetDate: this.getToday(), todayTradeCount: 0 };
    }
    return row;
  }

  private saveState(state: SpendingState): void {
    const db = openDatabase();
    db.prepare(
      `
        INSERT INTO spending_state (id, today_spent, last_reset_date, today_trade_count, updated_at)
        VALUES (1, @todaySpent, @lastResetDate, @todayTradeCount, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          today_spent = excluded.today_spent,
          last_reset_date = excluded.last_reset_date,
          today_trade_count = excluded.today_trade_count,
          updated_at = datetime('now')
      `
    ).run(state);
  }
}
