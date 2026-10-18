import type {
  ProductionInteractivePrepProfile,
  ProductionScenePlanCandidate,
  Scene,
} from '../../types/project';

type InteractivePlanningNode = ProductionInteractivePrepProfile['nodes'][number];

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const missingSourceError = (source: string, start: number, end: number, location: string) => {
  const missing = source.slice(start, end);
  const offset = start + missing.search(/\S/);
  const line = source.slice(0, offset).split(/\r\n|\r|\n/).length;
  const preview = missing.trim().replace(/\s+/g, ' ');
  return new Error(`${location}（原文第 ${line} 行起）：“${preview.slice(0, 100)}${preview.length > 100 ? '…' : ''}”。sourceEvidence 需要填写每场完整原文，不能只摘录几句。请让模型保留场次方案，补齐各场原文后重新回填。`);
};

/** A plan partitions the source; summaries and invented prose are never source text. */
export const validateProductionScenePlanSource = <T extends { sourceEvidence: string }>(
  source: string,
  scenes: T[],
): T[] => {
  if (!source.trim() || !scenes.length) throw new Error('场次方案必须覆盖当前完整剧本。');
  let cursor = 0;
  const result = scenes.map((scene, index) => {
    const evidence = scene.sourceEvidence.trim();
    const start = evidence ? source.indexOf(evidence, cursor) : -1;
    if (start < 0) throw new Error(`第 ${index + 1} 场原文依据不是来源中的连续原句，或存在重复、顺序错误。请逐字保留原文。`);
    if (source.slice(cursor, start).trim()) throw missingSourceError(source, cursor, start, `第 ${index + 1} 场之前有遗漏的剧本内容`);
    cursor = start + evidence.length;
    return { ...scene, sourceEvidence: source.slice(start, cursor) };
  });
  if (source.slice(cursor).trim()) throw missingSourceError(source, cursor, source.length, '场次方案遗漏了剧本末尾内容');
  return result;
};

export const productionScenesFromPlanCandidate = (
  sourceDocumentId: string,
  candidate: ProductionScenePlanCandidate[],
  planId: string,
  interactiveNodes: InteractivePlanningNode[],
): Scene[] => {
  const nodeById = new Map(interactiveNodes.map((node) => [node.nodeId, node]));
  return candidate.map((scene) => {
    const nodes = unique(scene.interactiveNodeIds || [])
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is InteractivePlanningNode => Boolean(node));
    const choices = new Map<string, NonNullable<Scene['interactiveMetadata']>['outboundChoices'][number]>();
    for (const node of nodes) {
      for (const choice of node.choices) {
        choices.set(`${node.nodeId}:${choice.choiceId}`, {
          label: choice.text,
          targetNodeId: choice.targetNodeId,
          intent: choice.intent,
          timeoutSeconds: choice.timeoutSeconds,
          defaultTimeoutTargetNodeId: choice.defaultTimeoutTargetNodeId,
        });
      }
    }
    return {
      id: `prod_scene_${planId}_${scene.order}`,
      sourceDocumentId,
      sourceEvidence: scene.sourceEvidence,
      sceneNumber: String(scene.order),
      title: scene.title,
      description: scene.description,
      valueCharge: 'neutral',
      script: scene.sourceEvidence,
      scriptBlocks: scene.scriptBlocks?.map((block, blockIndex) => ({
        id: `script_${planId}_${scene.order}_${blockIndex + 1}`,
        type: block.type,
        content: block.content,
      })),
      sceneGoal: scene.purpose,
      targetDuration: scene.targetDurationMinutes,
      interactiveMetadata: {
        nodeIds: nodes.map((node) => node.nodeId),
        storyEpisodeIds: unique(nodes.map((node) => node.storyEpisodeId || '')),
        storyEpisodeTitles: unique(nodes.map((node) => node.storyEpisodeTitle || '')),
        storyChapterIds: unique(nodes.map((node) => node.storyChapterId || '')),
        storyChapterTitles: unique(nodes.map((node) => node.storyChapterTitle || '')),
        incomingContext: scene.continuityIn,
        outgoingContext: scene.continuityOut,
        outboundChoices: [...choices.values()],
        readVariables: unique(nodes.flatMap((node) => node.readVariables)),
        writeVariables: unique(nodes.flatMap((node) => node.writeVariables)),
        requiredFacts: unique(nodes.flatMap((node) => node.requiredFacts)),
        producedFacts: unique(nodes.flatMap((node) => node.producedFacts)),
        isEnding: nodes.some((node) => node.isEnding),
      },
    };
  });
};
