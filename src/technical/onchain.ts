import type { ThufirConfig } from '../core/config.js';
import { HyperliquidClient } from '../execution/hyperliquid/client.js';
import type { OnChainSnapshot } from './types.js';

function toNumber(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function clamp(value: number, min = -1, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSymbol(symbol: string): string {
  if (!symbol) return symbol;
  const [base] = symbol.split('/');
  return (base ?? symbol).toUpperCase();
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function getOnChainSnapshot(
  config: ThufirConfig,
  symbol: string
): Promise<OnChainSnapshot> {
  if (!config.technical?.onChain?.enabled) {
    return { score: 0, reasoning: ['On-chain data disabled.'] };
  }

  const coin = normalizeSymbol(symbol);
  if (!coin) {
    return { score: 0, reasoning: ['Missing symbol; on-chain score neutral.'] };
  }

  const client = new HyperliquidClient(config);
  const reasoning: string[] = [];
  const componentScores: number[] = [];

  const [fundingRes, tradesRes, bookRes] = await Promise.allSettled([
    (async () => {
      const endTime = Date.now();
      const startTime = endTime - 24 * 60 * 60 * 1000;
      const history = await client.getFundingHistory(coin, startTime, endTime);
      const rates = history.map((item) => toNumber(item.fundingRate)).filter(Number.isFinite);
      if (!rates.length) return null;

      const avgFunding = mean(rates);
      const latestFunding = rates[rates.length - 1] ?? 0;
      const fundingTrend = latestFunding - avgFunding;
      const score = clamp((-latestFunding * 1200 + -fundingTrend * 800) / 2);
      reasoning.push(
        `Funding ${latestFunding.toFixed(5)} (avg ${avgFunding.toFixed(5)}, trend ${fundingTrend.toFixed(5)}).`
      );
      return score;
    })(),
    (async () => {
      const trades = await client.getRecentTrades(coin);
      let buyNotional = 0;
      let sellNotional = 0;
      for (const trade of trades) {
        const px = toNumber(trade.px);
        const sz = toNumber(trade.sz);
        const notional = px * sz;
        if (!Number.isFinite(notional) || notional <= 0) continue;
        const side = String(trade.side ?? '').toUpperCase();
        if (side === 'B' || side === 'BUY') buyNotional += notional;
        if (side === 'A' || side === 'S' || side === 'SELL') sellNotional += notional;
      }
      const total = buyNotional + sellNotional;
      if (total <= 0) return null;
      const imbalance = (buyNotional - sellNotional) / total;
      reasoning.push(`Trade-flow imbalance ${(imbalance * 100).toFixed(1)}%.`);
      return clamp(imbalance * 2);
    })(),
    (async () => {
      const book = await client.getL2Book(coin);
      const levels = (book as { levels?: Array<Array<{ px?: string | number; sz?: string | number }>> })
        .levels;
      if (!Array.isArray(levels) || levels.length < 2) return null;
      const bids = Array.isArray(levels[0]) ? levels[0] : [];
      const asks = Array.isArray(levels[1]) ? levels[1] : [];
      const bidDepth = bids.reduce((sum, level) => sum + toNumber(level.px) * toNumber(level.sz), 0);
      const askDepth = asks.reduce((sum, level) => sum + toNumber(level.px) * toNumber(level.sz), 0);
      const totalDepth = bidDepth + askDepth;
      if (totalDepth <= 0) return null;
      const depthImbalance = (bidDepth - askDepth) / totalDepth;
      reasoning.push(`Book depth imbalance ${(depthImbalance * 100).toFixed(1)}%.`);
      return clamp(depthImbalance * 1.5);
    })(),
  ]);

  if (fundingRes.status === 'fulfilled' && fundingRes.value != null) componentScores.push(fundingRes.value);
  if (tradesRes.status === 'fulfilled' && tradesRes.value != null) componentScores.push(tradesRes.value);
  if (bookRes.status === 'fulfilled' && bookRes.value != null) componentScores.push(bookRes.value);

  if (fundingRes.status === 'rejected') {
    reasoning.push(`Funding unavailable (${fundingRes.reason instanceof Error ? fundingRes.reason.message : 'error'}).`);
  }
  if (tradesRes.status === 'rejected') {
    reasoning.push(`Recent trades unavailable (${tradesRes.reason instanceof Error ? tradesRes.reason.message : 'error'}).`);
  }
  if (bookRes.status === 'rejected') {
    reasoning.push(`Order book unavailable (${bookRes.reason instanceof Error ? bookRes.reason.message : 'error'}).`);
  }

  if (!componentScores.length) {
    return {
      score: 0,
      reasoning: reasoning.length
        ? reasoning
        : ['No on-chain/orderflow data available; score neutral.'],
    };
  }

  const score = clamp(mean(componentScores));
  return { score, reasoning };
}
