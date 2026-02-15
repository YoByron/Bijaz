import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AgenticOpenAiClient } from '../src/core/llm.js';
import * as toolExecutor from '../src/core/tool-executor.js';

vi.mock('node-fetch', () => {
  return {
    default: vi.fn(),
  };
});

import fetch from 'node-fetch';

const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;

describe('AgenticOpenAiClient tool calling', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('executes tool calls and returns final text', async () => {
    const responses = [
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'intel_recent',
                    arguments: '{"limit":1}',
                  },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            message: {
              content: 'Latest intel: ...',
            },
          },
        ],
      },
    ];

    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => responses.shift(),
      })
    );

    const client = new AgenticOpenAiClient(
      {
        agent: {
          model: 'gpt-4o-mini',
          openaiModel: 'gpt-4o-mini',
          provider: 'openai',
          apiBaseUrl: 'https://api.openai.com',
        },
      } as any,
      {
        config: { intel: { embeddings: { enabled: false } } } as any,
        marketClient: {} as any,
      }
    );

    const result = await client.complete(
      [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'What is new?' },
      ],
      { temperature: 0.2, maxToolCalls: 3 }
    );

    expect(result.content).toContain('Latest intel');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1]?.body ?? '{}');
    const toolMessages = secondCallBody.messages.filter((msg: any) => msg.role === 'tool');
    expect(toolMessages.length).toBeGreaterThan(0);
  });

  it('uses text-based tool calling when proxy is enabled (tools param may be stripped)', async () => {
    const execSpy = vi
      .spyOn(toolExecutor, 'executeToolCall')
      .mockResolvedValue({ success: true, data: { ok: true } } as any);

    const responses = [
      {
        choices: [
          {
            message: {
              content:
                'Let me check.\n\n<tool_call>\n{"name":"intel_recent","arguments":{"limit":1}}\n</tool_call>',
            },
          },
        ],
      },
      {
        choices: [
          {
            message: {
              content: 'Latest intel: ...',
            },
          },
        ],
      },
    ];

    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => responses.shift(),
      } as any)
    );

    const client = new AgenticOpenAiClient(
      {
        agent: {
          model: 'gpt-4o-mini',
          openaiModel: 'gpt-4o-mini',
          provider: 'openai',
          apiBaseUrl: 'https://api.openai.com',
          useProxy: true,
          useResponsesApi: false,
        },
      } as any,
      {
        config: { intel: { embeddings: { enabled: false } } } as any,
        marketClient: {} as any,
      }
    );

    const result = await client.complete(
      [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'What is new?' },
      ],
      { temperature: 0.2, maxToolCalls: 3 }
    );

    expect(result.content).toContain('Latest intel');
    expect(execSpy).toHaveBeenCalledWith('intel_recent', { limit: 1 }, expect.anything());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
