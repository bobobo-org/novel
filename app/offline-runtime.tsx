"use client";

import { useEffect } from "react";

export default function OfflineRuntime() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/studio-service-worker.js", {
      scope: "/",
      updateViaCache: "none",
    }).catch(() => {
      // Offline registration is progressive enhancement. Runtime truth is
      // exposed by navigator.serviceWorker.controller instead of a fake state.
    });
  }, []);
  return null;
}
