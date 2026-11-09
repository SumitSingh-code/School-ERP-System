"use client";

import { useEffect, useState } from "react";

export function PwaRegistration() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
      if (registration.waiting && navigator.serviceWorker.controller) setWaitingWorker(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) setWaitingWorker(worker);
        });
      });
    }).catch(() => undefined);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!waitingWorker) return null;
  return <aside className="fixed inset-x-3 bottom-4 z-50 mx-auto flex max-w-lg items-center justify-between gap-3 rounded-2xl bg-emerald-950 p-4 text-sm text-white shadow-xl" role="status">
    <span>A new School ERP update is ready.</span>
    <button type="button" onClick={() => waitingWorker.postMessage({ type: "SKIP_WAITING" })} className="min-h-11 shrink-0 rounded-xl bg-white px-4 font-semibold text-emerald-950">Reload</button>
  </aside>;
}
