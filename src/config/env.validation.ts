import { plainToInstance, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, Max, Min, validateSync } from 'class-validator';

export class EnvVars {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: 'development' | 'production' | 'test' = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  PUBLIC_BASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  TOOLS_SHARED_SECRET!: string;

  // --- SPEC 03: canal Meta Cloud API + agente vendedor en n8n ---

  @IsString()
  @IsNotEmpty()
  META_GRAPH_VERSION!: string;

  @IsString()
  @IsNotEmpty()
  META_ACCESS_TOKEN!: string;

  @IsString()
  @IsNotEmpty()
  META_APP_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  META_VERIFY_TOKEN!: string;

  @IsString()
  @IsNotEmpty()
  N8N_WEBHOOK_BASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  N8N_WEBHOOK_SECRET!: string;

  // --- SPEC 04: API del panel del comercio ---

  @IsString()
  @IsNotEmpty()
  PANEL_ORIGIN!: string;
}

/** Usado como `validate` de `ConfigModule.forRoot`: falla el arranque con un mensaje claro. */
export function validateEnv(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
    throw new Error(
      `Variables de entorno inválidas o faltantes:\n${messages.map((m) => `  - ${m}`).join('\n')}`,
    );
  }

  return validated;
}
