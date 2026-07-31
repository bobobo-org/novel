(function(){
  "use strict";

  const actions=[
    ["create_story","閉端 AI 推薦故事設定","帶入作品方向，交給已驗證模型建立候選"],
    ["story_seed","閉端 AI 產生故事種子","建立可長篇發展的起點"],
    ["plan_chapter","閉端 AI 產生十章大綱","讀取上下文規劃章節方向"],
    ["first_chapter","閉端 AI 建立第一章","建立第一章候選，不直接覆蓋"],
    ["continue_story","續寫下一章","由已配對模型建立候選正文，不直接覆蓋"],
    ["rewrite_scene","改寫選取段落","保留原文並建立模型改寫候選"],
    ["fix_conflicts","檢查前後矛盾","由模型列出證據與可選修正"],
    ["diagnose_story","找出未回收伏筆","整理尚未處理的故事承諾"],
  ];
  const map={story_seed:"create_story",first_chapter:"create_story"};
  let selected="continue_story";

  function select(id){
    selected=id;
    window.NovelConsumerCenter?.selectTask(map[id]||id);
  }

  async function run(id=selected){
    select(id);
    ConsumerApp.notice("正在開啟閉端 AI 指揮中心並帶入目前作品……");
    try{
      if(!window.NovelConsumerCenter?.runSelectedTask)throw new Error("閉端 AI 交接模組尚未載入");
      const result=await window.NovelConsumerCenter.runSelectedTask();
      if(result?.redirected)return result;
      throw new Error("閉端 AI 交接未完成");
    }catch(error){
      ConsumerApp.notice(`閉端 AI 尚未開啟：${error?.message||"請重新整理後再試"}`);
      ConsumerApp.render();
      return {redirected:false,error};
    }
  }

  function render(){
    const state=window.NovelConsumerCenter?.getState?.()||{};
    const runtime=window.NovelConsumerCenter?.getRuntimeStatus?.()||{};
    const decision=state.lastRouterDecision||{};
    const ruleOnly=decision.actualExecutor==="deterministic_rule";
    const candidateLabel=ruleOnly?"離線規則候選（非 AI）":"已驗證模型候選";
    return `<section class="p11-ai-panel"><header><div><span>閉端 AI 創作助手</span><h2>你想讓模型幫什麼？</h2></div><button data-ai-detail>查看連線真相</button></header><div class="p11-ai-truth"><b>模型執行規則</b><p>續寫、改寫與分析會直接帶入閉端 AI 指揮中心。只有完成配對且通過模型實測的後端才能執行；未連線時會明確停下，不會用固定規則冒充 AI。</p><div class="p11-inline-actions"><button type="button" data-open-quick-assistant>開啟快速 AI 助手</button><button type="button" data-open-closed-ai>連接／檢查完整 AI 工作區</button></div></div><div class="p11-ai-grid">${actions.map(([id,label,desc])=>`<button data-ai-action="${id}" class="${selected===id?"active":""}"><b>${label}</b><span>${desc}</span></button>`).join("")}</div><div class="p11-ai-progress"><b>${state.lastCandidate?"候選已建立":"等待你的任務"}</b><p>${state.lastCandidate?"結果只在候選區，尚未改動正式正文。":"按下任務後會攜帶目前作品資料，開啟自動選擇後端的閉端 AI 工作區。"}</p></div>${state.lastCandidate?`<article class="p11-candidate"><header><b>${candidateLabel}</b><span>執行器 ${NovelConsumer.esc(decision.actualExecutor||"未記錄")}・外部請求 ${runtime.externalRequestCount||0}</span></header><pre>${NovelConsumer.esc(state.lastCandidate)}</pre><footer><button data-candidate="accept" class="primary">採用回饋</button><button data-candidate="edit">修改</button><button data-candidate="reject">放棄</button></footer></article>`:""}<details class="p11-technical"><summary>連線與路由詳細資料</summary><pre>${NovelConsumer.esc(JSON.stringify({browserAi:runtime.browserAi,localRuntime:runtime.localRuntime,ollama:runtime.ollama,provider:runtime.provider,model:runtime.model,lastRouterDecision:decision},null,2))}</pre></details></section>`;
  }

  function bind(root){
    root.querySelectorAll("[data-ai-action]").forEach(el=>el.addEventListener("click",()=>run(el.dataset.aiAction)));
    root.querySelector("[data-open-quick-assistant]")?.addEventListener("click",()=>{
      const url=window.NovelConsumerCenter?.quickAssistantUrl?.();
      if(url)window.location.assign(url);
      else ConsumerApp.notice("目前作品尚未建立，請先建立作品。");
    });
    root.querySelector("[data-open-closed-ai]")?.addEventListener("click",()=>run(selected));
    root.querySelector("[data-candidate='accept']")?.addEventListener("click",()=>{window.NovelConsumerCenter?.acceptCandidate();ConsumerApp.notice("已記錄為採用回饋；正式正文仍需由你決定寫入。")});
    root.querySelector("[data-candidate='reject']")?.addEventListener("click",()=>{window.NovelConsumerCenter?.rejectCandidate();ConsumerApp.notice("候選已放棄，正式作品沒有變更。")});
    root.querySelector("[data-candidate='edit']")?.addEventListener("click",()=>ConsumerApp.notice("可在候選預覽後複製到編輯器修改。"));
    root.querySelector("[data-ai-detail]")?.addEventListener("click",()=>root.querySelector(".p11-technical")?.toggleAttribute("open"));
  }

  window.ConsumerAiActions={actions,select,run,render,bind,getSelected:()=>selected};
})();
