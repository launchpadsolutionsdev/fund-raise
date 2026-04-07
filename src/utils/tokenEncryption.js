/**
 * Token Encryption Utility
 *
 * AES-256-GCM encryption/decryption for Blackbaud OAuth tokens.
 * The encryption key must be provided via TOKEN_ENCRYPTION_KEY env var
 * (64 hex chars = 32 bytes).
 *
 * Format: base64(iv + authTag + ciphertext)
 *   - iv: 12 bytes
 *   - authTag: 16 bytes
 *   - ciphertext: variable length
 */
const crypto = require('crypto');

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate with: openssl rand -hex 32');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext string. Returns a base64 string containing iv + authTag + ciphertext.
 */
function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Pack: iv (12) + authTag (16) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt a base64 string produced by encrypt(). Returns the original plaintext.
 */
function decrypt(encoded) {
  if (!encoded) return encoded;
  const key = getKey();
  const packed = Buffer.from(encoded, 'base64');
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Check if a string looks like it's already encrypted (base64 with correct min length).
 */
function isEncrypted(value) {
  if (!value) return false;
  // Encrypted tokens are base64 and at least iv+authTag long (28 bytes = ~38 base64 chars)
  // Plain OAuth tokens typically start with recognizable patterns
  try {
    const buf = Buffer.from(value, 'base64');
    // Must be at least iv + authTag + 1 byte of ciphertext
    return buf.length >= IV_LENGTH + AUTH_TAG_LENGTH + 1 &&
      // Re-encoding should produce the same string (valid base64)
      buf.toString('base64') === value;
  } catch {
    return false;
  }
}

module.exports = { encrypt, decrypt, isEncrypted };
