/**
 * EVM Funding Tools
 *
 * Minimal on-chain tools to let the agent diagnose and resolve funding blockers
 * (balances -> bridge -> deposit).
 */

import { z } from 'zod';

import type { ToolDefinition, ToolContext, ToolResult } from '../types.js';
import { executeToolCall, type ToolExecutorContext } from '../../../core/tool-executor.js';

function toExecutorContext(ctx: ToolContext): ToolExecutorContext {
  return ctx as unknown as ToolExecutorContext;
}

export const evmErc20BalanceTool: ToolDefinition = {
  name: 'evm_erc20_balance',
  description: 'Get ERC20 balance on an EVM chain (polygon|arbitrum). Read-only.',
  category: 'system',
  schema: z.object({
    chain: z.enum(['polygon', 'arbitrum']).describe('Chain'),
    address: z.string().describe('Owner address'),
    token_address: z.string().optional().describe('Token address (defaults to USDC for the chain)'),
    rpc_url: z.string().optional().describe('Override RPC URL for this call'),
  }),
  execute: async (input, ctx): Promise<ToolResult> => {
    return executeToolCall('evm_erc20_balance', input as Record<string, unknown>, toExecutorContext(ctx));
  },
  sideEffects: false,
  requiresConfirmation: false,
  cacheTtlMs: 10_000,
};

export const evmUsdcBalancesTool: ToolDefinition = {
  name: 'evm_usdc_balances',
  description: 'Get native + USDC balances for polygon and arbitrum. Read-only.',
  category: 'system',
  schema: z.object({
    address: z.string().optional().describe('Owner address (default: keystore address)'),
  }),
  execute: async (input, ctx): Promise<ToolResult> => {
    return executeToolCall('evm_usdc_balances', input as Record<string, unknown>, toExecutorContext(ctx));
  },
  sideEffects: false,
  requiresConfirmation: false,
  cacheTtlMs: 10_000,
};

export const cctpBridgeUsdcTool: ToolDefinition = {
  name: 'cctp_bridge_usdc',
  description:
    'Bridge native USDC across supported chains using Circle CCTP v1 (polygon <-> arbitrum). Side-effect tool.',
  category: 'trading',
  schema: z.object({
    from_chain: z.enum(['polygon', 'arbitrum']).optional().describe('Source chain (default: polygon)'),
    to_chain: z.enum(['polygon', 'arbitrum']).optional().describe('Destination chain (default: arbitrum)'),
    amount_usdc: z.number().describe('Amount of USDC to bridge'),
    recipient: z.string().optional().describe('Recipient address on destination (default: same wallet address)'),
    poll_seconds: z.number().optional().describe('Polling interval for attestation (default: 5)'),
    max_wait_seconds: z.number().optional().describe('Max wait for attestation (default: 300)'),
  }),
  execute: async (input, ctx): Promise<ToolResult> => {
    return executeToolCall('cctp_bridge_usdc', input as Record<string, unknown>, toExecutorContext(ctx));
  },
  sideEffects: true,
  requiresConfirmation: true,
  cacheTtlMs: 0,
};

export const hyperliquidDepositUsdcTool: ToolDefinition = {
  name: 'hyperliquid_deposit_usdc',
  description:
    'Deposit USDC to Hyperliquid by transferring USDC on Arbitrum to the configured Hyperliquid bridge deposit address. Side-effect tool.',
  category: 'trading',
  schema: z.object({
    amount_usdc: z.number().describe('Amount of USDC to deposit'),
    deposit_address: z.string().optional().describe('Override deposit address'),
  }),
  execute: async (input, ctx): Promise<ToolResult> => {
    return executeToolCall('hyperliquid_deposit_usdc', input as Record<string, unknown>, toExecutorContext(ctx));
  },
  sideEffects: true,
  requiresConfirmation: true,
  cacheTtlMs: 0,
};

export const evmTools: ToolDefinition[] = [
  evmErc20BalanceTool,
  evmUsdcBalancesTool,
  cctpBridgeUsdcTool,
  hyperliquidDepositUsdcTool,
];
