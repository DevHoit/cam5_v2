import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "./index";

/**
 * Migraciones en el build de Vercel, antes de "next build". Solo en el despliegue de producción:
 * así el código nuevo nunca sale sin las columnas que necesita (el 16-11-2026 el login quedó caído
 * porque se desplegó la suspensión de clientes sin aplicar 0015). Si la migración falla, el build
 * falla y Vercel mantiene la versión anterior en línea. Las vistas previas no migran: podrían
 * apuntar a la base de producción con migraciones de una rama sin fusionar.
 */
async function main() {
  const environment = process.env.VERCEL_ENV;
  if (environment !== "production") {
    console.log(`Migraciones omitidas: VERCEL_ENV=${environment ?? "(local)"}.`);
    return;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no está disponible durante el build de producción.");
  }
  await migrate(getDb(), { migrationsFolder: "drizzle" });
  console.log("Migraciones aplicadas antes del despliegue.");
}

main()
  .catch((error: unknown) => {
    console.error("No fue posible aplicar las migraciones: se cancela el despliegue.", error);
    process.exitCode = 1;
  })
  .finally(closeDb);
