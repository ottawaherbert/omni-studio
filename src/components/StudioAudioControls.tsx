import React, { useRef, useState } from "react";
import { Loader2, Mic, Music, Wand2, Library, Volume2, FolderOpen } from "lucide-react";
import { AudioTrack, Project } from "../clients/domainTypes";
import { BgmGeneratorModal, type BgmGovernedContext, type BgmGenerationResult } from "./BgmGeneratorModal";
import { flushDebouncedProjectSave, useGlobalStore } from "../clients/stateClient";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import { Modal } from "./ui/Modal";
import { buildGovernedBgmTrackUpdate } from "../clients/productionStudioWorkflowClient";

interface StudioAudioControlsProps {
  selectedAudioTrack: AudioTrack;
  localAudioText: string;
  onAudioTextChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  currentProject: Project;
  isGeneratingVoice: boolean;
  onGenerateVoice: () => void;
  onUpdateCharacter: (characterId: string) => void;
  onUpdateAudioTrack: (updates: Partial<AudioTrack>) => void;
  generationGate?: { ready: boolean; reason: string };
  promptReadOnly?: boolean;
  bgmGovernedContext?: BgmGovernedContext;
}

export const StudioAudioControls: React.FC<StudioAudioControlsProps> = ({
  selectedAudioTrack,
  localAudioText,
  onAudioTextChange,
  currentProject,
  isGeneratingVoice,
  onGenerateVoice,
  onUpdateCharacter,
  onUpdateAudioTrack,
  generationGate,
  promptReadOnly = false,
  bgmGovernedContext,
}) => {
  const [isBgmModalOpen, setIsBgmModalOpen] = useState(false);
  const [isLibraryModalOpen, setIsLibraryModalOpen] = useState(false);
  const { globalAssets } = useGlobalStore();
  const bgmGovernedContextRef = useRef(bgmGovernedContext);
  bgmGovernedContextRef.current = bgmGovernedContext;
  const globalBgmAssets = globalAssets.filter(a => a.type === 'bgm');
  const projectBgmAssets = currentProject.assets.filter(a => a.type === 'bgm');
  const allBgmAssets = [...projectBgmAssets, ...globalBgmAssets];

  const globalSfxAssets = globalAssets.filter(a => a.type === 'sfx');
  const projectSfxAssets = currentProject.assets.filter(a => a.type === 'sfx');
  const allSfxAssets = [...projectSfxAssets, ...globalSfxAssets];

  const allLibraryAssets = selectedAudioTrack.type === 'bgm' ? allBgmAssets : allSfxAssets;
  const handleGovernedBgmGenerated = (result: BgmGenerationResult) => {
    const updates = buildGovernedBgmTrackUpdate(result, bgmGovernedContextRef.current);
    if (!updates) {
      toast.error("故事板或当前音轨已变化，本次 BGM 不会写入项目。");
      return false;
    }
    onUpdateAudioTrack(updates);
    return true;
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3 border-b border-border-soft/20 pb-4">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="studio-track-volume" className="text-xs font-medium">音轨音量</label>
          <span className="text-xs tabular-nums">{Math.round((selectedAudioTrack.volume ?? 1) * 100)}%</span>
        </div>
        <input id="studio-track-volume" type="range" min="0" max="1" step="0.01"
          className="w-full" value={selectedAudioTrack.volume ?? 1}
          onChange={(event) => onUpdateAudioTrack({ volume: Number(event.target.value) })} />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={selectedAudioTrack.muted ?? false}
            onChange={(event) => onUpdateAudioTrack({ muted: event.target.checked })} />
          静音此音轨
        </label>
      </div>
      {selectedAudioTrack.type === 'dialogue' && (
        <>
          {selectedAudioTrack.url && <div className="space-y-2">
            <p className="text-xs text-text-muted">当前录音 · {selectedAudioTrack.duration.toFixed(2)} 秒</p>
            <audio aria-label="当前台词录音" key={selectedAudioTrack.url} controls preload="metadata" src={selectedAudioTrack.url} className="w-full" />
          </div>}
          <div>
            <label className="flex items-center gap-2.5 text-[10px] font-black text-gray-400 dark:text-neutral-500 mb-3 uppercase tracking-[0.2em]">
              <div className="w-6 h-6 bg-violet-100 dark:bg-violet-900/30 rounded-lg flex items-center justify-center shadow-sm">
                <Mic className="w-3 h-3 text-violet-600 dark:text-violet-400" />
              </div>
              配音台词
            </label>
            <textarea
              value={localAudioText}
              readOnly={promptReadOnly}
              onChange={(event) => { if (!promptReadOnly) onAudioTextChange(event); }}
              placeholder="输入该镜头的对白或旁白..."
              className="w-full h-36 bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-[2rem] p-6 text-xs text-gray-700 dark:text-neutral-300 font-black resize-none focus:outline-none focus:ring-4 focus:ring-violet-500/5 focus:border-violet-500/30 custom-scrollbar transition-all shadow-inner leading-relaxed"
            />
          </div>

          <div>
            <label className="flex items-center gap-2.5 text-[10px] font-black text-gray-400 dark:text-neutral-500 mb-3 uppercase tracking-[0.2em]">
              <div className="w-6 h-6 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center shadow-sm">
                <Mic className="w-3 h-3 text-amber-600 dark:text-amber-400" />
              </div>
              绑定配音角色
            </label>
            <div className="relative">
              <select 
                value={selectedAudioTrack.characterId || ""}
                onChange={(e) => onUpdateCharacter(e.target.value)}
                className="w-full bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-2xl p-4 text-xs text-gray-700 dark:text-neutral-300 font-black focus:outline-none focus:ring-4 focus:ring-violet-500/5 focus:border-violet-500/30 shadow-inner transition-all appearance-none cursor-pointer"
              >
                <option value="">选择角色...</option>
                <option value="narrator">旁白 (Narrator)</option>
                {currentProject.characters.map(char => (
                  <option key={char.id} value={char.id}>{char.name}</option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
              </div>
            </div>
          </div>

          <button
            onClick={onGenerateVoice}
            disabled={isGeneratingVoice || !localAudioText || Boolean(generationGate && !generationGate.ready)}
            title={generationGate && !generationGate.ready ? generationGate.reason : "生成 AI 配音"}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-900 hover:bg-black dark:bg-violet-600 dark:hover:bg-violet-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-gray-500/20 active:scale-95 disabled:opacity-50 group"
          >
            {isGeneratingVoice ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4 group-hover:scale-110 transition-transform" />}
            生成 AI 配音
          </button>
          {Boolean(selectedAudioTrack.voiceHistory?.length) && <details className="border-t border-border-soft/20 pt-3 text-xs">
            <summary className="cursor-pointer">历史录音（{selectedAudioTrack.voiceHistory!.length}）</summary>
            <div className="mt-3 space-y-3">
              {[...selectedAudioTrack.voiceHistory!].reverse().map((version, index) => <div key={`${version.archivedAt}-${index}`}>
                <p className="mb-1 text-text-muted">{version.text || '此前录音'} · {version.duration.toFixed(1)} 秒</p>
                <audio controls preload="none" src={version.url} className="w-full" />
              </div>)}
            </div>
          </details>}
        </>
      )}
      
      {selectedAudioTrack.type === 'bgm' && (
        <div className="space-y-6">
          <div className="p-6 bg-white dark:bg-neutral-900 border border-gray-100 dark:border-neutral-800 rounded-[2rem] shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 text-gray-900 dark:text-white">
                <div className="w-8 h-8 bg-violet-100 dark:bg-violet-900/30 rounded-xl flex items-center justify-center shadow-sm">
                  <Music className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                </div>
                <h4 className="font-black text-sm tracking-tight uppercase">背景音乐 (BGM)</h4>
              </div>
              {selectedAudioTrack.url && (
                <button
                  onClick={() => onUpdateAudioTrack({ linkedAssetId: undefined, url: '', audioMedia: undefined, generationAudit: undefined })}
                  className="text-[10px] font-black text-gray-400 hover:text-red-500 dark:text-neutral-500 dark:hover:text-red-400 transition-colors uppercase tracking-widest"
                >
                  解绑
                </button>
              )}
            </div>
            <p className="text-[10px] text-gray-400 dark:text-neutral-500 mb-6 font-black uppercase tracking-widest">
              {selectedAudioTrack.url ? '已绑定音乐资产' : '尚未生成或绑定音乐'}
            </p>
            
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setIsBgmModalOpen(true)}
                disabled={Boolean(generationGate && !generationGate.ready)}
                title={generationGate && !generationGate.ready ? generationGate.reason : "打开音乐提示词确认"}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-900 hover:bg-black dark:bg-violet-600 dark:hover:bg-violet-500 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-gray-500/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 group"
              >
                <Wand2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                {selectedAudioTrack.url ? '重新生成' : '生成音乐'}
              </button>
              <button
                onClick={() => setIsLibraryModalOpen(true)}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-50 hover:bg-gray-100 text-gray-900 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest border border-gray-100 dark:border-neutral-800 transition-all active:scale-95"
              >
                <Library className="w-4 h-4 text-violet-600" />
                从资产库选择
              </button>
            </div>
          </div>
          
          <BgmGeneratorModal
            isOpen={isBgmModalOpen}
            onClose={() => setIsBgmModalOpen(false)}
            initialPrompt={selectedAudioTrack.text || ''}
            governedContext={bgmGovernedContext}
            onGenerated={bgmGovernedContext ? handleGovernedBgmGenerated : undefined}
            onSave={(bgmAssetId) => {
              onUpdateAudioTrack({ linkedAssetId: bgmAssetId });
            }}
          />


        </div>
      )}

      {selectedAudioTrack.type === 'sfx' && (
        <div className="space-y-6">
          <div className="p-6 bg-white dark:bg-neutral-900 border border-gray-100 dark:border-neutral-800 rounded-[2rem] shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 text-gray-900 dark:text-white">
                <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center shadow-sm">
                  <Volume2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <h4 className="font-black text-sm tracking-tight uppercase">音效 (SFX)</h4>
              </div>
              {selectedAudioTrack.url && (
                <button
                  onClick={() => onUpdateAudioTrack({ linkedAssetId: undefined, url: '', audioMedia: undefined, generationAudit: undefined })}
                  className="text-[10px] font-black text-gray-400 hover:text-red-500 dark:text-neutral-500 dark:hover:text-red-400 transition-colors uppercase tracking-widest"
                >
                  解绑
                </button>
              )}
            </div>
            <p className="text-[10px] text-gray-400 dark:text-neutral-500 mb-6 font-black uppercase tracking-widest">
              {selectedAudioTrack.url ? '已绑定音效资产' : '尚未绑定音效'}
            </p>
            
            <button
              onClick={() => setIsLibraryModalOpen(true)}
              className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-50 hover:bg-gray-100 text-gray-900 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-white rounded-2xl text-[10px] font-black uppercase tracking-widest border border-gray-100 dark:border-neutral-800 transition-all active:scale-95"
            >
              <FolderOpen className="w-4 h-4 text-violet-600" />
              从资产库选择
            </button>
          </div>
          
          <div className="space-y-2 text-xs text-text-secondary">
            <label className="block">音效内容<textarea aria-label="音效内容" className="mt-2 min-h-24 w-full rounded-md border border-border-soft bg-bg-primary p-3 text-text-primary" value={localAudioText} onChange={onAudioTextChange} onBlur={() => void flushDebouncedProjectSave(currentProject.id).catch(() => toast.error("音效内容尚未保存成功，请重试。"))} /></label>
            <p>本场 {selectedAudioTrack.startTime.toFixed(1)} 秒进入，持续 {selectedAudioTrack.duration.toFixed(1)} 秒。</p>
            <p className="leading-5 text-text-muted">内容自动保存。可从资产库选择声音，在时间轴调整位置和时长；当前尚未接入在线音效生成。</p>
          </div>
        </div>
      )}
      <Modal isOpen={isLibraryModalOpen} onClose={() => setIsLibraryModalOpen(false)} title={selectedAudioTrack.type === 'bgm' ? '选择背景音乐' : '选择音效'} size="sm">
        <div className="space-y-3">
          {allLibraryAssets.length === 0 ? <div className="space-y-3 py-4 text-sm text-text-secondary">
            <p>资产库中还没有{selectedAudioTrack.type === 'bgm' ? '背景音乐' : '音效'}。先添加声音素材，再返回这里选择。</p>
            <Link className="inline-block text-gold hover:underline" to="/assets">前往全局资产库</Link>
          </div> : allLibraryAssets.map(asset => <button type="button" key={asset.id} onClick={() => {
            onUpdateAudioTrack({ linkedAssetId: asset.id, url: '', audioMedia: undefined, generationAudit: undefined });
            setIsLibraryModalOpen(false);
          }} className="w-full rounded-md border border-border-soft p-3 text-left hover:bg-bg-surface-hover">
            <span className="block text-sm font-semibold text-text-primary">{asset.name}</span>
            {asset.description && <span className="mt-1 block text-xs leading-5 text-text-muted">{asset.description}</span>}
          </button>)}
        </div>
      </Modal>
    </div>
  );
};
