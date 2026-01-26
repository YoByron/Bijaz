/**
 * Spending Limit Enforcement
 *
 * CRITICAL SECURITY COMPONENT
 *
 * Enforces spending limits to prevent runaway trading or accidental
 * large losses. Limits are checked BEFORE any transaction is signed.
 */

import { EventEmitter } from 'eventemitter3';
import { openDatabase } from '../../memory/db.js';

export interface SpendingLimits {
  /** Maximum USD spend per calendar day */
  daily: number;
  /** Maximum USD spend per single trade */
  perTrade: number;
  /** Trades above this amount require explicit confirmation */
  confirmationThreshold: number;
}

export interface SpendingState {
  /** Amount spent today (USD) */
  todaySpent: number;
  /** Date of last reset (YYYY-MM-DD) */
  lastResetDate: string;
  /** Trades executed today */
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

/**
 * Enforces spending limits on all trades.
 *
 * Usage:
 * ```typescript
 * const limiter = new SpendingLimitEnforcer(limits);
 *
 * // Before executing a trade:
 * const check = await limiter.checkAndReserve(amount);
 * if (!check.allowed) {
 *   throw new LimitError(check.reason);
 * }
 * if (check.requiresConfirmation) {
 *   const confirmed = await askUserConfirmation();
 *   if (!confirmed) {
 *     limiter.release(amount);
 *     return;
 *   }
 * }
 *
 * // Execute trade...
 *
 * // After successful trade:
 * limiter.confirm(amount);
 *
 * // If trade fails:
 * limiter.release(amount);
 * ```
 */
export class SpendingLimitEnforcer extends EventEmitter<LimitEvents> {
  private limits: SpendingLimits;
  private state: SpendingState;
  private reserved: number = 0;

  constructor(limits: SpendingLimits) {
    super();
    this.limits = { ...limits };
    this.state = this.loadState();
    this.checkDailyReset();
  }

  /**
   * Check if a trade amount is within limits and reserve it.
   *
   * @param amount - The trade amount in USD
   * @returns Check result with allowed status and any required confirmation
   */
  async checkAndReserve(amount: number): Promise<LimitCheckResult> {
    this.checkDailyReset();

    // Validate amount
    if (amount <= 0) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: 'Trade amount must be positive',
      };
    }

    // Check per-trade limit
    if (amount > this.limits.perTrade) {
      this.emit('limit-exceeded', {
        type: 'per-trade',
        attempted: amount,
        limit: this.limits.perTrade,
      });

      return {
        allowed: false,
        requiresConfirmation: false,
        reason:
          `Amount $${amount.toFixed(2)} exceeds per-trade limit of ` +
          `$${this.limits.perTrade.toFixed(2)}`,
      };
    }

    // Check daily limit (including reserved amounts)
    const projectedDaily = this.state.todaySpent + this.reserved + amount;
    if (projectedDaily > this.limits.daily) {
      this.emit('limit-exceeded', {
        type: 'daily',
        attempted: amount,
        limit: this.limits.daily,
      });

      return {
        allowed: false,
        requiresConfirmation: false,
        reason:
          `Would exceed daily limit. ` +
          `Spent today: $${this.state.todaySpent.toFixed(2)}, ` +
          `Reserved: $${this.reserved.toFixed(2)}, ` +
          `Limit: $${this.limits.daily.toFixed(2)}`,
        remainingDaily: Math.max(
          0,
          this.limits.daily - this.state.todaySpent - this.reserved
        ),
      };
    }

    // Warn if approaching daily limit
    if (projectedDaily > this.limits.daily * 0.8) {
      this.emit('limit-warning', {
        type: 'daily',
        current: projectedDaily,
        limit: this.limits.daily,
      });
    }

    // Reserve the amount
    this.reserved += amount;

    // Check if confirmation required
    const requiresConfirmation = amount > this.limits.confirmationThreshold;

    return {
      allowed: true,
      requiresConfirmation,
      reason: requiresConfirmation
        ? `Amount $${amount.toFixed(2)} requires confirmation ` +
          `(threshold: $${this.limits.confirmationThreshold.toFixed(2)})`
        : undefined,
      remainingDaily: this.limits.daily - projectedDaily,
    };
  }

  /**
   * Confirm a reserved amount after successful trade.
   * Moves the amount from reserved to spent.
   *
   * @param amount - The confirmed trade amount
   */
  confirm(amount: number): void {
    this.reserved = Math.max(0, this.reserved - amount);
    this.state.todaySpent += amount;
    this.state.todayTradeCount += 1;
    this.saveState();
  }

  /**
   * Release a reserved amount (trade cancelled or failed).
   *
   * @param amount - The amount to release
   */
  release(amount: number): void {
    this.reserved = Math.max(0, this.reserved - amount);
  }

  /**
   * Get current spending state.
   */
  getState(): Readonly<SpendingState & { reserved: number }> {
    return {
      ...this.state,
      reserved: this.reserved,
    };
  }

  /**
   * Get current limits.
   */
  getLimits(): Readonly<SpendingLimits> {
    return { ...this.limits };
  }

  /**
   * Update spending limits.
   * Does not affect already-spent amounts.
   */
  setLimits(limits: Partial<SpendingLimits>): void {
    if (limits.daily !== undefined) {
      this.limits.daily = limits.daily;
    }
    if (limits.perTrade !== undefined) {
      this.limits.perTrade = limits.perTrade;
    }
    if (limits.confirmationThreshold !== undefined) {
      this.limits.confirmationThreshold = limits.confirmationThreshold;
    }
  }

  /**
   * Get remaining daily allowance.
   */
  getRemainingDaily(): number {
    this.checkDailyReset();
    return Math.max(0, this.limits.daily - this.state.todaySpent - this.reserved);
  }

  /**
   * Check if we need to reset daily counters.
   */
  private checkDailyReset(): void {
    const today = this.getToday();
    if (this.state.lastResetDate !== today) {
      const previousSpent = this.state.todaySpent;

      this.state.todaySpent = 0;
      this.state.todayTradeCount = 0;
      this.state.lastResetDate = today;
      this.reserved = 0;

      this.saveState();

      this.emit('daily-reset', { previousSpent });
    }
  }

  /**
   * Get today's date string (YYYY-MM-DD in UTC).
   */
  private getToday(): string {
    return new Date().toISOString().split('T')[0]!;
  }

  /**
   * Load state from database.
   */
  private loadState(): SpendingState {
    try {
      const db = openDatabase();
      const row = db
        .prepare(
          `SELECT today_spent, last_reset_date, today_trade_count
           FROM spending_state
           WHERE id = 1`
        )
        .get() as { today_spent: number; last_reset_date: string; today_trade_count: number } | undefined;

      if (row) {
        return {
          todaySpent: row.today_spent ?? 0,
          lastResetDate: row.last_reset_date ?? this.getToday(),
          todayTradeCount: row.today_trade_count ?? 0,
        };
      }
    } catch {
      // Database not available, use defaults
    }

    return {
      todaySpent: 0,
      lastResetDate: this.getToday(),
      todayTradeCount: 0,
    };
  }

  /**
   * Save state to database.
   */
  private saveState(): void {
    try {
      const db = openDatabase();
      db.prepare(
        `UPDATE spending_state
         SET today_spent = @todaySpent,
             last_reset_date = @lastResetDate,
             today_trade_count = @todayTradeCount,
             updated_at = datetime('now')
         WHERE id = 1`
      ).run({
        todaySpent: this.state.todaySpent,
        lastResetDate: this.state.lastResetDate,
        todayTradeCount: this.state.todayTradeCount,
      });
    } catch {
      // Database not available, state will be lost on restart
    }
  }
}

/**
 * Error thrown when a spending limit is exceeded.
 */
export class LimitExceededError extends Error {
  constructor(
    message: string,
    public readonly limitType: 'daily' | 'per-trade',
    public readonly attempted: number,
    public readonly limit: number
  ) {
    super(message);
    this.name = 'LimitExceededError';
  }
}
