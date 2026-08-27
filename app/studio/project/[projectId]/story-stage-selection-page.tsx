import { ProjectContextTabs } from "./project-context-tabs";
import ProjectNavigation from "./project-navigation";
import StoryStageSelector from "./story-stage-selector";

type StageFocus = "characters" | "world" | "timeline" | "story-bible";

const TITLES: Record<StageFocus, [string, string]> = {
  characters: ["上場人物", "查閱正式人物資料，並選擇目前情節要使用的人物；能力值只能回首頁修改。"],
  world: ["上場世界與規則", "查閱正式世界與規則，並選擇目前故事脈絡；規則內容只能回首頁修改。"],
  timeline: ["上場時間線", "查閱正式事件先後，並選擇目前情節需要的事件；事件內容只能回首頁修改。"],
  "story-bible": ["上場 Story Bible 與記憶", "Story Bible 內容在此唯讀；故事內只選擇目前情節要讀取的記憶。"],
};

export default function StoryStageSelectionPage({
  projectId,
  focus,
}: {
  projectId: string;
  focus: StageFocus;
}) {
  const [title, description] = TITLES[focus];
  return (
    <main
      className="p2ProjectShell"
      data-testid="story-stage-selection-page"
      data-canon-edit-surface="story-selection-only"
    >
      <header>
        <a href={`/professional?intent=library&projectId=${encodeURIComponent(projectId)}#character-world-memory-editor`}>
          ← 首頁正式設定
        </a>
        <div><small>故事工作台 · 只讀與上場選擇</small><h1>{title}</h1></div>
        <span>Canon 內容鎖定</span>
      </header>
      <ProjectNavigation projectId={projectId} active={focus} />
      <section className="p2ProjectSection">
        <header><h2>{title}</h2><p>{description}</p></header>
        {focus === "characters" || focus === "world" ? (
          <ProjectContextTabs projectId={projectId} context="people-world" active={focus} />
        ) : (
          <ProjectContextTabs projectId={projectId} context="story" active={focus} />
        )}
        <StoryStageSelector projectId={projectId} focus={focus} />
      </section>
    </main>
  );
}
