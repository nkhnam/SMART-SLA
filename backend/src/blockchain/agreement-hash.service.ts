import { encodeAbiParameters, getAddress, keccak256, stringToHex } from "viem";

export type AgreementSnapshotInput = {
  agreementId: string;
  reference: string;
  version: number;
  buyerOrganizationId: string;
  supplierOrganizationId: string;
  name: string;
  serviceDescription: string;
  uptimeTargetBasisPoints: number;
  responseTimeTargetMs: number;
  measurementWindowHours: number;
  exclusions: string[];
  notes: string | null;
  buyerSigner: string;
  supplierSigner: string;
  validUntil: number;
};

export type CanonicalAgreementSnapshot = {
  snapshot: AgreementSnapshotInput & { schemaVersion: "sla-dex-agreement-snapshot/1" };
  canonicalJson: string;
  hash: `0x${string}`;
  key: `0x${string}`;
};

export const AGREEMENT_SNAPSHOT_SCHEMA = "sla-dex-agreement-snapshot/1" as const;
export const AGREEMENT_EIP712_DOMAIN_NAME = "SLA-DEX Agreement Registry";
export const AGREEMENT_EIP712_DOMAIN_VERSION = "1";

const utf8Encoder = new TextEncoder();

function normalizedText(value: string, field: string): string {
  if (typeof value !== "string") throw new TypeError(`${field} must be a string`);
  const normalized = value.normalize("NFC").trim();
  if (!normalized) throw new TypeError(`${field} must not be empty`);
  return normalized;
}

function normalizedUuid(value: string, field: string): string {
  const normalized = normalizedText(value, field).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new TypeError(`${field} must be a UUID`);
  }
  return normalized;
}

function positiveSafeInteger(value: number, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new TypeError(`${field} must be a positive safe integer no greater than ${max}`);
  }
  return value;
}

function compareUtf8(left: string, right: string): number {
  const a = utf8Encoder.encode(left);
  const b = utf8Encoder.encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}

export function canonicalizeAgreementSnapshot(input: AgreementSnapshotInput): CanonicalAgreementSnapshot {
  const version = positiveSafeInteger(input.version, "version");
  const uptimeTargetBasisPoints = positiveSafeInteger(input.uptimeTargetBasisPoints, "uptimeTargetBasisPoints", 10_000);
  if (!Array.isArray(input.exclusions) || input.exclusions.length > 20) {
    throw new TypeError("exclusions must contain at most 20 entries");
  }
  const exclusions = input.exclusions.map((value, index) => normalizedText(value, `exclusions[${index}]`)).sort(compareUtf8);
  const normalizedNotes = input.notes?.normalize("NFC").trim() ?? "";
  const notes = normalizedNotes === "" ? null : normalizedNotes;
  const snapshot = {
    schemaVersion: AGREEMENT_SNAPSHOT_SCHEMA,
    agreementId: normalizedUuid(input.agreementId, "agreementId"),
    reference: normalizedText(input.reference, "reference"),
    version,
    buyerOrganizationId: normalizedUuid(input.buyerOrganizationId, "buyerOrganizationId"),
    supplierOrganizationId: normalizedUuid(input.supplierOrganizationId, "supplierOrganizationId"),
    name: normalizedText(input.name, "name"),
    serviceDescription: normalizedText(input.serviceDescription, "serviceDescription"),
    uptimeTargetBasisPoints,
    responseTimeTargetMs: positiveSafeInteger(input.responseTimeTargetMs, "responseTimeTargetMs"),
    measurementWindowHours: positiveSafeInteger(input.measurementWindowHours, "measurementWindowHours"),
    exclusions,
    notes,
    buyerSigner: getAddress(input.buyerSigner),
    supplierSigner: getAddress(input.supplierSigner),
    validUntil: positiveSafeInteger(input.validUntil, "validUntil")
  } as const;
  if (snapshot.buyerOrganizationId === snapshot.supplierOrganizationId) {
    throw new TypeError("buyer and supplier organizations must differ");
  }
  if (snapshot.buyerSigner === snapshot.supplierSigner) {
    throw new TypeError("buyer and supplier signer wallets must differ");
  }

  const canonicalJson = JSON.stringify(snapshot);
  const hash = keccak256(stringToHex(canonicalJson));
  const key = agreementKey(snapshot.agreementId, snapshot.version);
  return { snapshot, canonicalJson, hash, key };
}

export function hashAgreementSnapshot(snapshot: AgreementSnapshotInput): `0x${string}` {
  return canonicalizeAgreementSnapshot(snapshot).hash;
}

export function agreementKey(agreementId: string, version: number): `0x${string}` {
  const canonicalId = normalizedUuid(agreementId, "agreementId");
  const canonicalVersion = positiveSafeInteger(version, "version");
  const agreementIdHash = keccak256(stringToHex(canonicalId));
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint64" }],
    [agreementIdHash, BigInt(canonicalVersion)]
  ));
}

export function agreementApprovalTypedData(
  canonical: CanonicalAgreementSnapshot,
  chainId: number,
  registryAddress: string,
  nonce: bigint,
  deadline: number
) {
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new TypeError("chainId must be a positive safe integer");
  if (nonce < 0n || nonce >= 1n << 256n) throw new TypeError("nonce must fit uint256");
  const validDeadline = positiveSafeInteger(deadline, "deadline");
  const { snapshot } = canonical;
  if (validDeadline !== snapshot.validUntil) {
    throw new TypeError("deadline must equal the frozen snapshot validity");
  }
  return {
    domain: {
      name: AGREEMENT_EIP712_DOMAIN_NAME,
      version: AGREEMENT_EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract: getAddress(registryAddress)
    },
    primaryType: "AgreementApproval",
    types: {
      AgreementApproval: [
        { name: "agreementKey", type: "bytes32" },
        { name: "agreementHash", type: "bytes32" },
        { name: "version", type: "uint64" },
        { name: "buyerOrganization", type: "bytes32" },
        { name: "supplierOrganization", type: "bytes32" },
        { name: "buyerSigner", type: "address" },
        { name: "supplierSigner", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint64" }
      ]
    },
    message: {
      agreementKey: canonical.key,
      agreementHash: canonical.hash,
      version: BigInt(snapshot.version),
      buyerOrganization: keccak256(stringToHex(snapshot.buyerOrganizationId)),
      supplierOrganization: keccak256(stringToHex(snapshot.supplierOrganizationId)),
      buyerSigner: snapshot.buyerSigner,
      supplierSigner: snapshot.supplierSigner,
      nonce,
      deadline: BigInt(validDeadline)
    }
  } as const;
}
