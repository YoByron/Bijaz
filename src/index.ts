/**
 * Bijaz - Prediction Market AI Companion
 *
 * Main entry point for the Bijaz library.
 */

import type { BijazConfig } from './core/config.js';
import { loadConfig } from './core/config.js';
import { createLlmClient } from './core/llm.js';
import { ConversationHandler } from './core/conversation.js';
import { PolymarketMarketClient } from './execution/polymarket/markets.js';
import { PaperExecutor } from './execution/modes/paper.js';
import { WebhookExecutor } from './execution/modes/webhook.js';
import type { ExecutionAdapter } from './execution/executor.js';
import { DbSpendingLimitEnforcer } from './execution/wallet/limits_db.js';
import { listCalibrationSummaries } from './memory/calibration.js';
import { listOpenPositions } from './memory/predictions.js';

// Re-export types
export * from './types/index.js';

// Re-export wallet security components
export {
  isWhitelisted,
  assertWhitelisted,
  WhitelistError,
  getWhitelistedAddresses,
  POLYMARKET_WHITELIST,
} from './execution/wallet/whitelist.js';

export {
  SpendingLimitEnforcer,
  LimitExceededError,
  type SpendingLimits,
  type SpendingState,
  type LimitCheckResult,
} from './execution/wallet/limits.js';

// Version
export const VERSION = '0.1.0';

/**
 * Bijaz client for programmatic access.
 *
 * @example
 * ```typescript
 * import { Bijaz } from 'bijaz';
 *
 * const bijaz = new Bijaz({
 *   configPath: '~/.bijaz/config.yaml'
 * });
 *
 * await bijaz.start();
 *
 * // Analyze a market
 * const analysis = await bijaz.analyze('fed-rate-decision');
 *
 * // Execute a trade (with confirmation)
 * const result = await bijaz.trade({
 *   marketId: 'abc123',
 *   outcome: 'YES',
 *   amount: 25
 * });
 * ```
 */
export class Bijaz {
  private configPath?: string;
  private userId: string;
  private config?: BijazConfig;
  private llm?: ReturnType<typeof createLlmClient>;
  private marketClient?: PolymarketMarketClient;
  private executor?: ExecutionAdapter;
  private limiter?: DbSpendingLimitEnforcer;
  private conversation?: ConversationHandler;
  private started: boolean = false;

  constructor(options?: { configPath?: string; userId?: string }) {
    this.configPath = options?.configPath;
    this.userId = options?.userId ?? 'programmatic';
  }

  /**
   * Start the Bijaz agent.
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error('Bijaz already started');
    }

    const config = loadConfig(this.configPath);
    if (config.memory?.dbPath) {
      process.env.BIJAZ_DB_PATH = config.memory.dbPath;
    }

    this.config = config;
    this.llm = createLlmClient(config);
    this.marketClient = new PolymarketMarketClient(config);
    this.executor =
      config.execution.mode === 'webhook' && config.execution.webhookUrl
        ? new WebhookExecutor(config.execution.webhookUrl)
        : new PaperExecutor();
    this.limiter = new DbSpendingLimitEnforcer({
      daily: config.wallet?.limits?.daily ?? 100,
      perTrade: config.wallet?.limits?.perTrade ?? 25,
      confirmationThreshold: config.wallet?.limits?.confirmationThreshold ?? 10,
    });
    this.conversation = new ConversationHandler(this.llm, this.marketClient, config);

    this.started = true;
  }

  /**
   * Stop the Bijaz agent.
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    this.conversation = undefined;
    this.limiter = undefined;
    this.executor = undefined;
    this.marketClient = undefined;
    this.llm = undefined;
    this.config = undefined;
    this.started = false;
  }

  /**
   * Analyze a market.
   */
  async analyze(_marketId: string): Promise<unknown> {
    this.ensureStarted();
    if (!this.conversation) {
      throw new Error('Conversation handler not initialized');
    }
    return this.conversation.analyzeMarket(this.userId, _marketId);
  }

  /**
   * Execute a trade.
   */
  async trade(_params: {
    marketId: string;
    outcome: 'YES' | 'NO';
    amount: number;
  }): Promise<unknown> {
    this.ensureStarted();
    if (!this.marketClient || !this.executor || !this.limiter) {
      throw new Error('Trading components not initialized');
    }

    const market = await this.marketClient.getMarket(_params.marketId);
    const limitCheck = await this.limiter.checkAndReserve(_params.amount);
    if (!limitCheck.allowed) {
      return {
        executed: false,
        message: limitCheck.reason ?? 'Trade blocked by limits',
      };
    }

    const result = await this.executor.execute(market, {
      action: 'buy',
      outcome: _params.outcome,
      amount: _params.amount,
      confidence: 'medium',
      reasoning: `Programmatic trade for ${this.userId}`,
    });

    if (result.executed) {
      this.limiter.confirm(_params.amount);
    } else {
      this.limiter.release(_params.amount);
    }

    return result;
  }

  /**
   * Get portfolio.
   */
  async getPortfolio(): Promise<unknown> {
    this.ensureStarted();
    const positions = listOpenPositions(200);

    const formatted = positions.map((position) => {
      const outcome = position.predictedOutcome ?? 'YES';
      const prices = position.currentPrices ?? null;
      let currentPrice: number | null = null;
      if (Array.isArray(prices)) {
        currentPrice = outcome === 'YES' ? prices[0] ?? null : prices[1] ?? null;
      } else if (prices) {
        currentPrice =
          prices[outcome] ??
          prices[outcome.toUpperCase()] ??
          prices[outcome.toLowerCase()] ??
          prices[outcome === 'YES' ? 'Yes' : 'No'] ??
          prices[outcome === 'YES' ? 'yes' : 'no'] ??
          null;
      }

      const averagePrice = position.executionPrice ?? currentPrice ?? 0;
      const positionSize = position.positionSize ?? 0;
      const shares = averagePrice > 0 ? positionSize / averagePrice : 0;
      const price = currentPrice ?? averagePrice;
      const value = shares * price;
      const unrealizedPnl = value - positionSize;
      const unrealizedPnlPercent =
        positionSize > 0 ? (unrealizedPnl / positionSize) * 100 : 0;

      return {
        marketId: position.marketId,
        marketTitle: position.marketTitle,
        outcome,
        shares,
        averagePrice,
        currentPrice: price,
        value,
        unrealizedPnl,
        unrealizedPnlPercent,
      };
    });

    const totalValue = formatted.reduce((sum, p) => sum + p.value, 0);
    const totalCost = formatted.reduce((sum, p) => sum + p.shares * p.averagePrice, 0);
    const totalPnl = totalValue - totalCost;
    const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    return {
      positions: formatted,
      totalValue,
      totalCost,
      totalPnl,
      totalPnlPercent,
      cashBalance: 0,
    };
  }

  /**
   * Get calibration stats.
   */
  async getCalibration(_domain?: string): Promise<unknown> {
    this.ensureStarted();
    const summaries = listCalibrationSummaries();
    if (_domain) {
      return summaries.filter((summary) => summary.domain === _domain);
    }
    return summaries;
  }

  /**
   * Chat with the agent.
   */
  async chat(_message: string): Promise<string> {
    this.ensureStarted();
    if (!this.conversation) {
      throw new Error('Conversation handler not initialized');
    }
    return this.conversation.chat(this.userId, _message);
  }

  private ensureStarted(): void {
    if (!this.started) {
      throw new Error('Bijaz not started. Call start() first.');
    }
  }
}
