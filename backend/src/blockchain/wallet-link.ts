import { getAddress, hashTypedData, keccak256, recoverTypedDataAddress, stringToHex } from "viem";

const walletLinkTypes = {
  WalletLinkChallenge: [
    { name: "organizationId", type: "bytes32" },
    { name: "userId", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint64" }
  ]
} as const;

export type WalletLinkChallenge = {
  organizationId: string;
  userId: string;
  nonce: string;
  deadline: number;
};

export function walletLinkChallengeTypedData(
  challenge: WalletLinkChallenge,
  chainId: number,
  registryAddress: string
) {
  const nonce = challenge.nonce.startsWith("0x") ? challenge.nonce : `0x${challenge.nonce}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) throw new TypeError("nonce must be 32-byte hex");
  if (!Number.isSafeInteger(challenge.deadline) || challenge.deadline < 1) {
    throw new TypeError("deadline must be a positive safe integer");
  }
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new TypeError("chainId must be a positive safe integer");
  const domain = {
    name: "SLA-DEX Organization Wallet",
    version: "1",
    chainId,
    verifyingContract: getAddress(registryAddress)
  } as const;
  return {
    domain,
    primaryType: "WalletLinkChallenge",
    types: walletLinkTypes,
    message: {
      organizationId: keccak256(stringToHex(challenge.organizationId.toLowerCase())),
      userId: keccak256(stringToHex(challenge.userId.toLowerCase())),
      nonce: nonce as `0x${string}`,
      deadline: BigInt(challenge.deadline)
    }
  } as const;
}

export async function recoverWalletLinkSigner(
  typedData: ReturnType<typeof walletLinkChallengeTypedData>,
  signature: `0x${string}`
): Promise<`0x${string}`> {
  return recoverTypedDataAddress({ ...typedData, signature });
}

export function hashWalletLinkChallenge(typedData: ReturnType<typeof walletLinkChallengeTypedData>): `0x${string}` {
  return hashTypedData(typedData);
}
