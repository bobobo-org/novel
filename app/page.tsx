const entries = [
  ["開始新故事", "從五個簡單步驟建立人物、世界與玩法。", "/studio?screen=create"],
  ["繼續我的故事", "回到最近作品與最後編輯的章節。", "/studio?screen=write"],
  ["玩互動故事", "讓每次選擇改變分支與故事數值。", "/studio?screen=choice"],
  ["修改目前作品", "改寫選取內容，先預覽候選稿再決定。", "/studio?screen=write&task=rewrite_scene"],
  ["檢查整本作品", "檢查矛盾、時間線與未回收伏筆。", "/studio?screen=inspect"],
  ["我的作品", "管理作品、版本、存檔與備份。", "/studio?screen=library"],
];

export default function Home() {
  return <main className="frontdoor">
    <header className="frontdoorNav">
      <a className="brandLockup" href="/" aria-label="諸天萬界小說生成系統首頁"><span className="brandSeal">創</span><span><b>諸天萬界</b><small>小說生成系統</small></span></a>
      <nav aria-label="主要導覽"><a className="active" href="/">首頁</a><a href="/studio?screen=create">創作</a><a href="/studio?screen=write">AI 助手</a><a href="/studio?screen=choice">互動故事</a><a href="/studio?screen=library">我的作品</a></nav>
      <a className="navCta" href="/studio">進入創作中心</a>
    </header>
    <section className="frontdoorHero">
      <div className="heroCopy"><p className="eyebrow">你的故事，從這裡開始</p><h1>諸天萬界小說生成系統</h1><p className="lead">創作、互動、養成與經營的 AI 故事平台</p><h2>今天想創作什麼樣的故事？</h2><div className="heroActions"><a className="primaryAction" href="/studio?screen=create">開始新故事</a><a className="secondaryAction" href="/studio?screen=write">繼續最近作品</a></div></div>
      <div className="worldPreview" aria-label="故事世界預覽"><span className="moon"/><span className="mountain mountainBack"/><span className="mountain mountainFront"/><div className="previewCaption"><small>目前模式</small><b>本機優先・候選稿安全邊界</b></div></div>
    </section>
    <section className="frontdoorEntries" aria-labelledby="entryTitle"><div className="sectionTitle"><span>六種開始方式</span><h2 id="entryTitle">選一件現在最想做的事</h2></div><div className="entryGrid">{entries.map(([title, description, href], index) => <a className="entryCard" href={href} key={title}><span className="entryIndex">{String(index + 1).padStart(2,"0")}</span><h3>{title}</h3><p>{description}</p><span className="entryArrow" aria-hidden="true">→</span></a>)}</div></section>
    <footer className="frontdoorFooter"><p>作品預設保存在目前裝置。AI 產出先進入候選稿，不會直接覆蓋正文。</p><a href="/studio?mode=professional">專業工具</a></footer>
  </main>;
}
