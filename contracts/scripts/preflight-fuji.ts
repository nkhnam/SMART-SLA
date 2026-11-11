import { artifacts } from "hardhat";
import { readFile } from "node:fs/promises";
import { createPublicClient, encodeDeployData, formatEther, getAddress, getContractAddress, http, keccak256, parseAbi, type Hex } from "viem";
import { FUJI_CHAIN_ID, FUJI_RPC_URL, getFujiRoles, matchesRuntimeBytecode } from "./deployment-policy.js";

const blockers: string[] = [];
const report: Record<string, unknown> = { readOnly: true, deploymentAuthorized: false, observedAt: new Date().toISOString(), blockers };
const addresses = [process.env.BLOCKCHAIN_REGISTRY_ADDRESS, process.env.EVIDENCE_REGISTRY_ADDRESS];
const postDeployment = addresses.every(Boolean);
report.phase = postDeployment ? "POST_DEPLOYMENT_IDENTITY" : "PRE_DEPLOYMENT_PLANNING";
const makeClient = (url: string) => {
  if (new URL(url).protocol !== "https:") throw new Error("Fuji RPC must use HTTPS.");
  return createPublicClient({ transport: http(url, { timeout: 15_000, retryCount: 0 }), cacheTime: 0 });
};

try {
  const client = makeClient(process.env.AVALANCHE_FUJI_RPC_URL ?? FUJI_RPC_URL);
  const chainId = await client.getChainId();
  report.chainId = chainId;
  if (chainId !== FUJI_CHAIN_ID) throw new Error("Unexpected chain.");
  const head = await client.getBlock({ blockTag: "latest" });
  const gasPrice = await client.getGasPrice();
  report.rpc = { chainId, blockNumber: String(head.number), blockHash: head.hash, blockTimestamp: String(head.timestamp), gasLimit: String(head.gasLimit), gasPriceWei: String(gasPrice) };
  for (const prefix of ["BLOCKCHAIN", "EVIDENCE"] as const) {
    const rpc = process.env[`${prefix}_RPC_URL`];
    const configuredId = process.env[`${prefix}_CHAIN_ID`];
    if (configuredId && configuredId !== String(FUJI_CHAIN_ID)) blockers.push(`${prefix}_CHAIN_ID must be 43113.`);
    if (rpc) {
      try {
        if (await makeClient(rpc).getChainId() !== FUJI_CHAIN_ID) blockers.push(`${prefix} RPC is not Fuji.`);
      } catch { blockers.push(`${prefix} RPC could not be verified; endpoint details suppressed.`); }
    }
  }

  const agreement = await artifacts.readArtifact("AgreementRegistry");
  const evidence = await artifacts.readArtifact("EvidenceRegistry");
  report.artifacts = [agreement, evidence].map((artifact) => ({ contract: artifact.contractName, buildInfoId: artifact.buildInfoId, initcodeHash: keccak256(artifact.bytecode as Hex), runtimeTemplateHash: keccak256(artifact.deployedBytecode as Hex), initcodeBytes: (artifact.bytecode.length - 2) / 2, runtimeBytes: (artifact.deployedBytecode.length - 2) / 2 }));
  for (const artifact of [agreement, evidence]) {
    const build = artifact.buildInfoId ? await artifacts.getBuildInfoPath(artifact.buildInfoId) : undefined;
    if (!build) blockers.push(`${artifact.contractName} build metadata missing.`);
    else {
      const metadata = JSON.parse(await readFile(build, "utf8"));
      const settings = metadata.input?.settings;
      if (metadata.solcVersion !== "0.8.38" || settings?.evmVersion !== "cancun" || !settings.optimizer?.enabled || settings.optimizer.runs !== 200) blockers.push(`${artifact.contractName} compiler metadata differs from pinned solc 0.8.38/Cancun/optimizer 200.`);
    }
    if ((artifact.deployedBytecode.length - 2) / 2 > 24576 || (artifact.bytecode.length - 2) / 2 > 49152) blockers.push(`${artifact.contractName} exceeds EVM code size limits.`);
  }

  let roles: ReturnType<typeof getFujiRoles> | undefined;
  try { roles = getFujiRoles(process.env); }
  catch (error) { blockers.push(error instanceof Error ? error.message : "Public role configuration invalid."); }
  if (roles) {
    report.roles = roles;
    const balances: Record<string, unknown> = {};
    for (const [role, address] of Object.entries(roles)) {
      const balance = await client.getBalance({ address, blockNumber: head.number });
      const latestNonce = await client.getTransactionCount({ address, blockNumber: head.number });
      const pendingNonce = await client.getTransactionCount({ address, blockTag: "pending" });
      const code = await client.getCode({ address, blockNumber: head.number });
      if (code && code !== "0x") blockers.push(`${role} must be a dedicated EOA for the existing signing/deployment flow.`);
      if (latestNonce !== pendingNonce) blockers.push(`${role} has pending transactions; reconcile before deployment.`);
      balances[role] = { address, balanceWei: String(balance), balanceAvax: formatEther(balance), latestNonce, pendingNonce };
    }
    report.accounts = balances;
    if (!postDeployment) {
      const nonce = await client.getTransactionCount({ address: roles.deployer, blockTag: "pending" });
      report.predictedAddresses = { agreement: getContractAddress({ from: roles.deployer, nonce: BigInt(nonce) }), evidence: getContractAddress({ from: roles.deployer, nonce: BigInt(nonce + 1) }), conditional: "Only if both deployments use this deployer, in this order, with no intervening transaction; not deployed addresses." };
      let totalBudget = 0n;
      let estimatesComplete = true;
      const estimates: Record<string, unknown> = {};
      for (const artifact of [agreement, evidence]) {
        const args = [artifact.contractName === "EvidenceRegistry" ? roles.evidencePublisher : roles.agreementRelayer];
        const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode as Hex, args });
        try {
          const gas = await client.estimateGas({ account: roles.deployer, data });
          const gasLimit = (gas * 120n + 99n) / 100n;
          const budgetWei = gasLimit * gasPrice * 2n;
          totalBudget += budgetWei;
          estimates[artifact.contractName] = { gas: String(gas), gasLimitWith20PercentMargin: String(gasLimit), planningGasPriceWei: String(gasPrice * 2n), budgetWei: String(budgetWei), budgetAvax: formatEther(budgetWei) };
        } catch {
          estimatesComplete = false;
          blockers.push(`${artifact.contractName} gas estimate unavailable; an unfunded sender or RPC execution policy may reject estimation. No transaction sent.`);
        }
      }
      report.deploymentEstimates = estimates;
      report.deployerBudget = { complete: estimatesComplete, wei: String(totalBudget), avax: formatEther(totalBudget), policy: "20% gas margin and 2x observed gas price; a planning allowance, not a transaction fee cap. Re-estimate immediately before approved execution." };
      if (estimatesComplete && await client.getBalance({ address: roles.deployer }) < totalBudget) blockers.push("Deployer balance is below the estimated deployment budget; funding requires separate approval.");
      report.relayerBudget = "Estimate registerAgreement with the actual approved bilateral signatures and commitEvidence with the actual authorized batch after deployment. Budget each account separately: ceil(gas*1.2) * (2*gasPrice) * approved operation count, plus an explicit reserve. No signatures are generated by preflight.";
    }
  }

  if (addresses.some(Boolean) && !addresses.every(Boolean)) blockers.push("Post-deployment verification requires both registry addresses.");
  if (addresses.every(Boolean) && roles) {
    const checked: Record<string, unknown> = {};
    for (const [index, artifact] of [agreement, evidence].entries()) {
      const address = getAddress(addresses[index]!);
      const code = await client.getCode({ address, blockNumber: head.number });
      if (!code || !matchesRuntimeBytecode(code, artifact.deployedBytecode, artifact.immutableReferences ?? {})) throw new Error("Runtime bytecode mismatch.");
      checked[artifact.contractName] = { address, runtimeHash: keccak256(code), artifactMatchExcludingImmutables: true };
    }
    const domain = await client.readContract({ address: getAddress(addresses[0]!), abi: parseAbi(["function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)"]), functionName: "eip712Domain", blockNumber: head.number });
    if (domain[1] !== "SLA-DEX Agreement Registry" || domain[2] !== "1" || domain[3] !== BigInt(FUJI_CHAIN_ID) || getAddress(domain[4]) !== getAddress(addresses[0]!)) throw new Error("Agreement EIP-712 domain mismatch.");
    const address = getAddress(addresses[1]!);
    const ownershipAbi = parseAbi(["function owner() view returns (address)", "function publisher() view returns (address)"]);
    const agreementOwner = await client.readContract({ address: getAddress(addresses[0]!), abi: ownershipAbi, functionName: "owner", blockNumber: head.number });
    const agreementPublisher = await client.readContract({ address: getAddress(addresses[0]!), abi: ownershipAbi, functionName: "publisher", blockNumber: head.number });
    if (getAddress(agreementOwner) !== roles.deployer || getAddress(agreementPublisher) !== roles.agreementRelayer) throw new Error("Agreement owner/publisher mismatch.");
    const owner = await client.readContract({ address, abi: ownershipAbi, functionName: "owner", blockNumber: head.number });
    const publisher = await client.readContract({ address, abi: ownershipAbi, functionName: "publisher", blockNumber: head.number });
    if (getAddress(owner) !== roles.deployer || getAddress(publisher) !== roles.evidencePublisher) throw new Error("Evidence owner/publisher mismatch.");
    report.registries = { ...checked, agreementOwner, agreementPublisher, owner, publisher, domain: { name: domain[1], version: domain[2], chainId: String(domain[3]), verifyingContract: domain[4] } };
  } else report.registries = "NOT_DEPLOYED_OR_NOT_CONFIGURED: no deployment or ownership claim.";
  if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash) blockers.push("RPC block identity changed during preflight; repeat against a trusted endpoint.");
  report.result = blockers.length ? "NO_GO" : "READ_ONLY_CHECKS_PASS_SEPARATE_APPROVAL_REQUIRED";
} catch {
  blockers.push("Fuji preflight failed: check HTTPS RPC/chain, artifacts and registry identities. Raw errors and endpoint details are suppressed.");
  report.result = "NO_GO";
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (blockers.length) process.exitCode = 1;
