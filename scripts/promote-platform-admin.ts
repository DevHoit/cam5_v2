import { closeDb, getDb } from "../db/index";
import { loadDatabaseEnvironment } from "../db/load-env";
import { ensurePlatformAdmin } from "../db/platform-admin";

async function main() {
  loadDatabaseEnvironment();
  const email = process.argv[2]?.trim() || process.env.CAM5_ADMIN_EMAIL?.trim();
  if (!email) {
    throw new Error("Indica el correo: npm run admin:promote -- usuario@dominio.cl o configura CAM5_ADMIN_EMAIL.");
  }
  const result = await ensurePlatformAdmin(getDb(), email);
  console.log(result.created
    ? `Administrador HOIT asignado a ${result.email}.`
    : `${result.email} ya era Administrador HOIT.`);
}

main()
  .catch((error) => {
    console.error("No fue posible promover el usuario.", error);
    process.exitCode = 1;
  })
  .finally(closeDb);
