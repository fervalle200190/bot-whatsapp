import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';

config();

/** Fuente de datos para la CLI de TypeORM (`migration:generate`, `migration:run`). */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ENTITIES,
  migrations: [__dirname + '/migrations/*.js'],
  synchronize: false,
});
