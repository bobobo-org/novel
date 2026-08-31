import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.cwd();

export async function resolve(specifier, context, defaultResolve) {
  // Next.js treats `server-only` as a build-time boundary package. Focused
  // Node contract tests do not install that virtual package, so resolve its
  // side-effect-only import to an empty module without changing production.
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export%20{}", shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const absolute = path.join(root, specifier.slice(2));
    const resolved = resolveTsFile(absolute);
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const absolute = path.resolve(parentDir, specifier);
    const resolved = resolveTsFile(absolute);
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  return defaultResolve(specifier, context, defaultResolve);
}

function resolveTsFile(absolute) {
  const candidates = [
    absolute,
    `${absolute}.ts`,
    `${absolute}.tsx`,
    path.join(absolute, "index.ts"),
    path.join(absolute, "index.tsx"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}
