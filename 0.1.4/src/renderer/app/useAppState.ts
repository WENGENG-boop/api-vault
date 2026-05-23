import { useEffect, useState } from "react";
import type { AppState } from "../../shared/types";
import { apiClient } from "../shared/api";
import { STATE_REFRESH_INTERVAL_MS } from "../shared/config";

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiClient.getState().then(setState).catch((error) => setError(error.message));
  }, []);

  useEffect(() => {
    if (!state?.unlocked) return;
    let timer: number | undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      apiClient.getState().then(setState).catch(() => {});
    };
    const start = () => {
      if (timer !== undefined || document.visibilityState !== "visible") return;
      timer = window.setInterval(refresh, STATE_REFRESH_INTERVAL_MS);
    };
    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };
    start();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [state?.unlocked]);

  return { state, setState, error, setError };
}
