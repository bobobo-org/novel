const preferred: Record<string, string> = {
  "这": "這", "为": "為", "说": "說", "后": "後", "里": "裡", "发": "發", "体": "體", "书": "書", "门": "門",
};

export function editTraditionalChinese(text: string) {
  let output = text;
  const replacements: string[] = [];
  for (const [from, to] of Object.entries(preferred)) {
    if (output.includes(from)) {
      output = output.split(from).join(to);
      replacements.push(`${from}→${to}`);
    }
  }
  return { text: output, replacements, naturalnessWarnings: /的的|了了|，，|。。/.test(output) ? ["疑似重字或重複標點"] : [] };
}
