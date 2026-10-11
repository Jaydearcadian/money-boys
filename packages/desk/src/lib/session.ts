import { useEffect, useState } from "react";

/** US cash-equity session in New York time. Holidays are not modelled. */
export function usSessionOpen(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  const minutes = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  return isWeekday && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function useSession(): boolean {
  const [open, setOpen] = useState(() => usSessionOpen(new Date()));
  useEffect(() => {
    const t = window.setInterval(() => setOpen(usSessionOpen(new Date())), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return open;
}
