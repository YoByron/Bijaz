# Implementation Plan (Hyperliquid Pivot)

## Status (2026-02-12)
- Phases 1-3 are implemented in code.
- Phase 4 is partially complete: tests/build are passing on Node 22, coverage thresholds are configured, and `thufir env verify-live` now checks market data, account state, open orders, and signer readiness; authenticated real-account trade/cancel verification remains.
- Phase 5 remains ongoing iteration work.

## Phase 1: Perp Integration
- Hyperliquid client + market list
- Live executor
- Order/position tools
- Perp risk checks

## Phase 2: Discovery Engine
- Signals (price/vol, cross-asset, funding/OI, orderflow)
- Hypotheses + expressions
- Probe sizing + guardrails

## Phase 3: Agent + Tooling
- Tool calling wired into agent modes
- Autonomy loop uses discovery outputs
- Autonomy thresholds enforced (`minEdge`, `requireHighConfidence`, `pauseOnLossStreak`)
- On-chain scoring uses live Hyperliquid funding/orderflow/book signals
- CLI and docs updated

## Phase 4: Verification
- Run tests
- Live API verification with small orders
- Monitor error handling and edge cases

## Phase 5: Learning
- Record trade artifacts
- Track signal quality and drift
- Iterate on sizing + prioritization
