import { network } from "hardhat";

const { viem } = await network.create();
const registry = await viem.deployContract("AgreementRegistry");
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();
process.stdout.write(`${JSON.stringify({ chainId, registryAddress: registry.address })}\n`);
