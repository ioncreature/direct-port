import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const IV_LENGTH = 12; // стандартный nonce для GCM
const TAG_LENGTH = 16;

/**
 * Шифрование секретов на уровне приложения (AES-256-GCM). Используется для токенов Telegram-
 * ботов компаний, которые хранятся в БД (companies.*_bot_token_enc — см. docs/COMPANY_BOTS.md).
 * Ключ берётся из env BOT_TOKEN_ENC_KEY (произвольная секретная строка) и приводится к 32 байтам
 * через SHA-256.
 *
 * Формат шифротекста — base64 от [iv(12) | authTag(16) | ciphertext]. IV случайный на каждый
 * вызов, поэтому один и тот же plaintext даёт разные шифротексты (и одинаковые токены в БД
 * неразличимы). GCM-тег защищает от подмены: decrypt чужого/битого значения бросает ошибку.
 *
 * Без ключа encrypt/decrypt бросают ошибку — осознанно, чтобы не хранить токены plaintext.
 * isConfigured() даёт вызывающему коду заранее вернуть понятную ошибку оператору.
 */
@Injectable()
export class SecretCipher {
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('BOT_TOKEN_ENC_KEY');
    this.key = raw ? createHash('sha256').update(raw).digest() : null;
  }

  isConfigured(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
  }

  decrypt(payload: string): string {
    const key = this.requireKey();
    const buf = Buffer.from(payload, 'base64');
    if (buf.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('SecretCipher: malformed ciphertext');
    }
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error('BOT_TOKEN_ENC_KEY is not set — cannot encrypt/decrypt bot tokens');
    }
    return this.key;
  }
}
