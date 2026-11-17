import { useAIConfigStore } from '../../clients/stateClient';
import { generateAIVoice } from '../../clients/aiClient';
import type { VoiceSettings } from '../../../packages/domain/src/speech';
import { useEffect, useState } from "react";
import { useGlobalStore, VoiceProfile } from "../../clients/stateClient";
import { Plus, Trash2, Mic, Play, Settings2, Save } from "lucide-react";
import { Button } from "../ui/Button";

export function GlobalVoiceLibrary() {
  const { voiceProfiles, addVoiceProfile, updateVoiceProfile, deleteVoiceProfile } = useGlobalStore();
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);

  useEffect(() => { void useAIConfigStore.getState().hydrate(); }, []);
  const selectedVoice = voiceProfiles.find(v => v.id === selectedVoiceId);

  const handleAdd = () => {
    addVoiceProfile({
      name: "新音色",
      description: "",
      tags: [],
      settings: { voice: '', language: 'Auto' },
      apiUrl: "",
      method: "POST",
      headers: '{\n  "Authorization": "Bearer YOUR_API_KEY",\n  "Content-Type": "application/json"\n}',
      bodyTemplate: '{\n  "text": "{{text}}",\n  "voice_id": "v1"\n}',
      audioPath: "data.audio_url"
    });
  };

  return (
    <div className="flex flex-col md:flex-row gap-6">
      {/* Left Sidebar: Voice List */}
      <div className="w-full md:w-1/3 flex flex-col text-text-primary">
        <div className="flex justify-between items-center mb-6 shrink-0">
          <h2 className="text-sm font-bold text-text-primary uppercase tracking-wider">音色列表</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={handleAdd}
            className="p-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-2 pr-2">
          {voiceProfiles.map(voice => (
            <div
              key={voice.id}
              onClick={() => setSelectedVoiceId(voice.id)}
              className={`p-4 rounded-xl cursor-pointer transition-all border ${
                selectedVoiceId === voice.id
                  ? "bg-bg-surface-soft border-border-soft/20 text-text-primary"
                  : "bg-bg-surface border-transparent text-text-secondary hover:bg-bg-surface-soft/80"
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold truncate pr-4">{voice.name}</h3>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteVoiceProfile(voice.id);
                    if (selectedVoiceId === voice.id) setSelectedVoiceId(null);
                  }}
                  className="text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-text-muted line-clamp-2 mb-3">{voice.description || "无描述"}</p>
              <div className="flex flex-wrap gap-1">
                {voice.tags.map((tag, i) => (
                  <span key={i} className="px-2 py-0.5 bg-bg-surface-soft text-text-secondary rounded-md text-[10px] uppercase border border-border-soft/10">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {voiceProfiles.length === 0 && (
            <div className="text-center text-text-muted text-xs py-8">
              暂无音色配置
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Voice Editor */}
      <div className="flex-1 flex flex-col pr-2">
        {selectedVoice ? (
          <VoicePresetEditor key={selectedVoice.id} voice={selectedVoice} onUpdate={(updates) => updateVoiceProfile(selectedVoice.id, updates)} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-muted flex-col gap-4 py-20">
            <Mic className="w-12 h-12 opacity-20" />
            <p className="text-xs font-bold uppercase tracking-widest">选择一个音色进行配置</p>
          </div>
        )}
      </div>
    </div>
  );
}

function LegacyVoiceEditor({ voice, onUpdate }: { voice: VoiceProfile, onUpdate: (updates: Partial<VoiceProfile>) => void }) {
  const [testText, setTestText] = useState("你好，世界！这是一段测试音频。");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ url?: string; error?: string } | null>(null);

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      // Simple variable replacement
      const bodyStr = voice.bodyTemplate.replace(/\{\{text\}\}/g, JSON.stringify(testText).slice(1, -1));
      let headersObj = {};
      try {
        headersObj = JSON.parse(voice.headers);
      } catch (e) {
        throw new Error("Headers JSON 解析失败");
      }

      const res = await fetch(voice.apiUrl, {
        method: voice.method,
        headers: headersObj,
        body: voice.method === 'POST' ? bodyStr : undefined,
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const data = await res.json();
      
      // Extract audio URL based on path (e.g., "data.audio_url")
      const pathParts = voice.audioPath.split('.');
      let audioUrl = data;
      for (const part of pathParts) {
        if (audioUrl && audioUrl[part] !== undefined) {
          audioUrl = audioUrl[part];
        } else {
          audioUrl = null;
          break;
        }
      }

      if (audioUrl && typeof audioUrl === 'string') {
        setTestResult({ url: audioUrl });
        onUpdate({ testAudioUrl: audioUrl });
      } else {
        throw new Error("无法从响应中提取音频 URL，请检查提取路径");
      }

    } catch (error: any) {
      setTestResult({ error: error.message || "请求失败" });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-6 pb-8 text-text-primary">
      <div className="flex items-center justify-between border-b border-border-soft/10 pb-4">
        <h2 className="text-md font-bold text-text-primary flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-text-muted" />
          音色配置
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-xs font-bold text-text-muted uppercase tracking-wider">音色名称</label>
          <input
            type="text"
            value={voice.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-text-primary focus:outline-none focus:border-border-soft/30 transition-all"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-text-muted uppercase tracking-wider">标签 (逗号分隔)</label>
          <input
            type="text"
            value={voice.tags.join(", ")}
            onChange={(e) => onUpdate({ tags: e.target.value.split(",").map(t => t.trim()).filter(Boolean) })}
            placeholder="女声, 青年, 温柔"
            className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-text-primary focus:outline-none focus:border-border-soft/30 transition-all"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-bold text-text-muted uppercase tracking-wider">描述</label>
        <textarea
          value={voice.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-text-primary focus:outline-none focus:border-border-soft/30 transition-all h-20 resize-none custom-scrollbar"
        />
      </div>

      <div className="space-y-4 bg-bg-surface p-6 rounded-2xl border border-border-soft/10">
        <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-4 border-b border-border-soft/10 pb-2">API 设置</h3>
        
        <div className="flex gap-4">
          <div className="w-32 space-y-2">
            <label className="text-xs font-bold text-text-muted uppercase">Method</label>
            <select
              value={voice.method}
              onChange={(e) => onUpdate({ method: e.target.value as 'POST' | 'GET' })}
              className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-text-primary focus:outline-none focus:border-border-soft/30 transition-all cursor-pointer"
            >
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </select>
          </div>
          <div className="flex-1 space-y-2">
            <label className="text-xs font-bold text-text-muted uppercase">API URL</label>
            <input
              type="text"
              value={voice.apiUrl}
              onChange={(e) => onUpdate({ apiUrl: e.target.value })}
              className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-text-primary focus:outline-none focus:border-border-soft/30 transition-all font-mono text-sm"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-text-muted uppercase">Headers (JSON)</label>
          <textarea
            value={voice.headers}
            onChange={(e) => onUpdate({ headers: e.target.value })}
            className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-text-secondary focus:outline-none focus:border-border-soft/30 transition-all font-mono text-xs h-24 resize-none custom-scrollbar"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-text-muted uppercase flex justify-between">
            <span>Body 模板 (JSON)</span>
            <span className="text-text-dark text-[10px]">使用 {"{{text}}"} 作为文本占位符</span>
          </label>
          <textarea
            value={voice.bodyTemplate}
            onChange={(e) => onUpdate({ bodyTemplate: e.target.value })}
            className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-text-secondary focus:outline-none focus:border-border-soft/30 transition-all font-mono text-xs h-32 resize-none custom-scrollbar"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-text-muted uppercase flex justify-between">
            <span>音频 URL 提取路径</span>
            <span className="text-text-dark text-[10px]">例如: data.audio_url</span>
          </label>
          <input
            type="text"
            value={voice.audioPath}
            onChange={(e) => onUpdate({ audioPath: e.target.value })}
            className="w-full bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-text-primary focus:outline-none focus:border-border-soft/30 transition-all font-mono text-sm"
          />
        </div>
      </div>

      {/* Test Section */}
      <div className="space-y-4 bg-bg-surface p-6 rounded-2xl border border-border-soft/10">
        <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-2">接口联调测试</h3>
        <div className="flex gap-4">
          <input
            type="text"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="输入测试文本..."
            className="flex-1 bg-bg-surface-soft border border-transparent rounded-xl px-4 py-2.5 text-text-primary focus:outline-none focus:border-border-soft/30 transition-all"
          />
          <Button
            onClick={handleTest}
            disabled={isTesting}
            leftIcon={isTesting ? undefined : <Play className="w-4 h-4" />}
            className="btn-primary rounded-xl cursor-pointer text-xs"
          >
            {isTesting ? "测试中..." : "发送测试"}
          </Button>
        </div>

        {testResult && (
          <div className={`p-4 rounded-xl border ${testResult.error ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-bg-surface-soft border-border-soft/10 text-text-secondary'}`}>
            {testResult.error ? (
              <p className="text-sm font-mono">{testResult.error}</p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-bold">测试成功！</p>
                {testResult.url && (
                  <audio controls src={testResult.url || undefined} className="w-full h-10" />
                )}
              </div>
            )}
          </div>
        )}
        
        {!testResult && voice.testAudioUrl && (
          <div className="p-4 rounded-xl border bg-bg-surface-soft border-border-soft/10">
            <p className="text-xs text-text-muted mb-2 uppercase tracking-wider">上次测试音频</p>
            <audio controls src={voice.testAudioUrl || undefined} className="w-full h-10" />
          </div>
        )}
      </div>
    </div>
  );
}


function VoicePresetEditor({ voice, onUpdate }: { voice: VoiceProfile; onUpdate: (updates: Partial<VoiceProfile>) => void }) {
  const { models } = useAIConfigStore();
  const [draft, setDraft] = useState<VoiceSettings>(voice.settings || { voice: '', language: 'Auto' });
  const [text, setText] = useState('你好，这是一段音色试听。');
  const [audio, setAudio] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const field = 'mt-1 w-full rounded-md border border-border-soft bg-bg-surface px-3 py-2 text-sm';
  const configured = models.some(m => m.id === draft.modelConfigId && m.capabilities.includes('audio'));
  return <section className="space-y-5 text-text-primary">
    <h2 className="text-sm font-semibold">可复用音色</h2>
    <p className="text-xs leading-5 text-text-muted">接口与凭证在系统设置管理。保存后，可在项目资产的角色声音中选用；角色保留自己的副本，后续修改不会覆盖已有配音。</p>
    {!voice.settings && <p className="text-xs text-amber-600">这是旧版自定义接口档案，尚未关联角色配音。请选择已配置的音频模型和音色 ID 后保存；原模板仍保留在下方。</p>}
    <label className="block text-xs">名称<input className={field} value={voice.name} onChange={e => onUpdate({ name: e.target.value })} /></label>
    <label className="block text-xs">说明<textarea className={field} value={voice.description} onChange={e => onUpdate({ description: e.target.value })} /></label>
    <label className="block text-xs">配音模型<select aria-label="音色预设配音模型" className={field} value={draft.modelConfigId || ''} onChange={e => setDraft({ ...draft, modelConfigId: e.target.value })}><option value="">选择音频模型</option>{draft.modelConfigId && !configured && <option value={draft.modelConfigId}>原模型已移除，请重新选择</option>}{models.filter(m => m.capabilities.includes('audio')).map(m => <option key={m.id} value={m.id}>{m.alias}</option>)}</select></label>
    <label className="block text-xs">音色 ID<input aria-label="音色预设 ID" className={field} value={draft.voice} onChange={e => setDraft({ ...draft, voice: e.target.value })} /></label>
    <label className="block text-xs">语言<input className={field} value={draft.language || 'Auto'} onChange={e => setDraft({ ...draft, language: e.target.value })} /></label>
    <label className="block text-xs">语速（模型支持时生效）<input type="number" min="0.25" max="4" step="0.05" className={field} value={draft.speed ?? 1} onChange={e => setDraft({ ...draft, speed: Number(e.target.value) })} /></label>
    <label className="block text-xs">声音要求<textarea className={field} value={draft.instructions || ''} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /></label>
    <button className="rounded-md border border-border-soft px-3 py-2 text-xs disabled:opacity-40" disabled={!configured || !draft.voice.trim()} onClick={() => onUpdate({ settings: draft })}>保存为可选音色</button>
    <label className="block text-xs">试听文本<textarea className={field} value={text} onChange={e => setText(e.target.value)} /></label>
    <button className="rounded-md border border-border-soft px-3 py-2 text-xs disabled:opacity-40" disabled={busy || !configured || !draft.voice || !text.trim()} onClick={async () => { setBusy(true); setError(''); try { setAudio(await generateAIVoice({ purpose: 'preview', text, ...draft, voiceName: draft.voice })); } catch (e) { setError(e instanceof Error ? e.message : '试听失败'); } finally { setBusy(false); } }}>{busy ? '生成中…' : '生成试听'}</button>
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}{audio && <audio controls src={audio} className="w-full" />}
    {voice.apiUrl && <details className="border-t border-border-soft pt-4 text-xs"><summary>旧接口档案与联调（不用于角色配音）</summary><div className="pt-4"><LegacyVoiceEditor voice={voice} onUpdate={onUpdate} /></div></details>}
  </section>;
}
