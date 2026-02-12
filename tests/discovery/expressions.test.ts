import { describe, expect, it } from 'vitest';
import { mapExpressionPlan } from '../../src/discovery/expressions.js';
import type { Hypothesis, SignalCluster } from '../../src/discovery/types.js';

describe('mapExpressionPlan', () => {
  it('maps cluster confidence into expression confidence and edge', () => {
    const cluster: SignalCluster = {
      id: 'cluster_1',
      symbol: 'BTC/USDT',
      signals: [],
      directionalBias: 'up',
      confidence: 0.8,
      timeHorizon: 'hours',
    };
    const hypothesis: Hypothesis = {
      id: 'hyp_1',
      clusterId: 'cluster_1',
      pressureSource: 'funding',
      expectedExpression: 'Price drifts up as shorts cover',
      timeHorizon: 'hours',
      invalidation: 'Funding normalizes',
      tradeMap: 'Directional long perp',
      riskNotes: [],
    };
    const config = {
      hyperliquid: { maxLeverage: 5 },
      wallet: { limits: { daily: 100 } },
      autonomy: { probeRiskFraction: 0.005 },
    } as any;

    const expr = mapExpressionPlan(config, cluster, hypothesis);
    expect(expr.confidence).toBeCloseTo(0.8, 6);
    expect(expr.expectedEdge).toBeCloseTo(0.08, 6);
  });

  it('assigns zero edge for neutral directional bias', () => {
    const cluster: SignalCluster = {
      id: 'cluster_1',
      symbol: 'ETH/USDT',
      signals: [],
      directionalBias: 'neutral',
      confidence: 0.9,
      timeHorizon: 'hours',
    };
    const hypothesis: Hypothesis = {
      id: 'hyp_1',
      clusterId: 'cluster_1',
      pressureSource: 'none',
      expectedExpression: 'No directional edge',
      timeHorizon: 'hours',
      invalidation: 'N/A',
      tradeMap: 'No trade',
      riskNotes: [],
    };
    const expr = mapExpressionPlan({} as any, cluster, hypothesis);
    expect(expr.expectedEdge).toBe(0);
  });
});
