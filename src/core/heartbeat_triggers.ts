export type PositionSide = 'long' | 'short';

export interface PositionTick {
  timestamp: number;
  symbol: string;
  markPrice: number;
  entryPrice: number;
  unrealizedPnl: number;
  pnlPctOfEquity: number;
  accountEquity: number;
  liquidationPrice: number;
  distToLiquidationPct: number;
  fundingRate: number;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  positionSide: PositionSide;
  positionSize: number;
}

export type HeartbeatTriggerName =
  | 'pnl_shift'
  | 'approaching_stop'
  | 'approaching_tp'
  | 'liquidation_proximity'
  | 'funding_flip'
  | 'funding_spike'
  | 'volatility_spike'
  | 'time_ceiling'
  | 'stop_missing'
  | 'position_opened'
  | 'position_closed';

export interface HeartbeatTriggerFired {
  name: HeartbeatTriggerName;
  detail: string;
}

export interface TriggerState {
  lastLlmCheckTimestamp: number;
  lastLlmPnlPctOfEquity: number;
  lastLlmMarkPrice: number;
  lastFundingRateSign: number; // -1, 0, 1
  triggerCooldowns: Partial<Record<HeartbeatTriggerName, number>>;
}

export interface HeartbeatTriggerConfig {
  pnlShiftPct: number;
  approachingStopPct: number;
  approachingTpPct: number;
  liquidationProximityPct: number;
  fundingSpike: number;
  volatilitySpikePct: number;
  volatilitySpikeWindowTicks: number;
  timeCeilingMinutes: number;
  triggerCooldownSeconds: number;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function sign(n: number): number {
  if (!Number.isFinite(n) || n === 0) return 0;
  return n > 0 ? 1 : -1;
}

function pctDistance(a: number, b: number): number {
  if (!Number.isFinite(a) || a === 0 || !Number.isFinite(b)) return Infinity;
  return (Math.abs(a - b) / Math.abs(a)) * 100;
}

function canFire(params: {
  name: HeartbeatTriggerName;
  nowMs: number;
  cooldownMs: number;
  state: TriggerState;
}): boolean {
  const last = params.state.triggerCooldowns?.[params.name] ?? 0;
  return params.cooldownMs <= 0 ? true : params.nowMs - last >= params.cooldownMs;
}

const DEFAULT_COOLDOWNS_MS: Record<HeartbeatTriggerName, number> = {
  pnl_shift: 3 * 60_000,
  approaching_stop: 2 * 60_000,
  approaching_tp: 2 * 60_000,
  liquidation_proximity: 60_000,
  funding_flip: 10 * 60_000,
  funding_spike: 10 * 60_000,
  volatility_spike: 3 * 60_000,
  time_ceiling: 0,
  stop_missing: 60_000,
  position_opened: 0,
  position_closed: 0,
};

export function defaultTriggerState(_nowMs: number): TriggerState {
  return {
    lastLlmCheckTimestamp: 0,
    lastLlmPnlPctOfEquity: 0,
    lastLlmMarkPrice: 0,
    lastFundingRateSign: 0,
    triggerCooldowns: {},
  };
}

export function evaluateHeartbeatTriggers(params: {
  nowMs: number;
  tick: PositionTick;
  buffer: PositionTick[];
  state: TriggerState;
  cfg: HeartbeatTriggerConfig;
  extra?: {
    positionOpened?: boolean;
    positionClosed?: boolean;
  };
}): { fired: HeartbeatTriggerFired[]; nextState: TriggerState } {
  const { nowMs, tick, buffer, cfg } = params;
  const fired: HeartbeatTriggerFired[] = [];
  const state: TriggerState = params.state ?? defaultTriggerState(nowMs);

  const defaultCooldownMs = clampInt(cfg.triggerCooldownSeconds, 0, 86_400) * 1000;
  const cooldownMs = (name: HeartbeatTriggerName): number =>
    DEFAULT_COOLDOWNS_MS[name] ?? defaultCooldownMs;

  const record = (name: HeartbeatTriggerName, detail: string) => {
    const cd = cooldownMs(name);
    if (!canFire({ name, nowMs, cooldownMs: cd, state })) return;
    fired.push({ name, detail });
    state.triggerCooldowns[name] = nowMs;
  };

  if (params.extra?.positionOpened) {
    record('position_opened', 'New position detected since last tick.');
  }
  if (params.extra?.positionClosed) {
    record('position_closed', 'Position disappeared since last tick.');
  }

  if (tick.stopLossPrice == null) {
    record('stop_missing', 'Position open but no stop-loss trigger order found.');
  }

  const pnlShift = Math.abs(tick.pnlPctOfEquity - (state.lastLlmPnlPctOfEquity ?? 0));
  if (pnlShift >= Math.abs(cfg.pnlShiftPct)) {
    record(
      'pnl_shift',
      `Unrealized PnL shifted ${pnlShift.toFixed(2)}% of equity since last LLM check.`
    );
  }

  if (tick.stopLossPrice != null) {
    const dist = pctDistance(tick.markPrice, tick.stopLossPrice);
    if (dist <= Math.abs(cfg.approachingStopPct)) {
      record('approaching_stop', `Price is within ${dist.toFixed(2)}% of stop-loss.`);
    }
  }

  if (tick.takeProfitPrice != null) {
    const dist = pctDistance(tick.markPrice, tick.takeProfitPrice);
    if (dist <= Math.abs(cfg.approachingTpPct)) {
      record('approaching_tp', `Price is within ${dist.toFixed(2)}% of take-profit.`);
    }
  }

  if (tick.distToLiquidationPct <= Math.abs(cfg.liquidationProximityPct)) {
    record(
      'liquidation_proximity',
      `Distance to liquidation is ${tick.distToLiquidationPct.toFixed(2)}%.`
    );
  }

  const fundingSign = sign(tick.fundingRate);
  const lastSign = sign(state.lastFundingRateSign ?? 0);
  if (lastSign !== 0 && fundingSign !== 0 && fundingSign !== lastSign) {
    record(
      'funding_flip',
      `Funding rate sign flipped (${lastSign} -> ${fundingSign}).`
    );
  }
  if (Math.abs(tick.fundingRate) >= Math.abs(cfg.fundingSpike)) {
    record(
      'funding_spike',
      `Funding rate magnitude (${tick.fundingRate}) exceeded threshold (${cfg.fundingSpike}).`
    );
  }

  const window = clampInt(cfg.volatilitySpikeWindowTicks, 1, 10_000);
  if (buffer.length >= window) {
    const base = buffer[buffer.length - window]!;
    const basePx = base.markPrice;
    const movePct =
      Number.isFinite(basePx) && basePx > 0
        ? (Math.abs(tick.markPrice - basePx) / basePx) * 100
        : 0;
    if (movePct >= Math.abs(cfg.volatilitySpikePct)) {
      record(
        'volatility_spike',
        `Price moved ${movePct.toFixed(2)}% over last ${window} ticks.`
      );
    }
  }

  const ceilingMs = clampInt(cfg.timeCeilingMinutes, 1, 10_000) * 60_000;
  if (ceilingMs > 0 && (state.lastLlmCheckTimestamp ?? 0) > 0) {
    const age = nowMs - state.lastLlmCheckTimestamp;
    if (age >= ceilingMs) {
      record('time_ceiling', `No LLM check in ${(age / 60_000).toFixed(1)} minutes.`);
    }
  }
  if (ceilingMs > 0 && (state.lastLlmCheckTimestamp ?? 0) === 0) {
    // First check for this position should happen promptly after it appears.
    record('time_ceiling', 'No prior LLM check recorded for this position.');
  }

  return { fired, nextState: state };
}
