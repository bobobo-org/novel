import {
  buildProfessionalFrontdoorUrl,
  type ProfessionalFrontdoorSearchParams,
} from "@/lib/professional-frontdoor";
import { redirect } from "next/navigation";

export default async function ProfessionalPage({
  searchParams,
}: {
  searchParams: Promise<ProfessionalFrontdoorSearchParams>;
}) {
  redirect(buildProfessionalFrontdoorUrl(await searchParams));
}
