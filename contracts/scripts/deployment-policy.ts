import { getAddress, zeroAddress, type Address } from "viem";

export const FUJI_CHAIN_ID = 43113;
export const FUJI_RPC_URL = "https://api.avax-test.network/ext/bc/C/rpc";

export function getFujiRoles(environment: Record<string, string | undefined>) {
  const names = ["FUJI_DEPLOYER_ADDRESS", "AGREEMENT_RELAYER_ADDRESS", "EVIDENCE_PUBLISHER_ADDRESS", "BUYER_SIGNER_ADDRESS", "SUPPLIER_SIGNER_ADDRESS"] as const;
  const addresses = names.map((name) => {
    const value = environment[name];
    if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`Set a valid public ${name}.`);
    const address = getAddress(value);
    if (address === zeroAddress) throw new Error(`${name} must be nonzero.`);
    return address;
  });
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== names.length) throw new Error("All five Fuji roles must use distinct addresses.");
  const [deployer, agreementRelayer, evidencePublisher, buyerSigner, supplierSigner] = addresses as [Address, Address, Address, Address, Address];
  return { deployer, agreementRelayer, evidencePublisher, buyerSigner, supplierSigner };
}

export function assertDeploymentTarget(networkName: string, chainId: number, environment: Record<string, string | undefined> = process.env): void {
  if ((networkName === "hardhatMainnet" || networkName === "localEvm") && chainId === 31337) return;
  if (networkName !== "avalancheFuji" || chainId !== FUJI_CHAIN_ID) throw new Error("Deployment target rejected: only named local chain 31337 or avalancheFuji chain 43113 is permitted.");
  if (environment.FUJI_DEPLOYMENT_APPROVED !== String(FUJI_CHAIN_ID)) throw new Error("Set FUJI_DEPLOYMENT_APPROVED=43113 only after separate Fuji deployment approval.");
  getFujiRoles(environment);
}

export function assertDeployerIdentity(chainId: number, address: Address, environment: Record<string, string | undefined> = process.env): void {
  if (chainId === FUJI_CHAIN_ID && getAddress(address) !== getFujiRoles(environment).deployer) throw new Error("Fuji deployer does not match FUJI_DEPLOYER_ADDRESS.");
}

export function matchesRuntimeBytecode(actual: string, expected: string, immutableReferences: Record<string, Array<{ start: number; length: number }>>): boolean {
  if (actual === "0x" || actual.length !== expected.length) return false;
  const mask = (code: string) => {
    let masked = code.toLowerCase();
    for (const references of Object.values(immutableReferences)) {
      for (const { start, length } of references) {
        const offset = 2 + start * 2;
        masked = masked.slice(0, offset) + "0".repeat(length * 2) + masked.slice(offset + length * 2);
      }
    }
    return masked;
  };
  return mask(actual) === mask(expected);
}
