import type { Market } from './polymarket/markets.js';

export interface TradeDecision {
  action: 'buy' | 'sell' | 'hold';
  outcome?: 'YES' | 'NO';
  amount?: number;
  confidence?: 'low' | 'medium' | 'high';
  reasoning?: string;
}

export interface TradeResult {
  executed: boolean;
  message: string;
}

export interface ExecutionAdapter {
  execute(market: Market, decision: TradeDecision): Promise<TradeResult>;
}
