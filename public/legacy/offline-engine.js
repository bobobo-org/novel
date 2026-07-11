(function () {
  "use strict";

  const sentenceBank = {
    goals: ["保住已取得的線索", "逼出反派的下一步", "修補上一章留下的破口", "爭取一個可靠盟友", "確認能力代價的真相", "把失控局勢拉回主線"],
    conflicts: ["資源被突然切斷", "信任關係出現裂痕", "敵人提前設局", "世界規則開始反噬", "主角的身分或立場受到質疑", "一個舊伏筆被迫提前爆開"],
    actions: ["主角先假裝退讓，暗中觀察所有人的反應", "主角把上一章得到的線索拆成三個可能方向", "主角主動聯絡最不穩定的盟友", "主角用一次有代價的能力換取短暫優勢", "主角拒絕立即反擊，改去處理真正的根源", "主角把反派留下的漏洞變成反向陷阱"],
    reversals: ["真正的陷阱不是眼前的攻擊，而是讓主角做出錯誤選擇", "看似失敗的行動反而證明了世界規則的漏洞", "盟友並非背叛，而是被迫保護另一個秘密", "反派暴露的弱點其實是故意拋出的誘餌", "主角贏下小局，卻輸掉更重要的時間", "上一章的未解問題在此刻變成新的威脅"],
    hooks: ["門外傳來熟悉的聲音，說出的卻是只有反派才知道的暗號", "系統面板跳出一行紅字：你剛剛救下的人，並不存在於原本劇情", "主角收到一份名單，第一個名字正是自己", "被封存的記憶突然鬆動，露出一個完全相反的真相", "反派沒有追擊，只留下一句話：下一章，你會自己來找我", "世界規則在眾人面前改寫，所有人的立場瞬間翻盤"]
  };

  function pick(list, seed) {
    if (!Array.isArray(list) || !list.length) return "";
    const index = Math.abs(seed || 0) % list.length;
    return list[index];
  }

  function hash(text) {
    return String(text || "").split("").reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);
  }

  function compact(text, max = 260) {
    return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function latestUnresolved(previous) {
    const text = String(previous || "");
    const hook = text.match(/【章尾鉤子】\s*([\s\S]*?)(?:\n\n|$)/);
    const choice = text.match(/【下一回合選擇】\s*([\s\S]*?)$/);
    if (hook) return compact(hook[1], 160);
    if (choice) return compact(choice[1], 160);
    return compact(text.slice(-260), 180);
  }

  function titleFor(state, chapterNumber, seed) {
    const nouns = [state.conflictCore, state.villainCore, state.powerCore, state.worldCore, state.subTheme].filter(Boolean);
    const verbs = ["反噬", "逼近", "裂縫", "逆轉", "暗線", "代價", "回聲", "局中局"];
    return `第${chapterNumber}章　${pick(nouns, seed) || "命運"}${pick(verbs, seed + 3)}`;
  }

  function buildSection(label, text) {
    return `【${label}】\n${text}`;
  }

  function expandDraft(context) {
    const { state, chapterNumber, goal, conflict, action, reversal, hook, previousThread } = context;
    const protagonist = state.protagonist || state.heroType || "主角";
    const villain = state.villainCore || "對立面";
    const world = state.worldCore || state.themeMode || "這個世界";
    const power = state.powerCore || "核心能力";
    const style = state.styleMode || "爽文反擊";
    const premise = state.seed || state.coreIdea || "故事仍在推進，新的選擇正在成形";

    const paragraphs = [
      `上一章留下的餘波沒有散去。${protagonist}原本以為自己至少抓住了一點主動權，但${world}很快證明，這裡的規則不會因為一次小勝就停止運轉。${previousThread ? `上一章未解的線索是：「${previousThread}」。` : ""}這條線索像針一樣留在心口，提醒他不能只看眼前的安全。`,
      `本章的目標很明確：${goal}。可真正麻煩的是，${conflict}。這不是單純多一個敵人，而是把${protagonist}先前累積的判斷全部放到壓力下檢驗。若他此刻選錯，不只眼前局面會崩，前面埋下的伏筆也可能被${villain}搶先利用。`,
      `${protagonist}沒有立刻衝出去。${action}。他先把能確認的資訊分成三類：一類是已經發生的事，一類是別人希望他相信的事，最後一類則是無論誰都不願明說的事。真正的突破口，往往藏在第三類裡。`,
      `就在他準備推進時，${villain}的壓迫感終於落下。對方沒有只派人阻攔，也沒有用空泛威脅浪費時間，而是直接動到${protagonist}最不能失去的東西：選擇權。原本可以慢慢查的線索，被迫變成必須立刻處理的危機。`,
      `${power}在這時成了唯一能撬開局面的工具，但它並不免費。${protagonist}每使用一次，就等於把自己的記憶、信任、資源或身分安全推到桌面上交換。這一點讓本章的勝利不再乾淨，也讓讀者能看見能力背後的重量。`,
      `他仍然選擇行動。不是因為有把握，而是因為不行動的代價更大。${style}的節奏在這裡被拉緊：外部壓力越強，內部選擇越窄，主角越必須用一個具體行動證明自己沒有被劇情推著走。`,
      `情勢很快逆轉。${reversal}。這一刻，${protagonist}才明白上一章真正留下的不是答案，而是一個更大的問題。對方早就知道他會追查，也早就預留了讓他看見「部分真相」的路。`,
      `可這次他沒有照著對方安排的情緒反應走。他把憤怒壓下，把恐懼拆開，把所有想逃避的部分都重新放回主線。若${world}是一套會懲罰錯誤選擇的規則，那他就必須讓自己的下一步同時符合生存、反擊與長線伏筆回收。`,
      `本章最後，局面表面上暫時穩住。${protagonist}得到一個新線索，也付出一個不小的代價。某個角色的態度開始改變，某條情感線有了微小推進，但${villain}留下的陰影並沒有消失。`,
      `章尾，${hook}。`
    ];

    return paragraphs.join("\n\n");
  }

  function generateNextChapter(state) {
    const story = Array.isArray(state.story) ? state.story : [];
    const previous = story[story.length - 1] || state.seed || "";
    const seed = hash(previous + JSON.stringify(state) + story.length);
    const chapterNumber = story.length + 1;
    const goal = pick(sentenceBank.goals, seed);
    const conflict = pick(sentenceBank.conflicts, seed + 1);
    const action = pick(sentenceBank.actions, seed + 2);
    const reversal = pick(sentenceBank.reversals, seed + 3);
    const hook = pick(sentenceBank.hooks, seed + 4);
    const title = titleFor(state, chapterNumber, seed);
    const previousThread = latestUnresolved(previous);

    const draft = expandDraft({ state, chapterNumber, goal, conflict, action, reversal, hook, previousThread });
    return {
      mode: "offline-rule",
      chapterNumber,
      title,
      goal,
      conflict,
      action,
      reversal,
      hook,
      content: [
        `# ${title}`,
        "",
        buildSection("本章目標", goal),
        "",
        buildSection("主要衝突", conflict),
        "",
        buildSection("人物行動", action),
        "",
        buildSection("情勢逆轉", reversal),
        "",
        draft,
        "",
        buildSection("章尾鉤子", hook),
        "",
        buildSection("下一回合選擇", "A：追查新線索，但必須付出資源代價。\nB：先保護盟友，但會讓反派取得時間。\nC：公開部分真相，換取讀者與角色陣營的重新站隊。")
      ].join("\n"),
      summary: `${goal}；${conflict}；${reversal}`,
      createdAt: new Date().toISOString()
    };
  }

  window.OfflineNovelEngine = {
    generateNextChapter,
    latestUnresolved,
    words: (text) => String(text || "").replace(/\s+/g, "").length
  };
})();
