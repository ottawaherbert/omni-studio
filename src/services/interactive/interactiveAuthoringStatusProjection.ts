import type {
  InteractiveWritingGenerationStatus,
  InteractiveWritingPort,
} from '../../domains/interactive/ports/writingPort';
import type { InteractiveTaskCoordination } from '../../domains/interactive/authoring/taskCoordination';
import type { InteractiveExperienceAggregate } from '../../domains/interactive/types/schema';
import type { InteractiveContentPlanDraft } from '../../domains/interactive/contentPlanning/contentPlan';
import { contentPlanMatchesWritingSource } from '../../domains/interactive/contentPlanning/contentPlan';
import {
  bindingMediaTakeRefs,
  bindingScriptSceneRefs,
} from '../../domains/interactive/binding/nodeContentBinding';
import { hasNodeCapability } from '../../domains/interactive/nodeContentRequirements';

export type InteractiveAuthoringNextAction =
  | 'prepare_story'
  | 'review_story'
  | 'prepare_content'
  | 'review_content'
  | 'prepare_production'
  | 'playtest';

export interface InteractiveAuthoringStatusProjection {
  executionPolicy: InteractiveTaskCoordination['executionPolicy'];
  paused: boolean;
  writing: InteractiveWritingGenerationStatus;
  content: {
    state: 'waiting' | 'working' | 'review' | 'failed' | 'ready';
    message: string;
  };
  nextAction: InteractiveAuthoringNextAction;
  nextActionLabel: string;
}

export const projectInteractiveAuthoringStatus = (input: {
  aggregate: InteractiveExperienceAggregate;
  coordination: InteractiveTaskCoordination;
  latestContentPlan: InteractiveContentPlanDraft | null;
  writingPort: InteractiveWritingPort;
}): InteractiveAuthoringStatusProjection => {
  const { aggregate, coordination, latestContentPlan, writingPort } = input;
  const writingProjectId = aggregate.experience.storySource.writingProjectId;
  const writingDomainStatus: InteractiveWritingGenerationStatus = writingProjectId
    ? writingPort.getGenerationStatus(writingProjectId)
    : { state: 'idle' as const, message: '等待建立统一剧本' };
  const contentNodes = aggregate.graph.nodes.filter((node) =>
    hasNodeCapability(node, 'play_content')
  );
  const allContentReady = contentNodes.length > 0 && contentNodes.every((node) =>
    aggregate.bindings.some((binding) =>
      binding.nodeId === node.id
      && binding.slot === 'main'
      && binding.status === 'approved'
      && bindingScriptSceneRefs(binding).length > 0
    )
  );
  // Only current script content and adopted scene references determine readiness.
  const writing: InteractiveWritingGenerationStatus = allContentReady
    ? {
        state: 'ready',
        checkpoint: 'script',
        message: '已有可供互动节点采用的剧本场次',
      }
    : writingDomainStatus;
  const allMediaReady = allContentReady && contentNodes.every((node) =>
    aggregate.bindings.some((binding) =>
      binding.nodeId === node.id
      && binding.slot === 'main'
      && binding.status === 'approved'
      && bindingMediaTakeRefs(binding).length > 0
      && Boolean(binding.mediaFitReview)
    )
  );
  const candidate = latestContentPlan?.status === 'candidate'
    && latestContentPlan.baseGraphVersionId === aggregate.graph.id
    && contentPlanMatchesWritingSource(
      latestContentPlan,
      writingProjectId ? writingPort.listScenes(writingProjectId) : [],
    );
  const latestContentTask = [...coordination.taskRefs]
    .reverse()
    .find((task) => task.owner === 'content_plan');
  const contentTaskWorking = Boolean(
    latestContentTask && (latestContentTask.status || 'working') === 'working',
  );
  const contentTaskFailed = Boolean(latestContentTask?.status === 'failed');
  const hasAdoptedProductionPlan = coordination.taskRefs.some((task) => (
    task.owner === 'production'
    && task.purpose === '准备完整制片场次方案'
    && task.status === 'completed'
  ));
  const content = allContentReady
    ? { state: 'ready' as const, message: '节点内容已安排好' }
    : contentTaskWorking
        ? { state: 'working' as const, message: 'AI 正在安排整张白板的内容' }
      : candidate
        ? { state: 'review' as const, message: 'AI 内容方案等待查看' }
      : contentTaskFailed
        ? { state: 'failed' as const, message: latestContentTask?.error || '节点内容安排被中断，可以重新安排' }
      : { state: 'waiting' as const, message: '等待安排节点内容' };

  if (coordination.paused) {
    return {
      executionPolicy: coordination.executionPolicy,
      paused: true,
      writing,
      content,
      nextAction: 'prepare_story',
      nextActionLabel: '继续 AI 创作',
    };
  }
  if (writing.state !== 'ready') {
    return { executionPolicy: coordination.executionPolicy, paused: coordination.paused, writing, content, nextAction: 'prepare_story', nextActionLabel: '打开剧本工作区' };
  }
  if (contentTaskWorking) {
    return {
      executionPolicy: coordination.executionPolicy,
      paused: coordination.paused,
      writing,
      content,
      nextAction: 'prepare_content',
      nextActionLabel: 'AI 正在安排内容',
    };
  }
  if (candidate) {
    return { executionPolicy: coordination.executionPolicy, paused: coordination.paused, writing, content, nextAction: 'review_content', nextActionLabel: '查看 AI 方案' };
  }
  if (contentTaskFailed) {
    return { executionPolicy: coordination.executionPolicy, paused: coordination.paused, writing, content, nextAction: 'prepare_content', nextActionLabel: '让 AI 重新安排内容' };
  }
  if (!allContentReady) {
    return { executionPolicy: coordination.executionPolicy, paused: coordination.paused, writing, content, nextAction: 'prepare_content', nextActionLabel: '让 AI 安排内容' };
  }
  if (allMediaReady) {
    return { executionPolicy: coordination.executionPolicy, paused: coordination.paused, writing, content, nextAction: 'playtest', nextActionLabel: '试玩作品' };
  }
  return {
    executionPolicy: coordination.executionPolicy,
    paused: coordination.paused,
    writing,
    content,
    nextAction: 'prepare_production',
    nextActionLabel: hasAdoptedProductionPlan ? '继续制作画面' : '准备制片方案',
  };
};
