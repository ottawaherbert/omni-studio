import {
  Profiler,
  useEffect,
  type PropsWithChildren,
  type ProfilerOnRenderCallback,
} from "react";

export type DevRouteProfileEntry = {
  id: string;
  phase: "mount" | "update" | "nested-update";
  actualDuration: number;
  baseDuration: number;
  startTime: number;
  commitTime: number;
};

export type DevRoutePerformanceSnapshot = {
  id: string;
  capturedAt: number;
  navigation: {
    duration: number;
    responseEnd: number;
    domContentLoaded: number;
    load: number;
  } | null;
  resources: Array<{
    path: string;
    initiatorType: string;
    duration: number;
    transferSize: number;
    encodedBodySize: number;
  }>;
  longTasks: Array<{
    startTime: number;
    duration: number;
  }>;
};

declare global {
  interface Window {
    __OMNI_ROUTE_PROFILES__?: DevRouteProfileEntry[];
    __OMNI_ROUTE_PERFORMANCE__?: Record<string, DevRoutePerformanceSnapshot>;
  }
}

const updateRouteProbe = (id: string) => {
  const probe = Array.from(document.querySelectorAll<HTMLOutputElement>("[data-dev-route-performance]"))
    .find((element) => element.dataset.devRoutePerformance === id);
  if (!probe) return;
  probe.dataset.snapshot = JSON.stringify({
    performance: window.__OMNI_ROUTE_PERFORMANCE__?.[id] || null,
    profiles: (window.__OMNI_ROUTE_PROFILES__ || []).filter((entry) => entry.id === id),
  });
};

const recordRouteRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime,
) => {
  const entries = window.__OMNI_ROUTE_PROFILES__ || [];
  window.__OMNI_ROUTE_PROFILES__ = [
    ...entries,
    {
      id,
      phase,
      actualDuration,
      baseDuration,
      startTime,
      commitTime,
    },
  ].slice(-100);
  updateRouteProbe(id);
};

const round = (value: number) => Math.round(value * 10) / 10;

export function DevRouteProfiler({
  id,
  children,
}: PropsWithChildren<{ id: string }>) {
  useEffect(() => {
    if (!import.meta.env.DEV || typeof performance === "undefined") return;

    const collect = () => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const resources = performance.getEntriesByType("resource")
        .filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming)
        .map((entry) => {
          let path = entry.name;
          try {
            const url = new URL(entry.name, window.location.href);
            path = `${url.pathname}${url.search}`;
          } catch {
            // Keep the original resource name when it is not a URL.
          }
          return {
            path,
            initiatorType: entry.initiatorType,
            duration: round(entry.duration),
            transferSize: entry.transferSize || 0,
            encodedBodySize: entry.encodedBodySize || 0,
          };
        });
      const longTasks = performance.getEntriesByType("longtask").map((entry) => ({
        startTime: round(entry.startTime),
        duration: round(entry.duration),
      }));

      window.__OMNI_ROUTE_PERFORMANCE__ = {
        ...(window.__OMNI_ROUTE_PERFORMANCE__ || {}),
        [id]: {
          id,
          capturedAt: Date.now(),
          navigation: navigation ? {
            duration: round(navigation.duration),
            responseEnd: round(navigation.responseEnd),
            domContentLoaded: round(navigation.domContentLoadedEventEnd),
            load: round(navigation.loadEventEnd),
          } : null,
          resources,
          longTasks,
        },
      };
      updateRouteProbe(id);
    };

    collect();
    const timer = window.setTimeout(collect, 1_500);
    const observer = typeof PerformanceObserver === "undefined"
      ? null
      : new PerformanceObserver(collect);
    observer?.observe({ entryTypes: ["resource", "longtask"] });
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [id]);

  if (!import.meta.env.DEV) return children;
  return (
    <>
      <Profiler id={id} onRender={recordRouteRender}>
        {children}
      </Profiler>
      <output hidden data-dev-route-performance={id} />
    </>
  );
}
