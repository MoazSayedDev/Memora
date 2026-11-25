import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AdminUserResponseDto } from './dto/admin-user-response.dto';
import { AdminUsersService } from './admin-users.service';

@ApiTags('Admin Dashboard')
@ApiBearerAuth()
@Controller('admin')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get('users')
  @ApiOperation({
    summary: 'List all users for the admin dashboard',
    description:
      'Requires authentication as memora@memora.com. Returns public account metadata only.',
  })
  @ApiResponse({
    status: 200,
    description: 'Users ordered by account creation date',
    type: AdminUserResponseDto,
    isArray: true,
  })
  @ApiResponse({ status: 401, description: 'Authentication is required' })
  @ApiResponse({
    status: 403,
    description: 'Only the configured admin email is allowed',
  })
  async listUsers(@CurrentUser() user: AuthenticatedUser) {
    return this.adminUsersService.listUsers(user.id);
  }
}
