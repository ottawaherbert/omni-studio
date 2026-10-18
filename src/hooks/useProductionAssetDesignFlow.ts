import toast from 'react-hot-toast';
import { useEffect, useRef, useState } from 'react';
import type { Episode, Project } from '../clients/domainTypes';
import { assetDesignOwner, missingAssetDesignIds, registerPlannedDesignTargets } from '../clients/productionAssetWorkflowClient';
import { useProductionAssetProfileAI } from './useProductionAssetProfileAI';

/** One design flow serves first-time single and batch image generation. */
export function useProductionAssetDesignFlow({ project, episodes, updateProject, onReady, scopeKey = "project" }: {
  project: Project | null; episodes: Episode[]; updateProject: (updates: Partial<Project>) => Promise<void>; onReady: () => void; scopeKey?: string;
}) {
  const [queue, setQueue] = useState<{ projectId: string; scopeKey: string; ids: string[]; index: number; continueToImage: boolean } | null>(null);
  const owner = project && queue?.projectId === project.id ? assetDesignOwner(project, queue.ids[queue.index]) : undefined;
  const profile = useProductionAssetProfileAI({ project, character: owner && !('type' in owner) ? owner : undefined, asset: owner && 'type' in owner ? owner : undefined, episodes, updateProject });
  const started = useRef('');
  const starting = useRef(false);
  const scopeRef = useRef(`${project?.id}:${scopeKey}`); scopeRef.current = `${project?.id}:${scopeKey}`;
  const readyRef = useRef(onReady); readyRef.current = onReady;
  const openRef = useRef(profile.openPrompt); openRef.current = profile.openPrompt;
  useEffect(() => {
    if (!queue) { started.current = ''; return; }
    if (project?.id !== queue.projectId || scopeKey !== queue.scopeKey) { setQueue(null); return; }
    if (queue.index > 0 && missingAssetDesignIds(project, queue.ids.slice(0, queue.index)).length) return;
    if (queue.index >= queue.ids.length) {
      setQueue(null);
      if (queue.continueToImage) readyRef.current();
      return;
    }
    if (!owner) return; // A newly registered planned identity may arrive on the next project render.
    if (profile.isGenerating) return;
    const key = `${queue.projectId}:${queue.index}:${owner.id}`;
    if (started.current === key) return;
    started.current = key;
    void openRef.current('appearance');
  }, [queue, owner?.id, project, scopeKey, profile.isGenerating]);
  useEffect(() => { if (profile.requestError && queue && !profile.isGenerating) setQueue(null); }, [profile.requestError, profile.isGenerating, queue]);
  const cancel = () => { profile.closePrompt(); profile.discardCandidate(); setQueue(null); };
  return {
    profile,
    active: Boolean(queue),
    continueToImage: Boolean(queue?.continueToImage),
    progress: queue ? `${queue.index + 1}/${queue.ids.length}` : '',
    start: async (assetIds: string[], options: { force?: boolean; continueToImage?: boolean } = {}) => {
      if (!project || queue || starting.current) return;
      starting.current = true;
      const initialScope = scopeRef.current;
      profile.clearRequestError();
      let readyProject: Project;
      try {
        readyProject = registerPlannedDesignTargets(project, assetIds);
        if (readyProject.characters.length !== project.characters.length || readyProject.assets.length !== project.assets.length) await updateProject({ characters: readyProject.characters, assets: readyProject.assets });
      } catch (error) { toast.error(error instanceof Error ? error.message : '资产登记失败'); return; }
      finally { starting.current = false; }
      if (scopeRef.current !== initialScope) return;
      const ids = options.force ? [...new Set(assetIds)].filter(id => assetDesignOwner(readyProject, id)) : missingAssetDesignIds(readyProject, assetIds);
      if (!ids.length) { if (options.continueToImage !== false) readyRef.current(); return; }
      setQueue({ projectId: project.id, scopeKey, ids, index: 0, continueToImage: options.continueToImage !== false });
    },
    cancel,
    adopt: async () => {
      const saved = await profile.adoptCandidate();
      if (saved) setQueue(current => current?.projectId === saved.id ? { ...current, index: current.index + 1 } : current);
    },
  };
}
