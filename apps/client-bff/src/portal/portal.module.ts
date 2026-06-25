import { Module } from '@nestjs/common';
import { ApiClientModule } from '../api-client/api-client.module';
import { AuthModule } from '../auth/auth.module';
import { PortalController } from './portal.controller';

@Module({
  imports: [AuthModule, ApiClientModule],
  controllers: [PortalController],
})
export class PortalModule {}
