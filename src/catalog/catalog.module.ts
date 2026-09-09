import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './product.entity';
import { MenuImport } from './menu-import.entity';
import { CatalogService } from './catalog.service';

@Module({
  imports: [TypeOrmModule.forFeature([Product, MenuImport])],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
