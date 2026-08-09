import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = process.cwd();

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = await resolveTypeScriptFile(path.join(root, specifier.slice(2)));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const parentDirectory = path.dirname(fileURLToPath(context.parentURL));
    const resolved = await resolveTypeScriptFile(path.resolve(parentDirectory, specifier));
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  return defaultResolve(specifier, context, defaultResolve);
}

export async function load(url, context, defaultLoad) {
  if (url.startsWith("file:") && /\.tsx?$/.test(new URL(url).pathname)) {
    const filePath = fileURLToPath(url);
    const source = await fs.readFile(filePath, "utf8");
    const transpiled = ts.transpileModule(source, {
      fileName: filePath,
      compilerOptions: {
        allowImportingTsExtensions: true,
        esModuleInterop: true,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022,
      },
      reportDiagnostics: false,
    });
    return {
      format: "module",
      source: transpiled.outputText,
      shortCircuit: true,
    };
  }

  return defaultLoad(url, context, defaultLoad);
}

async function resolveTypeScriptFile(absolutePath) {
  const candidates = [
    absolutePath,
    `${absolutePath}.ts`,
    `${absolutePath}.tsx`,
    path.join(absolutePath, "index.ts"),
    path.join(absolutePath, "index.tsx"),
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Continue probing the explicit TypeScript candidates.
    }
  }
  return null;
}
