import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** 32-byte AES key derived from the server-only secret. */
function key(): Buffer {
  const raw = process.env["VELORA_DELIVERY_ENCRYPTION_KEY"];
  if (!raw) throw new Error("Private delivery encryption is not configured");
  return createHash("sha256").update(raw).digest();
}

/** iv | authTag | ciphertext, base64 — one opaque column value. */
export function encryptDelivery(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptDelivery(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

const BANNED = [
  /\bstolen\s+(credit\s+)?cards?\b/i,
  /\bcarding\b/i,
  /\bcvv\s*dump/i,
  /\bnetflix\s+(account|login)s?\s+(for\s+)?sale\b/i,
  /\bcracked\s+(license|serial|keygen)\b/i,
  /\bkeygen\b/i,
  /\bchild\b[^.]{0,24}\b(porn|abuse)\b/i,
  /\bhack(ed|ing)?\s+(accounts?|databases?)\b/i,
  /\bddos\b/i,
  /\bransomware\b/i,
  /\bcredit\s+card\s+numbers?\b/i,
  /\bssn\b|\bsocial\s+security\s+number/i,
];

/** Cheap deterministic abuse screen for private delivery payloads. */
export function screenDeliveryContent(text: string): { ok: boolean; reason?: string } {
  for (const re of BANNED) {
    if (re.test(text)) {
      return {
        ok: false,
        reason:
          "This private delivery content looks like it shares prohibited or illegal material. Remove it and only include content for the product you legitimately own.",
      };
    }
  }
  return { ok: true };
}
