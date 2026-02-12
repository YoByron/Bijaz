import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/execution/hyperliquid/client.js', () => ({
  HyperliquidClient: class {
    async getFundingHistory() {
      return [{ fundingRate: 0.0006 }, { fundingRate: 0.0004 }];
    }
    async getRecentTrades() {
      return [
        { px: 100, sz: 10, side: 'B' },
        { px: 100, sz: 2, side: 'S' },
      ];
    }
    async getL2Book() {
      return {
        levels: [
          [
            { px: 100, sz: 10 },
            { px: 99, sz: 4 },
          ],
          [
            { px: 101, sz: 2 },
            { px: 102, sz: 2 },
          ],
        ],
      };
    }
  },
}));

import { getOnChainSnapshot } from '../../src/technical/onchain.js';

describe('getOnChainSnapshot', () => {
  it('returns neutral when on-chain is disabled', async () => {
    const res = await getOnChainSnapshot({ technical: { onChain: { enabled: false } } } as any, 'BTC/USDT');
    expect(res.score).toBe(0);
    expect(res.reasoning[0]).toContain('disabled');
  });

  it('computes non-neutral score from funding/orderflow/book', async () => {
    const res = await getOnChainSnapshot({ technical: { onChain: { enabled: true } } } as any, 'BTC/USDT');
    expect(res.score).not.toBe(0);
    expect(res.reasoning.some((line) => line.toLowerCase().includes('funding'))).toBe(true);
  });
});
