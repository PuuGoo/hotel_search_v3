import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KEY_FILE = path.join(__dirname, "..", ".encryption_key");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getOrCreateEncryptionKey() {
  try {
    if (fs.existsSync(KEY_FILE)) {
      const key = fs.readFileSync(KEY_FILE, "utf8").trim();
      if (key.length === 64) {
        return Buffer.from(key, "hex");
      }
    }
  } catch {}

  // Generate new 256-bit key
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600 });
  return key;
}

const ENCRYPTION_KEY = getOrCreateEncryptionKey();

export function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:encrypted (all hex)
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(encryptedText) {
  if (!encryptedText) return encryptedText;

  // If not encrypted (legacy plain text), return as-is
  if (!encryptedText.includes(":") || encryptedText.split(":").length !== 3) {
    return encryptedText;
  }

  try {
    const [ivHex, tagHex, encryptedHex] = encryptedText.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted, null, "utf8") + decipher.final("utf8");
  } catch {
    // If decryption fails, assume it's legacy plain text
    return encryptedText;
  }
}
