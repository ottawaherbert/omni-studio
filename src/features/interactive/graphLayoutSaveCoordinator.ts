import type { GraphLayoutRevision } from '../../domains/interactive/types/schema.ts';

type LayoutPatch = Pick<GraphLayoutRevision, 'nodes' | 'viewport'>;

/** A canvas event contains only visible nodes. Keep the other chapters and
 * serialize writes against the last acknowledged revision. */
export function createGraphLayoutSaveCoordinator(options: {
  initial: GraphLayoutRevision;
  persist: (layout: LayoutPatch, expectedVersionIndex: number) => Promise<GraphLayoutRevision>;
  onChange: (layout: GraphLayoutRevision) => void;
  onError: (error: unknown) => void;
}) {
  let draft = options.initial;
  let revision = draft.versionIndex;
  let change = 0;
  let acknowledged = 0;
  let running: Promise<void> | undefined;
  let failure: unknown;
  const flush = (): Promise<void> => {
    if (running) return running;
    failure = undefined;
    running = (async () => {
      while (acknowledged < change) {
        const sent = change;
        const saved = await options.persist({ nodes: draft.nodes, viewport: draft.viewport }, revision);
        revision = saved.versionIndex;
        acknowledged = sent;
        draft = { ...draft, id: saved.id, versionIndex: revision };
        options.onChange(draft);
      }
    })().catch((error) => {
      failure = error;
      options.onError(error);
      throw error;
    }).finally(() => { running = undefined; });
    return running;
  };
  return {
    update(patch: LayoutPatch) {
      draft = { ...draft, nodes: { ...draft.nodes, ...patch.nodes }, viewport: patch.viewport ?? draft.viewport };
      change += 1;
      options.onChange(draft);
      if (!failure) void flush().catch(() => undefined);
    },
    flush,
    get current() { return draft; },
    get pending() { return acknowledged < change; },
  };
}
