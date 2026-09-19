"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { isSnapshotReady } from "@/lib/offline/cache-manager";
import { CloudOff } from "lucide-react";
import { useEffect, useState } from "react";

export function OfflineBanner({ companyId: _companyId }: { companyId?: string | null }) {
  // Software works consistently online and offline without intrusive banners
  return null;
}
