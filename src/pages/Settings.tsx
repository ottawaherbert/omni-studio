import React, { useEffect, useState } from 'react';
import { LocalSpeechSetup } from '../components/LocalSpeechSetup';
import { motion } from 'motion/react';
import { RefreshCw, Wand2, Settings2, Cpu, Network, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSettingsStore } from '../clients/stateClient';
import { useAIConfigStore, AIChannel, AIModel } from '../clients/stateClient';
import { useGlobalStore } from '../clients/stateClient';
import SkillForge from '../components/SkillForge';
import { aiConfigClient } from '../clients/aiConfigClient';
import { comfyUIClient, type ComfyUIConnectionStatus } from '../clients/comfyUIClient';
import { systemClient } from '../clients/systemClient';
import {
  channelPresetForType,
  channelPresets,
  COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS,
  COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND,
  KIE_GPT_IMAGE_2_DEFAULT_SETTINGS,
  KIE_GPT_IMAGE_2_ADAPTER_ID,
  KIE_GPT_IMAGE_2_FAMILY_ID,
  KIE_GPT_IMAGE_2_RESOLUTIONS,
  KIE_GROK_IMAGE_ADAPTER_ID,
  KIE_GROK_IMAGE_FAMILY_ID,
  MINIMAX_H3_MODEL_ID,
  MINIMAX_H3_VIDEO_DEFAULT_SETTINGS,
  KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID,
  KIE_GROK_VIDEO_DEFAULT_SETTINGS,
  KIE_GROK_VIDEO_MAX_DURATION_SECONDS,
  KIE_GROK_VIDEO_MIN_DURATION_SECONDS,
  KIE_GROK_VIDEO_RESOLUTIONS,
  REASONING_EFFORT_OPTIONS,
  taskCapabilityRequirements,
  type ChannelType,
  VIDEO_MODEL_ADAPTER_OPTIONS,
  isKieGrokImageModelId,
  isKieGptImage2ModelId,
  isKieGrokVideoModelId,
  isOpenAICompatibleTextChannelType,
} from '../config/aiConfigDefaults';
import {
  imageModelCapabilitySummary,
  resolveImageModelCapabilities,
} from '../clients/productionStudioWorkflowClient';

const imageModelRouteLabel = (model: AIModel, channel?: AIChannel) => {
  if (model.managedBy === 'comfyui_h3_workflow') return `${model.alias} · 本地 ComfyUI 工作流`;
  if (!channel || !model.capabilities.includes('image')) return `${model.alias} (${model.modelId})`;
  const capabilities = resolveImageModelCapabilities({ model, channel });
  return `${model.alias} · ${imageModelCapabilitySummary(capabilities)}`;
};

const ORDINARY_VIDEO_MODEL_ADAPTER_OPTIONS = VIDEO_MODEL_ADAPTER_OPTIONS.filter(
  (option) => !option.id.startsWith('video.minimax.h3.'),
);

export default function Settings() {
  const [activeTab, setActiveTab] = useState<'basic' | 'routing' | 'bgm' | 'channels' | 'models' | 'comfyui' | 'skills'>('basic');
  const {
    isTestMode,
    setIsTestMode,
    isFastMode,
    setIsFastMode,
    isAutoProductionModeEnabled,
    setIsAutoProductionModeEnabled,
    isStoryChapterGateEnabled,
    setIsStoryChapterGateEnabled,
  } = useSettingsStore();

  const menuGroups = [
    {
      title: '基础设置',
      items: [
        { id: 'basic', label: '基本设置', icon: Settings2 }
      ]
    },
    {
      title: 'AI 配置',
      items: [
        { id: 'channels', label: '渠道管理', icon: Cpu },
        { id: 'models', label: '模型管理', icon: Wand2 },
        { id: 'routing', label: '任务路由', icon: Network },
        { id: 'bgm', label: 'BGM API', icon: Settings2 },
        { id: 'comfyui', label: 'ComfyUI 工作流', icon: Cpu }
      ]
    },
    {
      title: 'Skill 管理',
      items: [
        { id: 'skills', label: '通用 Skill 库', icon: Wand2 }
      ]
    }
  ];
  const { 
    channels, models, routing, visualQcEnabled, comfyWorkflows,
    hydrate, saveConfig, isSaving, loadError,
    addChannel, updateChannel, deleteChannel,
    addModel, updateModel, deleteModel,
    updateRouting, setVisualQcEnabled, addComfyWorkflow, updateComfyWorkflow, deleteComfyWorkflow
  } = useAIConfigStore();
  const { bgmSettings, updateBgmSettings } = useGlobalStore();
  const [providerKeyStatus, setProviderKeyStatus] = useState<Record<string, any>>({});
  const customBgmKeySource = bgmSettings.customKeySource || (bgmSettings.customApiKey?.trim() ? 'local' : 'serverEnv');
  const customBgmEnvName = bgmSettings.customApiKeyEnvName || 'OMNI_CUSTOM_BGM_API_KEY';
  const customBgmStatus = providerKeyStatus.customBgm as unknown as {
    envName?: string;
    ready?: boolean;
    error?: string;
    allowedOriginsConfigured?: boolean;
    allowedOriginCount?: number;
    allowedModelCount?: number;
  } | undefined;

  const refreshProviderKeyStatus = () => {
    aiConfigClient.getProviderKeyStatus(customBgmEnvName)
      .then((data) => setProviderKeyStatus(data || {}))
      .catch(() => setProviderKeyStatus({}));
  };

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    refreshProviderKeyStatus();
  }, [customBgmEnvName]);

  const [selectedChannelFilter, setSelectedChannelFilter] = useState<string>('all');

  const [comfySetupForm, setComfySetupForm] = useState({
    name: '本地 MiniMax H3',
    baseUrl: '',
  });
  const [comfyConnectionStatus, setComfyConnectionStatus] = useState<ComfyUIConnectionStatus | null>(null);
  const [isCheckingComfyUI, setIsCheckingComfyUI] = useState(false);

  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [newChannelForm, setNewChannelForm] = useState<Partial<AIChannel>>({
    name: '',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
  });

  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState<Partial<AIModel>>({
    alias: '',
    channelId: '',
    modelId: '',
    capabilities: ['text'],
    apiKeyOverride: '',
    reasoningEffort: 'provider_default',
    videoAdapterId: 'auto',
  });

  const managedLocalH3ChannelIds = new Set(comfyWorkflows
    .filter((workflow) => workflow.kind === COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND && workflow.channelId)
    .map((workflow) => workflow.channelId!));
  const visibleChannels = channels.filter((channel) => (
    channel.managedBy !== 'comfyui_h3_workflow' && !managedLocalH3ChannelIds.has(channel.id)
  ));
  const visibleModels = models.filter((model) => (
    model.managedBy !== 'comfyui_h3_workflow' && !managedLocalH3ChannelIds.has(model.channelId)
  ));
  const filteredModels = selectedChannelFilter === 'all'
    ? visibleModels
    : visibleModels.filter((model) => model.channelId === selectedChannelFilter);
  const modelFormChannel = channels.find((channel) => channel.id === modelForm.channelId);
  const modelFormKieVideoSettings = {
    ...KIE_GROK_VIDEO_DEFAULT_SETTINGS,
    ...(modelForm.kieGrokVideo || {}),
  };
  const modelFormKieGrokImage = modelFormChannel?.type === 'kie' && Boolean(modelForm.modelId && isKieGrokImageModelId(modelForm.modelId));
  const modelFormKieGptImage2 = modelFormChannel?.type === 'kie' && Boolean(modelForm.modelId && isKieGptImage2ModelId(modelForm.modelId));
  const modelFormKieGptImage2Settings = {
    ...KIE_GPT_IMAGE_2_DEFAULT_SETTINGS,
    ...(modelForm.kieGptImage2 || {}),
  };
  const modelFormKieGrokVideo = modelFormChannel?.type === 'kie' && Boolean(modelForm.modelId && isKieGrokVideoModelId(modelForm.modelId));
  const modelFormSupportsReasoning = Boolean(
    modelFormChannel
    && modelFormChannel.type !== 'kie'
    && isOpenAICompatibleTextChannelType(modelFormChannel.type)
    && modelForm.capabilities?.includes('text'),
  );
  const normalizedModelFormId = modelForm.modelId?.trim() || '';

  const openNewModelModal = () => {
    if (visibleChannels.length === 0) { toast.error('请先创建渠道'); return; }
    setEditingModelId(null);
    setModelForm({ alias: '', channelId: visibleChannels[0].id, modelId: '', capabilities: ['text'], apiKeyOverride: '', reasoningEffort: 'provider_default', videoAdapterId: 'auto' });
    setIsModelModalOpen(true);
  };

  const openEditModelModal = (model: AIModel) => {
    setEditingModelId(model.id);
    setModelForm(JSON.parse(JSON.stringify(model)));
    setIsModelModalOpen(true);
  };


  const addKieGptImage2 = () => {
    const existing = models.find((model) => {
      const channel = channels.find((item) => item.id === model.channelId);
      return channel?.type === 'kie' && isKieGptImage2ModelId(model.modelId);
    });
    if (existing) {
      setSelectedChannelFilter(existing.channelId);
      openEditModelModal(existing);
      return;
    }
    const channel = channels.find((item) => item.type === 'kie');
    if (!channel) {
      toast.error('请先配置 Kie 渠道和 API Key');
      return;
    }
    const model: AIModel = {
      id: `model-kie-gpt-image-2-${Date.now()}`,
      channelId: channel.id,
      alias: 'GPT Image 2',
      modelId: KIE_GPT_IMAGE_2_FAMILY_ID,
      capabilities: ['image'],
      apiKeyOverride: '',
      visualPromptLanguagePolicy: 'provider_default',
      imageAdapterId: KIE_GPT_IMAGE_2_ADAPTER_ID,
      videoAdapterId: 'auto',
      kieGptImage2: KIE_GPT_IMAGE_2_DEFAULT_SETTINGS,
    };
    addModel(model);
    setSelectedChannelFilter(channel.id);
    openEditModelModal(model);
  };

  const addKieGrokImage = () => {
    const existing = models.find((model) => {
      const channel = channels.find((item) => item.id === model.channelId);
      return channel?.type === 'kie' && isKieGrokImageModelId(model.modelId);
    });
    if (existing) {
      setSelectedChannelFilter(existing.channelId);
      openEditModelModal(existing);
      return;
    }
    const channel = channels.find((item) => item.type === 'kie');
    if (!channel) {
      toast.error('请先配置 Kie 渠道和 API Key');
      return;
    }
    const model: AIModel = {
      id: `model-kie-grok-image-${Date.now()}`,
      channelId: channel.id,
      alias: 'Grok Imagine',
      modelId: KIE_GROK_IMAGE_FAMILY_ID,
      capabilities: ['image'],
      apiKeyOverride: '',
      visualPromptLanguagePolicy: 'provider_default',
      imageAdapterId: KIE_GROK_IMAGE_ADAPTER_ID,
      videoAdapterId: 'auto',
    };
    addModel(model);
    setSelectedChannelFilter(channel.id);
    openEditModelModal(model);
  };

  useEffect(() => {
    if (comfySetupForm.baseUrl) return;
    const workflow = comfyWorkflows.find((item) => item.kind === COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND);
    const channel = workflow?.channelId ? channels.find((item) => item.id === workflow.channelId) : undefined;
    if (!workflow || !channel) return;
    setComfySetupForm({ name: workflow.name || channel.name, baseUrl: channel.baseUrl });
  }, [channels, comfySetupForm.baseUrl, comfyWorkflows]);

  const checkComfyUIConnection = async () => {
    const baseUrl = comfySetupForm.baseUrl.trim();
    if (!baseUrl) {
      toast.error('请填写 ComfyUI 地址');
      return null;
    }
    setIsCheckingComfyUI(true);
    try {
      const status = await comfyUIClient.checkConnection(baseUrl);
      setComfyConnectionStatus(status);
      if (!status.ready) {
        const missingLabels: Record<keyof ComfyUIConnectionStatus['installed'], string> = {
          diffusionModel: '参考生视频模型',
          textEncoder: '文本编码器',
          videoVae: '视频 VAE',
          audioVae: '音频 VAE',
          referenceNode: 'H3 参考生成节点',
          teSpeedNode: 'H3 推理加速节点',
          sourceWorkflow: 'video_minimax_h3_r2v 工作流',
        };
        const missing = Object.entries(status.installed).filter(([, ready]) => !ready).map(([key]) => missingLabels[key as keyof typeof missingLabels]);
        toast.error(`ComfyUI 还缺少：${missing.join('、')}`);
      } else {
        toast.success('ComfyUI 连接正常');
      }
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法连接 ComfyUI';
      setComfyConnectionStatus(null);
      toast.error(message);
      return null;
    } finally {
      setIsCheckingComfyUI(false);
    }
  };

  const saveLocalComfyH3 = async () => {
    const name = comfySetupForm.name.trim();
    if (!name) {
      toast.error('请填写配置名称');
      return;
    }
    const status = await checkComfyUIConnection();
    if (!status?.ready) return;
    const normalizedBaseUrl = status.baseUrl.replace(/\/+$/, '');
    const configuredWorkflow = comfyWorkflows.find((workflow) => workflow.kind === COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND);
    const configuredChannel = configuredWorkflow?.channelId
      ? channels.find((channel) => channel.id === configuredWorkflow.channelId && channel.type === 'comfyui')
      : undefined;
    const existingChannel = configuredChannel;
    const channelId = existingChannel?.id || `channel-comfyui-h3-${Date.now()}`;
    const channelConfig: AIChannel = existingChannel
      ? { ...existingChannel, name, baseUrl: normalizedBaseUrl, managedBy: 'comfyui_h3_workflow' }
      : { id: channelId, name, type: 'comfyui', baseUrl: normalizedBaseUrl, apiKey: '', managedBy: 'comfyui_h3_workflow' };

    const existingWorkflow = configuredWorkflow
      || comfyWorkflows.find((workflow) => workflow.kind === COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND && workflow.channelId === channelId);
    const workflowId = existingWorkflow?.id || `workflow-comfyui-h3-${Date.now()}`;
    const workflowConfig = {
      name,
      channelId,
      kind: COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND,
      sourceWorkflowName: status.sourceWorkflowName,
      workflowJson: existingWorkflow?.workflowJson || {},
      mappings: existingWorkflow?.mappings || [],
      minimaxH3Reference: existingWorkflow?.minimaxH3Reference || COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS,
    } as const;
    const existingModel = models.find((model) => model.channelId === channelId && model.modelId.toLowerCase() === MINIMAX_H3_MODEL_ID.toLowerCase());
    const modelId = existingModel?.id || `model-comfyui-h3-${Date.now()}`;
    const modelConfig: Partial<AIModel> = {
      channelId,
      alias: name,
      modelId: MINIMAX_H3_MODEL_ID,
      capabilities: ['video'],
      apiKeyOverride: '',
      visualPromptLanguagePolicy: 'en',
      videoAdapterId: 'video.minimax.h3.ref2va.v1',
      minimaxH3Video: { ...MINIMAX_H3_VIDEO_DEFAULT_SETTINGS, defaultMode: 'multimodal_reference', audioMode: 'provider_native' },
      comfyWorkflowId: workflowId,
      managedBy: 'comfyui_h3_workflow',
    };
    const nextWorkflow = { id: workflowId, ...workflowConfig };
    const nextModel = { id: modelId, ...modelConfig } as AIModel;
    await saveConfig({
      channels: existingChannel
        ? channels.map((channel) => channel.id === channelId ? channelConfig : channel)
        : [...channels, channelConfig],
      comfyWorkflows: existingWorkflow
        ? comfyWorkflows.map((workflow) => workflow.id === workflowId ? nextWorkflow : workflow)
        : [...comfyWorkflows, nextWorkflow],
      models: existingModel
        ? models.map((model) => model.id === modelId ? nextModel : model)
        : [...models, nextModel],
      routing: { ...routing, videoGen: modelId },
    });
    setSelectedChannelFilter('all');
    toast.success('本地 MiniMax H3 已保存，并设为默认视频模型');
  };

  const removeLocalComfyH3 = async () => {
    const workflow = comfyWorkflows.find((item) => item.kind === COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND);
    if (!workflow) return;
    const managedModels = models.filter((model) => (
      model.managedBy === 'comfyui_h3_workflow'
      || model.comfyWorkflowId === workflow.id
    ));
    const managedModelIds = new Set(managedModels.map((model) => model.id));
    const channel = workflow.channelId ? channels.find((item) => item.id === workflow.channelId) : undefined;
    const removeChannel = Boolean(channel?.managedBy === 'comfyui_h3_workflow');
    await saveConfig({
      channels: removeChannel ? channels.filter((item) => item.id !== channel?.id) : channels,
      models: models.filter((model) => !managedModelIds.has(model.id)),
      comfyWorkflows: comfyWorkflows.filter((item) => item.id !== workflow.id),
      routing: {
        ...routing,
        videoGen: managedModelIds.has(routing.videoGen) ? '' : routing.videoGen,
      },
    });
    setComfyConnectionStatus(null);
    setComfySetupForm({ name: '本地 MiniMax H3', baseUrl: '' });
    toast.success('本地 MiniMax H3 工作流配置已删除');
  };

  const closeModelModal = () => {
    setIsModelModalOpen(false);
    setEditingModelId(null);
  };

  const channelKeyState = (channel: AIChannel) => {
    if (channel.apiKey?.trim()) return 'database key ready';
    if (channel.type === 'openai' || channel.type === 'gemini' || channel.type === 'deepseek' || channel.type === 'doubao' || channel.type === 'minimax' || channel.type === 'kie') {
      return providerKeyStatus[channel.type] ? 'server key ready' : 'key missing';
    }
    return 'key optional';
  };

  const hasChannelKey = (channel: AIChannel) => channelKeyState(channel) !== 'key missing';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-5xl mx-auto px-6 py-12 md:py-20 min-h-screen"
    >
      <header className="mb-16">
        <h1 className="text-3xl font-light tracking-tight text-gray-900 dark:text-white mb-2">
          Settings <span className="text-gray-400 dark:text-neutral-600 ml-2">/ 系统设置</span>
        </h1>
        <p className="text-xs font-mono text-gray-400 dark:text-neutral-500 uppercase tracking-[0.2em]">
          Global configuration and model routing
        </p>
      </header>

      <div className="flex flex-row items-start" style={{ gap: 48 }}>
        {/* Sidebar Navigation */}
        <nav className="sticky top-24 shrink-0 space-y-12" style={{ width: 176 }}>
          {menuGroups.map((group, idx) => (
            <div key={idx} className="space-y-4">
              <h3 className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest px-1">
                {group.title}
              </h3>
              <div className="flex flex-col gap-1">
                {group.items.map(item => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id as any)}
                      className={`group flex items-center gap-3 py-1.5 px-1 text-sm transition-all ${
                        isActive 
                          ? 'text-violet-600 dark:text-violet-400 font-medium' 
                          : 'text-gray-500 dark:text-neutral-500 hover:text-gray-900 dark:hover:text-neutral-300'
                      }`}
                    >
                      <span className={`w-1 h-1 rounded-full transition-all ${isActive ? 'bg-violet-600 dark:bg-violet-400 scale-100' : 'bg-transparent scale-0'}`} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Content Area */}
        <main className="min-w-0 flex-1 space-y-20 pb-24">
          {activeTab === 'basic' && (
            <div className="space-y-12">
              <div className="pb-8 border-b border-gray-100 dark:border-neutral-800/50">
                <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-8">General Preferences</h2>
                
                <div className="space-y-10">
                  <div className="flex items-center justify-between gap-6 group">
                    <div className="max-w-md">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-neutral-200 mb-1">测试模式</h3>
                      <p className="text-xs text-gray-500 dark:text-neutral-500 leading-relaxed">
                        开启后可复制提示词、回填模型结果进行测试。关闭时使用已配置的 API 模型。此设置对所有页面生效。
                      </p>
                    </div>
                    <button type="button" role="switch" aria-label="测试模式" aria-checked={isTestMode}
                      onClick={() => setIsTestMode(!isTestMode)}
                      className={`relative shrink-0 w-10 h-5 rounded-full transition-colors duration-200 ${isTestMode ? 'bg-violet-600' : 'bg-gray-200 dark:bg-neutral-800'}`}>
                      <span className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-transform duration-200 ${isTestMode ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between group">
                    <div className="max-w-md">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-neutral-200 mb-1">快速模式 (Fast Mode)</h3>
                      <p className="text-xs text-gray-500 dark:text-neutral-500 leading-relaxed">
                        隐藏复杂的集数管理，使用扁平化的大纲板进行创作，适合快速灵感捕捉。
                      </p>
                    </div>
                    <button 
                      onClick={() => setIsFastMode(!isFastMode)}
                      className={`relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none ${isFastMode ? 'bg-violet-600' : 'bg-gray-200 dark:bg-neutral-800'}`}
                    >
                      <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-transform duration-200 ${isFastMode ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between group">
                    <div className="max-w-md">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-neutral-200 mb-1">自动制片模式实验开关</h3>
                      <p className="text-xs text-gray-500 dark:text-neutral-500 leading-relaxed">
                        控制创建项目页是否显示 Auto Production 入口。关闭后不会删除已有 ProductionRun，只是不再从新项目入口启动。
                      </p>
                    </div>
                    <button
                      onClick={() => setIsAutoProductionModeEnabled(!isAutoProductionModeEnabled)}
                      className={`relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none ${isAutoProductionModeEnabled ? 'bg-violet-600' : 'bg-gray-200 dark:bg-neutral-800'}`}
                    >
                      <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-transform duration-200 ${isAutoProductionModeEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between group">
                    <div className="max-w-md">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-neutral-200 mb-1">优先准备故事材料</h3>
                      <p className="text-xs text-gray-500 dark:text-neutral-500 leading-relaxed">
                        开启后优先推荐故事章。不影响手动选择写作任务、分场或正文，质量检查结果仅供参考。
                      </p>
                    </div>
                    <button
                      onClick={() => setIsStoryChapterGateEnabled(!isStoryChapterGateEnabled)}
                      className={`relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none ${isStoryChapterGateEnabled ? 'bg-violet-600' : 'bg-gray-200 dark:bg-neutral-800'}`}
                    >
                      <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white transition-transform duration-200 ${isStoryChapterGateEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between group">
                    <div className="max-w-md">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-neutral-200 mb-1">未使用的素材</h3>
                      <p className="text-xs text-gray-500 dark:text-neutral-500 leading-relaxed">
                        查看未被项目使用的素材。清理后保留在回收区；最近 24 小时的文件不会移动。
                      </p>
                    </div>
                    <button 
                      onClick={async () => {
                        const loadingToast = toast.loading('正在检查素材引用...');
                        try {
                          const preview = await systemClient.previewGarbageCollection();
                          toast.dismiss(loadingToast);
                          const files = preview.files || [];
                          if (!files.length) { toast.success('没有需要清理的素材'); return; }
                          if (!window.confirm(`发现 ${files.length} 个未使用文件，共 ${(files.reduce((sum, file) => sum + file.bytes, 0) / 1024 / 1024).toFixed(1)} MB。\n\n${files.slice(0, 8).map(file => file.relativePath).join('\n')}\n\n移入回收区？文件可以恢复，不会永久删除。`)) return;
                          const data = await systemClient.runGarbageCollection();
                          if (data.success) {
                            toast.success(data.message || '清理成功', { id: loadingToast });
                          } else {
                            toast.error(data.error || '清理失败', { id: loadingToast });
                          }
                        } catch (err: any) {
                          toast.error(`清理错误: ${err.message}`, { id: loadingToast });
                        }
                      }}
                      className="px-4 py-2 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 font-medium text-xs rounded-lg hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                    >
                      查看并清理
                    </button>
                    <button className="rounded-lg border px-4 py-2 text-xs" onClick={async () => {
                      try { const result = await systemClient.restoreRecycledMedia(); toast.success(result.message || '已恢复'); }
                      catch { toast.error('恢复失败，回收区文件仍保留'); }
                    }}>恢复回收区素材</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'routing' && (
            <div className="space-y-12">
              <LocalSpeechSetup />
              <div className="pb-8 border-b border-gray-100 dark:border-neutral-800/50">
                <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-8">Task Routing</h2>
                <div className="mb-8 flex items-center justify-between gap-8 border-b border-gray-100 pb-8 dark:border-neutral-800/50">
                  <div className="max-w-2xl">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">自动视觉画格质检</h3>
                    <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-neutral-400">
                      开启后，Agent 会读取生成画格和正式参考板，自动质检并定向重绘。关闭后仍保留视觉质检能力，但本次流程只生成候选画格，等待创作者看图采用，不会伪造通过分数。
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={visualQcEnabled}
                    aria-label="自动视觉画格质检"
                    onClick={() => setVisualQcEnabled(!visualQcEnabled)}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${visualQcEnabled ? 'bg-violet-600' : 'bg-gray-300 dark:bg-neutral-700'}`}
                  >
                    <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${visualQcEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-8">
                  {Object.entries(routing).map(([task, modelId]) => {
                    const taskNames: Record<string, string> = {
                      scriptGen: '剧本生成 (Script Gen)',
                      storyboardGen: '分镜生成 (Storyboard Gen)',
                      imageGen: '图像生成 (Image Gen)',
                      videoGen: '视频生成 (Video Gen)',
                      audioGen: '音频生成 (Audio Gen)',
                      videoExtraction: '视频拉片分析 (Video Extraction)',
                      qcAnalyzer: '共振质检分析 (QC Analyzer)',
                      visualQc: '视觉画格质检 (Visual QC)',
                    };
                    const displayName = taskNames[task] || task;
                    const requiredCapability = taskCapabilityRequirements[task as keyof typeof taskCapabilityRequirements];
                    const compatibleModels = models.filter((model) => model.capabilities.includes(requiredCapability));
                    const selectedModel = compatibleModels.find((model) => model.id === modelId);
                    const selectedChannel = selectedModel ? channels.find((channel) => channel.id === selectedModel.channelId) : undefined;
                    const imageCapabilities = task === 'imageGen' && selectedModel && selectedChannel
                      ? resolveImageModelCapabilities({ model: selectedModel, channel: selectedChannel })
                      : undefined;
                    
                    return (
                    <div key={task} className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="max-w-md">
                        <h3 className="text-xs font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest">{displayName}</h3>
                        {task === 'imageGen' && (
                          <p className="mt-1 text-[11px] leading-5 text-gray-500 dark:text-neutral-400">
                            同一模型家族会按本次是否携带参考图，自动选择文生图或图生图接口。
                          </p>
                        )}
                      </div>
                      <div className="w-full md:w-96">
                        <select
                          value={modelId}
                          onChange={(e) => updateRouting({ [task]: e.target.value })}
                          disabled={task === 'visualQc' && !visualQcEnabled}
                          className="w-full bg-transparent border-b border-gray-200 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <option value="">-- 选择模型 --</option>
                          {compatibleModels.map((model) => (
                            <option key={model.id} value={model.id}>{imageModelRouteLabel(model, channels.find((channel) => channel.id === model.channelId))}</option>
                          ))}
                        </select>
                        {imageCapabilities && (
                          <p className="mt-2 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            当前支持：{imageModelCapabilitySummary(imageCapabilities)}
                          </p>
                        )}
                      </div>
                    </div>
                  )})}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'bgm' && (
            <div className="space-y-12">
              <div className="pb-8 border-b border-gray-100 dark:border-neutral-800/50">
                <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-8">BGM API Configuration</h2>
                <div className="space-y-10">
                  <div className="flex flex-col gap-4">
                    <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">Provider</label>
                    <select
                      value={bgmSettings.provider}
                      onChange={(e) => updateBgmSettings({ provider: e.target.value as 'gemini' | 'custom' })}
                      className="w-full md:w-1/2 bg-transparent border-b border-gray-200 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                    >
                      <option value="gemini">Google Gemini (Lyria)</option>
                      <option value="custom">自定义 API (Custom)</option>
                    </select>
                  </div>

                  {bgmSettings.provider === 'custom' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                      <div className="col-span-full space-y-2">
                        <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">API Endpoint</label>
                        <input
                          type="text"
                          value={bgmSettings.customApiUrl || ''}
                          onChange={(e) => updateBgmSettings({ customApiUrl: e.target.value })}
                          placeholder="https://api.example.com/v1/audio/generate"
                          className="w-full bg-transparent border-b border-gray-200 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">Key Source</label>
                        <select
                          value={customBgmKeySource}
                          onChange={(e) => {
                            const nextSource = e.target.value as 'serverEnv' | 'local';
                            updateBgmSettings(nextSource === 'serverEnv'
                              ? { customKeySource: nextSource, customApiKey: '' }
                              : { customKeySource: nextSource });
                          }}
                          className="w-full bg-transparent border-b border-gray-200 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                        >
                          <option value="serverEnv">Server Env</option>
                          <option value="local">Local Key</option>
                        </select>
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                          <span className={customBgmStatus?.ready ? 'text-emerald-500' : 'text-amber-500'}>
                            {customBgmStatus?.ready ? 'server env ready' : 'server env missing'}
                          </span>
                          <span className={customBgmStatus?.allowedOriginsConfigured ? 'text-emerald-500' : 'text-amber-500'}>
                            {customBgmStatus?.allowedOriginsConfigured ? `allowlist ${customBgmStatus.allowedOriginCount || 0}` : 'allowlist missing'}
                          </span>
                          <span className="text-gray-400">
                            models {customBgmStatus?.allowedModelCount || 0}
                          </span>
                          <button
                            type="button"
                            onClick={refreshProviderKeyStatus}
                            className="inline-flex items-center gap-1 text-gray-400 hover:text-violet-500 transition-colors"
                            title="Refresh server env status"
                          >
                            <RefreshCw className="w-3 h-3" />
                            refresh
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">Server Env Slot</label>
                        <input
                          type="text"
                          value={customBgmEnvName}
                          onChange={(e) => updateBgmSettings({ customApiKeyEnvName: e.target.value })}
                          placeholder="OMNI_CUSTOM_BGM_API_KEY"
                          className="w-full bg-transparent border-b border-gray-200 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                        />
                        {customBgmStatus?.error && (
                          <p className="text-[11px] text-amber-500 leading-relaxed">{customBgmStatus.error}</p>
                        )}
                        {!customBgmStatus?.allowedOriginsConfigured && (
                          <p className="text-[11px] text-amber-500 leading-relaxed">Configure OMNI_CUSTOM_BGM_ALLOWED_ORIGINS on the server before using non-local custom BGM URLs.</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">API Key</label>
                        <input
                          type="password"
                          value={bgmSettings.customApiKey || ''}
                          onChange={(e) => updateBgmSettings({ customApiKey: e.target.value })}
                          placeholder="sk-..."
                          disabled={customBgmKeySource === 'serverEnv'}
                          className="w-full bg-transparent border-b border-gray-200 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                        />
                        {customBgmKeySource === 'serverEnv' && (
                          <p className="text-[11px] text-gray-400 dark:text-neutral-500 leading-relaxed">Local key is disabled while Server Env is selected.</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">Model ID</label>
                        <input
                          type="text"
                          value={bgmSettings.customModelId || ''}
                          onChange={(e) => updateBgmSettings({ customModelId: e.target.value })}
                          placeholder="suno-v3.5"
                          className="w-full bg-transparent border-b border-gray-200 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'channels' && (
            <div className="space-y-12">
              <div className="pb-8 border-b border-gray-100 dark:border-neutral-800/50">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-lg font-medium text-gray-900 dark:text-white">渠道管理</h2>
                  <div className="flex items-center gap-4">
                    {loadError && (
                      <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">
                        {loadError}
                      </span>
                    )}
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${isSaving ? 'text-amber-500' : 'text-emerald-500'}`}>
                      {isSaving ? 'Saving' : 'SQLite Saved'}
                    </span>
                    <button
                      onClick={refreshProviderKeyStatus}
                      className="p-2 text-gray-300 hover:text-violet-600 transition-colors"
                      title="Refresh key status"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        const preset = channelPresetForType('openai');
                        setNewChannelForm({ name: '', type: 'openai', baseUrl: preset?.baseUrl || '', apiKey: '' });
                        setIsChannelModalOpen(true);
                      }}
                      className="text-xs font-bold text-violet-600 dark:text-violet-400 hover:underline uppercase tracking-widest"
                    >
                      + Add Channel
                    </button>
                  </div>
                </div>
                
                <div className="space-y-1">
                  {visibleChannels.map(channel => (
                    <div
                      key={channel.id}
                      className="group grid items-end py-6 border-b border-gray-50 dark:border-neutral-900/50 last:border-0"
                      style={{ gridTemplateColumns: '200px minmax(220px, 1fr) 160px 32px', gap: 20 }}
                    >
                      <div className="min-w-0">
                        <input
                          type="text"
                          value={channel.name}
                          onChange={(e) => updateChannel(channel.id, { name: e.target.value })}
                          className="bg-transparent text-sm font-bold text-gray-900 dark:text-white focus:outline-none border-b border-transparent focus:border-violet-500 w-full mb-1"
                        />
                        <div className="flex items-center gap-3 text-[10px] text-gray-400 dark:text-neutral-600 uppercase tracking-widest">
                          <span>{channel.type}</span>
                          <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-neutral-800" />
                          <span className={hasChannelKey(channel) ? 'text-emerald-500' : 'text-amber-500'}>
                            {channelKeyState(channel)}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {(channelPresets.find((preset) => preset.type === channel.type)?.capabilityHints || []).map((capability) => (
                            <span key={capability} className="rounded bg-gray-50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-tighter text-gray-400 dark:bg-neutral-900 dark:text-neutral-600">
                              {capability}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <label className="block text-[9px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">Request URL</label>
                        <input
                          type="text"
                          value={channel.baseUrl}
                          onChange={(e) => updateChannel(channel.id, { baseUrl: e.target.value })}
                          placeholder={channelPresetForType(channel.type)?.baseUrl || 'https://api.example.com/v1'}
                          className="w-full bg-transparent border-b border-gray-100 dark:border-neutral-800 text-xs py-1 focus:outline-none focus:border-violet-500 transition-colors"
                        />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <label className="block text-[9px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">API Key</label>
                        {channel.type === 'comfyui' ? (
                          <p className="border-b border-gray-100 py-1 text-xs text-gray-400 dark:border-neutral-800 dark:text-neutral-500">本地连接无需密钥</p>
                        ) : (
                          <input
                            type="password"
                            value={channel.apiKey}
                            onChange={(e) => updateChannel(channel.id, { apiKey: e.target.value })}
                            placeholder="API Key"
                            className="w-full bg-transparent border-b border-gray-100 dark:border-neutral-800 text-xs py-1 focus:outline-none focus:border-violet-500 transition-colors"
                          />
                        )}
                      </div>
                      <button onClick={() => deleteChannel(channel.id)} className="p-2 text-gray-300 hover:text-red-500 transition-colors" title="删除渠道及其模型">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'models' && (
            <div className="space-y-12">
              <div className="pb-8 border-b border-gray-100 dark:border-neutral-800/50">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                  <h2 className="text-lg font-medium text-gray-900 dark:text-white">模型管理</h2>
                  <div className="flex flex-wrap items-center gap-6">
                    <select
                      value={selectedChannelFilter}
                      onChange={(e) => setSelectedChannelFilter(e.target.value)}
                      className="bg-transparent text-[10px] font-bold text-gray-400 dark:text-neutral-500 uppercase tracking-widest border-b border-gray-100 dark:border-neutral-800 pb-1 focus:outline-none"
                    >
                      <option value="all">All Channels</option>
                      {visibleChannels.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={addKieGrokImage}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:underline dark:text-sky-400"
                    >
                      {models.some((model) => isKieGrokImageModelId(model.modelId)) ? <Settings2 className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      {models.some((model) => isKieGrokImageModelId(model.modelId)) ? '配置 Grok Imagine' : '添加 Grok Imagine'}
                    </button>
                    <button
                      type="button"
                      onClick={addKieGptImage2}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:underline dark:text-sky-400"
                    >
                      {models.some((model) => isKieGptImage2ModelId(model.modelId)) ? <Settings2 className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      {models.some((model) => isKieGptImage2ModelId(model.modelId)) ? '配置 GPT Image 2' : '添加 GPT Image 2'}
                    </button>
                    <button
                      onClick={openNewModelModal}
                      className="text-xs font-bold text-violet-600 dark:text-violet-400 hover:underline uppercase tracking-widest"
                    >
                      + Add Model
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  {filteredModels.length === 0 && (
                    <div className="border-y border-gray-100 py-12 text-center dark:border-neutral-800">
                      <p className="text-sm text-gray-500 dark:text-neutral-400">还没有模型</p>
                      <p className="mt-2 text-xs text-gray-400 dark:text-neutral-600">先配置渠道，再手动新增模型并绑定任务路由。</p>
                    </div>
                  )}
                  {filteredModels.map(model => {
                    const modelChannel = channels.find((channel) => channel.id === model.channelId);
                    const isKieGrokImage = modelChannel?.type === 'kie' && isKieGrokImageModelId(model.modelId);
                    const isKieGptImage2 = modelChannel?.type === 'kie' && isKieGptImage2ModelId(model.modelId);
                    const isKieGrokVideo = modelChannel?.type === 'kie' && isKieGrokVideoModelId(model.modelId);
                    const imageCapabilities = modelChannel && model.capabilities.includes('image')
                      ? resolveImageModelCapabilities({ model, channel: modelChannel })
                      : undefined;
                    const kieVideoSettings = {
                      ...KIE_GROK_VIDEO_DEFAULT_SETTINGS,
                      ...(model.kieGrokVideo || {}),
                    };
                    return (
                    <div key={model.id} className="group flex flex-col md:flex-row md:items-center gap-6 py-6 border-b border-gray-50 dark:border-neutral-900/50 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="mb-1 text-sm font-bold text-gray-900 dark:text-white">{model.alias}</p>
                        <div className="flex items-center gap-3 text-[10px] text-gray-400 dark:text-neutral-600 uppercase tracking-widest">
                          <span>{imageCapabilities?.familyLabel || model.modelId}</span>
                          <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-neutral-800" />
                          <span>{modelChannel?.name}</span>
                        </div>
                        {model.capabilities.includes('video') && (
                          <p className="mt-2 text-[10px] leading-4 text-gray-400 dark:text-neutral-500">
                            视频生成方式：{VIDEO_MODEL_ADAPTER_OPTIONS.find((option) => option.id === (model.videoAdapterId || 'auto'))?.label || model.videoAdapterId}
                          </p>
                        )}
                        {model.capabilities.includes('text') && model.reasoningEffort && model.reasoningEffort !== 'provider_default' && (
                          <p className="mt-2 text-[10px] leading-4 text-gray-400 dark:text-neutral-500">
                            思考强度：{model.reasoningEffort}
                          </p>
                        )}
                        {isKieGrokVideo && (
                          <p className="mt-2 text-[10px] leading-4 text-gray-400 dark:text-neutral-500">
                            Kie 图生视频 · {kieVideoSettings.resolution} · 时长由当前分镜/复合故事板动态传入（{KIE_GROK_VIDEO_MIN_DURATION_SECONDS}-{KIE_GROK_VIDEO_MAX_DURATION_SECONDS}s）· 画幅继承项目 · 单首帧
                          </p>
                        )}
                        {isKieGrokImage && imageCapabilities && (
                          <p className="mt-2 text-[10px] leading-4 text-gray-400 dark:text-neutral-500">
                            Kie Grok Imagine · {imageModelCapabilitySummary(imageCapabilities)} · 根据参考图自动选择生成方式
                          </p>
                        )}
                        {isKieGptImage2 && imageCapabilities && (
                          <p className="mt-2 text-[10px] leading-4 text-gray-400 dark:text-neutral-500">
                            Kie GPT Image 2 · {model.kieGptImage2?.resolution || KIE_GPT_IMAGE_2_DEFAULT_SETTINGS.resolution} · {imageModelCapabilitySummary(imageCapabilities)} · 根据参考图自动选择生成方式
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="flex gap-1">
                          {model.capabilities.map(cap => (
                            <span key={cap} className="px-1.5 py-0.5 bg-gray-50 dark:bg-neutral-900 text-[8px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-tighter rounded">
                              {cap}
                            </span>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => openEditModelModal(model)}
                          className="p-2 text-gray-400 transition-colors hover:text-violet-600 dark:text-neutral-500 dark:hover:text-violet-400"
                          title="编辑模型"
                          aria-label={`编辑 ${model.alias}`}
                        >
                          <Settings2 className="h-4 w-4" />
                        </button>
                        <button onClick={() => deleteModel(model.id)} className="p-2 text-gray-300 hover:text-red-500 transition-colors" title="删除模型">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )})}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'comfyui' && (
            <div className="space-y-10 pb-8">
              <div>
                <h2 className="text-lg font-medium text-gray-900 dark:text-white">本地视频工作流</h2>
                <p className="mt-2 max-w-2xl text-xs leading-5 text-gray-500 dark:text-neutral-400">
                  连接局域网里的 ComfyUI。保存后会创建一个可在“视频生成”路由中选择的本地 MiniMax H3 模型。
                </p>
              </div>

              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-neutral-600">配置名称</span>
                  <input
                    type="text"
                    value={comfySetupForm.name}
                    onChange={(event) => setComfySetupForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="例如：剪辑室 H3"
                    className="w-full border-b border-gray-200 bg-transparent py-2 text-sm transition-colors focus:border-violet-500 focus:outline-none dark:border-neutral-800"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-neutral-600">ComfyUI 地址</span>
                  <input
                    type="url"
                    value={comfySetupForm.baseUrl}
                    onChange={(event) => {
                      setComfySetupForm((current) => ({ ...current, baseUrl: event.target.value }));
                      setComfyConnectionStatus(null);
                    }}
                    placeholder="http://192.168.1.20:8188"
                    className="w-full border-b border-gray-200 bg-transparent py-2 text-sm transition-colors focus:border-violet-500 focus:outline-none dark:border-neutral-800"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-4 border-y border-gray-100 py-6 dark:border-neutral-800/60 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">MiniMax H3 图片参考生成</p>
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-neutral-400">
                    工作流：{comfyConnectionStatus?.sourceWorkflowName || 'video_minimax_h3_r2v.json'} · 内部生成目标由系统维护，不会重复出现在普通渠道和模型列表中。
                  </p>
                  {comfyConnectionStatus && (
                    <p className={`mt-2 text-xs ${comfyConnectionStatus.ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {comfyConnectionStatus.ready
                        ? `连接正常 · ComfyUI ${comfyConnectionStatus.version} · ${comfyConnectionStatus.deviceName}`
                        : '已连接，但模型、节点或工作流不完整'}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void checkComfyUIConnection()}
                    disabled={isCheckingComfyUI}
                    className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:text-violet-600 disabled:opacity-50 dark:text-neutral-300 dark:hover:text-violet-400"
                  >
                    <RefreshCw className={`h-4 w-4 ${isCheckingComfyUI ? 'animate-spin' : ''}`} />
                    检查连接
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveLocalComfyH3()}
                    disabled={isCheckingComfyUI}
                    className="inline-flex items-center gap-2 bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    保存并用于视频生成
                  </button>
                  {comfyWorkflows.some((workflow) => workflow.kind === COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND) && (
                    <button
                      type="button"
                      onClick={() => void removeLocalComfyH3()}
                      disabled={isSaving}
                      className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-500 transition-colors hover:text-red-500 disabled:opacity-50 dark:text-neutral-400"
                    >
                      <Trash2 className="h-4 w-4" />
                      删除本地配置
                    </button>
                  )}
                </div>
              </div>

              <details className="border-b border-gray-100 pb-6 dark:border-neutral-800/60">
                <summary className="cursor-pointer text-sm font-medium text-gray-600 dark:text-neutral-300">通用图片工作流兼容设置</summary>
                <div className="mt-6 space-y-10">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs leading-5 text-gray-500 dark:text-neutral-400">保留旧的 API JSON 和参数映射方式，不影响上面的本地 H3 视频配置。</p>
                    <button
                      type="button"
                      onClick={() => addComfyWorkflow({ id: `workflow-${Date.now()}`, name: '通用图片工作流', workflowJson: {}, mappings: [], kind: 'generic_image' })}
                      className="shrink-0 text-xs font-semibold text-violet-600 hover:underline dark:text-violet-400"
                    >
                      新建图片工作流
                    </button>
                  </div>
                  {comfyWorkflows.filter((workflow) => workflow.kind !== COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND).map((workflow) => (
                    <div key={workflow.id} className="space-y-6 border-t border-gray-100 pt-6 dark:border-neutral-800/60">
                      <div className="flex items-center justify-between gap-4">
                        <input
                          type="text"
                          value={workflow.name}
                          onChange={(event) => updateComfyWorkflow(workflow.id, { name: event.target.value })}
                          className="min-w-0 flex-1 border-b border-transparent bg-transparent text-sm font-semibold text-gray-900 focus:border-violet-500 focus:outline-none dark:text-white"
                        />
                        <button type="button" onClick={() => deleteComfyWorkflow(workflow.id)} className="p-2 text-gray-300 transition-colors hover:text-red-500" title="删除工作流">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-neutral-600">API JSON</span>
                          <textarea
                            value={JSON.stringify(workflow.workflowJson, null, 2)}
                            onChange={(event) => {
                              try {
                                updateComfyWorkflow(workflow.id, { workflowJson: JSON.parse(event.target.value) });
                              } catch {
                                // Keep the last valid JSON while the author is typing.
                              }
                            }}
                            className="h-48 w-full resize-none border border-gray-100 bg-gray-50 p-3 font-mono text-xs focus:border-violet-500 focus:outline-none dark:border-neutral-900 dark:bg-neutral-950"
                          />
                        </label>
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-neutral-600">参数对应</span>
                            <button type="button" onClick={() => updateComfyWorkflow(workflow.id, { mappings: [...workflow.mappings, { systemParam: 'prompt', nodeId: '', nodeInput: 'text' }] })} className="text-xs text-violet-600 hover:underline">添加</button>
                          </div>
                          {workflow.mappings.map((mapping, index) => (
                            <div key={`${workflow.id}-${index}`} className="flex items-center gap-2">
                              <select
                                value={mapping.systemParam}
                                onChange={(event) => {
                                  const mappings = workflow.mappings.map((item, itemIndex) => itemIndex === index ? { ...item, systemParam: event.target.value } : item);
                                  updateComfyWorkflow(workflow.id, { mappings });
                                }}
                                className="border-b border-gray-100 bg-transparent py-1 text-xs focus:outline-none dark:border-neutral-800"
                              >
                                <option value="prompt">提示词</option>
                                <option value="negative_prompt">反向提示词</option>
                                <option value="image">图片</option>
                                <option value="width">画布宽度</option>
                                <option value="height">画布高度</option>
                                <option value="seed">随机种子</option>
                              </select>
                              <span className="text-gray-300">→</span>
                              <input
                                type="text"
                                value={mapping.nodeId}
                                onChange={(event) => {
                                  const mappings = workflow.mappings.map((item, itemIndex) => itemIndex === index ? { ...item, nodeId: event.target.value } : item);
                                  updateComfyWorkflow(workflow.id, { mappings });
                                }}
                                placeholder="节点"
                                className="w-16 border-b border-gray-100 bg-transparent py-1 text-xs focus:outline-none dark:border-neutral-800"
                              />
                              <input
                                type="text"
                                value={mapping.nodeInput}
                                onChange={(event) => {
                                  const mappings = workflow.mappings.map((item, itemIndex) => itemIndex === index ? { ...item, nodeInput: event.target.value } : item);
                                  updateComfyWorkflow(workflow.id, { mappings });
                                }}
                                placeholder="输入"
                                className="min-w-0 flex-1 border-b border-gray-100 bg-transparent py-1 text-xs focus:outline-none dark:border-neutral-800"
                              />
                              <button type="button" onClick={() => updateComfyWorkflow(workflow.id, { mappings: workflow.mappings.filter((_, itemIndex) => itemIndex !== index) })} className="p-1 text-gray-300 hover:text-red-500" title="删除参数对应">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

        {activeTab === 'skills' && (
          <SkillForge />
        )}
      </main>
    </div>

  {/* Add Channel Modal */}
      {isChannelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-neutral-950/80 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-neutral-900 border border-gray-100 dark:border-neutral-800 rounded-3xl p-10 w-full max-w-md shadow-2xl"
          >
            <div className="flex items-center justify-between mb-10">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">Add API Channel</h3>
              <button onClick={() => setIsChannelModalOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-8">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">Name</label>
                <input
                  type="text"
                  value={newChannelForm.name}
                  onChange={(e) => setNewChannelForm({ ...newChannelForm, name: e.target.value })}
                  placeholder="e.g. OpenAI Primary"
                  className="w-full bg-transparent border-b border-gray-100 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">Protocol</label>
                <select
                  value={newChannelForm.type}
                  onChange={(e) => {
                    const newType = e.target.value as ChannelType;
                    const preset = channelPresetForType(newType);
                    const updates: Partial<AIChannel> = { type: newType, baseUrl: preset?.baseUrl || '' };
                    setNewChannelForm({ ...newChannelForm, ...updates });
                  }}
                  className="w-full bg-transparent border-b border-gray-100 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                >
                  <option value="openai">OpenAI Compatible</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="minimax">MiniMax</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="doubao">Doubao</option>
                  <option value="kie">Kie AI</option>
                  <option value="llamacpp">llama.cpp (Local)</option>
                  <option value="comfyui">ComfyUI</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">Request URL</label>
                <input
                  type="text"
                  value={newChannelForm.baseUrl}
                  onChange={(e) => setNewChannelForm({ ...newChannelForm, baseUrl: e.target.value })}
                  className="w-full bg-transparent border-b border-gray-100 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
              {newChannelForm.type !== 'comfyui' && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">API Key</label>
                  <input
                    type="password"
                    value={newChannelForm.apiKey}
                    onChange={(e) => setNewChannelForm({ ...newChannelForm, apiKey: e.target.value })}
                    placeholder="sk-..."
                    className="w-full bg-transparent border-b border-gray-100 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                  />
                </div>
              )}
              <div className="pt-6 flex justify-end gap-6">
                <button
                  onClick={() => setIsChannelModalOpen(false)}
                  className="text-xs font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!newChannelForm.name) { toast.error('请输入渠道名称'); return; }
                    addChannel({
                      id: `channel-${Date.now()}`,
                      name: newChannelForm.name || 'New Channel',
                      type: newChannelForm.type as any || 'openai',
                      baseUrl: newChannelForm.baseUrl || '',
                      apiKey: newChannelForm.apiKey || ''
                    });
                    setIsChannelModalOpen(false);
                    setNewChannelForm({ name: '', type: 'openai', baseUrl: channelPresetForType('openai')?.baseUrl || '', apiKey: '' });
                    toast.success('渠道已添加');
                  }}
                  className="text-xs font-bold text-violet-600 hover:text-violet-700 uppercase tracking-widest"
                >
                  Confirm
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Unified Add / Edit Model Modal */}
      {isModelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-neutral-950/80 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-gray-100 bg-white p-8 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex items-center justify-between mb-10">
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">{editingModelId ? '编辑模型' : '新增模型'}</h3>
                <p className="mt-1 text-xs text-gray-400 dark:text-neutral-500">渠道负责地址和密钥；模型负责 Model ID、能力与模型参数。</p>
              </div>
              <button onClick={closeModelModal} className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-8">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">Alias</label>
                <input
                  type="text"
                  value={modelForm.alias || ''}
                  onChange={(e) => setModelForm({ ...modelForm, alias: e.target.value })}
                  placeholder="e.g. GPT-4o"
                  className="w-full bg-transparent border-b border-gray-100 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">Channel</label>
                <select
                  value={modelForm.channelId || ''}
                  onChange={(e) => setModelForm({ ...modelForm, channelId: e.target.value })}
                  className="w-full bg-transparent border-b border-gray-100 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                >
                  <option value="" disabled>Select Channel</option>
                  {visibleChannels.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              {(modelFormKieGrokImage || modelFormKieGptImage2) ? (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">图片模型家族</label>
                  <div className="border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
                    {modelFormKieGptImage2 ? 'GPT Image 2' : 'Grok Imagine'}
                  </div>
                  <p className="text-[11px] leading-5 text-gray-400">具体文生图或图生图接口由系统根据本次参考图数量自动选择，无需配置两个 Model ID。</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">Model ID</label>
                  <input
                    type="text"
                    value={modelForm.modelId || ''}
                    onChange={(e) => setModelForm({ ...modelForm, modelId: e.target.value })}
                    placeholder={modelFormChannel?.type === 'kie' ? KIE_GPT_IMAGE_2_FAMILY_ID : 'e.g. gpt-4o'}
                    className="w-full bg-transparent border-b border-gray-100 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                  />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">Model API Key Override (Optional)</label>
                <input
                  type="password"
                  value={modelForm.apiKeyOverride || ''}
                  onChange={(e) => setModelForm({ ...modelForm, apiKeyOverride: e.target.value })}
                  placeholder="默认继承渠道 API Key"
                  className="w-full bg-transparent border-b border-gray-100 dark:border-neutral-800 text-sm py-2 focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
              {modelFormSupportsReasoning && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">思考强度</label>
                  <select
                    value={modelForm.reasoningEffort || 'provider_default'}
                    onChange={(event) => setModelForm({
                      ...modelForm,
                      reasoningEffort: event.target.value as NonNullable<AIModel['reasoningEffort']>,
                    })}
                    className="w-full border-b border-gray-100 bg-transparent py-2 text-sm focus:border-violet-500 focus:outline-none dark:border-neutral-800"
                  >
                    {REASONING_EFFORT_OPTIONS.map((effort) => (
                      <option key={effort} value={effort}>
                        {effort === 'provider_default' ? '跟随服务默认' : effort === 'low' ? '低' : effort === 'medium' ? '中' : '高'}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] leading-5 text-gray-400">仅在该模型明确支持时启用；请求将使用 chat_template_kwargs.reasoning_effort。</p>
                </div>
              )}
              {modelForm.capabilities?.includes('text') && (
                <div className="space-y-2">
                  <label htmlFor="text-output-mode" className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">结构化返回</label>
                  <select id="text-output-mode" value={modelForm.textOutputMode || 'auto'}
                    onChange={event => setModelForm({ ...modelForm, textOutputMode: event.target.value as AIModel['textOutputMode'] })}
                    className="w-full border-b border-gray-100 bg-transparent py-2 text-sm focus:border-violet-500 focus:outline-none dark:border-neutral-800">
                    <option value="auto">按接入地址选择</option>
                    <option value="prompt-json">兼容模式（提示词约定）</option>
                    <option value="json-object" disabled={modelFormChannel?.type === 'minimax'}>JSON 模式</option>
                    <option value="json-schema" disabled={modelFormChannel?.type === 'minimax' || modelFormChannel?.type === 'gemini'}>严格结构模式</option>
                  </select>
                  <p className="text-[11px] leading-5 text-gray-400">代理渠道默认使用兼容模式。只有服务商确认支持时才启用 JSON 或严格结构模式；每种模式都会校验返回内容。</p>
                </div>
              )}
              <div className="space-y-4">
                <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">Capabilities</label>
                {(modelFormKieGrokImage || modelFormKieGptImage2) ? (
                  <p className="text-xs font-semibold text-gray-600 dark:text-neutral-300">图片生成</p>
                ) : (
                  <div className="flex flex-wrap gap-6">
                    {(['text', 'vision', 'image', 'video', 'audio'] as const).map(cap => (
                      <label key={cap} className="flex items-center gap-2 text-xs text-gray-500 dark:text-neutral-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={modelForm.capabilities?.includes(cap) || false}
                          onChange={(e) => {
                            const caps = modelForm.capabilities || [];
                            if (e.target.checked) setModelForm({ ...modelForm, capabilities: [...caps, cap] });
                            else setModelForm({ ...modelForm, capabilities: caps.filter(c => c !== cap) });
                          }}
                          className="rounded border-gray-200 dark:border-neutral-800 text-violet-600 focus:ring-violet-500"
                        />
                        <span className="capitalize">{cap}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {(modelForm.capabilities?.includes('image') || modelForm.capabilities?.includes('video')) && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">视觉提示词语言</label>
                  <select
                    value={modelForm.visualPromptLanguagePolicy || 'provider_default'}
                    onChange={(event) => setModelForm({
                      ...modelForm,
                      visualPromptLanguagePolicy: event.target.value as NonNullable<AIModel['visualPromptLanguagePolicy']>,
                    })}
                    className="w-full border-b border-gray-100 bg-transparent py-2 text-sm focus:border-violet-500 focus:outline-none dark:border-neutral-800"
                  >
                    <option value="provider_default">跟随模型能力（推荐）</option>
                    <option value="zh">简体中文</option>
                    <option value="en">English</option>
                    <option value="bilingual">中英双语</option>
                  </select>
                  <p className="text-[11px] leading-5 text-gray-400">只影响发送给图片或视频模型的视觉提示词，不改变作者界面语言。</p>
                </div>
              )}

              {modelForm.capabilities?.includes('video') && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-neutral-600 uppercase tracking-widest">视频生成方式</label>
                  <select
                    value={modelForm.videoAdapterId || 'auto'}
                    onChange={(event) => setModelForm({ ...modelForm, videoAdapterId: event.target.value })}
                    className="w-full border-b border-gray-100 bg-transparent py-2 text-sm focus:border-violet-500 focus:outline-none dark:border-neutral-800"
                  >
                    {ORDINARY_VIDEO_MODEL_ADAPTER_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                  <p className="text-[11px] leading-5 text-gray-400">默认使用自动识别；这里只决定模型如何整理当前视频资料，不会修改剧本、资产板或故事板。</p>
                </div>
              )}

              {modelFormKieGrokVideo && (
                <div className="space-y-3 border-t border-gray-100 pt-6 dark:border-neutral-800">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-neutral-500">视频清晰度</label>
                    <select value={modelFormKieVideoSettings.resolution} onChange={(event) => setModelForm({ ...modelForm, kieGrokVideo: { resolution: event.target.value as typeof modelFormKieVideoSettings.resolution } })} className="w-full max-w-xs border-b border-gray-200 bg-transparent py-2 text-sm focus:border-violet-500 focus:outline-none dark:border-neutral-700">
                      {KIE_GROK_VIDEO_RESOLUTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}{resolution === '480p' ? '（较快）' : '（更清晰）'}</option>)}
                    </select>
                  </div>
                  <p className="text-[11px] leading-5 text-gray-400 dark:text-neutral-500">请求字段由 Model ID 对应的 Kie 合同决定；时长和画幅由当前分镜/故事板动态传入。任务只提交一次，系统有限轮询结果，不需要填写回调地址，也不会无限重试。</p>
                </div>
              )}
              {modelFormKieGrokImage && (
                <p className="border-t border-gray-100 pt-6 text-[11px] leading-5 text-gray-400 dark:border-neutral-800 dark:text-neutral-500">
                  文生图支持 2:3、3:2、1:1、9:16、16:9；图生图只接受一张参考图。系统会根据是否传入参考图自动切换接口。
                </p>
              )}
              {modelFormKieGptImage2 && (
                <div className="space-y-3 border-t border-gray-100 pt-6 dark:border-neutral-800">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-neutral-500">图片清晰度</label>
                    <select
                      value={modelFormKieGptImage2Settings.resolution}
                      onChange={(event) => setModelForm({
                        ...modelForm,
                        kieGptImage2: { resolution: event.target.value as typeof modelFormKieGptImage2Settings.resolution },
                      })}
                      className="w-full max-w-xs border-b border-gray-200 bg-transparent py-2 text-sm focus:border-violet-500 focus:outline-none dark:border-neutral-700"
                    >
                      {KIE_GPT_IMAGE_2_RESOLUTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
                    </select>
                  </div>
                  <p className="text-[11px] leading-5 text-gray-400 dark:text-neutral-500">无参考图时使用文生图；传入 1-16 张参考图时自动使用图生图。画幅由当前项目传入。</p>
                </div>
              )}
              <div className="pt-6 flex justify-end gap-6">
                <button
                  onClick={closeModelModal}
                  className="text-xs font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!modelForm.alias?.trim() || !modelForm.channelId || !normalizedModelFormId) { toast.error('请填写完整信息'); return; }
                    if (!modelForm.capabilities?.length) { toast.error('至少选择一项模型能力'); return; }
                    if (normalizedModelFormId.toLowerCase() === MINIMAX_H3_MODEL_ID.toLowerCase()) {
                      toast.error('MiniMax H3 只通过“本地 ComfyUI”工作流配置，不在普通渠道或模型中添加。');
                      return;
                    }
                    const changes: Partial<AIModel> = {
                      channelId: modelForm.channelId,
                      alias: modelForm.alias.trim(),
                      modelId: normalizedModelFormId,
                      capabilities: (modelFormKieGptImage2 || modelFormKieGrokImage) ? ['image'] : modelForm.capabilities,
                      apiKeyOverride: modelForm.apiKeyOverride?.trim() || '',
                      textOutputMode: modelForm.textOutputMode || 'auto',
                      reasoningEffort: modelFormSupportsReasoning
                        ? modelForm.reasoningEffort || 'provider_default'
                        : 'provider_default',
                      visualPromptLanguagePolicy: modelForm.visualPromptLanguagePolicy || 'provider_default',
                      imageAdapterId: modelFormKieGptImage2
                        ? KIE_GPT_IMAGE_2_ADAPTER_ID
                        : modelFormKieGrokImage
                          ? KIE_GROK_IMAGE_ADAPTER_ID
                          : modelForm.imageAdapterId,
                      videoAdapterId: modelForm.videoAdapterId || 'auto',
                      kieGrokVideo: modelFormKieGrokVideo ? modelFormKieVideoSettings : undefined,
                      kieGptImage2: modelFormKieGptImage2 ? modelFormKieGptImage2Settings : undefined,
                    };
                    if (editingModelId) updateModel(editingModelId, changes);
                    else addModel({ id: `model-${Date.now()}`, ...(changes as Omit<AIModel, 'id'>) });
                    closeModelModal();
                    toast.success(editingModelId ? '模型已更新' : '模型已添加');
                  }}
                  className="text-xs font-bold text-violet-600 hover:text-violet-700 uppercase tracking-widest"
                >
                  {editingModelId ? '保存修改' : '新增模型'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
