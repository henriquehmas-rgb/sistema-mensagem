import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { PaginationQuery } from '../common/dto/pagination.query';
import type { PaginatedDto, UserDto } from '../common/serializers';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

/** CONTRACTS §6 — escrita ADMIN only; GET /users/agents aberto a todos os papéis. */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@Query() query: PaginationQuery): Promise<PaginatedDto<UserDto>> {
    return this.usersService.list(query);
  }

  @Get('agents')
  agents(): Promise<UserDto[]> {
    return this.usersService.agents();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<UserDto> {
    return this.usersService.get(id);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateUserDto): Promise<UserDto> {
    return this.usersService.create(dto);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<UserDto> {
    return this.usersService.update(id, dto, actor);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<{ success: true }> {
    return this.usersService.remove(id, actor);
  }
}
