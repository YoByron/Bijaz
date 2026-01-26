import { describe, expect, it, vi } from 'vitest';

import { PolymarketCommentsFetcher } from '../../src/intel/polymarket_comments.js';

vi.mock('../../src/memory/watchlist.js', () => ({
  listWatchlist: () => [{ marketId: '123' }],
}));

describe('PolymarketCommentsFetcher', () => {
  it('returns empty when disabled', async () => {
    const fetcher = new PolymarketCommentsFetcher({
      intel: { sources: { polymarketComments: { enabled: false } } },
      polymarket: { api: { gamma: 'https://gamma.local', clob: '' } },
    } as any);

    const items = await fetcher.fetch();
    expect(items).toEqual([]);
  });

  it('fetches and normalizes comments', async () => {
    const response = [
      {
        id: 'c1',
        body: 'Interesting take',
        createdAt: '2026-01-26T00:00:00Z',
        profile: { pseudonym: 'user123' },
      },
    ];

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => response,
    }));

    vi.stubGlobal('fetch', fetchMock as any);

    const fetcher = new PolymarketCommentsFetcher({
      intel: { sources: { polymarketComments: { enabled: true } } },
      polymarket: { api: { gamma: 'https://gamma.local', clob: '' } },
    } as any);

    const items = await fetcher.fetch();
    expect(fetchMock).toHaveBeenCalled();
    expect(items).toEqual([
      {
        title: 'Polymarket comment by user123',
        content: 'Interesting take',
        url: 'https://polymarket.com/market/123',
        publishedAt: '2026-01-26T00:00:00Z',
        source: 'Polymarket comments',
      },
    ]);

    vi.unstubAllGlobals();
  });
});
