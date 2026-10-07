import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "./index";
import { loadDatabaseEnvironment } from "./load-env";
import { ensurePlatformAdmin } from "./platform-admin";

async function main() {
  loadDatabaseEnvironment();
  const db = getDb();
  await migrate(db, { migrationsFolder: "drizzle" });
  const adminEmail = (process.env.HOIT_ADMIN_EMAIL ?? process.env.CAM5_ADMIN_EMAIL)?.trim();
  if (adminEmail) {
    const admin = await ensurePlatformAdmin(db, adminEmail);
    console.log(admin.created
      ? `Migraciones aplicadas y Administrador HOIT asegurado para ${admin.email}.`
      : `Migraciones aplicadas; ${admin.email} ya es Administrador HOIT.`);
  } else {
    console.log("Migraciones HoitLive Core aplicadas correctamente. HOIT_ADMIN_EMAIL no está configurado; no se modificaron privilegios de plataforma.");
  }
}

main()
  .catch((error: unknown) => {
    console.error("No fue posible aplicar las migraciones HoitLive Core.", error);
    process.exitCode = 1;
  })
  .finally(closeDb);
