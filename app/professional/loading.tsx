export default function ProfessionalLoading() {
  return (
    <main className="routeLoading" aria-busy="true" aria-live="polite">
      <div className="routeLoadingBrand" aria-hidden="true">庫</div>
      <section>
        <span>PROJECT LIBRARY</span>
        <h1>正在整理作品資料</h1>
        <p>畫面會立即保留位置，正式內容讀取完成後自動接上。</p>
        <div className="routeLoadingBars" aria-hidden="true"><i /><i /><i /></div>
      </section>
    </main>
  );
}
