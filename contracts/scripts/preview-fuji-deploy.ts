import { artifacts } from "hardhat";
import { readFile } from "node:fs/promises";
import { createPublicClient, encodeDeployData, formatEther, getContractAddress, http, keccak256, type Hex } from "viem";
import { FUJI_CHAIN_ID, FUJI_RPC_URL, getFujiExecutionPolicy, getFujiRoles, getFujiTransactionLimits } from "./deployment-policy.js";

try {
  const draft = JSON.parse(await readFile("fuji-deployment-draft.json", "utf8"));
  const roles = getFujiRoles(draft);
  const client = createPublicClient({ transport: http(FUJI_RPC_URL, { timeout: 15_000, retryCount: 0 }), cacheTime: 0 });
  if (await client.getChainId() !== FUJI_CHAIN_ID) throw new Error();
  const head = await client.getBlock();
  const independent = createPublicClient({ transport: http("https://avalanche-fuji-c-chain-rpc.publicnode.com", { timeout: 15_000, retryCount: 0 }), cacheTime: 0 });
  if (await independent.getChainId() !== FUJI_CHAIN_ID || (await independent.getBlock({ blockNumber: head.number })).hash !== head.hash) throw new Error();
  const nonce = await client.getTransactionCount({ address: roles.deployer, blockTag: "pending" });
  if (await client.getTransactionCount({ address: roles.deployer, blockTag: "latest" }) !== nonce) throw new Error();
  const code = await client.getCode({ address: roles.deployer });
  if (code && code !== "0x") throw new Error();
  const observedGasPrice = await client.getGasPrice();
  if (typeof draft.FUJI_MAX_GAS_PRICE_WEI !== "string" || !/^[1-9][0-9]*$/.test(draft.FUJI_MAX_GAS_PRICE_WEI)) throw new Error();
  const proposedGasPrice = observedGasPrice * 2n;
  if (proposedGasPrice > BigInt(draft.FUJI_MAX_GAS_PRICE_WEI)) throw new Error();
  const balance = await client.getBalance({ address: roles.deployer });
  const items = [];
  let maximumFee = 0n;
  for (const [offset, contract] of (["AgreementRegistry", "EvidenceRegistry"] as const).entries()) {
    const artifact = await artifacts.readArtifact(contract);
    const args = [contract === "EvidenceRegistry" ? roles.evidencePublisher : roles.agreementRelayer];
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode as Hex, args });
    const initcodeHash = keccak256(data);
    const environment = { ...draft, FUJI_GAS_PRICE_WEI: String(proposedGasPrice), FUJI_DEPLOYER_START_NONCE: String(nonce), FUJI_APPROVED_CONTRACT: contract, FUJI_APPROVED_INITCODE_HASH: initcodeHash };
    const policy = getFujiExecutionPolicy(environment);
    const estimate = await client.estimateGas({ account: roles.deployer, data });
    const limits = getFujiTransactionLimits(contract, { latestNonce: nonce + offset, pendingNonce: nonce + offset, gasPrice: observedGasPrice, gasEstimate: estimate, initcodeHash, previousFee: maximumFee }, environment);
    const fee = limits.gas * limits.gasPrice;
    maximumFee += fee;
    items.push({ contract, chainId: FUJI_CHAIN_ID, from: roles.deployer, nonce: limits.nonce, to: null, valueWei: "0", predictedAddress: getContractAddress({ from: roles.deployer, nonce: BigInt(limits.nonce) }), constructorArgs: args, initcodeHash, artifactBuildInfoId: artifact.buildInfoId, gasEstimate: String(estimate), gasLimit: String(limits.gas), fixedGasPriceWei: String(limits.gasPrice), maximumFeeWei: String(fee), maximumFeeAvax: formatEther(fee), totalFeeEnvelopeWei: String(policy.maxTotalFee) });
  }
  if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash || await client.getTransactionCount({ address: roles.deployer, blockTag: "pending" }) !== nonce) throw new Error();
  process.stdout.write(`${JSON.stringify({ readOnly: true, deploymentAuthorized: false, signerVerified: false, independentBlockMatch: true, observedAt: new Date().toISOString(), blockNumber: String(head.number), blockHash: head.hash, observedGasPriceWei: String(observedGasPrice), deployerBalanceWei: String(balance), totalMaximumFeeWei: String(maximumFee), fundingSufficient: balance >= maximumFee, items, condition: "Draft only. Second nonce/address assumes successful first deployment and no intervening transaction. Re-read all live inputs and independently approve each contract/hash/nonce/fee before execution." }, null, 2)}\n`);
} catch {
  process.stderr.write("Fuji preview failed: verify draft limits, artifacts, RPC identity, nonce and gas estimates. No signature or transaction was produced.\n");
  process.exitCode = 1;
}
