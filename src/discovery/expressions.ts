import type { ThufirConfig } from '../core/config.js';
import type { ExpressionPlan, Hypothesis, SignalCluster } from './types.js';

export function mapExpressionPlan(
  config: ThufirConfig,
  cluster: SignalCluster,
  hypothesis: Hypothesis
): ExpressionPlan {
  const leverage = Math.min(config.hyperliquid?.maxLeverage ?? 5, 5);
  const dailyLimit = config.wallet?.limits?.daily ?? 100;
  const probeFraction = config.autonomy?.probeRiskFraction ?? 0.005;
  const probeBudget = Math.max(1, dailyLimit * probeFraction);
  const side = hypothesis.expectedExpression.includes('down') ? 'sell' : 'buy';
  const confidence = Math.min(1, Math.max(0, cluster.confidence));
  const expectedEdge =
    cluster.directionalBias === 'neutral'
      ? 0
      : Math.min(1, confidence * 0.1);

  return {
    id: `expr_${hypothesis.id}`,
    hypothesisId: hypothesis.id,
    symbol: cluster.symbol,
    side,
    confidence,
    expectedEdge,
    entryZone: 'market',
    invalidation: hypothesis.invalidation,
    expectedMove: hypothesis.expectedExpression,
    orderType: 'market',
    leverage,
    probeSizeUsd: probeBudget,
  };
}
