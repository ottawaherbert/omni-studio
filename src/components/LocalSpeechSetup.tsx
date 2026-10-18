import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAIConfigStore } from '../clients/stateClient';
import { QWEN_TTS_MODEL } from '../../packages/domain/src/speech';

export function LocalSpeechSetup() {
  const [busy, setBusy] = useState(false);
  return <div className="mb-6 border-b border-border-soft/20 pb-5">
    <h3 className="text-sm font-semibold">本机语音服务</h3>
    <p className="mt-2 text-xs text-text-muted">MLX Audio · Qwen3-TTS 1.7B · http://127.0.0.1:8033/v1。角色音色和试听在“制片 → 项目资产 → 角色 → 角色表演档案 → 角色声音”设置。支持语言与表演指令，语速快慢可写入表演要求；不支持数值语速。</p>
    <button disabled={busy} className="mt-3 rounded-md border border-border-soft px-3 py-2 text-xs" onClick={async () => {
      setBusy(true);
      try {
        await useAIConfigStore.getState().hydrate();
        const current = useAIConfigStore.getState();
        if (current.loadError) throw new Error(current.loadError);
        const channelId = 'local-mlx-audio'; const modelId = 'local-qwen3-tts-1-7b';
        await current.saveConfig({
          channels: current.channels.some(item => item.id === channelId) ? current.channels : [...current.channels, { id: channelId, name: '本机 MLX 语音', type: 'custom', baseUrl: 'http://127.0.0.1:8033/v1', apiKey: '' }],
          models: current.models.some(item => item.id === modelId) ? current.models : [...current.models, { id: modelId, channelId, alias: '本机 Qwen3-TTS 1.7B', modelId: QWEN_TTS_MODEL, capabilities: ['audio'] }],
          routing: { ...current.routing, audioGen: modelId },
        });
        if (useAIConfigStore.getState().loadError) throw new Error(useAIConfigStore.getState().loadError);
        toast.success('已保存本机音频接口并设为默认配音模型');
      } catch (error) { toast.error(error instanceof Error ? error.message : '保存失败'); }
      finally { setBusy(false); }
    }}>{busy ? '保存中…' : '使用本机 Qwen3-TTS 配音'}</button>
  </div>;
}
