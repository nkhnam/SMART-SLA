import { getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export function verifyDeployerIdentity(secret, expected) {
  if (typeof secret !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$/.test(secret.trim())) throw new Error('Invalid private input.');
  const normalized = secret.trim();
  let address;
  try {
    address = privateKeyToAccount(normalized.startsWith('0x') ? normalized : `0x${normalized}`).address;
  } catch { throw new Error('Invalid private input.'); }
  if (getAddress(address) !== getAddress(expected)) throw new Error('Deployer identity mismatch.');
  return address;
}
