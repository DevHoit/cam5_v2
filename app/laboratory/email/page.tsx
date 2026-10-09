import { notFound } from "next/navigation";
import { assertLaboratoryEnvironment } from "../../../db/laboratory-email";
import { EmailLaboratoryView } from "../../email-laboratory-view";
export const dynamic = "force-dynamic";
export default function EmailLaboratoryPage() {
  try { assertLaboratoryEnvironment(process.env); } catch { notFound(); }
  return <EmailLaboratoryView />;
}
