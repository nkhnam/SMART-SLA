import { readFile } from "node:fs/promises";
import { verifyEvidencePackage } from "../src/monitoring/evidence-protocol.js";

const filePath = process.argv[2];
if (!filePath) throw new Error("Usage: npm run verify:evidence -- <evidence-export.json>");
const input: unknown = JSON.parse(await readFile(filePath, "utf8"));
if (!input || typeof input !== "object" || !("manifest" in input) || !("records" in input) || !Array.isArray(input.records)) {
  throw new TypeError("The file is not an SLA-DEX evidence export.");
}
const packageData = input as { manifest: Record<string, unknown>; records: Array<{ index: number; record: unknown; leafDigest: `0x${string}`; inclusionProof: `0x${string}`[] }> };
const valid = verifyEvidencePackage(packageData);
process.stdout.write(`${JSON.stringify({ valid, recordCount: packageData.records.length, merkleRoot: packageData.manifest.merkleRoot ?? null, batchDigest: packageData.manifest.batchDigest ?? null })}\n`);
if (!valid) process.exitCode = 1;
