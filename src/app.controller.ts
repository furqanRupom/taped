import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post()
  newProduct(): string {
    return "Create New Product"
  }
  @Patch()
  updateProduct(): string {
    return "update product"
  }
  @Delete()
  deleteProduct(): string {
    return "delete product"
  }

}
