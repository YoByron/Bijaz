import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const KDF_SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface EncryptedKeystore {
  version: number;
  cipher: 'aes-256-gcm';
  kdf: 'scrypt';
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  address: string;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_BYTES);
}

export function encryptPrivateKey(
  privateKey: string,
  password: string,
  address: string
): EncryptedKeystore {
  const salt = randomBytes(KDF_SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    cipher: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    address,
  };
}

export function decryptPrivateKey(store: EncryptedKeystore, password: string): string {
  const salt = Buffer.from(store.salt, 'base64');
  const iv = Buffer.from(store.iv, 'base64');
  const tag = Buffer.from(store.tag, 'base64');
  const ciphertext = Buffer.from(store.ciphertext, 'base64');
  const key = deriveKey(password, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

export function saveKeystore(path: string, store: EncryptedKeystore): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
}

export function loadKeystore(path: string): EncryptedKeystore {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as EncryptedKeystore;
}
