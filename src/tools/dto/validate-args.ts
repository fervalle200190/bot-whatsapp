import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

export type ArgsValidation<T> = { success: true; data: T } | { success: false };

/**
 * Validación de `arguments` fuera del ValidationPipe global: a diferencia
 * de `merchantId`/`contactPhone` (400 si faltan), unos `arguments`
 * inválidos para una tool responden 200 `{ error: "argumentos_invalidos" }`
 * — la única clienta es n8n y necesita poder explicarle el error al
 * comprador, no que la tool call falle.
 */
export async function validateArgs<T extends object>(
  cls: new () => T,
  plain: unknown,
): Promise<ArgsValidation<T>> {
  const instance = plainToInstance(cls, plain ?? {});
  const errors = await validate(instance as object, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) return { success: false };
  return { success: true, data: instance };
}
