import { ServiceUnavailableException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createPublicClient, getAddress, http, type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AppEnvironment } from "../config/env.schema.js";

@Injectable()
export class BlockchainNetworkService {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  getConfiguredDomain() {
    const chainId = this.config.get("BLOCKCHAIN_CHAIN_ID", { infer: true });
    const registryAddress = this.config.get("BLOCKCHAIN_REGISTRY_ADDRESS", { infer: true });
    if (!chainId || !registryAddress) throw new ServiceUnavailableException("Blockchain signing is not configured.");
    return { chainId, registryAddress: getAddress(registryAddress) };
  }

  getSigningConfiguration() {
    return this.getConfiguredDomain();
  }

  async getSigningContext() {
    const rpcUrl = this.config.get("BLOCKCHAIN_RPC_URL", { infer: true });
    if (!rpcUrl) {
      throw new ServiceUnavailableException("Blockchain signing is not configured.");
    }
    const { chainId: expectedChainId, registryAddress } = this.getConfiguredDomain();
    const client = createPublicClient({ transport: http(rpcUrl) });
    let connectedChainId: number;
    try {
      connectedChainId = await client.getChainId();
    } catch {
      throw new ServiceUnavailableException("The configured blockchain RPC is unavailable.");
    }
    if (connectedChainId !== expectedChainId) {
      throw new ServiceUnavailableException("The configured blockchain RPC returned an unexpected chain ID.");
    }
    return { client, chainId: expectedChainId, registryAddress: getAddress(registryAddress), rpcUrl };
  }

  isAnchorConfigured(): boolean {
    return Boolean(
      this.config.get("BLOCKCHAIN_RPC_URL", { infer: true })
      && this.config.get("BLOCKCHAIN_CHAIN_ID", { infer: true })
      && this.config.get("BLOCKCHAIN_REGISTRY_ADDRESS", { infer: true })
      && this.config.get("BLOCKCHAIN_RELAYER_PRIVATE_KEY", { infer: true })
    );
  }

  getRelayerAccount(): PrivateKeyAccount {
    const privateKey = this.config.get("BLOCKCHAIN_RELAYER_PRIVATE_KEY", { infer: true });
    if (!privateKey) throw new ServiceUnavailableException("Agreement anchoring is not configured.");
    return privateKeyToAccount(privateKey as `0x${string}`);
  }

  getRelayerAccountContext() {
    return { account: this.getRelayerAccount() };
  }

  getConfirmationCount(): number {
    return this.config.getOrThrow("BLOCKCHAIN_CONFIRMATIONS", { infer: true });
  }
}
