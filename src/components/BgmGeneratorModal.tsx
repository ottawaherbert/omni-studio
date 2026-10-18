import { useProjectStore } from "../clients/stateClient";
import { isGeneralSkill } from "../clients/creativeDirectionClient";
import { ManualAIResultField } from "./ManualAIResultField";
import { withManualAIResult, isManualAIMedia } from "../../apps/web/src/clients/manualAIClient";
import { hasManualAIResult, type ManualAIResult } from "../../packages/domain/src/manualAI";
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Music, Wand2, Loader2 } from 'lucide-react';
import { useGlobalStore } from '../clients/stateClient';
import type { UniversalSkillReference } from '../clients/domainTypes';
import { generateAIBgm } from '../clients/aiClient';
import toast from 'react-hot-toast';
import { summarizeUnknownError } from '../utils/logging';
import { manualStoryboardHash } from '../clients/productionStoryboardWorkflowClient';
import SkillOverrideModal from './SkillOverrideModal';
import { BgmPromptGovernanceFields } from './BgmPromptGovernanceFields';
import { BgmGeneratedAudioResult } from './BgmGeneratedAudioResult';
import { buildBgmGenerationPrompt, type BgmGovernedContext, type BgmGenerationResult } from '../clients/productionStudioWorkflowClient';

export type { BgmGovernedContext, BgmGenerationResult } from '../clients/productionStudioWorkflowClient';

interface BgmGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPrompt?: string;
  initialDescription?: string;
  onSave: (bgmAssetId: string) => void;
  onGenerated?: (result: BgmGenerationResult) => boolean | void;
  governedContext?: BgmGovernedContext;
}

export const BgmGeneratorModal: React.FC<BgmGeneratorModalProps> = ({
  isOpen,
  onClose,
  initialPrompt = '',
  initialDescription = '',
  onSave,
  onGenerated,
  governedContext,
}) => {
  const [manualResult, setManualResult] = useState<ManualAIResult>();
  const [resultUploading, setResultUploading] = useState(false);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [description, setDescription] = useState(initialDescription);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<UniversalSkillReference[]>([]);
  const [isSkillModalOpen, setIsSkillModalOpen] = useState(false);
  const [generationResult, setGenerationResult] = useState<BgmGenerationResult | null>(null);
  const [generationAdopted, setGenerationAdopted] = useState(false);
  const { addGlobalAsset, bgmSettings } = useGlobalStore();
  const modelId = bgmSettings.provider === 'gemini'
    ? 'lyria-3-clip-preview'
    : bgmSettings.customModelId || 'suno-v3.5';
  const modelLabel = `${bgmSettings.provider === 'gemini' ? 'Gemini Lyria' : 'Custom BGM'} (${modelId})`;
  const productionState = useProjectStore();
  const directorScene = governedContext ? productionState.activeEpisode?.scenes.find(scene => scene.audioTracks?.some(track => track.id === governedContext.trackId)) : undefined;
  const currentTrack = directorScene?.audioTracks?.find(track => track.id === governedContext?.trackId);
  const finalPrompt = useMemo(() => buildBgmGenerationPrompt({ prompt, description, skills: selectedSkills, tags: selectedTags, track: currentTrack }), [description, prompt, selectedSkills, selectedTags, currentTrack]);

  useEffect(() => {
    if (!isOpen) return;
    setManualResult(undefined);
      setResultUploading(false);
    setPrompt(initialPrompt);
    setDescription(initialDescription);
    setSelectedTags([]);
    setSelectedSkills([]);
    setGeneratedAudioUrl(null);
    setGenerationResult(null);
    setGenerationAdopted(false);
    audioElement?.pause();
    setAudioElement(null);
    setIsPlaying(false);
  }, [initialDescription, initialPrompt, isOpen]);

  if (typeof document === 'undefined') return null;

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleGenerate = async () => {
    if (isGenerating || resultUploading) return;
    if (!finalPrompt.trim()) {
      toast.error('请输入音乐提示词');
      return;
    }
    if (governedContext && !governedContext.generationAllowed) {
      toast.error(governedContext.blockedReason || '当前镜头尚未完成故事板确认。');
      return;
    }

    setIsGenerating(true);
    try {
      const audioUrl = await withManualAIResult(finalPrompt, manualResult, () => generateAIBgm({
        prompt: finalPrompt,
      }));
      const result: BgmGenerationResult = {
        audioUrl,
        finalPrompt,
        promptHash: manualStoryboardHash(finalPrompt),
        modelId: isManualAIMedia(audioUrl) ? "external-audio" : modelId,
        provider: isManualAIMedia(audioUrl) ? "manual_external" : bgmSettings.provider,
        selectedSkillIds: selectedSkills.filter(isGeneralSkill).map((skill) => skill.id),
        selectedSkillTitles: selectedSkills.filter(isGeneralSkill).map((skill) => skill.title),
        governedContext,
        createdAt: Date.now(),
      };
      const adopted = onGenerated?.(result) !== false;
      setGeneratedAudioUrl(audioUrl);
      setGenerationResult(result);
      setGenerationAdopted(adopted);
      if (adopted) toast.success('音乐生成成功！');
      else toast.error('生成期间上游状态已变化，结果未写入音轨。');
    } catch (error: any) {
      console.error('Failed to generate BGM:', summarizeUnknownError(error));
      toast.error('生成失败，请重试');
    } finally {
      setIsGenerating(false);
    }
  };

  const togglePlay = () => {
    if (isPlaying && audioElement) {
      audioElement.pause();
      setIsPlaying(false);
    } else if (generatedAudioUrl) {
      const audio = new Audio(generatedAudioUrl);
      audio.onended = () => setIsPlaying(false);
      audio.play();
      setAudioElement(audio);
      setIsPlaying(true);
    }
  };

  const handleClose = () => {
    audioElement?.pause();
    setIsPlaying(false);
    onClose();
  };

  const handleSaveToLibrary = () => {
    if (!generatedAudioUrl || !generationResult || !generationAdopted) return;
    const newAssetId = crypto.randomUUID();
    const newAsset = {
      id: newAssetId,
      type: 'bgm' as const,
      name: prompt.slice(0, 20) || '未命名背景音乐',
      description: description,
      tags: selectedTags,
      url: generatedAudioUrl,
      imageUrls: [],
    };

    addGlobalAsset(newAsset);
    toast.success('已保存至全局资产库！');
    onSave(newAssetId);
    handleClose();
  };

  return <>
    {createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-2xl w-full max-w-2xl flex flex-col overflow-hidden shadow-2xl"
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-900/50">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500">
                <Music className="w-5 h-5" />
                <h3 className="font-bold text-gray-900 dark:text-white">AI 背景音乐生成</h3>
              </div>
              <button onClick={handleClose} className="p-1 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg text-gray-500 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
          <BgmPromptGovernanceFields
            prompt={prompt}
            onPromptChange={setPrompt}
            description={description}
            onDescriptionChange={setDescription}
            selectedTags={selectedTags}
            onToggleTag={toggleTag}
            selectedSkills={selectedSkills}
            onChooseSkills={() => setIsSkillModalOpen(true)}
            finalPrompt={finalPrompt}
            modelLabel={modelLabel}
            contextSummary={governedContext?.contextSummary}
            blockedReason={governedContext && !governedContext.generationAllowed ? governedContext.blockedReason : undefined}
          />

          {generatedAudioUrl && (
            <BgmGeneratedAudioResult isPlaying={isPlaying} audited={generationAdopted} onTogglePlay={togglePlay} onSave={handleSaveToLibrary} />
          )}
        </div>

        <ManualAIResultField prompt={finalPrompt} value={manualResult} onChange={setManualResult} kind="audio" disabled={isGenerating} onBusyChange={setResultUploading} />
        <div className="p-4 border-t border-gray-200 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-900/50 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-500 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || resultUploading || !finalPrompt.trim() || Boolean(governedContext && !governedContext.generationAllowed)}
            title={governedContext && !governedContext.generationAllowed ? governedContext.blockedReason : '确认提示词并生成音乐'}
            className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                正在生成...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                生成音乐
              </>
            )}
          </button>
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
    )}
    <SkillOverrideModal
      isOpen={isSkillModalOpen}
      onClose={() => setIsSkillModalOpen(false)}
      onConfirm={setSelectedSkills}
      initialSelectedSkills={selectedSkills}
    />
  </>;
};
