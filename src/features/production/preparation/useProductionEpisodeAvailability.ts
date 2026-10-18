import { useEffect, useMemo, useState } from "react";

import { legacyProjectClient } from "../../../clients/legacyProjectClient";
import type { Episode, EpisodeMeta, Project } from "../../../types/project";
import { hasProductionEpisodeSource } from "./productionPreparationViewModel";

interface ProductionEpisodeAvailability {
  episodes: EpisodeMeta[];
  fullEpisodes: Episode[];
  isResolving: boolean;
}

/**
 * Episode metadata does not include scene bodies, so availability is resolved from
 * the authoritative episode records. Failed reads stay visible rather than hiding
 * a potentially valid unit from the author.
 */
export const useProductionEpisodeAvailability = (project: Project | null, activeEpisode?: Episode | null): ProductionEpisodeAvailability => {
  const projectId = project?.id;
  const episodeMetas = project?.episodes || [];
  const episodeSignature = episodeMetas.map((episode) => episode.id).join("|");
  const availabilityKey = `${projectId || "none"}:${episodeSignature}`;
  const [availability, setAvailability] = useState<{ key: string; ids: string[] | null; fullEpisodes: Episode[] }>({ key: "", ids: null, fullEpisodes: [] });

  useEffect(() => {
    let cancelled = false;
    const episodeIds = episodeSignature ? episodeSignature.split("|") : [];
    if (!projectId || !episodeIds.length) {
      setAvailability({ key: availabilityKey, ids: [], fullEpisodes: [] });
      return () => { cancelled = true; };
    }

    const canResolveFromMetadata = episodeMetas.every((episode) => (
      Boolean(episode.sourceDocumentId) || typeof episode.sceneCount === "number"
    ));
    if (canResolveFromMetadata) {
      const availableIds = episodeMetas
        .filter((episode) => Boolean(episode.sourceDocumentId) || Number(episode.sceneCount || 0) > 0)
        .map((episode) => episode.id);
      const currentEpisode = activeEpisode && availableIds.includes(activeEpisode.id)
        ? activeEpisode
        : null;
      setAvailability({
        key: availabilityKey,
        ids: availableIds,
        fullEpisodes: currentEpisode ? [currentEpisode] : [],
      });
      return () => { cancelled = true; };
    }

    setAvailability({ key: availabilityKey, ids: null, fullEpisodes: [] });
    void Promise.all(episodeIds.map(async (episodeId) => {
      if (activeEpisode?.id === episodeId) {
        return {
          id: hasProductionEpisodeSource(activeEpisode) ? episodeId : null,
          episode: hasProductionEpisodeSource(activeEpisode) ? activeEpisode : null,
        };
      }
      try {
        const fullEpisode = await legacyProjectClient.getEpisode(projectId, episodeId, "production-preparation");
        return {
          id: fullEpisode && hasProductionEpisodeSource(fullEpisode) ? episodeId : null,
          episode: fullEpisode && hasProductionEpisodeSource(fullEpisode) ? fullEpisode : null,
        };
      } catch {
        return { id: episodeId, episode: null };
      }
    })).then((records) => {
      if (!cancelled) setAvailability({
        key: availabilityKey,
        ids: records.map((record) => record.id).filter((id): id is string => Boolean(id)),
        fullEpisodes: records.map((record) => record.episode).filter((episode): episode is Episode => Boolean(episode)),
      });
    });

    return () => { cancelled = true; };
  }, [activeEpisode?.id, availabilityKey, episodeMetas, episodeSignature, projectId]);

  useEffect(() => {
    if (!activeEpisode) return;
    setAvailability((current) => {
      if (current.key !== availabilityKey || current.ids === null || !current.ids.includes(activeEpisode.id)) return current;
      const index = current.fullEpisodes.findIndex((episode) => episode.id === activeEpisode.id);
      const fullEpisodes = index >= 0
        ? current.fullEpisodes.map((episode) => episode.id === activeEpisode.id ? activeEpisode : episode)
        : [...current.fullEpisodes, activeEpisode];
      return { ...current, fullEpisodes };
    });
  }, [activeEpisode, availabilityKey]);

  return useMemo(() => ({
    episodes: availability.key === availabilityKey && availability.ids !== null
      ? episodeMetas.filter((episode) => availability.ids!.includes(episode.id))
      : [],
    fullEpisodes: availability.key === availabilityKey ? availability.fullEpisodes : [],
    isResolving: availability.key !== availabilityKey || availability.ids === null,
  }), [availability, availabilityKey, episodeMetas]);
};
