import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";

/** Reveal-on-scroll. Opts the page into hidden-until-seen only when motion is allowed. */
export function useReveal(root: RefObject<HTMLElement>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") return;
    el.setAttribute("data-motion", "on");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    const observeTargets = () => {
      const targets = Array.from(el.querySelectorAll<HTMLElement>(".reveal:not(.in)"));
      targets.forEach((t) => io.observe(t));
    };
    observeTargets();

    const mo = typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => observeTargets())
      : null;
    if (mo) {
      mo.observe(el, { childList: true, subtree: true });
    }

    return () => {
      io.disconnect();
      if (mo) mo.disconnect();
      el.removeAttribute("data-motion");
    };
  }, [root]);
}

/**
 * Hash routing owns location.hash here (unknown hashes fall back to v1), so
 * in-page links must not touch it: scroll + move focus to the target instead.
 */
export function useAnchorScroll() {
  return useCallback((e: MouseEvent<HTMLElement>, id: string) => {
    e.preventDefault();
    const t = document.getElementById(id);
    if (!t) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    t.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    t.setAttribute("tabindex", "-1");
    t.focus({ preventScroll: true });
  }, []);
}

/** Wall clock for the regime chip; ticks each minute. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Gentle hero-image parallax, rAF-throttled, skipped under reduced motion. */
export function useParallax(ref: RefObject<HTMLElement>, maxPx = 24) {
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = Math.min(window.scrollY, 600) / 600;
        el.style.transform = `translate3d(0, ${(y * maxPx).toFixed(1)}px, 0)`;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [ref, maxPx]);
}
