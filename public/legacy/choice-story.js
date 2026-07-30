(function(){
  "use strict";

  function makeChoices(){
    const p=NovelConsumer.activeProject();
    const name=p.protagonist||"主角";
    const conflict=p.conflict||"眼前危機";
    const archetype=p.archetype||"既有行動習慣";
    return [
      {key:"A",text:`${name}依照${archetype}正面推進${conflict}，立刻迫使對手回應。`,impact:"主線推進加快，但體力下降。",stat:["stamina",-8]},
      {key:"B",text:`${name}暫時不揭穿異常，先搜尋相關前文並確認證據來源。`,impact:"風險較低，經驗值與任務進度提升。",stat:["experience",12]},
      {key:"C",text:`${name}借第三方製造轉折，讓對手提前行動並暴露部分底牌。`,impact:"聲望可能提升，但關係風險增加。",stat:["reputation",6]},
    ];
  }

  function ensure(){
    const s=NovelConsumer.state;
    if(!s.choicePoint){
      s.choicePoint={
        id:`choice-${Date.now()}`,
        choices:makeChoices(),
        selected:"",
        custom:"",
        candidate:"",
        snapshot:{stats:{...s.stats},branchCount:s.branches.length},
        createdAt:new Date().toISOString(),
      };
      NovelConsumer.save();
    }
    return s.choicePoint;
  }

  function render(){
    const cp=ensure();
    return `<section class="p11-choice-story"><header><span>三選一互動</span><h1>你準備怎麼做？</h1><p>選項會讀取目前作品資料；模型結果先進入分支候選，不直接推進正式故事。</p></header><div class="p11-choice-grid">${cp.choices.map(c=>`<button data-choice="${c.key}" class="${cp.selected===c.key?"active":""}"><b>${c.key}. ${NovelConsumer.esc(c.text)}</b><span>可能影響：${NovelConsumer.esc(c.impact)}</span></button>`).join("")}</div><label class="p11-custom">自己決定<input id="p11CustomChoice" value="${NovelConsumer.esc(cp.custom||"")}" placeholder="輸入你的行動"></label><div class="p11-inline-actions"><button data-choice-refresh>重新整理選項</button><button data-choice-confirm class="primary">用閉端 AI 建立分支候選</button>${NovelConsumer.state.branches.length?"<button data-choice-undo>回到上一個選擇點</button>":""}</div>${cp.candidate?`<article class="p11-candidate"><header><b>分支候選稿</b><span>Candidate 安全邊界</span></header><pre>${NovelConsumer.esc(cp.candidate)}</pre><footer><button data-choice-accept class="primary">確認推進故事</button><button data-choice-discard>放棄</button></footer></article>`:""}</section>`;
  }

  function bind(root){
    root.querySelectorAll("[data-choice]").forEach(el=>el.addEventListener("click",()=>{
      NovelConsumer.state.choicePoint.selected=el.dataset.choice;
      NovelConsumer.save();
      ConsumerApp.render();
    }));
    root.querySelector("#p11CustomChoice")?.addEventListener("input",event=>{
      NovelConsumer.state.choicePoint.custom=event.target.value;
      NovelConsumer.save();
    });
    root.querySelector("[data-choice-refresh]")?.addEventListener("click",()=>{
      NovelConsumer.state.choicePoint=null;
      NovelConsumer.save();
      ConsumerApp.render();
    });
    root.querySelector("[data-choice-confirm]")?.addEventListener("click",async()=>{
      const cp=NovelConsumer.state.choicePoint;
      const choice=cp.choices.find(item=>item.key===cp.selected);
      const action=cp.custom||choice?.text;
      if(!action){
        ConsumerApp.notice("請先選擇 A、B、C 或輸入自己的決定。");
        return;
      }
      window.NovelConsumerCenter?.selectChoice(cp.selected||"A");
      const result=await ConsumerAiActions.run("branch_choice");
      if(result?.redirected)return;
      ConsumerApp.notice("尚未建立模型候選；請先完成閉端 AI 配對與實測。");
    });
    root.querySelector("[data-choice-accept]")?.addEventListener("click",()=>{
      const cp=NovelConsumer.state.choicePoint;
      const choice=cp.choices.find(item=>item.key===cp.selected);
      const branch={
        id:`branch-${Date.now()}`,
        choice:cp.custom||choice?.text,
        candidate:cp.candidate,
        snapshot:cp.snapshot,
        at:new Date().toISOString(),
      };
      NovelConsumer.state.branches.push(branch);
      const [key,delta]=cp.pendingStat||["turns",1];
      NovelConsumer.changeStat(key,delta,`選擇 ${cp.selected||"自訂"}：${branch.choice}`,branch.id);
      NovelConsumer.changeStat("turns",1,"完成一個互動回合",branch.id);
      NovelConsumer.state.choicePoint=null;
      NovelConsumer.save();
      ConsumerApp.notice("故事分支與數值變化已保存。候選正文仍未覆蓋正式章節。");
      ConsumerApp.render();
    });
    root.querySelector("[data-choice-discard]")?.addEventListener("click",()=>{
      NovelConsumer.state.choicePoint.candidate="";
      NovelConsumer.save();
      ConsumerApp.render();
    });
    root.querySelector("[data-choice-undo]")?.addEventListener("click",()=>{
      const branch=NovelConsumer.state.branches.pop();
      if(branch?.snapshot?.stats)NovelConsumer.state.stats={...branch.snapshot.stats};
      NovelConsumer.state.statHistory=NovelConsumer.state.statHistory.filter(item=>item.branchId!==branch?.id);
      NovelConsumer.state.choicePoint=null;
      NovelConsumer.save();
      ConsumerApp.notice("已回到上一個選擇點，故事數值同步恢復。");
      ConsumerApp.render();
    });
  }

  window.ChoiceStory={render,bind,makeChoices};
})();
