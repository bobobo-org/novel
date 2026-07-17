import { RELEASE_MANIFEST } from "@/lib/release-manifest";
import StudioClient from "./studio-client";

const screens = new Set(["home", "create", "write", "choice", "inspect", "library"]);

export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requested = typeof params.screen === "string" ? params.screen : "home";
  const initialScreen = screens.has(requested) ? requested : "home";
  const initialTask = typeof params.task === "string" ? params.task : "";
  return <StudioClient initialScreen={initialScreen} initialTask={initialTask} release={RELEASE_MANIFEST} />;
}
