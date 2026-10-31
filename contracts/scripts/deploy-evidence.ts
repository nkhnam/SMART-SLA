import { getAddress } from "viem";
import { network } from "hardhat";
import { assertDeployerIdentity, assertDeploymentTarget, FUJI_CHAIN_ID, getFujiRoles } from "./deployment-policy.js";

try {
  const connection = await network.create();
  const publicClient = await connection.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  assertDeploymentTarget(connection.networkName, chainId);
  const [deployer] = await connection.viem.getWalletClients();
  assertDeployerIdentity(chainId, deployer.account.address);
  const configuredPublisher = process.env.EVIDENCE_PUBLISHER_ADDRESS;
  const publisher = chainId === FUJI_CHAIN_ID ? getFujiRoles(process.env).evidencePublisher : configuredPublisher ? getAddress(configuredPublisher) : deployer.account.address;
  const { contract: registry, deploymentTransaction } = await connection.viem.sendDeploymentTransaction("EvidenceRegistry", [publisher]);
  if (chainId === FUJI_CHAIN_ID) process.stdout.write(`${JSON.stringify({ contract: "EvidenceRegistry", transactionHash: deploymentTransaction.hash, state: "SUBMITTED" })}\n`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction.hash, confirmations: 1 });
  if (receipt.status !== "success" || receipt.contractAddress?.toLowerCase() !== registry.address.toLowerCase()) throw new Error("Deployment receipt verification failed.");
  if (getAddress(String(await registry.read.owner())) !== getAddress(deployer.account.address) || getAddress(String(await registry.read.publisher())) !== getAddress(publisher)) throw new Error("Evidence owner/publisher verification failed.");
  process.stdout.write(`${JSON.stringify({ chainId, registryAddress: registry.address, publisher })}\n`);
  if (chainId === FUJI_CHAIN_ID) process.stdout.write(`${JSON.stringify({ contract: "EvidenceRegistry", transactionHash: receipt.transactionHash, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash, status: receipt.status, gasUsed: String(receipt.gasUsed), effectiveGasPrice: String(receipt.effectiveGasPrice), owner: deployer.account.address, publisher })}\n`);
} catch {
  process.stderr.write("EvidenceRegistry deployment stopped. Check target, explicit approval, roles, deployer identity and receipt using the Fuji runbook; raw RPC errors are suppressed. A submission may already exist: reconcile its hash/nonce before retrying.\n");
  process.exitCode = 1;
}
