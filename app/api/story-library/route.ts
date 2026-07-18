import { NextRequest, NextResponse } from "next/server";
import { listStoryTopics, STORY_LIBRARY, storyLibraryStats } from "@/lib/novel-data/story-library";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const adultRequested = params.get("adult") === "1";
  const ageConfirmed = params.get("ageConfirmed") === "1";
  const topics = listStoryTopics({ groupId: params.get("groupId") || undefined, packId: params.get("packId") || undefined, playModeId: params.get("playModeId") || undefined, query: params.get("q") || undefined, includeAdult: adultRequested, ageConfirmed, limit: Math.min(Number(params.get("limit") || 218), 225) });
  return NextResponse.json({ schemaVersion: STORY_LIBRARY.schemaVersion, stats: storyLibraryStats(), consumerGroups: STORY_LIBRARY.consumerGroups, packs: STORY_LIBRARY.packs, playModes: STORY_LIBRARY.playModes.filter((mode) => !mode.adultOnly || (adultRequested && ageConfirmed)), topics, adultAccess: adultRequested ? (ageConfirmed ? "confirmed" : "age_confirmation_required") : "disabled" }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } });
}
