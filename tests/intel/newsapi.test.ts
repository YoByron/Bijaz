import { describe, expect, it, vi } from 'vitest';

import { NewsApiFetcher } from '../../src/intel/newsapi.js';

const baseConfig = {
  intel: {
    sources: {
      newsapi: {
        enabled: true,
        apiKey: 'test-key',
        baseUrl: 'https://newsapi.local',
        maxArticlesPerFetch: 10,
      },
    },
  },
};

describe('NewsApiFetcher', () => {
  it('returns empty when apiKey is missing', async () => {
    const fetcher = new NewsApiFetcher({
      intel: { sources: { newsapi: { enabled: true } } },
    } as any);
    const items = await fetcher.fetch();
    expect(items).toEqual([]);
  });

  it('fetches articles and normalizes them', async () => {
    const response = {
      status: 'ok',
      articles: [
        {
          title: 'Test headline',
          description: 'Summary',
          url: 'https://example.com/story',
          publishedAt: '2026-01-26T00:00:00Z',
          source: { name: 'Example' },
        },
      ],
    };

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => response,
    }));

    vi.stubGlobal('fetch', fetchMock as any);

    const fetcher = new NewsApiFetcher(baseConfig as any);
    const items = await fetcher.fetch();

    expect(fetchMock).toHaveBeenCalled();
    expect(items).toEqual([
      {
        title: 'Test headline',
        content: 'Summary',
        url: 'https://example.com/story',
        publishedAt: '2026-01-26T00:00:00Z',
        source: 'Example',
      },
    ]);

    vi.unstubAllGlobals();
  });
});
