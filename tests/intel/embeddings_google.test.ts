import { describe, expect, it, vi } from 'vitest';

import { GoogleGeminiEmbedder } from '../../src/intel/embeddings.js';

describe('GoogleGeminiEmbedder', () => {
  it('returns empty when API key is missing', async () => {
    const embedder = new GoogleGeminiEmbedder({} as any, {
      model: 'gemini-embedding-001',
      apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    });
    const vectors = await embedder.embed(['hello']);
    expect(vectors).toEqual([]);
  });

  it('parses embeddings from response', async () => {
    const response = {
      embeddings: [{ values: [0.1, 0.2, 0.3] }],
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => response,
    }));

    vi.stubGlobal('fetch', fetchMock as any);
    process.env.GEMINI_API_KEY = 'test-key';

    const embedder = new GoogleGeminiEmbedder({} as any, {
      model: 'gemini-embedding-001',
      apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    });
    const vectors = await embedder.embed(['hello']);

    expect(fetchMock).toHaveBeenCalled();
    expect(vectors).toEqual([[0.1, 0.2, 0.3]]);

    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
  });
});
