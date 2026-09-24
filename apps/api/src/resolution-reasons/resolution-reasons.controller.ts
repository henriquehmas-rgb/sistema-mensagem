import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import type { ResolutionReasonDto } from '../common/serializers';
import { CreateResolutionReasonDto } from './dto/create-resolution-reason.dto';
import { UpdateResolutionReasonDto } from './dto/update-resolution-reason.dto';
import { ResolutionReasonsService } from './resolution-reasons.service';

@Controller('resolution-reasons')
export class ResolutionReasonsController {
  constructor(private readonly service: ResolutionReasonsService) {}

  @Get()
  list(): Promise<ResolutionReasonDto[]> { return this.service.list(); }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateResolutionReasonDto): Promise<ResolutionReasonDto> { return this.service.create(dto); }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateResolutionReasonDto): Promise<ResolutionReasonDto> { return this.service.update(id, dto); }
}
