import Link from "next/link";
import ProfessionalClient from "./professional-client";

export default function ProfessionalPage() {
  return <main className="professionalShell"><header><div><span>專業工具</span><h1>系統、資料與進階創作工具</h1><p>先用白話確認目前狀態，需要排查問題時再展開技術資料。</p></div><Link href="/studio">返回創作中心</Link></header><ProfessionalClient /></main>;
}
