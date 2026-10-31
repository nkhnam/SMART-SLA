import { network } from "hardhat";
import { assertDeployerIdentity, assertDeploymentTarget, FUJI_CHAIN_ID } from "./deployment-policy.js";

try {
  const connection = await network.create();
  const publicClient = await connection.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  assertDeploymentTarget(connection.networkName, chainId);
  const [deployer] = await connection.viem.getWalletClients();
  assertDeployerIdentity(chainId, deployer.account.address);
  const { contract: registry, deploymentTransaction } = await connection.viem.sendDeploymentTransaction("AgreementRegistry");
  if (chainId === FUJI_CHAIN_ID) process.stdout.write(`${JSON.stringify({ contract: "AgreementRegistry", transactionHash: deploymentTransaction.hash, state: "SUBMITTED" })}\n`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction.hash, confirmations: 1 });
  if (receipt.status !== "success" || receipt.contractAddress?.toLowerCase() !== registry.address.toLowerCase()) throw new Error("Deployment receipt verification failed.");
  process.stdout.write(`${JSON.stringify({ chainId, registryAddress: registry.address })}\n`);
  if (chainId === FUJI_CHAIN_ID) process.stdout.write(`${JSON.stringify({ contract: "AgreementRegistry", transactionHash: receipt.transactionHash, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash, status: receipt.status, gasUsed: String(receipt.gasUsed), effectiveGasPrice: String(receipt.effectiveGasPrice), deployer: deployer.account.address })}\n`);
} catch {
  process.stderr.write("AgreementRegistry deployment stopped. Check target, explicit approval, roles, deployer identity and receipt using the Fuji runbook; raw RPC errors are suppressed. A submission may already exist: reconcile its hash/nonce before retrying.\n");
  process.exitCode = 1;
}
