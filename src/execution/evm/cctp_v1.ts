import { ethers } from 'ethers';

import type { EvmChain } from './chains.js';
import { getRpcUrl, getUsdcConfig } from './chains.js';
import { getErc20Allowance, approveErc20 } from './erc20.js';

// Circle CCTP v1 interfaces (minimal).
const TOKEN_MESSENGER_ABI = [
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64)',
];

const MESSAGE_TRANSMITTER_ABI = [
  'function receiveMessage(bytes message, bytes attestation) returns (bool)',
];

function normalizeAddress(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) throw new Error('Missing address');
  return ethers.utils.getAddress(trimmed);
}

function addressToBytes32(address: string): string {
  // left-pad 20-byte address to 32 bytes
  const a = normalizeAddress(address);
  return ethers.utils.hexZeroPad(a, 32);
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

export async function cctpV1BridgeUsdc(params: {
  config: any;
  privateKey: string;
  fromChain: EvmChain;
  toChain: EvmChain;
  amountUsdc: number;
  recipient?: string; // EVM address; default = wallet address
  approve?: boolean; // default true
  pollSeconds?: number; // default 5
  maxWaitSeconds?: number; // default 300
}): Promise<{
  fromTxHash: string;
  messageHash: string;
  attestationStatus: string;
  toTxHash: string;
}> {
  if (params.fromChain === params.toChain) {
    throw new Error('fromChain and toChain must differ');
  }

  const amount = Number(params.amountUsdc);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid amountUsdc');
  }

  const rpcFrom = getRpcUrl(params.config, params.fromChain);
  const rpcTo = getRpcUrl(params.config, params.toChain);
  if (!rpcFrom) throw new Error(`Missing RPC URL for ${params.fromChain}`);
  if (!rpcTo) throw new Error(`Missing RPC URL for ${params.toChain}`);

  const fromProvider = new ethers.providers.JsonRpcProvider(rpcFrom);
  const toProvider = new ethers.providers.JsonRpcProvider(rpcTo);
  const fromWallet = new ethers.Wallet(params.privateKey, fromProvider);
  const toWallet = new ethers.Wallet(params.privateKey, toProvider);

  const recipient = params.recipient ? normalizeAddress(params.recipient) : fromWallet.address;
  const mintRecipient = addressToBytes32(recipient);

  const usdcFrom = getUsdcConfig(params.config, params.fromChain);

  const cctpCfg = params.config?.cctp ?? {};
  const domains = cctpCfg.domains ?? {};
  const contracts = cctpCfg.contracts ?? {};

  const destDomain =
    params.toChain === 'polygon'
      ? Number(domains.polygon ?? 7)
      : Number(domains.arbitrum ?? 3);
  if (!Number.isFinite(destDomain)) throw new Error('Invalid destination domain');

  const tokenMessenger =
    params.fromChain === 'polygon'
      ? contracts?.polygon?.tokenMessenger
      : contracts?.arbitrum?.tokenMessenger;
  const messageTransmitter =
    params.toChain === 'polygon'
      ? contracts?.polygon?.messageTransmitter
      : contracts?.arbitrum?.messageTransmitter;

  const tokenMessengerAddr = normalizeAddress(String(tokenMessenger ?? ''));
  const transmitterAddr = normalizeAddress(String(messageTransmitter ?? ''));

  // Convert amount in USDC decimals.
  const rawAmount = ethers.utils.parseUnits(String(amount), usdcFrom.decimals);

  // Approve TokenMessenger if needed.
  const shouldApprove = params.approve !== false;
  if (shouldApprove) {
    const allowance = await getErc20Allowance({
      provider: fromProvider,
      token: usdcFrom.address,
      owner: fromWallet.address,
      spender: tokenMessengerAddr,
    });
    if (allowance.lt(rawAmount)) {
      const approval = await approveErc20({
        signer: fromWallet,
        token: usdcFrom.address,
        spender: tokenMessengerAddr,
        amount: rawAmount,
      });
      await fromProvider.waitForTransaction(approval.txHash, 1);
    }
  }

  // Burn and emit message.
  const messenger = new ethers.Contract(tokenMessengerAddr, TOKEN_MESSENGER_ABI, fromWallet);
  const burnTx = await messenger.depositForBurn(rawAmount, destDomain, mintRecipient, usdcFrom.address);
  const fromTxHash = String(burnTx.hash ?? '');
  await fromProvider.waitForTransaction(fromTxHash, 1);

  // Fetch message from Circle Iris API by tx hash.
  const irisBase = String(cctpCfg.irisBaseUrl ?? 'https://iris-api.circle.com').replace(/\/+$/, '');
  const fromDomain =
    params.fromChain === 'polygon'
      ? Number(domains.polygon ?? 7)
      : Number(domains.arbitrum ?? 3);
  const messageUrl = `${irisBase}/v1/messages/${fromDomain}/${fromTxHash}`;

  const messageResp = await fetchJson(messageUrl);
  const first = Array.isArray(messageResp?.messages) ? messageResp.messages[0] : null;
  const message = String(first?.message ?? '');
  if (!message || !message.startsWith('0x')) {
    throw new Error('Failed to fetch CCTP message from Iris API');
  }
  const messageHash = ethers.utils.keccak256(message);

  const pollSeconds = Math.max(2, Math.min(30, Number(params.pollSeconds ?? 5) || 5));
  const maxWaitSeconds = Math.max(30, Math.min(30 * 60, Number(params.maxWaitSeconds ?? 300) || 300));
  const deadline = Date.now() + maxWaitSeconds * 1000;

  let attestation = String(first?.attestation ?? '');
  let attestationStatus = String(first?.attestationStatus ?? first?.status ?? 'unknown');

  // Poll attestations endpoint if not complete.
  while ((!attestation || attestationStatus !== 'complete') && Date.now() < deadline) {
    const attestUrl = `${irisBase}/v1/attestations/${messageHash}`;
    const att = await fetchJson(attestUrl);
    attestationStatus = String(att?.status ?? 'unknown');
    attestation = String(att?.attestation ?? '');
    if (attestation && attestationStatus === 'complete') break;
    await new Promise((r) => setTimeout(r, pollSeconds * 1000));
  }

  if (!attestation || attestationStatus !== 'complete') {
    throw new Error(`Attestation not complete (status=${attestationStatus})`);
  }

  // Receive on destination chain.
  const transmitter = new ethers.Contract(transmitterAddr, MESSAGE_TRANSMITTER_ABI, toWallet);
  const recvTx = await transmitter.receiveMessage(message, attestation);
  const toTxHash = String(recvTx.hash ?? '');
  await toProvider.waitForTransaction(toTxHash, 1);

  return { fromTxHash, messageHash, attestationStatus, toTxHash };
}

