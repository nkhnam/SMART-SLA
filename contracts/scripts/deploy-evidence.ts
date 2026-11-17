import { custom, encodeDeployData, getAddress, getContractAddress, keccak256, type Hex } from "viem";
import { avalancheFuji } from "viem/chains";
import { readPrivateDeployerWallet } from "./private-deployer.js";
import { artifacts, network } from "hardhat";
import { assertDeployerIdentity, assertDeploymentTarget, FUJI_CHAIN_ID, getFujiRoles, getFujiExecutionPolicy, getFujiTransactionLimits, matchesRuntimeBytecode } from "./deployment-policy.js";

try {
  const connection = await network.create();
  const publicClient = await connection.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  assertDeploymentTarget(connection.networkName, chainId);
  const deployer = chainId === FUJI_CHAIN_ID
    ? await readPrivateDeployerWallet(process.stdin, getFujiRoles(process.env).deployer, avalancheFuji, custom(publicClient))
    : (await connection.viem.getWalletClients())[0];
  assertDeployerIdentity(chainId, deployer.account.address);
  const configuredPublisher = process.env.EVIDENCE_PUBLISHER_ADDRESS;
  const publisher = chainId === FUJI_CHAIN_ID ? getFujiRoles(process.env).evidencePublisher : configuredPublisher ? getAddress(configuredPublisher) : deployer.account.address;
  const artifact = await artifacts.readArtifact("EvidenceRegistry");
  const { contract: registry, deploymentTransaction } = await (async () => {
    if (chainId !== FUJI_CHAIN_ID) return connection.viem.sendDeploymentTransaction("EvidenceRegistry", [publisher]);
    const policy = getFujiExecutionPolicy(process.env);
    if (policy.approvedContract !== "EvidenceRegistry") throw new Error("Contract approval mismatch.");
    const agreementAddress = getContractAddress({ from: deployer.account.address, nonce: BigInt(policy.startNonce) });
    const agreementArtifact = await artifacts.readArtifact("AgreementRegistry");
    const firstHash = process.env.FUJI_AGREEMENT_DEPLOYMENT_TX_HASH as Hex;
    const firstReceipt = await publicClient.getTransactionReceipt({ hash: firstHash });
    const firstTransaction = await publicClient.getTransaction({ hash: firstHash });
    const firstData = encodeDeployData({ abi: agreementArtifact.abi, bytecode: agreementArtifact.bytecode as Hex, args: [getFujiRoles(process.env).agreementRelayer] });
    if (firstReceipt.status !== "success" || firstReceipt.contractAddress?.toLowerCase() !== agreementAddress.toLowerCase()
      || firstTransaction.from.toLowerCase() !== deployer.account.address.toLowerCase() || firstTransaction.nonce !== policy.startNonce
      || firstTransaction.chainId !== FUJI_CHAIN_ID || firstTransaction.to !== null || firstTransaction.value !== 0n
      || keccak256(firstTransaction.input) !== keccak256(firstData)
      || (await publicClient.getBlock({ blockNumber: firstReceipt.blockNumber })).hash !== firstReceipt.blockHash) throw new Error("First deployment receipt/transaction proof mismatch.");
    const previousFee = firstReceipt.gasUsed * firstReceipt.effectiveGasPrice;
    const agreementCode = await publicClient.getCode({ address: agreementAddress });
    if (!agreementCode || !matchesRuntimeBytecode(agreementCode, agreementArtifact.deployedBytecode, agreementArtifact.immutableReferences ?? {})) throw new Error("Verify the first deployment before proceeding.");
    const agreementOwner = await publicClient.readContract({ address: agreementAddress, abi: agreementArtifact.abi, functionName: "owner" });
    const agreementPublisher = await publicClient.readContract({ address: agreementAddress, abi: agreementArtifact.abi, functionName: "publisher" });
    if (getAddress(String(agreementOwner)) !== getAddress(deployer.account.address) || getAddress(String(agreementPublisher)) !== getFujiRoles(process.env).agreementRelayer) throw new Error("Agreement owner/publisher mismatch.");
    const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode as Hex, args: [publisher] });
    const latestNonce = await publicClient.getTransactionCount({ address: deployer.account.address, blockTag: "latest" });
    const pendingNonce = await publicClient.getTransactionCount({ address: deployer.account.address, blockTag: "pending" });
    const gasEstimate = await publicClient.estimateGas({ account: deployer.account.address, data });
    const gasPrice = await publicClient.getGasPrice();
    const limits = getFujiTransactionLimits("EvidenceRegistry", { latestNonce, pendingNonce, gasEstimate, gasPrice, initcodeHash: keccak256(data), previousFee }, process.env);
    const hash = await deployer.sendTransaction({ data, ...limits });
    return { contract: { address: getContractAddress({ from: deployer.account.address, nonce: BigInt(limits.nonce) }) }, deploymentTransaction: { hash } };
  })();
  if (chainId === FUJI_CHAIN_ID) process.stdout.write(`${JSON.stringify({ contract: "EvidenceRegistry", transactionHash: deploymentTransaction.hash, state: "SUBMITTED" })}\n`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction.hash, confirmations: 1 });
  if (receipt.status !== "success" || receipt.contractAddress?.toLowerCase() !== registry.address.toLowerCase()) throw new Error("Deployment receipt verification failed.");
  const owner = await publicClient.readContract({ address: registry.address, abi: artifact.abi, functionName: "owner" });
  const actualPublisher = await publicClient.readContract({ address: registry.address, abi: artifact.abi, functionName: "publisher" });
  if (getAddress(String(owner)) !== getAddress(deployer.account.address) || getAddress(String(actualPublisher)) !== getAddress(publisher)) throw new Error("Evidence owner/publisher verification failed.");
  process.stdout.write(`${JSON.stringify({ chainId, registryAddress: registry.address, publisher })}\n`);
  if (chainId === FUJI_CHAIN_ID) process.stdout.write(`${JSON.stringify({ contract: "EvidenceRegistry", transactionHash: receipt.transactionHash, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash, status: receipt.status, gasUsed: String(receipt.gasUsed), effectiveGasPrice: String(receipt.effectiveGasPrice), owner: deployer.account.address, publisher })}\n`);
} catch {
  process.stderr.write("EvidenceRegistry deployment stopped. Check target, explicit approval, roles, deployer identity and receipt using the Fuji runbook; raw RPC errors are suppressed. A submission may already exist: reconcile its hash/nonce before retrying.\n");
  process.exitCode = 1;
}
