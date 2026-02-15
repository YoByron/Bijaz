import { describe, expect, test } from 'vitest';

import {
  defaultTriggerState,
  evaluateHeartbeatTriggers,
  type HeartbeatTriggerConfig,
  type PositionTick,
} from '../../src/core/heartbeat_triggers.js';

function baseCfg(): HeartbeatTriggerConfig {
  return {
    pnlShiftPct: 1.5,
    approachingStopPct: 1.0,
    approachingTpPct: 1.0,
    liquidationProximityPct: 5.0,
    fundingSpike: 0.0001,
    volatilitySpikePct: 2.0,
    volatilitySpikeWindowTicks: 10,
    timeCeilingMinutes: 15,
    triggerCooldownSeconds: 180,
  };
}

function mkTick(partial: Partial<PositionTick> = {}): PositionTick {
  const now = partial.timestamp ?? 1700000000000;
  return {
    timestamp: now,
    symbol: 'ETH',
    markPrice: 2000,
    entryPrice: 1980,
    unrealizedPnl: 10,
    pnlPctOfEquity: 0.5,
    accountEquity: 2000,
    liquidationPrice: 1500,
    distToLiquidationPct: 25,
    fundingRate: 0,
    stopLossPrice: 1900,
    takeProfitPrice: 2100,
    positionSide: 'long',
    positionSize: 1,
    ...partial,
  };
}

describe('evaluateHeartbeatTriggers', () => {
  test('fires stop_missing when stop is null (with cooldown)', () => {
    const cfg = baseCfg();
    const now = 1700000000000;
    const tick = mkTick({ timestamp: now, stopLossPrice: null });
    const state = defaultTriggerState(now);
    const res1 = evaluateHeartbeatTriggers({ nowMs: now, tick, buffer: [tick], state, cfg });
    expect(res1.fired.map((t) => t.name)).toContain('stop_missing');

    const res2 = evaluateHeartbeatTriggers({
      nowMs: now + 30_000,
      tick: mkTick({ timestamp: now + 30_000, stopLossPrice: null }),
      buffer: [tick],
      state: res1.nextState,
      cfg,
    });
    expect(res2.fired.map((t) => t.name)).not.toContain('stop_missing');
  });

  test('fires pnl_shift when change vs lastLlmPnlPctOfEquity exceeds threshold', () => {
    const cfg = baseCfg();
    const now = 1700000000000;
    const tick = mkTick({ timestamp: now, pnlPctOfEquity: 2.1 });
    const state = { ...defaultTriggerState(now), lastLlmPnlPctOfEquity: 0.0 };
    const res = evaluateHeartbeatTriggers({ nowMs: now, tick, buffer: [tick], state, cfg });
    expect(res.fired.map((t) => t.name)).toContain('pnl_shift');
  });

  test('fires approaching_stop when within threshold', () => {
    const cfg = baseCfg();
    const now = 1700000000000;
    const tick = mkTick({ timestamp: now, markPrice: 2000, stopLossPrice: 1982 }); // 0.9%
    const res = evaluateHeartbeatTriggers({
      nowMs: now,
      tick,
      buffer: [tick],
      state: defaultTriggerState(now),
      cfg,
    });
    expect(res.fired.map((t) => t.name)).toContain('approaching_stop');
  });

  test('fires funding_flip only when last sign is non-zero and sign changed', () => {
    const cfg = baseCfg();
    const now = 1700000000000;
    const tick = mkTick({ timestamp: now, fundingRate: -0.0002 });
    const state = { ...defaultTriggerState(now), lastFundingRateSign: 1 };
    const res = evaluateHeartbeatTriggers({ nowMs: now, tick, buffer: [tick], state, cfg });
    expect(res.fired.map((t) => t.name)).toContain('funding_flip');
  });

  test('fires volatility_spike when move over window exceeds threshold', () => {
    const cfg = { ...baseCfg(), volatilitySpikePct: 2.0, volatilitySpikeWindowTicks: 3 };
    const now = 1700000000000;
    const t1 = mkTick({ timestamp: now - 60_000, markPrice: 100 });
    const t2 = mkTick({ timestamp: now - 30_000, markPrice: 101 });
    const t3 = mkTick({ timestamp: now, markPrice: 103 }); // 3% from 100
    const res = evaluateHeartbeatTriggers({
      nowMs: now,
      tick: t3,
      buffer: [t1, t2, t3],
      state: defaultTriggerState(now),
      cfg,
    });
    expect(res.fired.map((t) => t.name)).toContain('volatility_spike');
  });
});

