import { Global, Module } from '@nestjs/common';
import { SecretCipher } from './secret-cipher';

/**
 * Шифрование секретов приложения (токены ботов компаний и пр.). Глобальный — чтобы инжектить
 * SecretCipher в любом модуле (companies, internal bots API) без повторного импорта.
 */
@Global()
@Module({
  providers: [SecretCipher],
  exports: [SecretCipher],
})
export class CryptoModule {}
