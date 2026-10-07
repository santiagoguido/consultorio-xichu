# Consultorio ISSSTE (app local para iPad)

App web instalable (PWA). Funciona sin internet y **todos los datos se quedan en el iPad** (IndexedDB). No hay servidor, base de datos externa ni costos.

## Publicarla gratis en GitHub Pages (una sola vez)

1. Crea un repositorio en GitHub (puede ser privado si tu plan lo permite con Pages; si no, público: el repo solo tiene el código, nunca datos de pacientes).
2. Sube **el contenido de esta carpeta** a la raíz del repositorio (index.html, app.js, app.css, suive.js, sw.js, manifest.webmanifest, carpetas `icons/` y `vendor/`).
3. En el repo: **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
4. En un minuto tendrás una URL tipo `https://TU-USUARIO.github.io/NOMBRE-REPO/`.

## Instalarla en el iPad

1. Abre la URL en **Safari**.
2. Botón Compartir → **Agregar a pantalla de inicio**.
3. Ábrela **siempre desde el ícono**. (Los datos del ícono y los de Safari son independientes.)
4. Después de abrirla una vez con internet, funciona en modo avión.

## Importar pacientes

- Ajustes → **Importar pacientes** (o el botón en Pacientes cuando la lista está vacía) y elige el archivo `.json` de pacientes.
- No borra nada: si el paciente ya existe (mismo nombre y expediente), solo completa los datos que le falten. Puedes importarlo dos veces sin duplicar.
- **Nunca subas ese archivo a GitHub**: contiene datos de pacientes. Pásalo al iPad por AirDrop, correo o Archivos.

## Respaldos

- Ajustes → **Guardar respaldo** genera un `.json`; guárdalo en Archivos / iCloud Drive cada semana.
- Para pasar los datos a otro iPad: instala la app ahí y usa **Restaurar respaldo**.

## Actualizar la app

Si cambias cualquier archivo, sube también `sw.js` con el número de versión aumentado (`consultorio-v2` → `consultorio-v3`, etc.). Al abrir la app dos veces, el iPad toma la versión nueva. Los datos no se tocan.

## Notas

- Catálogo SUIVE: basado en el formato SUIVE-1; revisa claves y nombres contra el formato vigente de la jurisdicción (Ajustes → Catálogo SUIVE).
- Semana epidemiológica: domingo a sábado; la semana 1 termina el primer sábado de enero con al menos 4 días del año.
- Librerías incluidas localmente: jsPDF, jspdf-autotable y docx (licencia MIT).
