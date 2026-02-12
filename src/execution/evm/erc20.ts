import { ethers } from 'ethers';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function transfer(address to, uint256 value) returns (bool)',
];

export async function getErc20Decimals(provider: ethers.providers.Provider, token: string): Promise<number> {
  const contract = new ethers.Contract(token, ERC20_ABI, provider);
  const decimals = await contract.decimals();
  return Number(decimals);
}

export async function getErc20Balance(params: {
  provider: ethers.providers.Provider;
  token: string;
  owner: string;
}): Promise<{ raw: string; decimals: number; formatted: string }> {
  const contract = new ethers.Contract(params.token, ERC20_ABI, params.provider);
  const [raw, decimals] = await Promise.all([
    contract.balanceOf(params.owner),
    contract.decimals(),
  ]);
  const dec = Number(decimals);
  return {
    raw: raw.toString(),
    decimals: dec,
    formatted: ethers.utils.formatUnits(raw, dec),
  };
}

export async function getErc20Allowance(params: {
  provider: ethers.providers.Provider;
  token: string;
  owner: string;
  spender: string;
}): Promise<ethers.BigNumber> {
  const contract = new ethers.Contract(params.token, ERC20_ABI, params.provider);
  return contract.allowance(params.owner, params.spender);
}

export async function approveErc20(params: {
  signer: ethers.Signer;
  token: string;
  spender: string;
  amount: ethers.BigNumberish;
}): Promise<{ txHash: string }> {
  const contract = new ethers.Contract(params.token, ERC20_ABI, params.signer);
  const tx = await contract.approve(params.spender, params.amount);
  return { txHash: String(tx.hash ?? '') };
}

export async function transferErc20(params: {
  signer: ethers.Signer;
  token: string;
  to: string;
  amount: ethers.BigNumberish;
}): Promise<{ txHash: string }> {
  const contract = new ethers.Contract(params.token, ERC20_ABI, params.signer);
  const tx = await contract.transfer(params.to, params.amount);
  return { txHash: String(tx.hash ?? '') };
}

