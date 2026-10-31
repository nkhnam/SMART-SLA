import { readFile } from 'node:fs/promises';
import { verifyDeployerIdentity } from './deployer-identity.mjs';

try {
  const draft = JSON.parse(await readFile(new URL('../fuji-deployment-draft.json', import.meta.url), 'utf8'));
  let secret = '';
  for await (const chunk of process.stdin) {
    secret += chunk;
    if (secret.length > 128) throw new Error();
  }
  const address = verifyDeployerIdentity(secret, draft.FUJI_DEPLOYER_ADDRESS);
  secret = '';
  console.log(JSON.stringify({ result: 'PASS', address, identityOnly: true, signatureProduced: false, transactionProduced: false }));
} catch {
  console.error('FAIL: deployer identity does not match or private input is invalid. No signature or transaction produced.');
  process.exitCode = 1;
}
