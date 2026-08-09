import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// AES-256-GCM encryption for tokens at rest, keyed off APP_SECRET.
// Ciphertext format: base64(iv).base64(tag).base64(data)

function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 10) {
    throw new Error("APP_SECRET is missing or too short — set it in .env");
  }
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${data.toString("base64")}`;
}

export function decrypt(ciphertext: string): string {
  const [iv, tag, data] = ciphertext.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
