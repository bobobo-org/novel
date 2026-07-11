export default function Home() {
  return (
    <main className="min-h-screen bg-[#090d18] px-6 py-10 text-[#edf4ff]">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl flex-col justify-center">
        <p className="mb-4 text-sm font-semibold tracking-[0.2em] text-[#f2c86b]">
          ZHUTIAN NOVEL SYSTEM
        </p>
        <h1 className="max-w-3xl text-4xl font-black leading-tight sm:text-6xl">
          諸天萬界小說生成系統
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-[#b8c8e8]">
          v5.9.1 閉端 AI 多章批量操作章節號修正版已合併到此 repo。
          目前完整離線平台版以靜態 HTML 形式提供，包含 Explore、快速創作、
          ChatGPT 接力、小型閉端 AI、章節版本管理、多章批量操作與一致性守護。
        </p>

        <div className="mt-10 flex flex-col gap-4 sm:flex-row">
          <a
            className="rounded-lg border border-[#97763b] bg-[#493916] px-6 py-4 text-center font-bold text-[#ffe4a1] transition hover:border-[#f2c86b]"
            href="/legacy/novel-system.html"
          >
            開啟 v5.9.1 完整系統
          </a>
          <a
            className="rounded-lg border border-[#344967] bg-[#182642] px-6 py-4 text-center font-bold text-[#edf4ff] transition hover:border-[#5ba7ff]"
            href="/legacy/使用說明_README.txt"
          >
            查看使用說明
          </a>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            ["閉端 AI", "章節草稿、迭代、監督、一致性檢查"],
            ["版本分支", "保存、比對、設為主線、分支實驗"],
            ["批量操作", "最近多章統一加強反派、代價與情感線"],
          ].map(([title, body]) => (
            <article
              className="rounded-xl border border-[#2c3852] bg-[#141d31] p-5"
              key={title}
            >
              <h2 className="text-lg font-bold text-[#f2c86b]">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-[#b8c8e8]">{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
