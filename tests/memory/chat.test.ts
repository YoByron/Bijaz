import { describe, expect, it, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('pruneChatMessages', () => {
  it('returns 0 when nothing to prune', async () => {
    const prepare = vi.fn().mockReturnValue({
      all: () => [],
      run: () => ({ changes: 0 }),
    });
    vi.doMock('../../src/memory/db.js', () => ({
      openDatabase: () => ({ prepare }),
    }));

    const { pruneChatMessages } = await import('../../src/memory/chat.js');
    const pruned = pruneChatMessages(30);
    expect(pruned).toBe(0);
  });

  it('deletes old messages and embeddings', async () => {
    const calls: string[] = [];
    const prepare = (sql: string) => {
      calls.push(sql);
      if (sql.includes('SELECT id FROM chat_messages')) {
        return { all: () => [{ id: 'a' }, { id: 'b' }] };
      }
      return { run: () => ({ changes: 2 }) };
    };

    vi.doMock('../../src/memory/db.js', () => ({
      openDatabase: () => ({ prepare }),
    }));

    const { pruneChatMessages } = await import('../../src/memory/chat.js');
    const pruned = pruneChatMessages(7);
    expect(pruned).toBe(2);
    expect(calls.some((c) => c.includes('chat_embeddings'))).toBe(true);
  });
});
