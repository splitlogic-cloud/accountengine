import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const VERSION_PREFIX = /^v(\d+):(.+)$/

function getKey(version = 1): Buffer {
  const envKey = version === 1
    ? process.env.AE_ENCRYPTION_KEY
    : process.env[`AE_ENCRYPTION_KEY_V${version}`]
  if (!envKey) throw new Error(`AE_ENCRYPTION_KEY_V${version} missing`)
  return scryptSync(envKey, `ae-salt-v${version}`, 32)
}

function currentKeyVersion(): number {
  let v = 1
  while (process.env[`AE_ENCRYPTION_KEY_V${v + 1}`]) v++
  return v
}

export function encrypt(plaintext: string): string {
  const version = currentKeyVersion()
  const key = getKey(version)
  const iv  = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  const base64 = Buffer.concat([iv, authTag, encrypted]).toString('base64')
  return `v${version}:${base64}`
}

export function decrypt(ciphertext: string): string {
  let version = 1
  let data: string
  const match = ciphertext.match(VERSION_PREFIX)
  if (match) { version = parseInt(match[1]); data = match[2] }
  else { data = ciphertext }
  const key     = getKey(version)
  const buf     = Buffer.from(data, 'base64')
  const iv      = buf.slice(0, 16)
  const authTag = buf.slice(16, 32)
  const enc     = buf.slice(32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

export function needsReencryption(ciphertext: string): boolean {
  const match = ciphertext.match(VERSION_PREFIX)
  const version = match ? parseInt(match[1]) : 1
  return version < currentKeyVersion()
}
