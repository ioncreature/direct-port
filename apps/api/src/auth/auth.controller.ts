import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // x-tenant-host — исходный хост запроса, проставляется прокси admin-web (доверенный источник
  // домена для тенант-гейта, не подделывается клиентом в отличие от тела запроса).
  login(@Body() dto: LoginDto, @Headers('x-tenant-host') tenantHost?: string) {
    return this.authService.login(dto.email, dto.password, tenantHost);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Body() dto: RefreshDto) {
    return this.authService.logout(dto.refreshToken);
  }
}
