import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type WebhookMetadata = { timestamp: string; nonce: string; eventId: string };

export function createWebhookSignature(secret: string, metadata: WebhookMetadata, rawBody: Uint8Array): string {
  const digest = createHmac("sha256", secret)
    .update(`${metadata.timestamp}.${metadata.nonce}.${metadata.eventId}.`, "utf8")
    .update(rawBody)
    .digest("hex");
  return `v1=${digest}`;
}

export function verifyWebhookSignature(
  secret: string,
  metadata: WebhookMetadata,
  rawBody: Uint8Array,
  signature: string,
  nowSeconds: number,
  maxAgeSeconds: number
): boolean {
  if (!/^\d{10}$/.test(metadata.timestamp) || !/^[A-Za-z0-9_-]{16,128}$/.test(metadata.nonce) || !/^[A-Za-z0-9_-]{1,128}$/.test(metadata.eventId)) return false;
  if (!Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1) return false;
  if (Math.abs(nowSeconds - Number(metadata.timestamp)) > maxAgeSeconds) return false;
  if (!/^v1=[a-f0-9]{64}$/.test(signature)) return false;

  const expected = Buffer.from(createWebhookSignature(secret, metadata, rawBody).slice(3), "hex");
  const received = Buffer.from(signature.slice(3), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

export function encryptWebhookSecret(secret: string, encryptionKey: Uint8Array): string {
  if (encryptionKey.byteLength !== 32) throw new RangeError("Webhook encryption key must contain 32 bytes.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptWebhookSecret(sealed: string, encryptionKey: Uint8Array): string {
  if (encryptionKey.byteLength !== 32) throw new RangeError("Webhook encryption key must contain 32 bytes.");
  const [version, ivText, tagText, ciphertextText, extra] = sealed.split(":");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText || extra !== undefined) throw new TypeError("Encrypted webhook secret is malformed.");
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  const ciphertext = Buffer.from(ciphertextText, "base64url");
  if (iv.length !== 12 || tag.length !== 16) throw new TypeError("Encrypted webhook secret is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
