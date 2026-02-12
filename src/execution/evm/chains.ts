export type EvmChain = 'polygon' | 'arbitrum';

export function getRpcUrl(config: any, chain: EvmChain): string | null {
  const fromCfg =
    config?.evm?.rpcUrls?.[chain] ??
    config?.wallet?.rpcUrls?.[chain] ??
    null;

  const fromEnv =
    chain === 'polygon'
      ? process.env.THUFIR_EVM_RPC_POLYGON
      : process.env.THUFIR_EVM_RPC_ARBITRUM;

  const rpc = String(fromCfg ?? fromEnv ?? '').trim();
  return rpc ? rpc : null;
}

export function getUsdcConfig(config: any, chain: EvmChain): { address: string; decimals: number } {
  const entry = config?.evm?.usdc?.[chain];
  const address =
    typeof entry?.address === 'string' && entry.address.trim().length > 0
      ? entry.address.trim()
      : chain === 'polygon'
        ? '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
        : '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
  const decimals = typeof entry?.decimals === 'number' ? entry.decimals : 6;
  return { address, decimals };
}

