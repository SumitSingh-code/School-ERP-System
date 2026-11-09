"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 12 * 60 * 1000;

export function SessionRefresh() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    let lastInteraction = Date.now();
    const refresh = async () => {
      try {
        const response = await fetch("/api/auth/refresh", { method: "POST", cache: "no-store" });
        if (active && response.ok) router.refresh();
      } catch {
        // Keep the current screen; the next focus or interval can retry.
      }
    };
    const noteActivity = () => { lastInteraction = Date.now(); };
    void refresh();
    const timer = window.setInterval(() => {
      if (Date.now() - lastInteraction < REFRESH_INTERVAL_MS) void refresh();
    }, REFRESH_INTERVAL_MS);
    const onFocus = () => {
      if (Date.now() - lastInteraction < 30 * 60 * 1000) void refresh();
    };
    for (const event of ["pointerdown", "keydown", "touchstart", "click"]) window.addEventListener(event, noteActivity, { passive: true });
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      for (const event of ["pointerdown", "keydown", "touchstart", "click"]) window.removeEventListener(event, noteActivity);
    };
  }, [router]);

  return null;
}
