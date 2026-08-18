import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  ChannelsService,
  type ChannelDto,
  type ChannelTestResultDto,
} from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

/**
 * GET/POST/PATCH /channels + POST /channels/:id/test (CONTRACTS §6).
 * Mutações restritas a ADMIN — canais carregam credenciais Meta.
 */
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  list(): Promise<ChannelDto[]> {
    return this.channelsService.list();
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateChannelDto): Promise<ChannelDto> {
    return this.channelsService.create(dto);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateChannelDto): Promise<ChannelDto> {
    return this.channelsService.update(id, dto);
  }

  @Roles('ADMIN')
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(@Param('id') id: string): Promise<ChannelTestResultDto> {
    return this.channelsService.test(id);
  }
}
