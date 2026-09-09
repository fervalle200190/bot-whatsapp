import type { ValueTransformer } from 'typeorm';

/**
 * TypeORM `numeric` columns come back from `pg` as strings to avoid silent
 * precision loss. Los montos de este proyecto (USD/Bs con 2-4 decimales,
 * cifras pequeñas) caben en `number` sin pérdida perceptible, así que este
 * transformer los expone como `number` en TypeScript.
 */
export const numericToNumber: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null || value === undefined ? null : Number(value)),
};
