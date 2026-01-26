import { describe, expect, it, vi } from 'vitest';

import { GoogleNewsFetcher } from '../../src/intel/googlenews.js';

const baseConfig = {
  intel: {
    sources: {
      googlenews: {
        enabled: true,
        serpApiKey: 'test-key',
        baseUrl: 'https://serpapi.local/search.json',
        queries: ['election'],
      },
    },
  },
};

describe('GoogleNewsFetcher', () => {
  it('returns empty when serpApiKey is missing', async () => {
    const fetcher = new GoogleNewsFetcher({
      intel: { sources: { googlenews: { enabled: true } } },
    } as any);
    const items = await fetcher.fetch();
    expect(items).toEqual([]);
  });

  it('fetches and normalizes news results', async () => {
    const response = {
      news_results: [
        {
          title: 'Headline',
          link: 'https://example.com/article',
          snippet: 'Summary',
          source: 'Example',
          date: '2026-01-26T00:00:00Z',
        },
      ],
    };

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => response,
    }));

    vi.stubGlobal('fetch', fetchMock as any);

    const fetcher = new GoogleNewsFetcher(baseConfig as any);
    const items = await fetcher.fetch();

    expect(fetchMock).toHaveBeenCalled();
    expect(items).toEqual([
      {
        title: 'Headline',
        content: 'Summary',
        url: 'https://example.com/article',
        publishedAt: '2026-01-26T00:00:00Z',
        source: 'Example',
      },
    ]);

    vi.unstubAllGlobals();
  });
});
