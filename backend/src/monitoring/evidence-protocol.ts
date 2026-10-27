import { keccak256, toBytes, type Hex } from "viem";

export const evidenceSchemaVersion = "sla-dex-evidence/1";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Evidence numbers must be safe integers.");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).map((key) => ({ original: key, normalized: key.normalize("NFC") })).sort((left, right) => compareUtf8(left.normalized, right.normalized));
    if (new Set(keys.map((key) => key.normalized)).size !== keys.length) throw new TypeError("Evidence object has duplicate normalized keys.");
    return `{${keys.map(({ original, normalized }) => `${JSON.stringify(normalized)}:${canonicalJson(record[original])}`).join(",")}}`;
  }
  throw new TypeError("Evidence contains a value that cannot be serialized canonically.");
}

export type MerkleEntry<T> = { index: number; leafDigest: Hex; proof: Hex[]; record: T; canonicalRecord: string };

export function buildMerkleEntries<T>(records: T[]): { root: Hex; entries: MerkleEntry<T>[] } {
  if (records.length === 0) throw new RangeError("An evidence batch must contain at least one record.");
  const canonicalRecords = records.map(canonicalJson);
  let level = canonicalRecords.map((record) => keccak256(concatBytes(new Uint8Array([0]), toBytes(record))));
  const proofs = records.map(() => [] as Hex[]);
  const positions = records.map((_, index) => index);
  while (level.length > 1) {
    for (let position = 0; position < positions.length; position += 1) {
      const index = positions[position];
      if (index === undefined) continue;
      const sibling = index ^ 1;
      proofs[position]?.push(level[sibling] ?? level[index]!);
      positions[position] = Math.floor(index / 2);
    }
    const next: Hex[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      next.push(keccak256(concatBytes(new Uint8Array([1]), hexBytes(left), hexBytes(right))));
    }
    level = next;
  }
  return {
    root: level[0]!,
    entries: records.map((record, index) => ({ index, leafDigest: keccak256(concatBytes(new Uint8Array([0]), toBytes(canonicalRecords[index]!))), proof: proofs[index]!, record, canonicalRecord: canonicalRecords[index]! }))
  };
}

export function verifyMerkleProof(record: unknown, index: number, proof: Hex[], root: Hex): boolean {
  if (!Number.isSafeInteger(index) || index < 0) return false;
  let digest = keccak256(concatBytes(new Uint8Array([0]), toBytes(canonicalJson(record))));
  let position = index;
  for (const sibling of proof) {
    const siblingBytes = hexBytes(sibling);
    digest = position % 2 === 0
      ? keccak256(concatBytes(new Uint8Array([1]), hexBytes(digest), siblingBytes))
      : keccak256(concatBytes(new Uint8Array([1]), siblingBytes, hexBytes(digest)));
    position = Math.floor(position / 2);
  }
  return digest.toLowerCase() === root.toLowerCase();
}

export function verifyEvidencePackage(input: { manifest: Record<string, unknown>; records: Array<{ index: number; record: unknown; leafDigest: Hex; inclusionProof: Hex[] }> }): boolean {
  try {
    const { batchDigest, ...manifestBase } = input.manifest;
    const { merkleRoot, observationCount, records: manifestRecords } = manifestBase;
    if (typeof batchDigest !== "string" || typeof merkleRoot !== "string" || !Number.isSafeInteger(observationCount) || observationCount !== input.records.length || !Array.isArray(manifestRecords)) return false;
    if (keccak256(toBytes(canonicalJson(manifestBase))) !== batchDigest) return false;
    if (manifestRecords.length !== input.records.length) return false;
    return input.records.every((entry, index) => {
      const manifestEntry = manifestRecords[index] as { index?: unknown; observationId?: unknown; leafDigest?: unknown } | undefined;
      const actualLeaf = keccak256(concatBytes(new Uint8Array([0]), toBytes(canonicalJson(entry.record))));
      return entry.index === index && entry.leafDigest === actualLeaf
        && manifestEntry?.index === index && manifestEntry.leafDigest === actualLeaf
        && manifestEntry.observationId === (entry.record as { id?: unknown })?.id
        && verifyMerkleProof(entry.record, entry.index, entry.inclusionProof, merkleRoot as Hex);
    });
  } catch {
    return false;
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function hexBytes(value: Hex): Uint8Array {
  return Uint8Array.from(Buffer.from(value.slice(2), "hex"));
}

function concatBytes(...items: Uint8Array[]): Uint8Array {
  return Buffer.concat(items.map((item) => Buffer.from(item)));
}
