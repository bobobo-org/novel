(function(){
  const actions=[
    ["create_story","AI 推薦故事設定","依作品方向整理可採用的故事候選"],
    ["story_seed","產生故事種子","建立可長篇發展的起點"],
    ["plan_chapter","產生十章大綱","讀取上下文規劃十章方向"],
    ["first_chapter","建立第一章","建立第一章候選，不直接覆蓋"],
    ["continue_story","續寫下一章","承接相關前文產生候選正文"],
    ["rewrite_scene","改寫選取段落","保留原文並提供局部改寫"],
    ["fix_conflicts","檢查前後矛盾","列出證據與可選修正"],
    ["diagnose_story","找出未回收伏筆","整理尚未處理的故事承諾"],
  ];
  const map={story_seed:"create_story",first_chapter:"create_story"};
  let selected="continue_story";
  function select(id){selected=id;window.NovelConsumerCenter?.selectTask(map[id]||id)}
  async function run(id=selected){select(id);ConsumerApp.notice("正在閱讀你的故事……");try{await window.NovelConsumerCenter?.runSelectedTask();ConsumerApp.notice("候選稿已完成，請先預覽再決定是否採用。") }catch(error){ConsumerApp.notice(`本機創作流程未完成：${error?.message||"請稍後再試"}`)}ConsumerApp.render()}
  function render(){const state=window.NovelConsumerCenter?.getState?.()||{};const runtime=window.NovelConsumerCenter?.getRuntimeStatus?.()||{};return `<section class="p11-ai-panel"><header><div><span>AI 創作助手</span><h2>你想讓系統幫什麼？</h2></div><button data-ai-detail>查看詳細資訊</button></header><div class="p11-ai-grid">${actions.map(([id,label,desc])=>`<button data-ai-action="${id}" class="${selected===id?"active":""}"><b>${label}</b><span>${desc}</span></button>`).join("")}</div><div class="p11-ai-progress"><b>${state.lastCandidate?"候選稿已完成":"等待你的任務"}</b><p>${state.lastCandidate?"結果只在候選區，尚未改動正式正文。":"系統會自動選擇可用的本機能力。"}</p></div>${state.lastCandidate?`<article class="p11-candidate"><header><b>AI 候選稿</b><span>本機故事智慧系統・外部請求 ${runtime.externalRequestCount||0}</span></header><pre>${NovelConsumer.esc(state.lastCandidate)}</pre><footer><button data-candidate="accept" class="primary">採用回饋</button><button data-candidate="edit">修改</button><button data-candidate="reject">放棄</button></footer></article>`:""}<details class="p11-technical"><summary>詳細技術資料</summary><pre>${NovelConsumer.esc(JSON.stringify(state.lastRouterDecision||{},null,2))}</pre></details></section>`}
  function bind(root){root.querySelectorAll("[data-ai-action]").forEach(el=>el.addEventListener("click",()=>run(el.dataset.aiAction)));root.querySelector("[data-candidate='accept']")?.addEventListener("click",()=>{window.NovelConsumerCenter?.acceptCandidate();ConsumerApp.notice("已記錄為採用回饋；正式正文仍需由你決定寫入。")});root.querySelector("[data-candidate='reject']")?.addEventListener("click",()=>{window.NovelConsumerCenter?.rejectCandidate();ConsumerApp.notice("候選稿已放棄，正式作品沒有變更。")});root.querySelector("[data-candidate='edit']")?.addEventListener("click",()=>ConsumerApp.notice("可在候選稿預覽後複製到編輯器修改。"));root.querySelector("[data-ai-detail]")?.addEventListener("click",()=>root.querySelector(".p11-technical")?.toggleAttribute("open"))}
  window.ConsumerAiActions={actions,select,run,render,bind,getSelected:()=>selected};
})();
