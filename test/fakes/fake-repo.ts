/**
 * Repositorio en memoria mínimo para tests unitarios: implementa solo lo
 * que los servicios usan (`find`, `findOne`, `create`, `save`, `update`,
 * `count`) con `where` de igualdad simple. No es un mock de TypeORM
 * completo — es intencionalmente chico para no acoplar los tests a su API.
 */
export interface FakeRepo<T extends { id?: string }> {
  rows: T[];
  create: (data: Partial<T>) => T;
  save: (entity: Partial<T>) => Promise<T>;
  findOne: (opts: { where: Record<string, unknown> }) => Promise<T | null>;
  find: (opts: { where: Record<string, unknown> }) => Promise<T[]>;
  update: (criteria: Record<string, unknown>, partial: Partial<T>) => Promise<void>;
  count: (opts: { where: Record<string, unknown> }) => Promise<number>;
}

let idCounter = 0;

function matches<T>(row: T, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
}

export function createFakeRepo<T extends { id?: string }>(): FakeRepo<T> {
  const rows: T[] = [];

  return {
    rows,
    create: (data) => ({ ...data }) as T,
    save: async (entity) => {
      const row = entity as T;
      if (!row.id) row.id = `fake_${++idCounter}`;
      const idx = rows.findIndex((r) => r.id === row.id);
      if (idx >= 0) rows[idx] = row;
      else rows.push(row);
      return row;
    },
    findOne: async ({ where }) => rows.find((r) => matches(r, where)) ?? null,
    find: async ({ where }) => rows.filter((r) => matches(r, where)),
    update: async (criteria, partial) => {
      for (const row of rows) {
        if (matches(row, criteria)) Object.assign(row as object, partial);
      }
    },
    count: async ({ where }) => rows.filter((r) => matches(r, where)).length,
  };
}
