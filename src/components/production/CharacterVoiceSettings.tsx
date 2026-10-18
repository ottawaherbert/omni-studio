import { characterSpeechDirection } from '../../utils/studioVoiceResult';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import type { Character } from '../../clients/domainTypes';
import { useAIConfigStore, useProjectStore, flushDebouncedProjectSave } from '../../clients/stateClient';
import { generateAIVoice } from '../../clients/aiClient';
import { withManualAIResult } from '../../clients/manualAIClient';
import { ManualAIResultField } from '../ManualAIResultField';
import TTSConfigModal from '../TTSConfigModal';
import type { ManualAIResult } from '../../../packages/domain/src/manualAI';
import { QWEN_VOICES, QWEN_LANGUAGES, isQwenCustomVoice, speechCapabilities, type VoiceSettings } from '../../../packages/domain/src/speech';

const field = 'mt-1 w-full rounded-md border border-border-soft bg-bg-surface px-3 py-2 text-sm';
export function CharacterVoiceSettings({ character, projectId }: { character: Character; projectId: string }) {
  const { models, channels, routing, hydrate } = useAIConfigStore();
  const [draft, setDraft] = useState<VoiceSettings>(() => character.voiceSettings || { voice: character.voiceName || '', language: 'Auto' });
  const [text, setText] = useState('别着急。我在这里，把刚才发生的事情慢慢告诉我。');
  const [manualResult, setManualResult] = useState<ManualAIResult>();
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [candidate, setCandidate] = useState<{ url: string; settings: VoiceSettings; text: string }>();
  const [duration, setDuration] = useState(0);
  useEffect(() => { void hydrate(); }, [hydrate]);
  useEffect(() => { setDraft(character.voiceSettings || { voice: character.voiceName || '', language: 'Auto' }); setCandidate(undefined); setManualResult(undefined); }, [character.id, projectId]);
  const model = models.find(item => item.id === (draft.modelConfigId || routing.audioGen));
  const channel = channels.find(item => item.id === model?.channelId);
  const qwen = isQwenCustomVoice(model?.modelId);
  const capabilities = speechCapabilities(model?.modelId);
  const voices = qwen ? QWEN_VOICES : channel?.type === 'gemini' ? ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'] : [];
  const save = async (settings: VoiceSettings, reference?: NonNullable<Character['voiceReferences']>[number]) => {
    const store = useProjectStore.getState();
    const project = store.currentProject;
    if (project?.id !== projectId || !project.characters.some(item => item.id === character.id)) throw new Error('项目或角色已切换，本次结果未写入。');
    await store.updateProject({ characters: project.characters.map(item => item.id === character.id ? {
      ...item, voiceName: settings.voice, voiceSettings: settings,
      ...(reference ? { voiceReferences: [...(item.voiceReferences || []).map(ref => ({ ...ref, isDefault: false })), reference] } : {}),
    } : item) });
    await flushDebouncedProjectSave(projectId);
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try { await operation(); } catch (error) { toast.error(error instanceof Error ? error.message : '声音操作失败'); }
    finally { setBusy(false); }
  };
  const previewInstructions = characterSpeechDirection(character.vocalQuirk, draft.instructions);
  const adopted = character.voiceReferences?.filter(reference => reference.usage === 'voice_timbre');
  return <section className="border-t border-border-soft/20 py-6">
    <h2 className="text-sm font-bold">角色声音</h2>
    <p className="mt-2 text-xs text-text-muted">全剧共用这份角色音色。接口在系统设置管理，上方说话习惯会带入试听与配音，单句情绪在配音时调整；换音色不会覆盖已有音频。</p>
    <fieldset disabled={busy || uploading} className="mt-4 space-y-4 disabled:opacity-60">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="text-xs">配音模型<select aria-label="角色配音模型" className={field} value={draft.modelConfigId || ''} onChange={event => setDraft({ ...draft, modelConfigId: event.target.value || undefined, voice: '' })}>
          <option value="">跟随系统音频模型{routing.audioGen ? '' : '（尚未配置）'}</option>
          {models.filter(item => item.capabilities.includes('audio')).map(item => <option key={item.id} value={item.id}>{item.alias}</option>)}
        </select></label>
        <label className="text-xs">默认音色{voices.length ? <select aria-label="角色默认音色" className={field} value={draft.voice} onChange={event => setDraft({ ...draft, voice: event.target.value })}>
          <option value="">请选择音色</option>
          {draft.voice && !voices.includes(draft.voice) && <option value={draft.voice}>{draft.voice}（当前模型不支持，请重选）</option>}
          {voices.map(voice => <option key={voice} value={voice}>{voice}</option>)}
        </select> : <input aria-label="角色默认音色" className={field} value={draft.voice} onChange={event => setDraft({ ...draft, voice: event.target.value })} placeholder="填写该接口的音色 ID" />}</label>
        <label className="text-xs">默认配音语言<select aria-label="角色配音语言" className={field} value={draft.language || 'Auto'} onChange={event => setDraft({ ...draft, language: event.target.value })}>
          {QWEN_LANGUAGES.map(language => <option key={language} value={language}>{language === 'Auto' ? '自动识别' : language}</option>)}
        </select></label>
        <div className="self-end pb-2 text-xs text-text-muted">{model?.alias || '请先在设置 → 任务路由中配置音频模型'}{qwen ? ' · 本地预设音色' : ''}</div>
      </div>
      <label className="block text-xs">默认声音与表演要求<textarea aria-label="角色声音要求" className={field} rows={2} value={draft.instructions || ''} onChange={event => setDraft({ ...draft, instructions: event.target.value })} placeholder="例如：克制、语气平静，句尾不刻意上扬。具体效果取决于模型。" /></label>
      {!capabilities.instructions && <p className="text-xs text-text-muted">当前接口模型不支持表演指令。请切换到支持的模型，或按此要求在外部制作后上传。</p>}
      {capabilities.speed ? <label className="block text-xs">默认语速<input aria-label="角色默认语速" type="number" min={0.25} max={4} step={0.05} className={field} value={draft.speed ?? 1} onChange={event => setDraft({ ...draft, speed: Number(event.target.value) })} /></label> : <p className="text-xs text-text-muted">当前模型不支持数值语速。支持表演指令时，可在声音要求中写“缓慢”或“急促”。</p>}
      <button type="button" className="rounded-md border border-border-soft px-3 py-2 text-xs" disabled={!draft.voice} onClick={() => void run(async () => { await save(draft); toast.success('角色声音设置已保存'); })}>保存声音设置</button>
      <label className="block text-xs">试听台词<textarea aria-label="角色试听台词" className={field} rows={2} value={text} onChange={event => { setText(event.target.value); setManualResult(undefined); }} /></label>
      <ManualAIResultField kind="audio" prompt={[`音色：${draft.voice}`, `语言：${draft.language}`, capabilities.speed ? `语速：${draft.speed ?? 1}` : '', previewInstructions, text].filter(Boolean).join('\n')} sourcePrompt={text} projectId={projectId} value={manualResult} onChange={setManualResult} onBusyChange={setUploading} />
      <button type="button" disabled={!text.trim() || !draft.voice || (!model && !manualResult)} className="rounded-md bg-text-primary px-4 py-2 text-xs text-bg-surface disabled:opacity-40" onClick={() => { if (!manualResult) { setPromptOpen(true); return; } void run(async () => {
        const settings = { ...draft, speed: capabilities.speed ? draft.speed : undefined, modelConfigId: model?.id };
        const url = await withManualAIResult(text, manualResult, () => generateAIVoice({ text, voiceName: settings.voice, ...settings, instructions: previewInstructions, projectId }));
        setCandidate({ url, settings, text }); setDuration(0);
      }); }}>{busy ? '处理中…' : manualResult ? '试听上传的声音' : '生成试听'}</button>
    </fieldset>
    <TTSConfigModal isOpen={promptOpen} projectId={projectId} onClose={() => setPromptOpen(false)} title="角色试听提示词" initialText={text} modelId={model?.id} voiceName={draft.voice} language={draft.language} instructions={previewInstructions} speed={draft.speed} onConfirm={async (finalText, direction) => {
      setBusy(true);
      try {
        const settings = { ...draft, ...direction, modelConfigId: model?.id };
        const url = await generateAIVoice({ text: finalText, voiceName: settings.voice, ...settings, projectId });
        setCandidate({ url, settings: { ...settings, instructions: settings.instructions === previewInstructions ? draft.instructions : settings.instructions }, text: finalText }); setDuration(0);
      } finally { setBusy(false); }
    }} />
    {candidate && <div className="mt-4 space-y-2">
      <p className="text-xs">试听候选 · {candidate.settings.voice} · {candidate.settings.language}</p>
      <audio controls src={candidate.url} className="w-full" onLoadedMetadata={event => setDuration(event.currentTarget.duration)} />
      <button type="button" disabled={busy || !Number.isFinite(duration) || duration <= 0} className="rounded-md border border-border-soft px-3 py-2 text-xs disabled:opacity-40" onClick={() => void run(async () => {
        await save(candidate.settings, { id: crypto.randomUUID(), url: candidate.url, language: candidate.settings.language, durationSeconds: duration, usage: 'voice_timbre', description: `${candidate.settings.voice} · ${candidate.text}`, isDefault: true, createdAt: Date.now() });
        setDraft(candidate.settings); setCandidate(undefined); toast.success('已采用为角色声音参考');
      })}>保存为角色音色参考</button>
      <p className="text-xs text-text-muted">声音参考会关联此角色；是否能传给视频接口取决于视频模型能力。当前本地 ComfyUI H3 与 Grok 不接受参考音频，配音仍可用于后续声音合成。</p>
    </div>}
    {adopted?.length ? <div className="mt-5 space-y-3"><h3 className="text-xs font-bold">已采用声音参考</h3>{adopted.map(reference => <div key={reference.id}><p className="mb-1 text-xs text-text-muted">{reference.isDefault ? '默认 · ' : ''}{reference.description}</p><audio controls src={reference.url} className="w-full" /></div>)}</div> : null}
  </section>;
}
