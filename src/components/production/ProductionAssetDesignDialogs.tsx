import PromptEditorModal from '../PromptEditorModal';
import { ProductionAssetProfileReviewModal } from './ProductionAssetProfileReviewModal';
import type { useProductionAssetDesignFlow } from '../../hooks/useProductionAssetDesignFlow';

export function ProductionAssetDesignDialogs({ flow }: { flow: ReturnType<typeof useProductionAssetDesignFlow> }) {
  const profile = flow.profile;
  return <>
    <PromptEditorModal
      isOpen={Boolean(profile.promptRequest)} onClose={profile.closePrompt} onCancel={flow.cancel}
      templateId={profile.promptRequest?.templateId || 'productionAssetVisualDesign'}
      variables={profile.promptRequest?.variables || {}} title={`${profile.promptRequest?.title || '设计形象'} · ${flow.progress}`}
      contextOptions={profile.promptRequest?.contextOptions} defaultSelectedContextIds={profile.promptRequest?.defaultSelectedContextIds}
      externalReferences={profile.promptRequest?.referenceImageUrl ? [{ url: profile.promptRequest.referenceImageUrl, label: '已有形象参考图' }] : undefined}
      onConfirm={profile.executePrompt} workflowStepId="production.asset.profile_enrichment"
    />
    <ProductionAssetProfileReviewModal candidate={profile.candidate} isAdopting={profile.isAdopting}
      onClose={flow.cancel} onAdopt={() => void flow.adopt()} onEdit={profile.editCandidate} confirmText={flow.continueToImage ? "采用形象并继续" : "采用形象"} />
  </>;
}
