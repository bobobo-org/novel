import { validateTaintEnvelope, type TaintEnvelope } from "./taint-label";

export function serializeTaintEnvelope(value: TaintEnvelope) {
  const validation = validateTaintEnvelope(value);
  if (!validation.valid) throw Object.assign(new Error("Taint envelope is invalid."), validation);
  return JSON.stringify(value);
}

export function parseTaintEnvelope(value: string) {
  const parsed = JSON.parse(value) as TaintEnvelope;
  const validation = validateTaintEnvelope(parsed);
  if (!validation.valid) throw Object.assign(new Error("Taint envelope is invalid."), validation);
  return parsed;
}
