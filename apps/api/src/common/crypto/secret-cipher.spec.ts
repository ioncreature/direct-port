import { ConfigService } from '@nestjs/config';
import { SecretCipher } from './secret-cipher';

function cipherWith(key: string | undefined): SecretCipher {
  const config = { get: () => key } as unknown as ConfigService;
  return new SecretCipher(config);
}

describe('SecretCipher', () => {
  const token = '123456:ABC-DEF_ghiJKLmnopQRStuvwxyz0123456';

  it('round-trips plaintext through encrypt → decrypt', () => {
    const cipher = cipherWith('test-secret-key');
    expect(cipher.decrypt(cipher.encrypt(token))).toBe(token);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const cipher = cipherWith('test-secret-key');
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('isConfigured reflects presence of the key', () => {
    expect(cipherWith('k').isConfigured()).toBe(true);
    expect(cipherWith(undefined).isConfigured()).toBe(false);
  });

  it('throws a clear error when the key is missing', () => {
    const cipher = cipherWith(undefined);
    expect(() => cipher.encrypt('x')).toThrow(/BOT_TOKEN_ENC_KEY/);
    expect(() => cipher.decrypt('x')).toThrow(/BOT_TOKEN_ENC_KEY/);
  });

  it('fails to decrypt tampered ciphertext (GCM auth tag)', () => {
    const cipher = cipherWith('test-secret-key');
    const buf = Buffer.from(cipher.encrypt('secret'), 'base64');
    buf[buf.length - 1] ^= 0xff; // портим последний байт шифротекста
    expect(() => cipher.decrypt(buf.toString('base64'))).toThrow();
  });

  it('rejects decryption under a different key', () => {
    const enc = cipherWith('key-a').encrypt('secret');
    expect(() => cipherWith('key-b').decrypt(enc)).toThrow();
  });

  it('rejects malformed (too short) ciphertext', () => {
    expect(() => cipherWith('k').decrypt('AAAA')).toThrow(/malformed/);
  });
});
