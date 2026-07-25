export function planResponseStructure(task: "creative" | "fact" | "analysis" | "research" | "adult_creative" | "high_risk_real_world") {
  const structures = {
    creative: ["主要情節", "角色行動", "後果與鉤子"],
    adult_creative: ["成年與同意確認", "情緒與關係", "場景推進", "後果"],
    fact: ["結論", "可驗證事實", "不確定事項"],
    analysis: ["問題拆解", "證據", "反例", "結論"],
    research: ["研究問題", "來源", "多種解釋", "限制", "結論"],
    high_risk_real_world: ["風險界定", "可驗證資訊", "安全選項", "限制"],
  };
  return structures[task];
}
