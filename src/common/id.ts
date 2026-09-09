import { createId } from '@paralleldrive/cuid2';

/** Ids opacos, no secuenciales, generados en el servicio (no en la base). */
export function generateId(): string {
  return createId();
}
