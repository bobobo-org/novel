export type ManagementEra = "modern" | "ancient" | "cultivation";

export type ManagementInvestmentDefinition = {
  id: string;
  name: string;
  category: string;
  capital: string;
  returnCycle: string;
  liquidity: "高" | "中" | "低";
  principalRisk: string;
  stakeholders: string;
};

const CATALOG: Record<ManagementEra, ManagementInvestmentDefinition[]> = {
  modern: [
    { id: "modern.equity", name: "企業股權與新創持股", category: "股權", capital: "現金、估值與表決權", returnCycle: "季／年", liquidity: "中", principalRisk: "稀釋、估值下修與治理衝突", stakeholders: "股東、董事會、員工與監管者" },
    { id: "modern.property", name: "店面與商用不動產", category: "不動產", capital: "頭期、貸款與維護費", returnCycle: "月／年", liquidity: "低", principalRisk: "空置、利率與區位衰退", stakeholders: "房東、銀行、租戶與地方社群" },
    { id: "modern.supply", name: "供應鏈與產能擴建", category: "實業", capital: "設備、庫存與長約", returnCycle: "月／季", liquidity: "低", principalRisk: "需求誤判、斷鏈與固定成本", stakeholders: "供應商、客戶、員工與競爭者" },
    { id: "modern.research", name: "研發、專利與品牌內容", category: "無形資產", capital: "研發工時、人才與行銷預算", returnCycle: "季／年", liquidity: "低", principalRisk: "研發失敗、侵權與口碑反噬", stakeholders: "研發團隊、合作方、消費者與平台" },
  ],
  ancient: [
    { id: "ancient.land", name: "田莊、水利與糧倉", category: "土地", capital: "地契、佃租與灌溉工役", returnCycle: "季／年", liquidity: "低", principalRisk: "天災、兼併、徭役與欠收", stakeholders: "佃戶、宗族、官府與地方豪強" },
    { id: "ancient.shop", name: "商號、行棧與跨城商路", category: "商貿", capital: "貨本、倉儲與通關文牒", returnCycle: "旬／月", liquidity: "中", principalRisk: "劫掠、禁運、價格波動與合夥背信", stakeholders: "掌櫃、商幫、官府與沿途勢力" },
    { id: "ancient.escort", name: "鏢局、船隊與護運契約", category: "服務", capital: "人手、坐騎、船隻與擔保金", returnCycle: "單次／月", liquidity: "中", principalRisk: "傷亡、失鏢、天候與聲譽破產", stakeholders: "鏢師、客商、幫會與地方官" },
    { id: "ancient.mine", name: "礦山、鹽引與官營特許", category: "特許資產", capital: "採掘工具、勞力與特許關係", returnCycle: "月／季", liquidity: "低", principalRisk: "礦難、查抄、貪腐與權力更替", stakeholders: "礦工、官府、宗族與軍鎮" },
  ],
  cultivation: [
    { id: "cultivation.field", name: "靈田、藥園與靈泉", category: "修行生產", capital: "靈石、種源、地脈與靈植師", returnCycle: "季／秘境年", liquidity: "低", principalRisk: "蟲災、靈氣衰退、劫掠與藥性失衡", stakeholders: "靈植峰、丹峰、家族與坊市" },
    { id: "cultivation.market", name: "坊市鋪位、丹坊與符坊", category: "修行商貿", capital: "靈石、配方、店契與煉製人力", returnCycle: "旬／月", liquidity: "中", principalRisk: "炸爐、偽符、價格戰與宗門抽成", stakeholders: "丹師、符師、散修盟與坊市執事" },
    { id: "cultivation.mine", name: "靈礦、地火與煉器工坊", category: "修行實業", capital: "礦脈權、陣法、礦工與煉器師", returnCycle: "月／年", liquidity: "低", principalRisk: "礦脈枯竭、魔氣、爭奪與工坊事故", stakeholders: "器峰、陣院、宗門與鄰近勢力" },
    { id: "cultivation.realm", name: "秘境名額、洞府與護山陣份額", category: "戰略資產", capital: "功勳、靈石、陣樞與守備承諾", returnCycle: "秘境週期／長期", liquidity: "低", principalRisk: "秘境崩塌、陣眼受損、分配衝突與外敵", stakeholders: "宗主、長老、各峰、家族與散修盟" },
  ],
};

export function resolveManagementEra(worldContext: string): ManagementEra {
  if (/修仙|仙俠|修真|宗門|靈石|靈田|秘境|坊市|金丹|元嬰/iu.test(worldContext)) return "cultivation";
  if (/古代|王朝|皇朝|朝廷|江湖|武俠|商號|田莊|侯府|國公府/iu.test(worldContext)) return "ancient";
  return "modern";
}

export function managementInvestmentCatalog(worldContext: string) {
  return CATALOG[resolveManagementEra(worldContext)];
}

export function managementInvestmentStrategy(worldContext: string, strategy: "steady" | "resource" | "bold") {
  const assets = managementInvestmentCatalog(worldContext);
  const asset = assets[strategy === "steady" ? 0 : strategy === "resource" ? 1 : 3] ?? assets[0];
  return {
    asset,
    action: strategy === "steady"
      ? `先小額投入「${asset.name}」，核對本金、收益週期與最壞損失後再擴張`
      : strategy === "resource"
        ? `聯合${asset.stakeholders}投資「${asset.name}」，用契約明定持有人、分潤、退出與違約責任`
        : `集中資源搶下「${asset.name}」的控制權，但保留能承受「${asset.principalRisk}」的止損線`,
  };
}
