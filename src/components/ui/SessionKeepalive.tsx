"use client";

import { useEffect, useRef } from "react";

/**
 * Slides the server idle window while the user is active. It records activity via
 * passive listeners and, at most once per interval, POSTs /api/auth/refresh to
 * re-stamp the session's `seen`. An idle user makes no calls, so the session
 * lapses server-side; if a refresh comes back 401 (already expired/revoked), it
 * redirects to sign in. Renders nothing.
 */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // re-stamp at most every 5 min

export function SessionKeepalive(): null {
  const activeSinceTick = useRef(false);

  useEffect(() => {
    const mark = (): void => {
      activeSinceTick.current = true;
    };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));

    const timer = window.setInterval(() => {
      if (!activeSinceTick.current) return; // idle this interval — let it lapse
      activeSinceTick.current = false;
      void fetch("/api/auth/refresh", { method: "POST" })
        .then((res) => {
          if (res.status === 401) window.location.assign("/");
        })
        .catch(() => {
          /* transient network error — retry next interval */
        });
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, mark));
    };
  }, []);

  return null;
}
