"use client";

import { useWorkbench } from "@/lib/stores/workbench";

export function Toast() {
  const { toast } = useWorkbench();
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm text-bg shadow-lg">
      {toast}
    </div>
  );
}
