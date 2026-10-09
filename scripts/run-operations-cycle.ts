import { closeDb, getDb } from "../db/index";
import { runOperationalCycle } from "../db/operations-cycle";

async function main() {
  const result = await runOperationalCycle(getDb());
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
