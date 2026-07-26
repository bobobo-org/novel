import {
  buildProfessionalFrontdoorUrl,
  type ProfessionalFrontdoorSearchParams,
} from "@/lib/professional-frontdoor";
import { redirect } from "next/navigation";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<ProfessionalFrontdoorSearchParams>;
}) {
  redirect(buildProfessionalFrontdoorUrl(await searchParams));
}
