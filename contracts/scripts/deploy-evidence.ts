import { getAddress } from "viem";
import { network } from "hardhat";

const { viem } = await network.create();
const [deployer] = await viem.getWalletClients();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
const configuredPublisher = process.env.EVIDENCE_PUBLISHER_ADDRESS;
if (chainId === 43113 && !configuredPublisher) throw new Error("Set EVIDENCE_PUBLISHER_ADDRESS before deploying the Fuji evidence registry.");
const publisher = configuredPublisher ? getAddress(configuredPublisher) : deployer.account.address;
const registry = await viem.deployContract("EvidenceRegistry", [publisher]);
process.stdout.write(`${JSON.stringify({ chainId, registryAddress: registry.address, publisher })}\n`);
