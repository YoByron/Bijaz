import { describe, expect, it, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('pruneIntel', () => {
  it('returns 0 when nothing to prune', async () => {
    const prepare = vi.fn().mockReturnValue({
      all: () => [],
      run: () => ({ changes: 0 }),
    });
    vi.doMock('../../src/memory/db.js', () => ({
      openDatabase: () => ({ prepare }),
    }));

    const { pruneIntel } = await import('../../src/intel/store.js');
    const pruned = pruneIntel(30);
    expect(pruned).toBe(0);
  });

  it('deletes old intel items and embeddings', async () => {
    const calls: string[] = [];
    const prepare = (sql: string) => {
      calls.push(sql);
      if (sql.includes('SELECT id FROM intel_items')) {
        return { all: () => [{ id: 'x' }, { id: 'y' }] };
      }
      return { run: () => ({ changes: 2 }) };
    };
    vi.doMock('../../src/memory/db.js', () => ({
      openDatabase: () => ({ prepare }),
    }));

    const { pruneIntel } = await import('../../src/intel/store.js');
    const pruned = pruneIntel(7);
    expect(pruned).toBe(2);
    expect(calls.some((c) => c.includes('intel_embeddings'))).toBe(true);
  });
});
