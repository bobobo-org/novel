export default function StudioLoading() {
  return (
    <main className="routeLoading" aria-busy="true" aria-live="polite">
      <div className="routeLoadingBrand" aria-hidden="true">創</div>
      <section>
        <span>STORY WORKSPACE</span>
        <h1>正在打開你的故事世界</h1>
        <p>角色、章節與圖像正在從這台裝置安全讀取。</p>
        <div className="routeLoadingBars" aria-hidden="true"><i /><i /><i /></div>
      </section>
    </main>
  );
}
