import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import type { DepartmentDto } from '../common/serializers';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly service: DepartmentsService) {}

  @Get()
  list(): Promise<DepartmentDto[]> { return this.service.list(); }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateDepartmentDto): Promise<DepartmentDto> { return this.service.create(dto); }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto): Promise<DepartmentDto> { return this.service.update(id, dto); }
}
