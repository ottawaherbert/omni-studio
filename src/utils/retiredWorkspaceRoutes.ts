/** URL compatibility only. The retired page implementations have been deleted. */
export const RETIRED_WORKSPACE_PATHS = [
  "bible", "world", "world/character/:characterId", "world/asset/:assetId",
  "episodes", "episodes/generator", "whiteboard", "insight", "breakdown",
  "script", "storyboard", "studio", "adaptation", "video-gen", "audio-gen",
  "production/team",
] as const;

export function retiredWorkspaceHref(pathname: string, search: string, activeProjectId?: string | null): string {
  const params = new URLSearchParams(search);
  const projectId = params.get("projectId") || activeProjectId;
  let target: string;
  if (["/bible", "/script", "/whiteboard", "/insight", "/episodes/generator"].includes(pathname)) {
    params.delete("projectId");
    if (projectId) { params.set("legacyProjectId", projectId); params.set("source", "legacy-script"); }
    target = "/writing";
  } else if (pathname === "/adaptation") {
    params.delete("destination");
    target = "/production/import";
  } else {
    if (projectId) params.set("projectId", projectId);
    target = pathname.startsWith("/world") ? pathname.replace(/^\/world/, "/production/assets")
      : pathname === "/storyboard" ? "/production/storyboard"
      : ["/studio", "/video-gen", "/audio-gen"].includes(pathname) ? "/production/studio"
      : "/production/preparation";
  }
  const query = params.toString();
  return `${target}${query ? `?${query}` : ""}`;
}
