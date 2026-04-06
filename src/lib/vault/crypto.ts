import 'server-only'

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM    = 'aes-256-gcm'
const KEY_LENGTH   = 32     // 256 bits
const IV_LENGTH    = 16     // 128 bits
const TAG_LENGTH   = 16     // 128 bits
const SALT_PREFIX  = 'ae-vault-v'
const VERSION_RE   = /^v(\d+):(.+)$/

// ---------------------------------------------------------------------------
// Key management
// Multiple key versions allow rotation without downtime.
// Keys are loaded from environment variables:
//   AE_VAULT_KEY   — current key (version 1)
//   AE_VAULT_KEY_V2 — rotated key (version 2) etc.
// ---------------------------------------------------------------------------

function deriveKey(rawKey: string, version: number): Buffer {
  const salt = `${SALT_PREFIX}${version}`
  return scryptSync(rawKey, salt, KEY_LENGTH)
}

function getKey(version: number): Buffer {
  const envVar = version === 1 ? 'AE_VAULT_KEY' : `AE_VAULT_KEY_V${version}`
  const raw    = process.env[envVar]

  if (!raw) {
    throw new Error(
      `Vault key for version ${version} not found. Set ${envVar} environment variable.`
    )
  }

  return deriveKey(raw, version)
}

function currentVersion(): number {
  let v = 1
  while (process.env[`AE_VAULT_KEY_V${v + 1}`]) v++
  return v
}

// ---------------------------------------------------------------------------
// encrypt
// Returns: "v{version}:{base64(iv + authTag + ciphertext)}"
// ---------------------------------------------------------------------------

export function encrypt(plaintext: string): string {
  if (!plaintext) throw new Error('Cannot encrypt empty string.')

  const version = currentVersion()
  const key     = getKey(version)
  const iv      = randomBytes(IV_LENGTH)
  const cipher  = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Layout: [iv(16)] [authTag(16)] [ciphertext(N)]
  const payload = Buffer.concat([iv, authTag, encrypted])
  return `v${version}:${payload.toString('base64')}`
}

// ---------------------------------------------------------------------------
// decrypt
// ---------------------------------------------------------------------------

export function decrypt(ciphertext: string): string {
  if (!ciphertext) throw new Error('Cannot decrypt empty string.')

  let version: number
  let base64:  string

  const match = ciphertext.match(VERSION_RE)
  if (match) {
    version = parseInt(match[1]!, 10)
    base64  = match[2]!
  } else {
    // Legacy: no version prefix, assume v1
    version = 1
    base64  = ciphertext
  }

  const key     = getKey(version)
  const payload = Buffer.from(base64, 'base64')

  if (payload.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Ciphertext is too short to be valid.')
  }

  const iv       = payload.subarray(0,                   IV_LENGTH)
  const authTag  = payload.subarray(IV_LENGTH,            IV_LENGTH + TAG_LENGTH)
  const encrypted = payload.subarray(IV_LENGTH + TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  try {
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ])
    return decrypted.toString('utf8')
  } catch {
    throw new Error('Decryption failed — data may be corrupt or key is incorrect.')
  }
}

// ---------------------------------------------------------------------------
// needsReEncryption
// Returns true if the ciphertext was encrypted with an older key version.
// Allows gradual re-encryption of stored values after key rotation.
// ---------------------------------------------------------------------------

export function needsReEncryption(ciphertext: string): boolean {
  const match = ciphertext.match(VERSION_RE)
  if (!match) return true  // No version prefix = legacy, always re-encrypt

  const storedVersion = parseInt(match[1]!, 10)
  return storedVersion < currentVersion()
}

// ---------------------------------------------------------------------------
// reEncrypt
// Decrypts with old key, re-encrypts with current key.
// Use during rotation window.
// ---------------------------------------------------------------------------

export function reEncrypt(ciphertext: string): string {
  const plaintext = decrypt(ciphertext)
  return encrypt(plaintext)
}

// ---------------------------------------------------------------------------
// safeCompare
// Timing-safe string comparison for secrets.
// ---------------------------------------------------------------------------

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

// ---------------------------------------------------------------------------
// encryptJSON / decryptJSON
// Convenience wrappers for structured data.
// ---------------------------------------------------------------------------

export function encryptJSON(data: Record<string, unknown>): string {
  return encrypt(JSON.stringify(data))
}

export function decryptJSON<T = Record<string, unknown>>(ciphertext: string): T {
  return JSON.parse(decrypt(ciphertext)) as T
}
