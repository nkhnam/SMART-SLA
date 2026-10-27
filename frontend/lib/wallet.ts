import type { TypedDataPayload } from "./live-api";

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export class WalletFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletFlowError";
  }
}

export function getInjectedWallet(): Eip1193Provider {
  if (typeof window === "undefined" || !window.ethereum) throw new WalletFlowError("No EIP-1193 wallet was detected in this browser.");
  return window.ethereum;
}

export async function requestWalletAccounts(provider: Eip1193Provider): Promise<`0x${string}`[]> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || accounts.length === 0 || accounts.some((item) => typeof item !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(item))) {
    throw new WalletFlowError("The wallet did not return a valid account.");
  }
  return accounts as `0x${string}`[];
}

export async function ensureWalletChain(provider: Eip1193Provider, expectedChainId: number): Promise<void> {
  if (!Number.isSafeInteger(expectedChainId) || expectedChainId < 1) throw new WalletFlowError("The agreement contains an invalid chain ID.");
  const targetChainId = `0x${expectedChainId.toString(16)}`;
  const current = await provider.request({ method: "eth_chainId" });
  if (typeof current !== "string" || !/^0x[0-9a-fA-F]+$/.test(current)) throw new WalletFlowError("The wallet returned an invalid chain ID.");
  if (BigInt(current) !== BigInt(expectedChainId)) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainId }] });
    } catch {
      throw new WalletFlowError(expectedChainId === 43113
        ? "Switch your wallet to Avalanche Fuji, then retry."
        : `Switch your wallet to chain ${expectedChainId}, then retry.`);
    }
  }
  const active = await provider.request({ method: "eth_chainId" });
  if (typeof active !== "string" || BigInt(active) !== BigInt(expectedChainId)) throw new WalletFlowError("The wallet is still connected to the wrong network.");
}

export async function signWalletTypedData(provider: Eip1193Provider, account: string, typedData: TypedDataPayload): Promise<`0x${string}`> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw new WalletFlowError("The selected wallet account is invalid.");
  const signature = await provider.request({
    method: "eth_signTypedData_v4",
    params: [account, JSON.stringify(typedData, (_, value) => typeof value === "bigint" ? value.toString() : value)]
  });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new WalletFlowError("The wallet returned an invalid EIP-712 signature.");
  return signature as `0x${string}`;
}
