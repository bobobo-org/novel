import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  PRIVATE_HUB_PUBLIC_LOUNGE_PRODUCER_VERSION,
  defaultPublicLoungeAttestationKeyFiles,
} from "./public-lounge-attestation-producer.mjs";

const execFile = promisify(execFileCallback);

const WINDOWS_ACL_SENTINEL = "NOVEL_ATTESTATION_KEY_ACL_OK";
const WINDOWS_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$TargetPath = $env:NOVEL_ATTESTATION_KEY_ACL_TARGET
if ([string]::IsNullOrWhiteSpace($TargetPath)) {
  throw 'ATTESTATION_KEY_ACL_TARGET_MISSING'
}

$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$noInheritance = [System.Security.AccessControl.InheritanceFlags]::None
$noPropagation = [System.Security.AccessControl.PropagationFlags]::None

$sealedAcl = New-Object System.Security.AccessControl.FileSecurity
$sealedAcl.SetAccessRuleProtection($true, $false)
$sealedAcl.SetOwner($currentSid)
foreach ($sid in @($currentSid, $systemSid)) {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule -ArgumentList @(
    $sid, $fullControl, $noInheritance, $noPropagation, $allow
  )
  [void]$sealedAcl.AddAccessRule($rule)
}
[System.IO.File]::SetAccessControl($TargetPath, $sealedAcl)

$actualAcl = [System.IO.File]::GetAccessControl(
  $TargetPath,
  [System.Security.AccessControl.AccessControlSections]::Owner -bor
    [System.Security.AccessControl.AccessControlSections]::Access
)
if (-not $actualAcl.AreAccessRulesProtected) {
  throw 'ATTESTATION_KEY_ACL_INHERITANCE_ENABLED'
}
if ($actualAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $currentSid.Value) {
  throw 'ATTESTATION_KEY_ACL_OWNER_INVALID'
}

$expectedSids = @($currentSid.Value, $systemSid.Value)
$actualRules = @($actualAcl.GetAccessRules(
  $true,
  $true,
  [System.Security.Principal.SecurityIdentifier]
))
if ($actualRules.Count -ne $expectedSids.Count) {
  throw 'ATTESTATION_KEY_ACL_ENTRY_COUNT_INVALID'
}
foreach ($rule in $actualRules) {
  if ($rule.IsInherited -or
      $rule.AccessControlType -ne $allow -or
      $rule.FileSystemRights -ne $fullControl -or
      $rule.InheritanceFlags -ne $noInheritance -or
      $rule.PropagationFlags -ne $noPropagation -or
      $expectedSids -notcontains $rule.IdentityReference.Value) {
    throw 'ATTESTATION_KEY_ACL_ENTRY_INVALID'
  }
}
foreach ($sid in $expectedSids) {
  if (@($actualRules | Where-Object { $_.IdentityReference.Value -eq $sid }).Count -ne 1) {
    throw 'ATTESTATION_KEY_ACL_REQUIRED_ENTRY_MISSING'
  }
}

Write-Output '${WINDOWS_ACL_SENTINEL}'
`;

function codedError(code, cause) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function environmentFromArgs(args) {
  const environment = args.find((value) => value === "preview" || value === "production");
  if (!environment) throw new Error("ATTESTATION_ENVIRONMENT_REQUIRED");
  return environment;
}

function publicIdentity(privateKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("ATTESTATION_KEY_TYPE_INVALID");
  const publicKey = crypto.createPublicKey(privateKey);
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const publicKeyFingerprint = crypto.createHash("sha256").update(publicDer).digest("hex");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    publicKeyFingerprint,
  };
}

async function secureWindowsPrivateKeyFile(file, runExecFile = execFile) {
  let result;
  try {
    const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
    if (!windowsRoot || !path.win32.isAbsolute(windowsRoot)) {
      throw codedError("ATTESTATION_KEY_WINDOWS_ROOT_UNAVAILABLE");
    }
    const powershell = path.win32.join(
      windowsRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    result = await runExecFile(powershell, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      WINDOWS_ACL_SCRIPT,
    ], {
      windowsHide: true,
      env: {
        ...process.env,
        NOVEL_ATTESTATION_KEY_ACL_TARGET: file,
      },
    });
  } catch (error) {
    throw codedError("ATTESTATION_KEY_ACL_HARDEN_FAILED", error);
  }
  if (!String(result?.stdout || "").split(/\r?\n/u).includes(WINDOWS_ACL_SENTINEL)) {
    throw codedError("ATTESTATION_KEY_ACL_VERIFICATION_FAILED");
  }
}

async function hardenPrivateKeyFile(file, dependencies) {
  if (dependencies.platform !== "win32") {
    await dependencies.chmodFile(file, 0o600);
    return "posix-owner-read-write";
  }
  try {
    await dependencies.secureWindowsFile(file);
  } catch (error) {
    if (error?.code === "ATTESTATION_KEY_ACL_HARDEN_FAILED"
      || error?.code === "ATTESTATION_KEY_ACL_VERIFICATION_FAILED") {
      throw error;
    }
    throw codedError("ATTESTATION_KEY_ACL_HARDEN_FAILED", error);
  }
  return "windows-owner-and-system-only";
}

export function createPublicLoungeAttestationKeyProvisioner(overrides = {}) {
  const dependencies = {
    platform: overrides.platform || process.platform,
    chmodFile: overrides.chmodFile || chmod,
    linkFile: overrides.linkFile || link,
    makeDirectory: overrides.makeDirectory || mkdir,
    openFile: overrides.openFile || open,
    readTextFile: overrides.readTextFile || readFile,
    removeFile: overrides.removeFile || rm,
    renameFile: overrides.renameFile || rename,
    randomBytes: overrides.randomBytes || crypto.randomBytes,
    generateKeyPair: overrides.generateKeyPair || (() => crypto.generateKeyPairSync("ed25519")),
    secureWindowsFile: overrides.secureWindowsFile || secureWindowsPrivateKeyFile,
  };

  return async function provisionPublicLoungeAttestationKeyWithDependencies(options = {}) {
    const environment = options.environment;
    if (environment !== "preview" && environment !== "production") {
      throw new Error("ATTESTATION_ENVIRONMENT_REQUIRED");
    }
    const runtimeDir = options.runtimeDir
      || process.env.NOVEL_PRIVATE_HUB_RUNTIME_DIR
      || path.join(process.env.LOCALAPPDATA || os.homedir(), "NovelPrivateHub");
    const keyFile = options.keyFile || defaultPublicLoungeAttestationKeyFiles(runtimeDir)[environment];
    const keyDirectory = path.dirname(keyFile);
    await dependencies.makeDirectory(keyDirectory, { recursive: true });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      let privateKeyPem;
      let created = false;
      try {
        privateKeyPem = await dependencies.readTextFile(keyFile, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        const pair = dependencies.generateKeyPair();
        privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
        created = true;
      }

      const identity = publicIdentity(privateKeyPem);
      const tempFile = path.join(
        keyDirectory,
        `.${path.basename(keyFile)}.${dependencies.randomBytes(16).toString("hex")}.tmp`,
      );
      let installed = false;
      let tempHandle = null;
      try {
        tempHandle = await dependencies.openFile(tempFile, "wx", 0o600);
        const acl = await hardenPrivateKeyFile(tempFile, dependencies);
        await tempHandle.writeFile(privateKeyPem, { encoding: "utf8" });
        await tempHandle.sync();
        await tempHandle.close();
        tempHandle = null;
        const sealedPrivateKeyPem = await dependencies.readTextFile(tempFile, "utf8");
        if (sealedPrivateKeyPem !== privateKeyPem) {
          throw codedError("ATTESTATION_KEY_CHANGED_DURING_SEALING");
        }
        publicIdentity(sealedPrivateKeyPem);

        if (created) {
          try {
            // A hard link installs the already-sealed inode atomically without
            // allowing a concurrent first-run provisioner to replace its key.
            await dependencies.linkFile(tempFile, keyFile);
          } catch (error) {
            if (error?.code === "EEXIST") continue;
            throw error;
          }
        } else {
          // Same-directory rename preserves the sealed security descriptor and
          // atomically replaces the old key only after sealing has succeeded.
          await dependencies.renameFile(tempFile, keyFile);
        }
        installed = true;

        const keyId = `novel-pl-${environment}-${identity.publicKeyFingerprint.slice(0, 24)}`;
        return {
          schemaVersion: "private-hub-public-lounge-key-provisioning-v1",
          status: created ? "created" : "already_exists",
          environment,
          audience: `novel-public-lounge:${environment}`,
          producerVersion: PRIVATE_HUB_PUBLIC_LOUNGE_PRODUCER_VERSION,
          keyId,
          publicKeyFingerprint: identity.publicKeyFingerprint,
          publicKeyPem: identity.publicKeyPem,
          privateKeyExported: false,
          privateKeyAcl: acl,
        };
      } finally {
        if (tempHandle) {
          await tempHandle.close().catch(() => undefined);
        }
        if (!installed || created) {
          try {
            await dependencies.removeFile(tempFile, { force: true });
          } catch (error) {
            throw codedError("ATTESTATION_KEY_TEMP_CLEANUP_FAILED", error);
          }
        }
      }
    }
    throw codedError("ATTESTATION_KEY_PROVISIONING_RACE");
  };
}

export const provisionPublicLoungeAttestationKey = createPublicLoungeAttestationKeyProvisioner();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  provisionPublicLoungeAttestationKey({ environment: environmentFromArgs(process.argv.slice(2)) })
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.code || error.message || "ATTESTATION_KEY_PROVISION_FAILED"}\n`);
      process.exitCode = 1;
    });
}
