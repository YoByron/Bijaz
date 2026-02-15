# Position Heartbeat System

## Problem

Thufir can only reason about open positions when the user sends a Telegram message. Between messages, positions are unmonitored — no stop adjustments, no partial profit-taking, no thesis re-evaluation. The autonomous scan loop exists but focuses on finding new trade opportunities, not managing existing ones.

## Solution

A three-layer position management system that continuously monitors open positions and only invokes the LLM when something meaningful changes.

---

## Architecture

```
Layer 1: Data Poller          (every 30-60s, zero tokens)
    |
    v
Layer 2: Significance Filter  (mechanical thresholds, zero tokens)
    |
    v  (only when a trigger fires)
Layer 3: LLM Decision          (full context, token cost)
    |
    v
    Tool execution (adjust stop, close, partial profit, do nothing)
```

---

## Layer 1: Data Poller

**Purpose:** Continuously gather raw market and position data.

**Frequency:** Every 30-60 seconds while any position is open. Idle when flat (no positions).

**Cost:** Only Hyperliquid API calls. Zero LLM tokens.

### Data collected each tick

| Field | Source | Description |
|---|---|---|
| `markPrice` | `perp_market_get` | Current mark price for the position's asset |
| `entryPrice` | `perp_positions` | Average entry price of the open position |
| `unrealizedPnl` | `perp_positions` | Current unrealized PnL in USDC |
| `pnlPctOfEquity` | computed | `unrealizedPnl / accountEquity * 100` |
| `accountEquity` | `get_portfolio` | Total account value |
| `marginUsed` | `perp_positions` | Margin allocated to the position |
| `liquidationPrice` | `perp_positions` | Estimated liquidation price |
| `distToLiquidation` | computed | `abs(markPrice - liquidationPrice) / markPrice * 100` |
| `fundingRate` | `perp_market_get` | Current funding rate |
| `priceVelocity` | computed | Price change (%) over last N ticks (rolling window) |
| `stopLossPrice` | open orders | Current SL order price (if any) |
| `takeProfitPrice` | open orders | Current TP order price (if any) |
| `positionSide` | `perp_positions` | Long or short |
| `positionSize` | `perp_positions` | Notional size |

### Data storage

Each tick is stored in a rolling buffer (last ~60 ticks = ~30-60 minutes of history). This buffer is passed to the LLM when a trigger fires, giving it a recent trajectory, not just a snapshot.

```typescript
interface PositionTick {
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
  positionSide: 'long' | 'short';
  positionSize: number;
}
```

---

## Layer 2: Significance Filter

**Purpose:** Decide whether the current tick warrants an LLM call. Purely mechanical — no tokens, no network calls beyond what Layer 1 already fetched.

**Inputs:** Current tick + previous ticks + state from last LLM decision.

### Trigger conditions

Each trigger has a name, a threshold, and a cooldown (minimum time between consecutive firings of the same trigger to avoid spamming the LLM).

| # | Trigger | Condition | Default Threshold | Cooldown |
|---|---|---|---|---|
| 1 | `pnl_shift` | Unrealized PnL changed by more than X% of equity since last LLM check | 1.5% | 3 min |
| 2 | `approaching_stop` | Price is within X% of the stop-loss level | 1.0% | 2 min |
| 3 | `approaching_tp` | Price is within X% of the take-profit level | 1.0% | 2 min |
| 4 | `liquidation_proximity` | Distance to liquidation dropped below X% | 5.0% | 1 min |
| 5 | `funding_flip` | Funding rate sign flipped since last check (positive to negative or vice versa) | sign change | 10 min |
| 6 | `funding_spike` | Funding rate absolute value exceeds X | 0.01% (per hour) | 10 min |
| 7 | `volatility_spike` | Price moved more than X% in the last Y minutes | 2% in 5 min | 3 min |
| 8 | `time_ceiling` | No LLM check has happened in the last X minutes regardless of other triggers | 15 min | n/a |
| 9 | `stop_missing` | Position is open but no stop-loss order exists on the exchange | always fires | 1 min |
| 10 | `position_opened` | A new position was detected that wasn't there in the previous tick | always fires | 0 |
| 11 | `position_closed` | A position disappeared (filled stop/TP or liquidated) | always fires | 0 |

### Trigger evaluation

```
for each trigger:
    if condition is met AND cooldown has elapsed:
        mark trigger as fired
        record fire time

if any trigger fired:
    proceed to Layer 3
else:
    skip, wait for next tick
```

### Trigger state

```typescript
interface TriggerState {
  lastLlmCheckTimestamp: number;
  lastLlmPnlPctOfEquity: number;    // PnL at time of last LLM check
  lastLlmMarkPrice: number;         // price at time of last LLM check
  lastFundingRateSign: number;       // 1, -1, or 0
  triggerCooldowns: Record<string, number>;  // trigger name -> last fire timestamp
}
```

### Configuration

All thresholds should be configurable via `config.yaml`:

```yaml
heartbeat:
  enabled: true
  tickIntervalSeconds: 30          # Layer 1 polling frequency
  rollingBufferSize: 60            # ticks to keep in memory
  triggers:
    pnlShiftPct: 1.5
    approachingStopPct: 1.0
    approachingTpPct: 1.0
    liquidationProximityPct: 5.0
    fundingSpike: 0.0001
    volatilitySpikePct: 2.0
    volatilitySpikeWindowTicks: 10  # 10 ticks * 30s = 5 min
    timeCeilingMinutes: 15
    triggerCooldownSeconds: 180     # default cooldown between same trigger fires
  llm:
    provider: null                  # null = use agent's default provider
    model: null                     # null = use agent's default model
    maxTokens: 1024
```

---

## Layer 3: LLM Decision

**Purpose:** Given that something significant happened, let Thufir reason about what to do.

**Frequency:** Only when Layer 2 fires a trigger. Could be 0 times/hour on a quiet day or 10+ times/hour during volatility.

### Context passed to the LLM

The LLM receives a structured prompt containing:

1. **Which trigger(s) fired** — so the LLM knows *why* it's being consulted.
2. **Current position snapshot** — the latest tick data.
3. **Recent trajectory** — last N ticks from the rolling buffer, showing price/PnL trend.
4. **Original trade thesis** — if stored when the position was opened (entry reason, assumptions, invalidation criteria).
5. **Account state** — total equity, other open positions (if any), today's trade count, recent win/loss streak.
6. **Risk rules** — the position management rules from config (max loss per trade, max concurrent positions, loss streak pause, etc.).

### Prompt structure

```
## Position Heartbeat Alert

**Trigger:** {trigger_name} — {human-readable description}
**Time:** {timestamp}

### Current Position
- Symbol: {symbol}
- Side: {long/short}
- Entry: {entry_price}
- Current: {mark_price}
- Unrealized PnL: {pnl} USDC ({pnl_pct}% of equity)
- Stop-loss: {sl_price} (distance: {sl_dist}%)
- Take-profit: {tp_price} (distance: {tp_dist}%)
- Liquidation: {liq_price} (distance: {liq_dist}%)
- Funding rate: {funding}

### Recent Price Trajectory (last {N} minutes)
{table or compact list of recent ticks: time, price, pnl}

### Account State
- Equity: {equity} USDC
- Open positions: {count}
- Today's entries: {count}/{max}
- Recent streak: {W/L/W/L...}

### Original Trade Thesis
{thesis text if available, or "Not recorded"}

### Risk Rules
- Max loss per trade: {x}% of equity
- Max concurrent positions: {n}
- Loss streak pause: {n} losses -> {hours}h pause

### Your task
Evaluate whether to:
1. **Hold** — position is fine, no changes needed
2. **Tighten stop** — move stop-loss closer to protect gains or limit loss
3. **Take partial profit** — close a portion of the position
4. **Close entirely** — exit the full position
5. **Adjust take-profit** — move TP level

Respond with a JSON action and a one-sentence reason.
```

### Expected LLM response format

```json
{
  "action": "tighten_stop",
  "params": {
    "newStopPrice": 2045.00
  },
  "reason": "Price moved 3% in our favor; trailing stop to breakeven to protect capital."
}
```

Or:

```json
{
  "action": "hold",
  "reason": "PnL shift is within normal range, thesis intact, funding still favorable."
}
```

### Action execution

After the LLM responds:

1. Parse the action JSON.
2. Validate it against safety rules (e.g., can't move stop further away, can't increase position size).
3. Execute via tool calls (`perp_modify_order`, `perp_close_position`, etc.).
4. Log the decision: timestamp, trigger, LLM reasoning, action taken, result.
5. Update `TriggerState.lastLlmCheckTimestamp` and related fields.
6. Optionally notify via Telegram: "Tightened ETH stop to 2045. Reason: trailing to breakeven."

---

## Integration Points

### Where it lives in the codebase

The heartbeat should be a standalone service started alongside the gateway, similar to how the autonomous scanner and trade management service are started:

```
src/
  core/
    position_heartbeat.ts    # Layer 1 + 2 + 3 orchestration
    heartbeat_triggers.ts    # Layer 2 trigger definitions and evaluation
  gateway/
    index.ts                 # starts the heartbeat service alongside other services
```

### Lifecycle

1. **Gateway starts** -> heartbeat service initializes, starts idle.
2. **Position detected** (via periodic check or `position_opened` trigger) -> Layer 1 polling begins at `tickIntervalSeconds`.
3. **All positions closed** -> Layer 1 polling stops, heartbeat goes idle.
4. **Gateway shuts down** -> heartbeat service stops cleanly.

### Interaction with existing systems

| System | Interaction |
|---|---|
| Autonomous scanner | Scanner finds new trades. Heartbeat manages them after entry. No overlap — scanner skips symbols with open positions. |
| Conversation handler | User can ask "what's my position status?" — conversation handler reads the same data. Heartbeat decisions are logged and visible to the conversation LLM via trade journal. |
| Trade management service | Heartbeat uses the same tool execution context and order management functions. |
| Telegram notifications | Heartbeat can optionally send alerts when it takes action (configurable). |

### Shared state

The heartbeat writes its decisions to the trade journal / SQLite database so that:
- The conversation LLM can reference them ("I tightened your stop 10 minutes ago because...")
- The user can review heartbeat actions retroactively
- Win/loss streak tracking stays accurate

---

## Token Budget

Estimated token cost per LLM invocation:

| Component | Tokens (approx) |
|---|---|
| System prompt + identity | ~500 |
| Position context + trajectory | ~300-500 |
| Account state + risk rules | ~200 |
| LLM response | ~50-100 |
| **Total per invocation** | **~1,000-1,300** |

Estimated daily cost (assuming positions are open 8 hours/day):

| Market condition | Triggers/hour | LLM calls/day | Tokens/day |
|---|---|---|---|
| Quiet / sideways | 2-4 | 16-32 | ~20k-40k |
| Normal volatility | 4-8 | 32-64 | ~40k-80k |
| High volatility | 8-15 | 64-120 | ~80k-150k |

Compare to current: calling the full agentic LLM on every user message uses ~4,000-8,000 tokens per message. The heartbeat uses ~1,000 tokens per check because it has a focused, structured prompt with no agentic tool loop — the data is already gathered by Layer 1.

---

## Safety Constraints

1. **Heartbeat can only reduce risk, never increase it.** It can tighten stops, take profit, close positions. It cannot open new positions, add to existing ones, or widen stops. New entries are the autonomous scanner's job.

2. **Hard circuit breakers (no LLM needed):**
   - If `distToLiquidationPct < 2%` -> immediately close position, skip LLM.
   - If `pnlPctOfEquity < -5%` -> immediately close position, skip LLM.
   - These are hardcoded safety rails that fire before the LLM is even consulted.

3. **LLM action validation:**
   - Reject any LLM action that moves a stop further from current price (loosening).
   - Reject any action that would exceed position limits.
   - Log rejected actions for debugging.

4. **Rate limiting the LLM:**
   - Maximum N LLM calls per hour from the heartbeat (e.g., 20).
   - If exceeded, fall back to hard circuit breakers only until the next hour.

---

## Example Scenarios

### Scenario 1: Quiet hold
- ETH long opened at 2080, stop at 2050, TP at 2140.
- Price drifts between 2078-2085 for 30 minutes.
- No triggers fire except `time_ceiling` at 15 min.
- LLM checks in, says "hold", goes back to sleep.
- **LLM calls: 2 in 30 min. Tokens: ~2,500.**

### Scenario 2: Trade moves in our favor
- ETH long at 2080, stop at 2050.
- Price climbs to 2110 over 20 minutes.
- `pnl_shift` fires at +1.5% equity (tick 12).
- LLM: "tighten stop to 2080 (breakeven)."
- Price continues to 2130.
- `pnl_shift` fires again at +3% equity.
- LLM: "take 50% partial profit, trail stop to 2100."
- **LLM calls: 2. Tokens: ~2,500. Actions: 2 stop adjustments + 1 partial close.**

### Scenario 3: Sudden adverse move
- BTC short at 70,000, stop at 71,500.
- Price spikes from 69,800 to 70,900 in 3 minutes.
- `volatility_spike` fires (2% in 5 min).
- `approaching_stop` fires (within 1% of stop).
- LLM: "close position — vol spike against us, thesis invalid."
- Position closed at 70,900 for small loss instead of waiting for stop at 71,500.
- **LLM calls: 1. Tokens: ~1,200. Saved ~600 USDC of additional loss.**

### Scenario 4: Funding flip
- ETH long at 2080, funding was positive (longs paying shorts).
- Funding flips negative after 2 hours.
- `funding_flip` fires.
- LLM: "funding turned favorable for longs, hold. No action."
- **LLM calls: 1. Tokens: ~1,200. No action needed but thesis re-validated.**

### Scenario 5: Circuit breaker
- BTC long at 70,000 with 10x leverage.
- Flash crash, price drops to 63,500 in 2 minutes.
- `liquidation_proximity` fires (< 2%).
- Hard circuit breaker triggers BEFORE the LLM — position closed immediately.
- Telegram notification: "Emergency close BTC long — liquidation proximity < 2%."
- **LLM calls: 0. Tokens: 0. Account saved from liquidation.**
