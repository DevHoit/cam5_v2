import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "./index";
import { loadDatabaseEnvironment } from "./load-env";

async function main() {
  loadDatabaseEnvironment();
  const db = getDb();
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("Migraciones CAM5 aplicadas correctamente.");
}

main()
  .catch((error: unknown) => {
    console.error("No fue posible aplicar las migraciones CAM5.", error);
    process.exitCode = 1;
  })
  .finally(closeDb);
