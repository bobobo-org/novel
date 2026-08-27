"use client";

import { useEffect } from "react";

type OfflineRuntimeProps = {
  appCommit: string;
  assetManifestDigest: string;
};

export default function OfflineRuntime({
  appCommit,
  assetManifestDigest,
}: OfflineRuntimeProps) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const identityMessage = {
      type: "NOVEL_RELEASE_IDENTITY",
      appCommit,
      assetManifestDigest,
    };
    const publishIdentity = (registration: ServiceWorkerRegistration) => {
      registration.installing?.postMessage(identityMessage);
      registration.waiting?.postMessage(identityMessage);
      registration.active?.postMessage(identityMessage);
      navigator.serviceWorker.controller?.postMessage(identityMessage);
    };
    const handleControllerChange = () => {
      void navigator.serviceWorker.ready.then(publishIdentity);
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    void navigator.serviceWorker.register("/studio-service-worker.js", {
      scope: "/",
      updateViaCache: "none",
    }).then(async (registration) => {
      publishIdentity(registration);
      const ready = await navigator.serviceWorker.ready;
      publishIdentity(ready);
    }).catch(() => {
      // Offline registration is progressive enhancement. Runtime truth is
      // exposed by navigator.serviceWorker.controller instead of a fake state.
    });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, [appCommit, assetManifestDigest]);
  return null;
}
