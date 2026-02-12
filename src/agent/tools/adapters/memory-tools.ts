/**
 * Memory Tools Adapter
 *
 * Wraps existing memory/calibration-related tools from tool-executor.ts.
 */

import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';
import { executeToolCall, type ToolExecutorContext } from '../../../core/tool-executor.js';
import type { ThufirConfig } from '../../../core/config.js';
import { ChatVectorStore } from '../../../memory/chat_vectorstore.js';
import { listChatMessagesByIds } from '../../../memory/chat.js';

const DEFAULT_CACHE_TTL = 30_000; // 30 seconds

/**
 * Convert ToolContext to ToolExecutorContext.
 */
function toExecutorContext(ctx: ToolContext): ToolExecutorContext {
  return ctx as unknown as ToolExecutorContext;
}

/**
 * Calibration stats tool - get trade track record.
 */
export const calibrationStatsTool: ToolDefinition = {
  name: 'calibration_stats',
  description: "Get the user's trade calibration stats (accuracy, track record).",
  category: 'memory',
  schema: z.object({
    domain: z.string().optional().describe('Filter by domain (e.g., "politics", "crypto")'),
  }),
  execute: async (input, ctx): Promise<ToolResult> => {
    return executeToolCall('calibration_stats', input as Record<string, unknown>, toExecutorContext(ctx));
  },
  sideEffects: false,
  requiresConfirmation: false,
  cacheTtlMs: DEFAULT_CACHE_TTL,
};

/**
 * Memory query tool - semantic search over chat history.
 */
export const memoryQueryTool: ToolDefinition = {
  name: 'memory.query',
  description: 'Query chat memory using semantic search. Returns relevant past messages.',
  category: 'memory',
  schema: z.object({
    query: z.string().describe('What to search for in chat memory'),
    limit: z.number().optional().describe('Maximum messages to return (default: 5)'),
  }),
  execute: async (input, ctx): Promise<ToolResult> => {
    const config = ctx.config as ThufirConfig;
    const query = String((input as { query?: string }).query ?? '').trim();
    const limit = Math.min(Math.max(Number((input as { limit?: number }).limit ?? 5), 1), 20);

    if (!query) {
      return { success: false, error: 'Missing query' };
    }

    const store = new ChatVectorStore(config);
    const hits = await store.query(query, limit);
    const messages = listChatMessagesByIds(hits.map((hit) => hit.id));

    const scored = messages.map((message) => {
      const score = hits.find((hit) => hit.id === message.id)?.score ?? 0;
      return { ...message, score };
    });

    return { success: true, data: scored };
  },
  sideEffects: false,
  requiresConfirmation: false,
  cacheTtlMs: DEFAULT_CACHE_TTL,
};

/**
 * Evaluation summary tool - live performance and calibration snapshot.
 */
export const evaluationSummaryTool: ToolDefinition = {
  name: 'evaluation.summary',
  description: 'Get evaluation summary metrics (PnL, calibration, edge, domain performance).',
  category: 'memory',
  schema: z.object({
    window_days: z.number().optional().describe('Window length in days (omit for all-time).'),
    domain: z.string().optional().describe('Optional domain filter (e.g., politics, crypto).'),
  }),
  execute: async (input, ctx): Promise<ToolResult> => {
    return executeToolCall('evaluation_summary', input as Record<string, unknown>, toExecutorContext(ctx));
  },
  sideEffects: false,
  requiresConfirmation: false,
  cacheTtlMs: DEFAULT_CACHE_TTL,
};

export const agentIncidentsRecentTool: ToolDefinition = {
  name: 'agent_incidents_recent',
  description: 'List recent agent incidents (tool failures + detected blockers). Use to debug operational gaps.',
  category: 'memory',
  schema: z.object({
    limit: z.number().optional().describe('Maximum rows (default: 20)'),
  }),
  execute: async (input, ctx): Promise<ToolResult> => {
    return executeToolCall('agent_incidents_recent', input as Record<string, unknown>, toExecutorContext(ctx));
  },
  sideEffects: false,
  requiresConfirmation: false,
  cacheTtlMs: 5_000,
};

export const playbookSearchTool: ToolDefinition = {
  name: 'playbook_search',
  description: 'Search operator playbooks by keyword. Use to find procedures for fixing blockers.',
  category: 'memory',
  schema: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional().describe('Maximum results (default: 8)'),
  }),
  execute: async (input, ctx): Promise<ToolResult> => {
    return executeToolCall('playbook_search', input as Record<string, unknown>, toExecutorContext(ctx));
  },
  sideEffects: false,
  requiresConfirmation: false,
  cacheTtlMs: 10_000,
};

export const playbookGetTool: ToolDefinition = {
  name: 'playbook_get',
  description: 'Get an operator playbook by key.',
  category: 'memory',
  schema: z.object({
    key: z.string().describe('Playbook key (e.g., "hyperliquid/funding")'),
  }),
  execute: async (input, ctx): Promise<ToolResult> => {
    return executeToolCall('playbook_get', input as Record<string, unknown>, toExecutorContext(ctx));
  },
  sideEffects: false,
  requiresConfirmation: false,
  cacheTtlMs: 10_000,
};

export const playbookUpsertTool: ToolDefinition = {
  name: 'playbook_upsert',
  description: 'Create or update an operator playbook. Use to persist durable procedures after you validate them.',
  category: 'memory',
  schema: z.object({
    key: z.string().describe('Playbook key'),
    title: z.string().describe('Playbook title'),
    content: z.string().describe('Playbook content (markdown/plaintext)'),
    tags: z.array(z.string()).optional().describe('Optional tags'),
  }),
  execute: async (input, ctx): Promise<ToolResult> => {
    return executeToolCall('playbook_upsert', input as Record<string, unknown>, toExecutorContext(ctx));
  },
  sideEffects: true,
  requiresConfirmation: true,
  cacheTtlMs: 0,
};

/**
 * All memory tools.
 */
export const memoryTools: ToolDefinition[] = [
  calibrationStatsTool,
  memoryQueryTool,
  evaluationSummaryTool,
  agentIncidentsRecentTool,
  playbookSearchTool,
  playbookGetTool,
  playbookUpsertTool,
];
