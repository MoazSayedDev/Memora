import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthenticatedUser | undefined,
    context: ExecutionContext,
  ): AuthenticatedUser | string => {
    const request = context.switchToHttp().getRequest<{
      user: AuthenticatedUser;
    }>();

    return data ? request.user[data] : request.user;
  },
);
