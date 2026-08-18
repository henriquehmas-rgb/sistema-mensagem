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
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import type { TagDto } from '../common/serializers';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { TagsService } from './tags.service';

/** Leitura para todos; escrita restrita a ADMIN/SUPERVISOR. */
@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  list(): Promise<TagDto[]> {
    return this.tagsService.list();
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Post()
  create(@Body() dto: CreateTagDto): Promise<TagDto> {
    return this.tagsService.create(dto);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTagDto): Promise<TagDto> {
    return this.tagsService.update(id, dto);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string): Promise<{ success: true }> {
    return this.tagsService.remove(id);
  }
}
