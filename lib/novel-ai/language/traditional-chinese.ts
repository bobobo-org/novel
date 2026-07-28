import OpenCC from "opencc-js/cn2t";

const toTaiwanTraditional = OpenCC.Converter({ from: "cn", to: "tw" });

export function normalizeTraditionalChinese(value: string) {
  return toTaiwanTraditional(value);
}

export function containsConvertibleSimplifiedChinese(value: string) {
  return normalizeTraditionalChinese(value) !== value;
}
