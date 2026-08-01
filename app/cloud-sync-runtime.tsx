"use client";

import { useEffect } from "react";
import { startCloudSyncRuntime } from "@/lib/novel-ai/cloud-sync";

export default function CloudSyncRuntime() {
  useEffect(() => startCloudSyncRuntime(), []);
  return null;
}
