import { loadEnv } from "./env.js";
import { buildApp } from "./app.js";

const env = loadEnv();
const app = await buildApp(env);

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then((address) => {
    app.log.info(`Servidor escuchando en ${address}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
