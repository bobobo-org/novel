import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  listPublicLoungeShelves,
  listPublicLoungeTopics,
  publicLoungeShelfDisplayName,
  publicLoungeTopicDisplayNames,
} from "../lib/novel-ai/public-lounge/taxonomy.ts";
import { PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS } from "../lib/novel-ai/public-lounge/types.ts";

const [
  listPageSource,
  listSource,
  detailPageSource,
  detailSource,
  interactionSource,
  publicationSource,
  clientSource,
] = await Promise.all([
  readFile(new URL("../app/lounge/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lounge/lounge-client.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lounge/[publicId]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lounge/[publicId]/lounge-detail-client.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lounge/[publicId]/reader-interactions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/author-tools/public-lounge-publication-panel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/novel-ai/public-lounge/client.ts", import.meta.url), "utf8"),
]);

assert.equal(listPublicLoungeShelves().length, 8);
assert.equal(listPublicLoungeTopics().length, 218);
assert.equal(PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS, 140);
assert.equal(publicLoungeShelfDisplayName(listPublicLoungeShelves()[0].shelfId), listPublicLoungeShelves()[0].name);
assert.deepEqual(publicLoungeTopicDisplayNames([]), ["舊版未分類"]);
assert.equal(listPageSource.includes("<LoungeClient />"), true);
assert.equal(listPageSource.includes("getPublicLoungeServerService"), false);
assert.equal(listPageSource.includes("public-lounge/runtime.server"), false);
assert.equal(listSource.includes("listPublicLoungePosts({ completedOnly: true, limit: 24 })"), true);
assert.equal(listSource.includes("正在讀取正式公開書庫"), true);
assert.equal(listSource.includes("PUBLIC_LOUNGE_RATE_LIMITED"), true);
assert.equal(listSource.includes("publicLoungeTopicDisplayNames(item.topicIds)"), true);
assert.equal(listSource.includes("publicLoungeShelfDisplayName(item.shelfId)"), true);
assert.equal(listSource.includes("書架："), true);
assert.equal(listSource.includes("item.authorByline"), true);
assert.equal(listSource.includes("item.completedAt.slice(0, 10)"), true);
assert.equal(listSource.includes("item.quality.totalScore"), true);
assert.equal(listSource.includes("item.category"), false);
assert.equal(listSource.includes("作者裝置閉端 AI 評分，平台未簽章驗證"), true);
assert.equal(listSource.includes("Private AI Hub 已簽章驗證"), true);
assert.equal(detailPageSource.includes("<LoungeDetailClient"), true);
assert.equal(detailPageSource.includes("getPublicLoungeServerService"), false);
assert.equal(detailPageSource.includes("public-lounge/runtime.server"), false);
assert.equal(detailSource.includes("getPublicLoungePost(publicId)"), true);
assert.equal(detailSource.includes("PUBLIC_LOUNGE_NOT_FOUND"), true);
assert.equal(detailSource.includes("正在讀取正式公開版本"), true);
assert.equal(detailSource.includes("publicLoungeTopicDisplayNames(post.topicIds)"), true);
assert.equal(detailSource.includes("post.category"), false);
assert.equal(detailSource.includes("作者裝置閉端 AI 評分，平台未簽章驗證"), true);
assert.equal(detailSource.includes("Private AI Hub 已簽章驗證"), true);
assert.equal(detailSource.includes("<ReaderInteractions"), true);
assert.equal(clientSource.includes("fetch(`/api/lounge${search.size ? `?${search}` : \"\"}`"), true);
assert.equal(clientSource.includes("fetch(`/api/lounge/${encodeURIComponent(publicId)}`"), true);
assert.equal(interactionSource.includes("服務未接通時不顯示虛構數字"), true);
assert.equal(interactionSource.includes("sendPublicLoungeMagicLink"), true);
assert.equal(interactionSource.includes("setPublicLoungeVote"), true);
assert.equal(interactionSource.includes("addPublicLoungeComment"), true);
assert.equal(interactionSource.includes("reportPublicLoungeContent"), true);
assert.equal(interactionSource.includes("snapshot.voteCount"), true);
assert.equal(interactionSource.includes("data-interaction-state={loadState}"), true);
assert.equal(interactionSource.includes("data-like-count={snapshot.voteCount}"), true);
assert.equal(interactionSource.includes("data-comment-count={snapshot.commentCount}"), true);
assert.equal(interactionSource.includes("推薦｜等待登入服務"), true);
assert.equal(interactionSource.includes("留言｜等待登入服務"), true);
assert.equal(interactionSource.includes('loadState === "ready" && !authenticated'), true);
assert.equal(interactionSource.includes('authenticated && reportTarget !== undefined'), true);
assert.equal(interactionSource.includes("refreshSequence.current"), true);
assert.equal(interactionSource.includes('event === "INITIAL_SESSION"'), true);
assert.equal(interactionSource.includes("fetch("), false);
assert.equal(interactionSource.includes("useSyncExternalStore"), true);
assert.equal(interactionSource.includes("useEffect"), true);
assert.equal(clientSource.includes("X-Public-Lounge-Management-Token"), true);
assert.equal(clientSource.includes("Authorization: `Bearer ${accessToken}`"), true);
assert.equal(listSource.includes("likeCount"), false);
assert.equal(detailSource.includes("likeCount"), false);
assert.equal(publicationSource.includes("OFFICIAL_PUBLIC_LOUNGE_TOPICS.map"), true);
assert.equal(publicationSource.includes("主要題材（決定公開書架）"), true);
assert.equal(publicationSource.includes("次要題材（可選）"), true);
assert.equal(publicationSource.includes("第三題材（可選）"), true);
assert.equal(publicationSource.includes("setCategory"), false);
assert.equal(publicationSource.includes("topicIds: selectedTopicIds"), true);
assert.equal(publicationSource.includes("createPublicLoungeAuthorDeviceEligibilityRequestFromWholeNovelReview"), false);
assert.equal(publicationSource.includes("authorDeviceReviewConsent"), false);
assert.equal(publicationSource.includes("本機分數無法自行解鎖公開"), true);
assert.equal(publicationSource.includes("公開摘要（最多 {PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS} 字）"), true);
assert.equal(publicationSource.includes("maxLength={PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS}"), true);
assert.equal(publicationSource.includes("loadPublicLoungeWorkPublicationReference"), true);
assert.equal(publicationSource.includes("savePublicLoungeWorkPublicationReference"), true);
assert.equal(publicationSource.includes("disabled={working || !serverAttestation}"), false);

console.log("PUBLIC_LOUNGE_UI_CONTRACT_TESTS_PASS");
