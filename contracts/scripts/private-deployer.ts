import { createWalletClient, getAddress, type Address, type Chain, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export async function readPrivateDeployerWallet(input: AsyncIterable<string | Buffer>, expected: Address, chain: Chain, transport: Transport) {
  let secret = "";
  try {
    for await (const chunk of input) {
      secret += chunk.toString();
      if (Buffer.byteLength(secret) > 128) throw new Error();
    }
    secret = secret.trim();
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(secret)) throw new Error();
    const account = privateKeyToAccount((secret.startsWith("0x") ? secret : `0x${secret}`) as `0x${string}`);
    if (getAddress(account.address) !== getAddress(expected)) throw new Error();
    return createWalletClient({ account, chain, transport });
  } catch {
    throw new Error("Private deployer input rejected.");
  } finally {
    secret = "";
  }
}
