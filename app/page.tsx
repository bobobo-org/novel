import { RELEASE_MANIFEST } from "@/lib/release-manifest";
import { storyLibraryStats } from "@/lib/novel-data/story-library";
import FrontdoorClient from "./frontdoor-client";

export default function Home() {
  const library = storyLibraryStats();
  return (
    <FrontdoorClient
      release={RELEASE_MANIFEST}
      packs={library.packs}
      classicTopics={library.classicTopics}
    />
  );
}
