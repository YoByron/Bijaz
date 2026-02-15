import { describe, expect, test } from 'vitest';

import { _private } from '../../src/core/position_heartbeat.js';

describe('position heartbeat action validation', () => {
  test('rejects loosening stop for long', () => {
    const tick: any = { positionSide: 'long', markPrice: 2000 };
    const action: any = { action: 'tighten_stop', params: { newStopPrice: 1800 }, reason: 'x' };
    const res = _private.validateAction({ action, tick, stopLossPrice: 1900 });
    expect(res.ok).toBe(false);
  });

  test('rejects stop above mark for long', () => {
    const tick: any = { positionSide: 'long', markPrice: 2000 };
    const action: any = { action: 'tighten_stop', params: { newStopPrice: 2001 }, reason: 'x' };
    const res = _private.validateAction({ action, tick, stopLossPrice: 1900 });
    expect(res.ok).toBe(false);
  });

  test('rejects loosening stop for short', () => {
    const tick: any = { positionSide: 'short', markPrice: 2000 };
    const action: any = { action: 'tighten_stop', params: { newStopPrice: 2300 }, reason: 'x' };
    const res = _private.validateAction({ action, tick, stopLossPrice: 2200 });
    expect(res.ok).toBe(false);
  });

  test('parses trigger open orders by symbol (sl/tp)', () => {
    const orders = [
      { coin: 'ETH', isTrigger: true, tpsl: 'sl', oid: 10, triggerPx: '1900.0' },
      { coin: 'ETH', isTrigger: true, tpsl: 'tp', oid: 11, triggerPx: '2100.0' },
      { coin: 'BTC', isTrigger: true, tpsl: 'sl', oid: 12, triggerPx: '60000.0' },
    ];
    const parsed = _private.parseOpenOrdersForSymbol(orders, 'eth');
    expect(parsed.stopLossPrice).toBe(1900);
    expect(parsed.stopLossOid).toBe('10');
    expect(parsed.takeProfitPrice).toBe(2100);
    expect(parsed.takeProfitOid).toBe('11');
  });
});

