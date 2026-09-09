const BASE_STYLES = `
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 64px auto; padding: 0 16px; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  p.sub { color: #555; }
  label { display: block; margin-top: 16px; font-weight: 600; }
  input { width: 100%; padding: 10px; margin-top: 4px; box-sizing: border-box; font-size: 1rem; }
  button { margin-top: 24px; width: 100%; padding: 12px; font-size: 1rem; font-weight: 600; background: #25D366; color: white; border: none; border-radius: 6px; cursor: pointer; }
  button:hover { background: #1ebe57; }
`;

export const REGISTRO_FORM_HTML = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Registrá tu comercio</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <h1>Registrá tu comercio</h1>
  <p class="sub">Cargá tus datos y te contactamos para conectar tu WhatsApp.</p>
  <form method="POST" action="/registro">
    <label for="name">Nombre del comercio</label>
    <input id="name" name="name" type="text" required placeholder="Arepas La Esquina" />

    <label for="ownerPhone">Tu WhatsApp (con código de país)</label>
    <input id="ownerPhone" name="ownerPhone" type="tel" required placeholder="+584121234567" />

    <button type="submit">Registrar comercio</button>
  </form>
</body>
</html>`;

export const REGISTRO_SUCCESS_HTML = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Registro recibido</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <h1>¡Listo!</h1>
  <p class="sub">Te contactamos para conectar tu número.</p>
</body>
</html>`;
