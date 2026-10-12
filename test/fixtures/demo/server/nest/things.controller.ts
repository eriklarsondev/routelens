import { Controller, Get, Post } from '@nestjs/common';

@Controller('things')
export class ThingsController {
  @Get()
  findAll() {
    return [];
  }

  @Get(':id')
  findOne() {
    return {};
  }

  @Post()
  create() {
    return {};
  }
}
