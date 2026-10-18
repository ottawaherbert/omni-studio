import {
  normalizeStoryArchitecture,
  type NarrativeGraphVersion,
  type ProductionBlock,
  type StoryArchitecture,
} from '../types/schema';

export interface StoryArchitectureBudgetSummary {
  mandatoryDurationRangeSec: [number, number];
  variableDurationRangeSec: [number, number];
  plannedDurationRangeSec: [number, number];
  productionBlockCount: number;
}

export interface StoryArchitectureBudgetFit {
  /**
   * The mandatory spine must fit inside a normal playthrough. This is a
   * feasibility boundary, not a claim that the graph has already been fully
   * simulated.
   */
  blocking: string[];
  /**
   * P90 is a whole-experience promise. It can only be proven after the graph
   * exists, so architecture can surface the gap without pretending to know
   * every eventual route.
   */
  warnings: string[];
}

const duplicates = (values: string[]) => values.filter((value, index) => values.indexOf(value) !== index);

const validRange = (range: [number, number] | undefined) => Boolean(
  range
  && Number.isFinite(range[0])
  && Number.isFinite(range[1])
  && range[0] > 0
  && range[0] <= range[1],
);

const rangeSum = (ranges: Array<[number, number]>) => ranges.reduce<[number, number]>(
  (total, range) => [total[0] + range[0], total[1] + range[1]],
  [0, 0],
);

/**
 * Drafts deliberately permit incomplete creative fields. They still reject
 * broken identities and references so an unfinished board cannot quietly
 * corrupt a later approved version.
 */
export const validateStoryArchitectureDraft = (input: StoryArchitecture): string[] => {
  const architecture = normalizeStoryArchitecture(input);
  const beats = architecture.storyBeats!;
  const chapters = architecture.storyChapters!;
  const episodes = architecture.storyEpisodes!;
  const endingContracts = architecture.endingContracts!;
  const blocks = architecture.productionBlocks!;
  const beatIds = new Set(beats.map((beat) => beat.id));
  const contractIds = new Set(endingContracts.map((contract) => contract.id));
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  const episodeIds = new Set(episodes.map((episode) => episode.id));
  const blockIds = new Set(blocks.map((block) => block.id));
  const issues: string[] = [];

  duplicates(beats.map((beat) => beat.id)).forEach((id) => issues.push(`StoryBeat ID “${id}”重复`));
  duplicates(endingContracts.map((contract) => contract.id)).forEach((id) => issues.push(`Ending Contract ID “${id}”重复`));
  duplicates(chapters.map((chapter) => chapter.id)).forEach((id) => issues.push(`故事章节 ID “${id}”重复`));
  duplicates(episodes.map((episode) => episode.id)).forEach((id) => issues.push(`故事分集 ID “${id}”重复`));
  duplicates(blocks.map((block) => block.id)).forEach((id) => issues.push(`Production Block ID “${id}”重复`));
  if (beats.some((beat) => !beat.id.trim())) issues.push('每个 StoryBeat 草稿都必须具有稳定 ID');
  if (endingContracts.some((contract) => !contract.id.trim())) issues.push('每个 Ending Contract 草稿都必须具有稳定 ID');
  if (chapters.some((chapter) => !chapter.id.trim())) issues.push('每个故事章节草稿都必须具有稳定 ID');
  if (episodes.some((episode) => !episode.id.trim())) issues.push('每个故事分集草稿都必须具有稳定 ID');
  if (blocks.some((block) => !block.id.trim())) issues.push('每个 Production Block 草稿都必须具有稳定 ID');

  const chapterAssignment = new Map<string, string>();
  chapters.forEach((chapter) => {
    duplicates(chapter.storyBeatIds).forEach((beatId) => issues.push(`故事章节“${chapter.title || chapter.id}”重复包含 Beat “${beatId}”`));
    chapter.storyBeatIds.forEach((beatId) => {
      if (!beatIds.has(beatId)) {
        issues.push(`故事章节“${chapter.title || chapter.id}”引用不存在的 Beat “${beatId}”`);
        return;
      }
      const prior = chapterAssignment.get(beatId);
      if (prior && prior !== chapter.id) issues.push(`StoryBeat “${beatId}”不能同时属于多个故事章节`);
      chapterAssignment.set(beatId, chapter.id);
    });
    if (chapter.episodeId && !episodeIds.has(chapter.episodeId)) {
      issues.push(`故事章节“${chapter.title || chapter.id}”引用不存在的分集`);
    }
  });
  episodes.forEach((episode) => {
    duplicates(episode.storyChapterIds).forEach((chapterId) => issues.push(`故事分集“${episode.title || episode.id}”重复包含章节“${chapterId}”`));
    episode.storyChapterIds.forEach((chapterId) => {
      if (!chapterIds.has(chapterId)) issues.push(`故事分集“${episode.title || episode.id}”引用不存在的章节“${chapterId}”`);
    });
  });

  const blockAssignment = new Map<string, string>();
  blocks.forEach((block) => {
    duplicates(block.storyBeatIds).forEach((beatId) => issues.push(`Production Block “${block.title || block.id}”重复包含 Beat “${beatId}”`));
    block.storyBeatIds.forEach((beatId) => {
      if (!beatIds.has(beatId)) {
        issues.push(`Production Block “${block.title || block.id}”引用不存在的 Beat “${beatId}”`);
        return;
      }
      const prior = blockAssignment.get(beatId);
      if (prior && prior !== block.id) issues.push(`StoryBeat “${beatId}”不能同时属于多个 Production Block`);
      blockAssignment.set(beatId, block.id);
    });
  });
  beats.forEach((beat) => {
    if (beat.storyChapterId && !chapterIds.has(beat.storyChapterId)) issues.push(`StoryBeat “${beat.title || beat.id}”引用不存在的故事章节`);
    if (beat.storyChapterId && chapterAssignment.get(beat.id) && chapterAssignment.get(beat.id) !== beat.storyChapterId) {
      issues.push(`StoryBeat “${beat.title || beat.id}”与故事章节归属不一致`);
    }
    if (beat.productionBlockId && !blockIds.has(beat.productionBlockId)) issues.push(`StoryBeat “${beat.title || beat.id}”引用不存在的 Production Block`);
    if (beat.productionBlockId && blockAssignment.get(beat.id) && blockAssignment.get(beat.id) !== beat.productionBlockId) {
      issues.push(`StoryBeat “${beat.title || beat.id}”与 Production Block 归属不一致`);
    }
    if (beat.endingContractId && !contractIds.has(beat.endingContractId)) issues.push(`StoryBeat “${beat.title || beat.id}”引用不存在的结局合同`);
  });
  endingContracts.forEach((contract) => {
    duplicates(contract.requiredBeatIds).forEach((beatId) => issues.push(`Ending Contract “${contract.title || contract.id}”重复引用 Beat “${beatId}”`));
    contract.requiredBeatIds.forEach((beatId) => {
      if (!beatIds.has(beatId)) issues.push(`Ending Contract “${contract.title || contract.id}”引用不存在的 Beat “${beatId}”`);
    });
  });
  return Array.from(new Set(issues));
};

export const summarizeStoryArchitectureBudget = (input: StoryArchitecture): StoryArchitectureBudgetSummary => {
  const architecture = normalizeStoryArchitecture(input);
  const mandatory = architecture.storyBeats!
    .filter((beat) => beat.kind === 'mandatory')
    .map((beat) => beat.durationRangeSec);
  const variable = architecture.storyBeats!
    .filter((beat) => beat.kind === 'variable')
    .map((beat) => beat.durationRangeSec);
  return {
    mandatoryDurationRangeSec: rangeSum(mandatory),
    variableDurationRangeSec: rangeSum(variable),
    plannedDurationRangeSec: rangeSum(
      architecture.storyBeats!.map((beat) => beat.durationRangeSec),
    ),
    productionBlockCount: architecture.productionBlocks!.length,
  };
};

/**
 * Architecture deliberately comes before a graph, therefore it cannot know a
 * real P50/P90 path yet. It can still reject impossible promises: a mandatory
 * spine that already overruns the normal session, or a whole plan that cannot
 * possibly reach it. Graph QA later replaces these bounds with path-level
 * evidence.
 */
export const auditStoryArchitectureBudgetFit = (input: StoryArchitecture): StoryArchitectureBudgetFit => {
  const architecture = normalizeStoryArchitecture(input);
  const budget = architecture.durationBudget;
  if (!budget) return { blocking: [], warnings: [] };

  const summary = summarizeStoryArchitectureBudget(architecture);
  const tolerance = budget.tolerancePercent / 100;
  const p50Range: [number, number] = [
    budget.p50TargetSec * (1 - tolerance),
    budget.p50TargetSec * (1 + tolerance),
  ];
  const p90LowerBound = budget.p90TargetSec * (1 - tolerance);
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (!architecture.storyBeats!.length) {
    blocking.push('先添加至少一个故事支点，才能验证互动体验的时长承诺');
  } else if (summary.mandatoryDurationRangeSec[0] > p50Range[1]) {
    blocking.push(
      `必经故事支点最短合计 ${summary.mandatoryDurationRangeSec[0]} 秒，已经超过 P50 目标容差上限 ${Math.round(p50Range[1])} 秒`,
    );
  } else if (summary.plannedDurationRangeSec[1] < p50Range[0]) {
    blocking.push(
      `全部已规划故事支点最长合计 ${summary.plannedDurationRangeSec[1]} 秒，无法覆盖 P50 目标下限 ${Math.round(p50Range[0])} 秒`,
    );
  }

  if (architecture.storyBeats!.length && summary.plannedDurationRangeSec[1] < p90LowerBound) {
    warnings.push(
      `当前故事支点最长合计 ${summary.plannedDurationRangeSec[1]} 秒，尚不足以支撑 P90 完整探索目标下限 ${Math.round(p90LowerBound)} 秒；请在图谱阶段用可重玩路径和独占内容复核`,
    );
  }

  architecture.productionBlocks!.forEach((block) => {
    const assignedRanges = architecture.storyBeats!
      .filter((beat) => beat.productionBlockId === block.id)
      .map((beat) => beat.durationRangeSec);
    if (!assignedRanges.length) return;
    const assignedRange = rangeSum(assignedRanges);
    const [blockMin, blockMax] = block.targetDurationRangeSec;
    if (assignedRange[0] > blockMax || assignedRange[1] < blockMin) {
      blocking.push(
        `制作区段“${block.title || block.id}”时长 ${blockMin}-${blockMax} 秒，与其已分配故事支点 ${assignedRange[0]}-${assignedRange[1]} 秒没有交集`,
      );
    }
  });

  return { blocking: Array.from(new Set(blocking)), warnings: Array.from(new Set(warnings)) };
};

const validateProductionBlock = (
  block: ProductionBlock,
  beatIds: Set<string>,
  beatBlockAssignments: Map<string, string>,
): string[] => {
  const issues: string[] = [];
  if (!block.id.trim() || !block.title.trim()) issues.push('Production Block 必须具有稳定 ID 和标题');
  if (!validRange(block.targetDurationRangeSec)) issues.push(`Production Block “${block.title || block.id}”时长范围无效`);
  if (!block.storyBeatIds.length) issues.push(`Production Block “${block.title || block.id}”必须至少覆盖一个 StoryBeat`);
  duplicates(block.storyBeatIds).forEach((beatId) => issues.push(`Production Block “${block.title || block.id}”重复包含 Beat “${beatId}”`));
  block.storyBeatIds.forEach((beatId) => {
    if (!beatIds.has(beatId)) {
      issues.push(`Production Block “${block.title || block.id}”引用不存在的 Beat “${beatId}”`);
      return;
    }
    const previousBlockId = beatBlockAssignments.get(beatId);
    if (previousBlockId && previousBlockId !== block.id) {
      issues.push(`StoryBeat “${beatId}”不能同时属于多个 Production Block`);
      return;
    }
    beatBlockAssignments.set(beatId, block.id);
  });
  return issues;
};

/** Structural validation only. Narrative quality remains a dedicated QA concern. */
export const validateStoryArchitecture = (input: StoryArchitecture): string[] => {
  const architecture = normalizeStoryArchitecture(input);
  const issues: string[] = validateStoryArchitectureDraft(architecture);
  const beats = architecture.storyBeats!;
  const chapters = architecture.storyChapters!;
  const episodes = architecture.storyEpisodes!;
  const endingContracts = architecture.endingContracts!;
  const blocks = architecture.productionBlocks!;
  const beatIds = new Set(beats.map((beat) => beat.id));
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));
  const episodeIds = new Set(episodes.map((episode) => episode.id));
  const contractIds = new Set(endingContracts.map((contract) => contract.id));
  const blockIds = new Set(blocks.map((block) => block.id));

  duplicates(beats.map((beat) => beat.id)).forEach((id) => issues.push(`StoryBeat ID “${id}”重复`));
  duplicates(chapters.map((chapter) => chapter.id)).forEach((id) => issues.push(`故事章节 ID “${id}”重复`));
  duplicates(episodes.map((episode) => episode.id)).forEach((id) => issues.push(`故事分集 ID “${id}”重复`));
  const beatChapterAssignments = new Map<string, string>();
  chapters.forEach((chapter) => {
    if (!chapter.id.trim() || !chapter.title.trim()) issues.push('每个故事章节都必须有 ID 和标题');
    if (!validRange(chapter.targetDurationRangeSec)) issues.push(`故事章节“${chapter.title || chapter.id}”时长范围无效`);
    if (!chapter.storyBeatIds.length) issues.push(`故事章节“${chapter.title || chapter.id}”必须至少包含一个 StoryBeat`);
    chapter.storyBeatIds.forEach((beatId) => {
      if (!beatIds.has(beatId)) {
        issues.push(`故事章节“${chapter.title || chapter.id}”引用不存在的 Beat “${beatId}”`);
        return;
      }
      const prior = beatChapterAssignments.get(beatId);
      if (prior && prior !== chapter.id) issues.push(`StoryBeat “${beatId}”不能同时属于多个故事章节`);
      beatChapterAssignments.set(beatId, chapter.id);
    });
    if (chapter.episodeId && !episodeIds.has(chapter.episodeId)) issues.push(`故事章节“${chapter.title || chapter.id}”引用不存在的分集`);
  });
  episodes.forEach((episode) => {
    if (!episode.id.trim() || !episode.title.trim()) issues.push('每个故事分集都必须有 ID 和标题');
    episode.storyChapterIds.forEach((chapterId) => {
      const chapter = chapters.find((item) => item.id === chapterId);
      if (!chapter) {
        issues.push(`故事分集“${episode.title || episode.id}”引用不存在的章节“${chapterId}”`);
      } else if (chapter.episodeId !== episode.id) {
        issues.push(`故事章节“${chapter.title}”与故事分集归属不一致`);
      }
    });
  });
  if (episodes.length) {
    chapters.filter((chapter) => !chapter.episodeId).forEach((chapter) => issues.push(`分集作品中的故事章节“${chapter.title}”必须归入一个分集`));
  }
  beats.forEach((beat) => {
    if (!beat.id.trim() || !beat.title.trim() || !beat.dramaticPurpose.trim()) {
      issues.push('每个 StoryBeat 都必须有 ID、标题和戏剧作用');
    }
    if (!validRange(beat.durationRangeSec)) issues.push(`StoryBeat “${beat.title || beat.id}”时长范围无效`);
    const listedChapterId = beatChapterAssignments.get(beat.id);
    if (!listedChapterId) issues.push(`StoryBeat “${beat.title || beat.id}”必须归入一个故事章节`);
    if (beat.storyChapterId !== listedChapterId) issues.push(`StoryBeat “${beat.title || beat.id}”与故事章节归属不一致`);
    if (beat.endingContractId && !contractIds.has(beat.endingContractId)) {
      issues.push(`StoryBeat “${beat.title || beat.id}”引用不存在的结局合同`);
    }
    if (beat.productionBlockId && !blockIds.has(beat.productionBlockId)) {
      issues.push(`StoryBeat “${beat.title || beat.id}”引用不存在的 Production Block`);
    }
  });

  duplicates(endingContracts.map((contract) => contract.id)).forEach((id) => issues.push(`Ending Contract ID “${id}”重复`));
  endingContracts.forEach((contract) => {
    if (!contract.id.trim() || !contract.title.trim() || !contract.promise.trim()) {
      issues.push('每个 Ending Contract 都必须有 ID、标题和兑现承诺');
    }
    contract.requiredBeatIds.forEach((beatId) => {
      if (!beatIds.has(beatId)) issues.push(`Ending Contract “${contract.title || contract.id}”引用不存在的 Beat “${beatId}”`);
    });
  });

  beats.filter((beat) => beat.kind === 'ending').forEach((beat) => {
    if (!beat.endingContractId) issues.push(`结局 StoryBeat “${beat.title || beat.id}”必须兑现一个 Ending Contract`);
  });
  endingContracts.forEach((contract) => {
    if (!beats.some((beat) => beat.kind === 'ending' && beat.endingContractId === contract.id)) {
      issues.push(`Ending Contract “${contract.title || contract.id}”必须由一个结局 StoryBeat 兑现`);
    }
  });

  duplicates(blocks.map((block) => block.id)).forEach((id) => issues.push(`Production Block ID “${id}”重复`));
  const beatBlockAssignments = new Map<string, string>();
  blocks.forEach((block) => issues.push(...validateProductionBlock(block, beatIds, beatBlockAssignments)));
  beats.forEach((beat) => {
    const listedBlockId = beatBlockAssignments.get(beat.id);
    if (beat.productionBlockId && listedBlockId !== beat.productionBlockId) {
      issues.push(`StoryBeat “${beat.title || beat.id}”与 Production Block 归属不一致`);
    }
    if (!beat.productionBlockId && listedBlockId) {
      issues.push(`StoryBeat “${beat.title || beat.id}”必须显式确认所属 Production Block`);
    }
  });

  if (architecture.durationBudget) {
    const budget = architecture.durationBudget;
    if (!Number.isFinite(budget.p50TargetSec) || budget.p50TargetSec <= 0) issues.push('P50 目标时长必须大于 0');
    if (!Number.isFinite(budget.p90TargetSec) || budget.p90TargetSec < budget.p50TargetSec) issues.push('P90 目标时长必须不小于 P50');
    if (!Number.isFinite(budget.maxSecondsWithoutChoice) || budget.maxSecondsWithoutChoice <= 0) issues.push('选择间隔必须大于 0');
    if (!Number.isFinite(budget.tolerancePercent) || budget.tolerancePercent < 0 || budget.tolerancePercent > 100) issues.push('时长容差必须在 0-100% 之间');
    issues.push(...auditStoryArchitectureBudgetFit(architecture).blocking);
  }
  return Array.from(new Set(issues));
};

export interface StoryBeatMappingAudit {
  blocking: string[];
  warnings: string[];
}

/**
 * This is deliberately an audit, not a one-to-one constraint: a Beat can fan
 * out into several interactive nodes and a node can serve multiple beats.
 */
export const auditStoryBeatMappings = (
  architectureInput: StoryArchitecture,
  graph: Pick<NarrativeGraphVersion, 'nodes'>,
): StoryBeatMappingAudit => {
  const architecture = normalizeStoryArchitecture(architectureInput);
  const beats = architecture.storyBeats || [];
  const knownBeatIds = new Set(beats.map((beat) => beat.id));
  const nodeIdsByBeat = new Map<string, string[]>();
  const blocking: string[] = [];
  const warnings: string[] = [];
  graph.nodes.forEach((node) => {
    const mappedBeatIds = node.storyBeatIds || [];
    duplicates(mappedBeatIds).forEach((id) => blocking.push(`节点“${node.brief.title}”重复映射 StoryBeat “${id}”`));
    mappedBeatIds.forEach((beatId) => {
      if (!knownBeatIds.has(beatId)) {
        blocking.push(`节点“${node.brief.title}”映射了不存在的 StoryBeat “${beatId}”`);
        return;
      }
      nodeIdsByBeat.set(beatId, [...(nodeIdsByBeat.get(beatId) || []), node.id]);
    });
  });
  beats.filter((beat) => beat.kind === 'mandatory' || beat.kind === 'ending').forEach((beat) => {
    if (!nodeIdsByBeat.get(beat.id)?.length) {
      blocking.push(`必经/结局 StoryBeat “${beat.title}”尚未映射到互动节点`);
    }
  });
  beats.forEach((beat) => {
    const mapped = nodeIdsByBeat.get(beat.id) || [];
    if (mapped.length > 1) warnings.push(`StoryBeat “${beat.title}”映射到 ${mapped.length} 个节点；请在白板审阅这是有意的分支展开。`);
  });
  return { blocking: Array.from(new Set(blocking)), warnings: Array.from(new Set(warnings)) };
};
