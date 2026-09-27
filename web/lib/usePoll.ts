"use client";
import { useEffect, useState } from "react";

/** Re-run `load` every `ms` while the page is visible — the pipeline is async. */
export function usePoll<T>(load: () => Promise<T>, ms = 2000, deps: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    const tick = () =>
      load()
        .then((d) => alive && (setData(d), setError(undefined)))
        .catch((e: Error) => alive && setError(e.message));
    tick();
    const t = setInterval(() => document.visibilityState === "visible" && tick(), ms);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error };
}
