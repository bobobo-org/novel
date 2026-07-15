export type OllamaStreamEvent =
  | { type: "start"; requestId: string }
  | { type: "token"; text: string }
  | { type: "structured_delta"; value: unknown }
  | { type: "progress"; done: boolean }
  | { type: "warning"; message: string }
  | { type: "completed"; content: string }
  | { type: "cancelled" }
  | { type: "error"; message: string };

export function parseOllamaStreamLine(line: string): OllamaStreamEvent | null {
  if (!line.trim()) return null;
  try {
    const payload = JSON.parse(line);
    if (payload.error) return { type: "error", message: String(payload.error) };
    if (payload.done) return { type: "progress", done: true };
    const text = payload.response ?? payload.message?.content ?? "";
    return text ? { type: "token", text: String(text) } : { type: "progress", done: false };
  } catch {
    return { type: "warning", message: "Invalid Ollama stream JSON line" };
  }
}

export async function collectOllamaStream(response: Response, signal?: AbortSignal) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  while (true) {
    if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseOllamaStreamLine(line);
      if (event?.type === "token") output += event.text;
    }
  }
  return output;
}
