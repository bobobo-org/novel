import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

function verificationError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

async function findFunctionConfigs(directory) {
  const configs = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      configs.push(...await findFunctionConfigs(entryPath));
    } else if (entry.isFile() && entry.name === ".vc-config.json") {
      configs.push(entryPath);
    }
  }
  return configs;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function isWithinWorkspace(workspace, candidate) {
  const candidateRelative = relative(workspace, candidate);
  return candidateRelative !== ".."
    && !candidateRelative.startsWith(`..${sep}`)
    && !isAbsolute(candidateRelative);
}

function isExcludedReference(reference, excludedReferencePrefixes) {
  const normalized = reference.replaceAll("\\", "/").replace(/^\.\//u, "");
  return excludedReferencePrefixes.some((prefix) => {
    const normalizedPrefix = prefix.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");
    return normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}/`);
  });
}

export async function verifyVercelPrebuiltFileReferences({
  workspace = process.cwd(),
  outputDirectory = ".vercel/output",
  excludedReferencePrefixes = [".next/cache"],
} = {}) {
  const workspaceRoot = resolve(workspace);
  const outputRoot = resolve(workspaceRoot, outputDirectory);
  const outputConfig = join(outputRoot, "config.json");
  if (!await pathExists(outputConfig)) {
    throw verificationError("VERCEL_PREBUILT_OUTPUT_CONFIG_MISSING", { outputConfig });
  }

  const functionConfigs = await findFunctionConfigs(outputRoot);
  if (functionConfigs.length === 0) {
    throw verificationError("VERCEL_PREBUILT_FUNCTION_CONFIG_MISSING", { outputRoot });
  }

  const references = [];
  for (const configPath of functionConfigs) {
    let config;
    try {
      config = JSON.parse(await readFile(configPath, "utf8"));
    } catch (error) {
      throw verificationError("VERCEL_PREBUILT_FUNCTION_CONFIG_INVALID", {
        configPath: relative(workspaceRoot, configPath),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    if (config.filePathMap === undefined) continue;
    if (!config.filePathMap || Array.isArray(config.filePathMap) || typeof config.filePathMap !== "object") {
      throw verificationError("VERCEL_PREBUILT_FILE_PATH_MAP_INVALID", {
        configPath: relative(workspaceRoot, configPath),
      });
    }
    for (const reference of Object.values(config.filePathMap)) {
      const normalizedReference = typeof reference === "string"
        ? reference.replace(/^\.\//u, "")
        : "";
      if (typeof reference !== "string"
        || normalizedReference.length === 0
        || normalizedReference === "."
        || reference.includes("\0")
        || reference.includes("\\")
        || isAbsolute(reference)) {
        throw verificationError("VERCEL_PREBUILT_FILE_REFERENCE_INVALID", {
          configPath: relative(workspaceRoot, configPath),
        });
      }
      const resolvedReference = join(workspaceRoot, reference);
      if (resolvedReference === workspaceRoot || !isWithinWorkspace(workspaceRoot, resolvedReference)) {
        throw verificationError("VERCEL_PREBUILT_FILE_REFERENCE_ESCAPES_WORKSPACE", {
          configPath: relative(workspaceRoot, configPath),
          reference,
        });
      }
      if (isExcludedReference(reference, excludedReferencePrefixes)) {
        throw verificationError("VERCEL_PREBUILT_REFERENCE_EXCLUDED_FROM_ARCHIVE", {
          configPath: relative(workspaceRoot, configPath),
          reference,
        });
      }
      references.push({ configPath, reference, resolvedReference });
    }
  }

  const uniqueReferences = new Map();
  for (const entry of references) {
    if (!uniqueReferences.has(entry.resolvedReference)) {
      uniqueReferences.set(entry.resolvedReference, entry);
    }
  }
  const missing = [];
  const uniqueReferenceEntries = [...uniqueReferences.values()];
  const statConcurrency = 128;
  for (let index = 0; index < uniqueReferenceEntries.length; index += statConcurrency) {
    const batch = uniqueReferenceEntries.slice(index, index + statConcurrency);
    const existence = await Promise.all(batch.map((entry) => pathExists(entry.resolvedReference)));
    for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
      if (!existence[batchIndex]) {
        missing.push({
          configPath: relative(workspaceRoot, batch[batchIndex].configPath),
          reference: batch[batchIndex].reference,
        });
      }
    }
  }
  if (missing.length > 0) {
    throw verificationError("VERCEL_PREBUILT_FILE_REFERENCE_MISSING", {
      missingCount: missing.length,
      missing: missing.slice(0, 20),
    });
  }

  const topLevelReferenceCounts = {};
  for (const { reference } of uniqueReferenceEntries) {
    const topLevel = reference.replace(/^\.\//u, "").split("/", 1)[0];
    topLevelReferenceCounts[topLevel] = (topLevelReferenceCounts[topLevel] || 0) + 1;
  }
  return {
    schemaVersion: "vercel-prebuilt-file-references-v1",
    status: "PASS",
    functionConfigCount: functionConfigs.length,
    referenceCount: references.length,
    uniqueReferenceCount: uniqueReferences.size,
    topLevelReferenceCounts,
    excludedReferencePrefixes,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const report = await verifyVercelPrebuiltFileReferences();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      schemaVersion: "vercel-prebuilt-file-references-v1",
      status: "FAIL",
      code: error?.code || "VERCEL_PREBUILT_FILE_REFERENCE_VERIFICATION_FAILED",
      details: error?.details || {},
    }, null, 2));
    process.exitCode = 1;
  }
}
