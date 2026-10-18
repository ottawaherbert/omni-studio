/** Return to the current production source without leaking a shot or stale scene selection. */
export function productionPreparationHref(context: { projectId?: string | null; episodeId?: string | null; returnTo?: string | null }): string {
  if (!context.projectId) return "/production";
  const params = new URLSearchParams({ projectId: context.projectId });
  if (context.episodeId) params.set("episodeId", context.episodeId);
  if (context.returnTo?.startsWith("/interactive/experiences/")) params.set("returnTo", context.returnTo);
  return `/production/preparation?${params}`;
}
