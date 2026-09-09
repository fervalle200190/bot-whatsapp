-- Se ejecuta solo la primera vez que se crea el volumen de Postgres.
-- n8n administra sus propias tablas en esta base, fuera de TypeORM.
CREATE DATABASE n8n;
