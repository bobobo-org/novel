(function(){
  const items=[["home","首頁"],["create","開始創作"],["write","繼續寫作"],["library","我的作品"],["rewrite","修改作品"],["inspect","檢查作品"],["choice","互動故事"],["world","角色與世界"],["dashboard","任務與成就"],["backup","存檔與備份"]];
  function render(){const s=NovelConsumer.state;return `<aside class="p11-rail"><a class="p11-logo" href="/"><b>諸天萬界</b><small>小說生成系統</small></a><button class="p11-new" data-screen="create">＋ 建立新作品</button><nav>${items.map(([id,label])=>`<button data-screen="${id}" class="${s.screen===id?"active":""}">${label}</button>`).join("")}</nav><button class="p11-pro" data-mode="professional">專業工具</button></aside>`}
  function bind(root){root.querySelectorAll("[data-screen]").forEach(btn=>btn.addEventListener("click",()=>{document.body.classList.remove("p11-menu-open");window.ConsumerApp.navigate(btn.dataset.screen)}));root.querySelector("[data-mode]")?.addEventListener("click",()=>window.ConsumerApp.setMode("professional"))}
  window.ConsumerNavigation={render,bind,items};
})();
