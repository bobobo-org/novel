import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root=process.cwd(),canonicalPath=path.join(root,"data/story-library.json"),snapshotPath=path.join(root,"public/generated/story-library.json"),legacyPath=path.join(root,"public/legacy/novel-system.html");
const data=JSON.parse(fs.readFileSync(canonicalPath,"utf8")),snapshot=JSON.parse(fs.readFileSync(snapshotPath,"utf8")),legacy=fs.readFileSync(legacyPath,"utf8");
const classic=data.topics.filter((topic)=>topic.classic),adult=data.topics.filter((topic)=>topic.adultOnly),ids=new Set(data.topics.map((topic)=>topic.topicId));
const report={
  auditVersion:"p12-story-library-audit-v1",createdAt:new Date().toISOString(),schemaVersion:data.schemaVersion,
  source:{formal:"data/story-library.json",legacy:"public/legacy/novel-system.html",legacyRole:"historical bootstrap only",snapshot:"public/generated/story-library.json"},
  counts:{packs:data.packs.length,consumerGroups:data.consumerGroups.length,classicTopics:classic.length,adultTopics:adult.length,allTopics:data.topics.length,subCategoryRelations:classic.reduce((sum,topic)=>sum+topic.subCategories.length,0),uniqueTopicIds:ids.size},
  stale97:{foundInLegacyHelp:/97\s*類題材/.test(legacy),explanation:data.staleCountExplanation,resolution:"首頁、API 與 Studio 全部改讀正式故事庫的動態統計。"},
  integrity:{uniqueIds:ids.size===data.topics.length,classic218:classic.length===218,packs11:data.packs.length===11,adultIsolated:adult.every((topic)=>!topic.classic&&topic.adultOnly),snapshotMatches:JSON.stringify(data)===JSON.stringify(snapshot)},
  hashes:{canonicalSha256:crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex"),snapshotSha256:crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")},
};
fs.mkdirSync(path.join(root,"artifacts"),{recursive:true});fs.writeFileSync(path.join(root,"artifacts/story-library-audit.json"),`${JSON.stringify(report,null,2)}\n`);console.log(JSON.stringify(report,null,2));
if(Object.values(report.integrity).some((value)=>!value))process.exitCode=1;
