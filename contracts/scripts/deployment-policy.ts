import { getAddress, zeroAddress, type Address, type Hex } from "viem";

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
  const policy = getFujiExecutionPolicy(environment);
  if (policy.approvedContract === "EvidenceRegistry" && !/^0x[0-9a-fA-F]{64}$/.test(environment.FUJI_AGREEMENT_DEPLOYMENT_TX_HASH ?? "")) throw new Error("Set FUJI_AGREEMENT_DEPLOYMENT_TX_HASH from the verified first receipt.");
}

export function getFujiExecutionPolicy(environment: Record<string, string | undefined>) {
  const integer = (name: string, allowZero = false) => {
    const value = environment[name];
    if (!value || !/^(0|[1-9][0-9]*)$/.test(value) || (!allowZero && BigInt(value) === 0n)) throw new Error(`Set a valid public ${name}.`);
    return BigInt(value);
  };
  const gasPrice = integer("FUJI_GAS_PRICE_WEI");
  const agreementGas = integer("FUJI_AGREEMENT_GAS_LIMIT");
  const evidenceGas = integer("FUJI_EVIDENCE_GAS_LIMIT");
  const maxTotalFee = integer("FUJI_MAX_DEPLOYMENT_FEE_WEI");
  const startNonce = integer("FUJI_DEPLOYER_START_NONCE", true);
  if (startNonce >= BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("FUJI_DEPLOYER_START_NONCE out of range.");
  if (maxTotalFee > 2_000_000_000_000_000n || (agreementGas + evidenceGas) * gasPrice > maxTotalFee) throw new Error("Fuji deployment fee envelope exceeded.");
  const approvedContract = environment.FUJI_APPROVED_CONTRACT;
  if (approvedContract !== "AgreementRegistry" && approvedContract !== "EvidenceRegistry") throw new Error("Set FUJI_APPROVED_CONTRACT for one deployment only.");
  const initcodeHash = environment.FUJI_APPROVED_INITCODE_HASH;
  if (!initcodeHash || !/^0x[0-9a-fA-F]{64}$/.test(initcodeHash)) throw new Error("Set FUJI_APPROVED_INITCODE_HASH from the reviewed preview.");
  return { gasPrice, agreementGas, evidenceGas, maxTotalFee, startNonce: Number(startNonce), approvedContract, initcodeHash };
}

export function getFujiTransactionLimits(contract: "AgreementRegistry" | "EvidenceRegistry", observed: { latestNonce: number; pendingNonce: number; gasPrice: bigint; gasEstimate: bigint; initcodeHash: Hex; previousFee?: bigint }, environment: Record<string, string | undefined>) {
  const policy = getFujiExecutionPolicy(environment);
  if (policy.approvedContract !== contract || policy.initcodeHash.toLowerCase() !== observed.initcodeHash.toLowerCase()) throw new Error("Fuji contract/initcode differs from approval.");
  const nonce = policy.startNonce + (contract === "EvidenceRegistry" ? 1 : 0);
  if (observed.latestNonce !== nonce || observed.pendingNonce !== nonce) throw new Error("Fuji nonce changed or pending; reconcile before deployment.");
  const gas = contract === "AgreementRegistry" ? policy.agreementGas : policy.evidenceGas;
  if (observed.gasPrice > policy.gasPrice) throw new Error("Observed gas price exceeds approved fixed price.");
  if (observed.gasEstimate <= 0n || (observed.gasEstimate * 120n + 99n) / 100n > gas) throw new Error("Gas estimate exceeds approved gas limit with margin.");
  if (contract === "EvidenceRegistry" && (observed.previousFee === undefined || observed.previousFee < 0n || observed.previousFee + gas * policy.gasPrice > policy.maxTotalFee)) throw new Error("Second deployment exceeds remaining fee envelope or first fee is unverified.");
  return { gas, gasPrice: policy.gasPrice, nonce, value: 0n };
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
