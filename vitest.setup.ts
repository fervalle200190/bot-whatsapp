// Solo para tests: el resto de la app siempre lee DATABASE_URL del .env real
// vía env.ts. Este valor por defecto es el mismo Postgres de desarrollo
// (docker-compose.yml) — así el test de aislamiento del paso 20 corre
// aunque el shell no haya hecho `source .env`.
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5433/zavu_mvp?schema=public";
