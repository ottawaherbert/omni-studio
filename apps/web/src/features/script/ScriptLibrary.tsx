import { skillApplicabilityHint } from "../../../../../packages/domain/src/skillMetadata";
import { useScriptExecutionChannel } from './useScriptExecutionChannel';
import { SCRIPT_STAGES, stageLabels, stageDescriptions, type ScriptStage } from '../../../../../packages/script/src/agentStages';
import { ScriptHomeBlueprint } from './ScriptHomeBlueprint';
import { discussionTurnsSinceMilestone } from '../../../../../packages/script/src/ideation';
import { ScriptHomeExternalRequest, ScriptHomeGoal } from './ScriptHomeGoal';
import { scriptHomeFollowupIntent, scriptHomeOptionIntent } from './scriptHomeOptionIntent';
import { useScriptConversation } from './useScriptConversation';
import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, ArrowRight, Send, Search, Clock, BookOpen, Trash2, ChevronDown, Play, Cpu, MessageSquare, RefreshCw, CheckSquare, Square, ShieldAlert, Edit3, Wand2 } from 'lucide-react';
import type { ProjectProfile, MethodBinding } from '../../../../../packages/script/src/schema';
import type { ScriptProjectSummary } from '../../../../../packages/domain/src/scriptDelivery';
import type { SkillDTO } from '../../../../../packages/domain/src/skill';
import { methodFromSkill } from '../../../../../packages/script/src/methods';
import type { InitialBriefPayload } from '../../../../../packages/script/src/creation';
import { SCRIPT_CREATION_PRESETS, createScriptCreationProfile, type ScriptCreationFormat } from '../../../../../packages/script/src/creation';
import { parseIdeationReply, buildIdeationPrompt, type ChatMessage, type ChatOption } from '../../../../../packages/script/src/ideation';
import { skillClient } from '../../clients/skillClient';
import { generateAIContent } from '../../clients/aiClient';
import { usePromptStore } from '../../clients/stateClient';
import toast from 'react-hot-toast';
import { Modal } from '../../../../../src/components/ui/Modal';

interface Props {
  projects: ScriptProjectSummary[];
  error: string;
  onOpen: (id: string,view?:'blueprint') => void;
  onCreate: (title: string, profile: ProjectProfile, initialBrief?: InitialBriefPayload) => Promise<void>;
  onDeleteProject?: (id: string) => void;
  onOpenLibrary?: () => void;
}
type ModeType = 'agent' | 'interview';
const draftKey = 'omni.script.ideation.v1';
const channelKey = 'omni.script.home.execution-channel.v1';
const readChannel=(): 'api'|'external' => {try{return localStorage.getItem(channelKey)==='external'?'external':'api';}catch{return 'api';}};
interface IdeationSession { mode: ModeType; inputText: string; chatMessages: ChatMessage[]; selectedSkillIds: string[] }
function readSession(): IdeationSession {
  const empty: IdeationSession = {mode:'interview',inputText:'',chatMessages:[],selectedSkillIds:[]};
  try {
    const data=JSON.parse(localStorage.getItem(draftKey)||'null');
    if(data && ['agent','interview','fast'].includes(data.mode) && typeof data.inputText==='string' && Array.isArray(data.chatMessages) && data.chatMessages.every((m: ChatMessage)=>['user','ai'].includes(m.role)&&typeof m.text==='string') && Array.isArray(data.selectedSkillIds)) {
      if(data.chatMessages.at(-1)?.role==='user')data.chatMessages.push({role:'ai',text:'上次回复未完成，对话已保留，可以重试。',isError:true});
      if(data.mode==='fast')data.mode='interview';
      return data;
    }
  } catch { /* An unavailable or old cache does not prevent opening the editor. */ }
  return empty;
}

export function ScriptLibrary({projects,error,onOpen,onCreate,onDeleteProject,onOpenLibrary}: Props) {
  const [initial]=useState(readSession);
  const [stopAfter,setStopAfter]=useState<ScriptStage|''>('');
  const [agentRequest,setAgentRequest]=useState<{text:string;input:string}|null>(null);
  const [agentError,setAgentError]=useState('');
  const agentReturnFocus=useRef<HTMLElement|null>(null);
  const agentDialogContent=useRef<HTMLDivElement>(null);
  const [mode,setMode]=useState<ModeType>(initial.mode);
  const {isTestMode,channel,setChannel}=useScriptExecutionChannel(readChannel);
  const [isModeOpen,setIsModeOpen]=useState(false);
  const [isSkillsOpen,setIsSkillsOpen]=useState(false);
  const [availableSkills,setAvailableSkills]=useState<SkillDTO[]>([]);
  const [selectedSkillIds,setSelectedSkillIds]=useState<string[]>(initial.selectedSkillIds);
  const [skillsLoading,setSkillsLoading]=useState(true);
  const [skillsError,setSkillsError]=useState('');
  const [inputText,setInputText]=useState(initial.inputText);
  const [chatMessages,setChatMessages]=useState<ChatMessage[]>(initial.chatMessages);
  const hasConversation=chatMessages.length>0;
  const [legacyReplying,setIsReplying]=useState(false);
  const durable = useScriptConversation(initial.chatMessages, setChatMessages, setInputText);
  const isReplying = legacyReplying || durable.pending || durable.mode === 'loading';
  const [isSubmitting,setIsSubmitting]=useState(false);
  const [storageError,setStorageError]=useState('');
  const [projectSearch,setProjectSearch]=useState('');
  const [manualCreateOpen,setManualCreateOpen]=useState(false);
  const [manualTitle,setManualTitle]=useState('');
  const [manualFormat,setManualFormat]=useState<Exclude<ScriptCreationFormat,'custom'>>('feature-film');
  const [manualBrief,setManualBrief]=useState('');
  const [manualCreateError,setManualCreateError]=useState('');
  const [manualCreating,setManualCreating]=useState(false);
  const modeRef=useRef<HTMLDivElement>(null);
  const skillsRef=useRef<HTMLDivElement>(null);
  const chatScrollRef=useRef<HTMLDivElement>(null);
  const textareaRef=useRef<HTMLTextAreaElement>(null);
  const running=useRef(false);
  const mounted=useRef(true);
  useEffect(()=>{ mounted.current=true; return ()=>{mounted.current=false;}; },[]);
  useEffect(()=>{let live=true;skillClient.listSkills().then(skills=>{if(live)setAvailableSkills(skills);}).catch(e=>{if(live)setSkillsError(e.message||'Skill 加载失败');}).finally(()=>{if(live)setSkillsLoading(false);});return()=>{live=false;};},[]);
  useEffect(()=>{
    try {if(!localStorage.getItem(`${draftKey}.original`))localStorage.setItem(`${draftKey}.original`,localStorage.getItem(draftKey)||'null');localStorage.setItem(draftKey,JSON.stringify({mode,inputText,chatMessages,selectedSkillIds}));setStorageError('');}
    catch {setStorageError('浏览器未能保存这段对话，刷新前请复制需要保留的内容。');}
  },[mode,inputText,chatMessages,selectedSkillIds]);
  useEffect(()=>{try{localStorage.setItem(channelKey,channel);}catch{setStorageError('浏览器未能保存执行方式，请刷新前检查选择。');}},[channel]);
  useEffect(()=>{
    const close=(event:MouseEvent)=>{if(!modeRef.current?.contains(event.target as Node))setIsModeOpen(false);if(!skillsRef.current?.contains(event.target as Node))setIsSkillsOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setIsModeOpen(false);setIsSkillsOpen(false);}};
    document.addEventListener('mousedown',close);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',escape);};
  },[]);
  useEffect(()=>{if(chatScrollRef.current)chatScrollRef.current.scrollTop=chatScrollRef.current.scrollHeight;},[chatMessages,isReplying]);
  const toggleSkill=(id:string)=>setSelectedSkillIds(ids=>ids.includes(id)?ids.filter(item=>item!==id):[...ids,id]);
  const selectedMethods=():MethodBinding[]=>{
    if(selectedSkillIds.some(id=>!availableSkills.some(skill=>skill.id===id)))throw new Error('所选 Skill 尚未加载或已删除，请重新选择。');
    return availableSkills.filter(skill=>selectedSkillIds.includes(skill.id)).map(methodFromSkill);
  };
  const request=async(messages:ChatMessage[],methods:MethodBinding[])=>{
    const template=usePromptStore.getState().templates.scriptIdeation.template;
    const prompt=buildIdeationPrompt('chat',messages,methods,template);
    let actualPrompt=prompt;
    let provenance:ChatMessage['provenance'];
    const raw=await generateAIContent({prompt,requireJson:false,taskType:'scriptGen',skipManualPrompt:true,onPromptComposed:a=>{actualPrompt=[a.systemInstruction,a.prompt].filter(Boolean).join('\n\n');},onExecutionProvenance:a=>{provenance={source:a.source,provider:a.provider,modelId:a.modelId};}});
    return {raw,audit:{prompt:actualPrompt,methods,provenance}};
  };
  const handleInterviewReply=async(overrideText?:string,overrideIntent?:'AUTO'|'AGENT')=>{
    if(running.current)return;
    const text=overrideText===undefined?inputText:overrideText;
    const history=chatMessages.filter(message=>!message.isError);
    if(!text.trim()&&!history.length)return;
    if(durable.mode==='loading'||durable.mode==='error'){toast.error(durable.error||'对话正在加载');return;}
    if(durable.mode==='durable'){
      const intent=overrideIntent??scriptHomeFollowupIntent(durable.conversation?.turns.at(-1));
      const sentText=text.trim()?text:([...history].reverse().find(m=>m.role==='user')?.text||'');
      if(!sentText)return;
      running.current=true;
      try{await durable.send(sentText,selectedSkillIds,usePromptStore.getState().templates.scriptIdeation.template,intent,channel,intent==='AGENT'?durable.conversation?.turns.at(-1)?.input.stopAfter:undefined);if(mounted.current&&overrideText===undefined)setInputText('');}
      catch(e){if(overrideText!==undefined)setInputText(current=>current.includes(sentText)?current:[current,sentText].filter(Boolean).join('\n'));toast.error((e as Error).message);}
      finally{running.current=false;}
      return;
    }
    if(channel==='external'){toast.error('外部回填需要持久助手，请等待连接恢复。');return;}
    let methods:MethodBinding[];try{methods=selectedMethods();}catch(e){toast.error((e as Error).message);return;}
    const next:ChatMessage[]=text.trim()?[...history,{role:'user',text}]:history;
    running.current=true;setIsReplying(true);setChatMessages(next);
    if(overrideText===undefined)setInputText('');
    try {
      const {raw,audit}=await request(next,methods);
      if(mounted.current)setChatMessages([...next,{role:'ai',...parseIdeationReply(raw),...audit}]);
    } catch(e) {
      if(mounted.current)setChatMessages([...next,{role:'ai',text:(e as Error).message||'本次回复未完成',isError:true,retryKind:'chat'}]);
    } finally {running.current=false;if(mounted.current)setIsReplying(false);}
  };
  const openAgentHandoff=(overrideText?:string)=>{
    if(running.current||isReplying||isSubmitting)return;
    if(durable.mode!=='durable'){toast.error(durable.error||'持久助手尚未就绪，请稍后重试');return;}
    if(durable.goalWorking||durable.goalNeedsReconcile){toast.error('请先暂停当前委托或核对已有返回，再调整任务。');return;}
    if(!inputText.trim()&&!overrideText?.trim()&&!chatMessages.some(message=>message.role==='user'&&message.text.trim())){toast.error('先说说你想写什么');return;}
    agentReturnFocus.current=document.activeElement as HTMLElement|null;
    setStopAfter(overrideText?durable.conversation?.turns.at(-1)?.input.stopAfter||'':'');
    setAgentError('');setIsModeOpen(false);setIsSkillsOpen(false);
    setAgentRequest({text:overrideText??inputText.trim(),input:inputText});
  };
  const closeAgentHandoff=()=>{
    if(running.current)return;
    setAgentRequest(null);setAgentError('');agentReturnFocus.current?.focus();
  };
  useEffect(()=>{
    if(!agentRequest)return;
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeAgentHandoff();return;}
      if(event.key!=='Tab')return;
      const dialog=agentDialogContent.current?.closest('[role="dialog"]');
      const controls=Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)')||[]);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keydown,true);
    return()=>document.removeEventListener('keydown',keydown,true);
  },[Boolean(agentRequest)]);
  const handleAgentGenerate=async()=>{
    if(running.current)return;
    if(!agentRequest)return;
    const text=`${agentRequest.text?`${agentRequest.text}\n\n`:''}${stopAfter?`请根据已有讨论推进本次任务，只做到${stageLabels[stopAfter]}就停止。`:'请按我的要求接手后续任务；如果我还没说清做到哪里，先问我本次停止位置，不要默认完成全部流程。'}`;
    running.current=true;setIsSubmitting(true);setAgentError('');
    try{await durable.send(text,selectedSkillIds,usePromptStore.getState().templates.scriptIdeation.template,'AGENT',channel,stopAfter||undefined);if(mounted.current){setInputText(current=>current===agentRequest.input?'':current);setAgentRequest(null);agentReturnFocus.current?.focus();}}
    catch(e){if(mounted.current)setAgentError((e as Error).message);}finally{running.current=false;if(mounted.current)setIsSubmitting(false);}
  };
  const handleBrief=async(overrideText?:string)=>{
    if(running.current)return;
    if(durable.mode!=='durable'){toast.error('持久助手尚未就绪，请稍后重试');return;}
    if(!inputText.trim()&&!chatMessages.some(message=>message.role==='user'))return;
    const text=overrideText??`${inputText.trim()?`${inputText.trim()}\n\n`:''}请根据已有讨论生成作品蓝图，只包含故事构想、主题、人物和基础设定，不生成故事大纲、节拍、分场或正文，区分我已确定的方向、候选建议和开放问题。只完成这份方案后停止，不启动连续创作。`;
    running.current=true;setIsSubmitting(true);
    try{await durable.send(text,selectedSkillIds,usePromptStore.getState().templates.scriptIdeation.template,'BLUEPRINT',channel);if(mounted.current)setInputText('');}
    catch(e){toast.error((e as Error).message);}finally{running.current=false;if(mounted.current)setIsSubmitting(false);}
  };
  const handleSelectOption=(option:ChatOption)=>{
    void handleInterviewReply(`【${option.tag}】${option.text}`,scriptHomeOptionIntent(durable.conversation?.turns.at(-1),option));
  };
  const handleFillOption=(option:ChatOption)=>{setInputText(`【${option.tag}】${option.text} `);textareaRef.current?.focus();};
  const handleRetryLastMessage=()=>{
    const kind=chatMessages.at(-1)?.retryKind || (mode==='interview'?'chat':mode);
    if(kind==='blueprint')void handleBrief([...chatMessages].reverse().find(message=>message.role==='user')?.text);else if(kind==='chat')void handleInterviewReply('');else openAgentHandoff(kind==='agent'?[...chatMessages].reverse().find(message=>message.role==='user')?.text:undefined);
  };
  const handleMainAction=()=>{if(!hasConversation&&mode==='agent')openAgentHandoff();else if(inputText.trim())void handleInterviewReply();};
  const waitingExternal=[...new Map((durable.conversation?.turns.flatMap(turn=>turn.externalRequests||[])||[])
    .filter(request=>request.status==='WAITING').map(request=>[request.id,request])).values()];
  const visibleProjects = projects.filter((p) =>
    p.title.toLowerCase().includes(projectSearch.trim().toLowerCase()) ||
    (p.genre && p.genre.toLowerCase().includes(projectSearch.trim().toLowerCase())) ||
    (p.concept && p.concept.toLowerCase().includes(projectSearch.trim().toLowerCase()))
  );
  const createManualProject=async()=>{
    if(manualCreating)return;
    if(!manualTitle.trim()){setManualCreateError('请填写作品名称');return;}
    const preset=SCRIPT_CREATION_PRESETS[manualFormat];
    setManualCreating(true);setManualCreateError('');
    try{
      const profile=createScriptCreationProfile(manualFormat,preset.plannedUnits,preset.targetMinutes);
      const initialBrief:InitialBriefPayload|undefined=manualBrief.trim()?{concept:manualBrief.trim(),theme:'',outline:''}:undefined;
      await onCreate(manualTitle.trim(),profile,initialBrief);
      setManualCreateOpen(false);setManualTitle('');setManualBrief('');
    }catch(cause){setManualCreateError(cause instanceof Error?cause.message:'手动新建失败');}
    finally{setManualCreating(false);}
  };

  return (
    <main className="min-h-full bg-bg-primary text-text-primary px-4 py-8 md:p-12 overflow-y-auto selection:bg-text-primary/20 selection:text-text-primary">
      <div className="max-w-4xl mx-auto space-y-10">

        {/* ============================================================== */}
        {/* 1. HERO TITLE & HEADLINE (System theme colors)                 */}
        {/* ============================================================== */}
        <div className="text-center space-y-2.5 pt-2">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-text-primary flex flex-wrap items-center justify-center gap-x-2">
            <span className="whitespace-nowrap">开启你的</span>
            <span className="whitespace-nowrap text-text-primary underline decoration-border-primary/60">长篇创作模式</span>
            <span className="whitespace-nowrap">，即刻起笔</span>
          </h1>
          <p className="text-xs md:text-sm text-text-muted max-w-xl mx-auto font-normal">
            和 AI 聊聊你的故事，选择喜欢的想法，也可以随时提出自己的方向。
          </p>
          <button type="button" onClick={()=>{setManualCreateError('');setManualCreateOpen(true);}} className="inline-flex items-center gap-1.5 rounded-xl border border-border-primary/35 bg-bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-surface-hover hover:text-text-primary transition-colors"><Edit3 size={13}/>手动新建剧本</button>
        </div>

        {(error || storageError || durable.error) && (
          <div className="p-3 text-xs rounded-xl bg-accent-red/10 text-accent-red">
            {error || storageError || durable.error}
          </div>
        )}

        {/* ============================================================== */}
        {/* 2. CONVERSATIONAL HERO INPUT BOX (Borderless design)          */}
        {/* ============================================================== */}
        <div className="rounded-3xl bg-bg-surface shadow-xl shadow-black/5 dark:shadow-black/25 p-5 md:p-7 transition-all space-y-4 relative group">

          {/* Chat Messages Stream (Active in Interview Mode or when conversation exists) */}
          {(chatMessages.length > 0 || (durable.mode==='durable' && Boolean(durable.error))) && (() => {
            return (
              <div className="space-y-2.5 mb-2">
                <div className="flex flex-wrap gap-2 items-center justify-between px-1 text-xs text-text-muted">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1.5 font-bold text-text-primary">
                      <MessageSquare size={13} className="text-text-secondary" />
                      <span>编审共创</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {durable.mode==='durable'&&(durable.needsReconcile||durable.error)&&<button
                      type="button"
                      disabled={!durable.canReset||isSubmitting}
                      onClick={()=>void durable.reconcile().catch(e=>toast.error(e.message))}
                      className="text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                    >核对返回</button>}
                    <button
                      type="button"
                      disabled={isSubmitting || isReplying || durable.needsReconcile}
                      onClick={() => void handleBrief()}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-text-primary text-bg-surface hover:opacity-90 font-medium transition-opacity cursor-pointer shadow-xs"
                      title="整理当前讨论，生成作品蓝图后停止"
                    >
                      生成作品蓝图
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting || (durable.mode==='durable'?!durable.canReset:isReplying)}
                      onClick={() => {
                        if (window.confirm(durable.mode==='durable'?'停止当前对话并重新开始？未完成的回复和委托将停止使用，旧对话及已有成果会保留。':'确定清空当前对话记录，重新起笔？')) {
                          if(durable.mode==='durable'){void durable.reset().catch(e=>toast.error(e.message));return;}
                          setChatMessages([]);
                          setInputText('');
                        }
                      }}
                      className="text-[11px] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                    >
                      清空重来
                    </button>
                  </div>
                </div>

                <div
                  ref={chatScrollRef}
                  className="max-h-80 md:max-h-96 overflow-y-auto space-y-3 p-4 rounded-2xl bg-bg-surface-soft"
                >
                {chatMessages.map((msg, idx) => {
                  const isLatestAi = msg.role === 'ai' && idx === chatMessages.length - 1;
                  return (
                    <div
                      key={idx}
                      className={`flex gap-2.5 text-xs leading-relaxed ${
                        msg.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {msg.role === 'ai' && (
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                          msg.isError ? 'bg-accent-red/15 text-accent-red' : 'bg-bg-surface text-text-secondary border border-border-primary/30'
                        }`}>
                          {msg.isError ? <ShieldAlert size={12} /> : <Sparkles size={12} />}
                        </div>
                      )}
                      <div
                        className={`min-w-0 max-w-[90%] md:max-w-[85%] px-3 md:px-4 py-3 rounded-2xl ${
                          msg.role === 'user'
                            ? 'bg-text-primary text-bg-surface font-medium rounded-br-none'
                            : msg.isError
                            ? 'bg-accent-red/10 text-accent-red rounded-bl-none shadow-xs'
                            : 'bg-bg-surface text-text-primary rounded-bl-none shadow-xs border border-border-primary/20'
                        }`}
                      >
                        <div className="text-[10px] font-mono text-text-muted mb-1 flex items-center justify-between">
                          <span>{msg.role === 'user' ? '你' : 'AI 资深编审'}</span>
                        </div>
                        {msg.replyKind==='READY'&&<p className="text-xs font-semibold mb-2">已有可展开的方向，可以整理作品蓝图</p>}
                        {msg.replyKind==='BLUEPRINT'&&<p className="text-xs font-semibold mb-2">作品蓝图已整理 · 本次完成</p>}
                        <div className="whitespace-pre-wrap">{msg.text}</div>
                        {msg.replyKind==='BLUEPRINT'&&<p className="text-[11px] text-text-muted mt-2">蓝图已保存为工作稿。确认采用后进入作品，再逐步生成大纲、分场和正文。</p>}
                        {msg.blueprintWorkspaceId&&<ScriptHomeBlueprint workspaceId={msg.blueprintWorkspaceId} onOpen={onOpen}/>}

                        {msg.isError && isLatestAi && (durable.mode!=='durable'||msg.retryKind==='chat'||msg.retryKind==='agent'||msg.retryKind==='blueprint') && (
                          <div className="mt-2.5 pt-2 border-t border-accent-red/20 flex items-center justify-between gap-3">
                            <span className="text-[11px] text-text-muted">对话已保留，可以重试。</span>
                            <button
                              type="button"
                              disabled={isReplying || isSubmitting}
                              onClick={handleRetryLastMessage}
                              className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-accent-red text-white hover:bg-accent-red/90 text-[11px] font-semibold transition-all cursor-pointer shadow-sm"
                            >
                              <RefreshCw size={11} className={isReplying ? "animate-spin" : ""} />
                              <span>点击重新生成回答</span>
                            </button>
                          </div>
                        )}

                        {/* Quick Suggestion Options (Available on latest AI message) */}
                        {msg.options && msg.options.length > 0 && isLatestAi && (
                          <div className="mt-3.5 pt-3 border-t border-border-primary/20 space-y-2">
                            <div className="text-[11px] text-text-muted flex items-center gap-1.5 font-medium">
                              <Sparkles size={11} className="text-text-muted" />
                              <span>可选方向（选中后继续讨论，也可以输入自己的想法）：</span>
                            </div>

                            <div className="grid grid-cols-1 gap-1.5">
                              {msg.options.map((opt, optIdx) => (
                                <div
                                  key={optIdx}
                                  role="button" tabIndex={isReplying || isSubmitting ? -1 : 0}
                                  aria-label={`选择：${opt.text}`}
                                  onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key) && !isReplying && !isSubmitting) { event.preventDefault(); handleSelectOption(opt); } }}
                                  onClick={() => !isReplying && !isSubmitting && handleSelectOption(opt)}
                                  className="group/opt flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between p-2.5 rounded-xl bg-bg-surface-soft hover:bg-bg-surface-hover transition-all cursor-pointer border border-transparent hover:border-border-primary/40"
                                >
                                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-2.5 min-w-0 flex-1 sm:pr-2">
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 bg-bg-surface text-text-secondary border border-border-primary/25 group-hover/opt:text-text-primary transition-colors">
                                      {opt.tag}
                                    </span>
                                    <span className="text-xs text-text-secondary group-hover/opt:text-text-primary transition-colors whitespace-pre-wrap leading-relaxed">
                                      {opt.text}
                                    </span>
                                  </div>

                                  <div className="flex items-center justify-end gap-1 shrink-0">
                                    <button
                                      type="button"
                                      title="填入下方输入框微调"
                                      disabled={isReplying || isSubmitting}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleFillOption(opt);
                                      }}
                                      className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer"
                                    >
                                      <Edit3 size={12} />
                                    </button>
                                    <span className="text-[11px] text-text-muted group-hover/opt:text-text-primary flex items-center gap-0.5 font-medium px-1">
                                      <span>选择</span>
                                      <ArrowRight size={11} />
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {isReplying && (
                  <div className="flex items-center gap-2 text-xs text-text-muted px-2 py-1">
                    <Sparkles size={13} className="animate-spin text-text-secondary" />
                    <span>AI 正在回复...</span>
                  </div>
                )}
              </div>
            </div>
            );
          })()}

          {mode==='interview'&&!isReplying&&!durable.goalWorking&&discussionTurnsSinceMilestone(durable.conversation?.turns||[])>=3&&(
            <div role="status" className="text-xs text-text-secondary flex flex-wrap items-center gap-2">
              <span>可以先生成作品蓝图，未定细节留待后续调整。</span>
              <button type="button" disabled={isSubmitting} onClick={()=>void handleBrief()} className="underline">生成作品蓝图</button>
            </div>
          )}
          {/* Main Textarea */}
          <div className="rounded-2xl border border-border-primary bg-bg-surface-soft p-4 transition-colors focus-within:border-text-secondary focus-within:ring-1 focus-within:ring-text-secondary/30">
            <textarea
              aria-label="给 AI 的消息"
              aria-describedby="script-home-message-hint"
              disabled={isReplying || isSubmitting}
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
                  e.preventDefault();
                  handleMainAction();
                }
              }}
              placeholder={
                !hasConversation && mode === 'agent'
                  ? "描述你想交给 Agent 的任务…"
                  : "输入你的想法、问题或修改意见…"
              }
              rows={chatMessages.length > 0 ? 3 : 4}
              className="block w-full bg-transparent text-sm md:text-base text-text-primary placeholder:text-text-secondary focus:outline-none resize-none leading-relaxed font-normal disabled:opacity-60"
            />
            <p id="script-home-message-hint" className="mt-2 text-xs text-text-secondary">
              {!hasConversation && mode === 'agent' ? 'Enter 设置委托' : 'Enter 发送'} · Shift+Enter 换行
            </p>
          </div>

          {/* Bottom Controls Bar (Borderless, surface tokens) */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">

            {/* Left Options Controls */}
            <div className="relative flex flex-wrap items-center gap-2 text-xs">

              {/* Option 1: Agent Mode Dropdown */}
              {!hasConversation&&<div className="relative" ref={modeRef}>
                <button
                  type="button"
                  disabled={isReplying || isSubmitting}
                  aria-label="创作模式" aria-expanded={isModeOpen}
                  onClick={() => {
                    setIsModeOpen(!isModeOpen);
                    setIsSkillsOpen(false);
                  }}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-medium transition-all ${
                    mode === 'agent'
                      ? 'bg-bg-surface-hover text-text-primary border border-border-primary/40 shadow-xs'
                      : mode === 'interview'
                      ? 'bg-bg-surface-hover text-text-primary border border-border-primary/40 shadow-xs'
                      : 'bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {mode === 'agent' && <Cpu size={13} className="text-text-muted" />}
                  {mode === 'interview' && <MessageSquare size={13} className="text-text-muted" />}
                  <span>{mode === 'agent' ? 'Agent 模式' : '普通模式'}</span>
                  <ChevronDown size={12} className={`transition-transform opacity-70 ${isModeOpen ? 'rotate-180' : ''}`} />
                </button>

                {isModeOpen && (
                  <div className="absolute left-0 bottom-full mb-2 w-64 rounded-2xl bg-bg-surface shadow-2xl p-1.5 z-30 space-y-1 animate-in fade-in zoom-in-95 duration-100 border border-border-primary/30">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('agent');
                        setIsModeOpen(false);
                      }}
                      className={`w-full text-left p-2.5 rounded-xl transition-all flex items-start gap-2.5 ${
                        mode === 'agent' ? 'bg-bg-surface-hover text-text-primary font-medium' : 'text-text-secondary hover:bg-bg-surface-soft hover:text-text-primary'
                      }`}
                    >
                      <Cpu size={16} className="mt-0.5 shrink-0 text-text-muted" />
                      <div>
                        <div className="font-semibold text-xs text-text-primary">Agent 模式</div>
                        <div className="text-[11px] text-text-muted mt-0.5 leading-snug">
                          指定从哪里接手、做到哪里停止，由 Agent 推进这一段流程。
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if(durable.mode==='durable'){void durable.pauseGoals().then(()=>{setMode('interview');setIsModeOpen(false);}).catch(e=>toast.error(e.message));}
                        else if(durable.mode==='legacy'){setMode('interview');setIsModeOpen(false);}
                        else toast.error('对话尚未加载，请稍后重试。');
                      }}
                      className={`w-full text-left p-2.5 rounded-xl transition-all flex items-start gap-2.5 ${
                        mode === 'interview' ? 'bg-bg-surface-hover text-text-primary font-medium' : 'text-text-secondary hover:bg-bg-surface-soft hover:text-text-primary'
                      }`}
                    >
                      <MessageSquare size={16} className="mt-0.5 shrink-0 text-text-muted" />
                      <div>
                        <div className="font-semibold text-xs text-text-primary">普通模式（多轮共创）</div>
                        <div className="text-[11px] text-text-muted mt-0.5 leading-snug">
                          讨论方向，随时整理作品蓝图；每次只完成你要求的一步。
                        </div>
                      </div>
                    </button>


                  </div>
                )}
              </div>}

              {isTestMode&&<label className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-bg-surface-soft text-text-secondary">
                <span>执行方式</span>
                <select aria-label="首页执行方式" value={channel} onChange={event=>setChannel(event.target.value as 'api'|'external')} className="bg-transparent text-text-primary outline-none">
                  <option value="api">API 模型</option><option value="external">复制回填</option>
                </select>
              </label>}

              {/* Option 2: Skills Selector Dropdown */}
              <div ref={skillsRef}>
                <button
                  type="button"
                  disabled={isReplying || isSubmitting}
                  aria-label="选择 Skill" aria-expanded={isSkillsOpen}
                  onClick={() => {
                    setIsSkillsOpen(!isSkillsOpen);
                    setIsModeOpen(false);
                  }}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-medium transition-all ${
                    selectedSkillIds.length > 0
                      ? 'bg-bg-surface-hover text-text-primary border border-border-primary/40 shadow-xs'
                      : 'bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <Wand2 size={13} className="text-text-muted" />
                  <span>Skill</span>
                  {selectedSkillIds.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded font-mono text-[10px] bg-bg-surface-soft text-text-secondary border border-border-primary/20">
                      {selectedSkillIds.length}
                    </span>
                  )}
                  <ChevronDown size={12} className={`transition-transform opacity-70 ${isSkillsOpen ? 'rotate-180' : ''}`} />
                </button>

                {isSkillsOpen && (
                  <div className="absolute left-0 bottom-full mb-2 w-80 max-w-[calc(100vw-5rem)] max-h-80 overflow-y-auto rounded-2xl bg-bg-surface shadow-2xl p-2 z-30 space-y-1.5 animate-in fade-in zoom-in-95 duration-100 border border-border-primary/30">
                    <div className="px-2 py-1 text-[11px] font-semibold text-text-muted flex items-center justify-between pb-1.5">
                      <span>选择本次使用的 Skill</span>
                      <span className="text-text-secondary font-mono">已选 {selectedSkillIds.length} 个</span>
                    </div>

                    <div className="space-y-1 pt-1">
                      {availableSkills.map((sk) => {
                        const isChecked = selectedSkillIds.includes(sk.id);
                        return (
                          <div
                            key={sk.id}
                            role="checkbox" aria-checked={isChecked} tabIndex={0}
                            onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); toggleSkill(sk.id); } }}
                            onClick={() => toggleSkill(sk.id)}
                            className={`flex items-start gap-2.5 p-2 rounded-xl cursor-pointer transition-all ${
                              isChecked
                                ? 'bg-bg-surface-soft text-text-primary'
                                : 'text-text-secondary hover:bg-bg-surface-soft hover:text-text-primary'
                            }`}
                          >
                            <div className="mt-0.5 shrink-0 text-text-primary">
                              {isChecked ? <CheckSquare size={14} /> : <Square size={14} className="text-text-muted" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium text-text-primary truncate">{sk.title}</div>
                              <div className="text-[10px] text-text-muted line-clamp-1 mt-0.5">{sk.content}</div><div className="text-[10px] text-text-muted">{skillApplicabilityHint(sk, {task:"writing"})}</div>
                            </div>
                          </div>
                        );
                      })}

                      {!availableSkills.length && (
                        <div className="p-3 text-center text-xs text-text-muted">
                          {skillsError || (skillsLoading ? '正在加载 Skill…' : 'Skill 库暂无内容')}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* Right Action Button */}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {hasConversation && (
                <button
                  type="button"
                  disabled={isSubmitting || isReplying}
                  onClick={() => openAgentHandoff()}
                  className="px-4 py-2.5 rounded-2xl text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-primary transition-all border border-border-primary/20"
                >
                  {isSubmitting ? '处理中...' : '交给 Agent 处理'}
                </button>
              )}

              <button
                type="button"
                disabled={isSubmitting || isReplying || !inputText.trim()}
                onClick={handleMainAction}
                className="flex items-center gap-2 px-6 py-2.5 rounded-2xl text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition-all transform active:scale-95 cursor-pointer"
              >
                {isSubmitting || isReplying ? (
                  <>
                    <Sparkles size={14} className="animate-spin" />
                    <span>处理中...</span>
                  </>
                ) : (
                  <>
                    <span>
                      {!hasConversation&&mode === 'agent'
                        ? '交给 Agent 处理'
                        : '发送'}
                    </span>
                    {!hasConversation&&mode === 'agent' ? <ArrowRight size={14} /> : <Send size={14} />}
                  </>
                )}
              </button>
            </div>

          </div>

        </div>

        <Modal isOpen={agentRequest!==null} onClose={closeAgentHandoff} title="交给 Agent 处理" size="sm" closeOnBackdrop={!isSubmitting} showCloseButton={!isSubmitting}
          footer={<>
            <button type="button" disabled={isSubmitting} onClick={closeAgentHandoff} className="px-3 py-2 text-sm rounded-lg hover:bg-bg-surface-hover disabled:opacity-40">取消</button>
            <button type="button" disabled={isSubmitting||isReplying} onClick={()=>void handleAgentGenerate()} className="px-4 py-2 text-sm rounded-lg bg-text-primary text-bg-primary disabled:opacity-40">{isSubmitting?'正在提交…':'确认委托'}</button>
          </>}>
          <div ref={agentDialogContent} className="space-y-4 text-sm">
            <p className="text-text-secondary">Agent 将基于当前对话和你的要求推进，做到约定阶段后停止，成果先保存为工作稿。</p>
            <label className="block space-y-2"><span>做到哪里停止</span>
              <select autoFocus disabled={isSubmitting} aria-label="Agent 停止阶段" value={stopAfter} onChange={e=>setStopAfter(e.target.value as ScriptStage|'')} className="w-full px-3 py-2 rounded-lg bg-bg-surface border border-border-primary/40 text-text-primary">
                <option value="">按我的要求确定</option>{SCRIPT_STAGES.map(stage=><option key={stage} value={stage}>{stageLabels[stage]}</option>)}
              </select>
            </label>
            <p className="text-xs text-text-muted">{stopAfter?`${stageDescriptions[stopAfter]} 完成后停止，后续由你决定。`:'如果你的要求中还没有明确停止位置，Agent 会先询问。'}</p>
            {agentError&&<p role="alert" className="text-accent-red">{agentError}</p>}
          </div>
        </Modal>

        <Modal isOpen={manualCreateOpen} onClose={()=>{if(!manualCreating)setManualCreateOpen(false);}} title="手动新建剧本" size="sm" closeOnBackdrop={!manualCreating} showCloseButton={!manualCreating}
          footer={<><button type="button" disabled={manualCreating} onClick={()=>setManualCreateOpen(false)} className="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-bg-surface-hover disabled:opacity-40">取消</button><button type="button" disabled={manualCreating} onClick={()=>void createManualProject()} className="rounded-lg bg-text-primary px-4 py-2 text-sm font-semibold text-bg-surface disabled:opacity-40">{manualCreating?'正在创建…':'创建空白剧本'}</button></>}>
          <div className="space-y-4 text-sm">
            <label className="block">作品名称<input autoFocus aria-label="手动剧本名称" value={manualTitle} onChange={event=>setManualTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-border-primary/40 bg-bg-surface px-3 py-2 text-text-primary outline-none focus:border-text-secondary" placeholder="例如：雾港回声" /></label>
            <label className="block">作品形态<select aria-label="手动剧本形态" value={manualFormat} onChange={event=>setManualFormat(event.target.value as Exclude<ScriptCreationFormat,'custom'>)} className="mt-1 w-full rounded-lg border border-border-primary/40 bg-bg-surface px-3 py-2 text-text-primary outline-none focus:border-text-secondary">{(Object.entries(SCRIPT_CREATION_PRESETS) as Array<[ScriptCreationFormat,typeof SCRIPT_CREATION_PRESETS[ScriptCreationFormat]]>).filter(([id])=>id!=='custom').map(([id,preset])=><option key={id} value={id}>{preset.label} · {preset.targetMinutes} 分钟{preset.organization==='episodic'?` · ${preset.plannedUnits} 集`:''}</option>)}</select></label>
            <label className="block">故事构想（可选）<textarea aria-label="手动剧本构想" rows={3} value={manualBrief} onChange={event=>setManualBrief(event.target.value)} className="mt-1 w-full resize-y rounded-lg border border-border-primary/40 bg-bg-surface px-3 py-2 text-text-primary outline-none focus:border-text-secondary" placeholder="可以留空，进入剧本后再写" /></label>
            {manualCreateError&&<p role="alert" className="text-xs text-accent-red">{manualCreateError}</p>}
          </div>
        </Modal>

        {durable.goalNeedsReconcile&&<p role="status">委托结果待核对，输入会保留。请先在下方委托中核对已收到的返回，再暂停或继续。</p>}
        {durable.goalWorking&&<div role="status" className="p-3 text-xs rounded-xl bg-bg-surface-soft">委托正在运行，输入会保留。请先暂停，再在下方委托中修改目标并明确继续。<button type="button" disabled={isReplying} onClick={()=>void durable.pauseGoals().catch(e=>toast.error(e.message))} className="ml-2 underline">暂停委托</button></div>}

        {mode==='interview'&&chatMessages.length>0&&!durable.goalWorking&&<p className="text-xs text-text-muted">普通模式先生成蓝图，采用后逐步调用模型生成大纲、分场和正文。也可随时交给 Agent，指定做到哪一步；成果先存为工作稿供你确认。</p>}

        {waitingExternal.map(request=><ScriptHomeExternalRequest key={request.id} request={request} onSubmitted={()=>void durable.refresh().catch(cause=>toast.error((cause as Error).message))}/>)}

        {durable.conversation?.turns.flatMap(turn=>{
          const goal=(turn.response as {goal?:{goalId?:string}}|null)?.goal;
          return goal?.goalId?[<ScriptHomeGoal key={goal.goalId} goalId={goal.goalId} onOpen={onOpen} skills={availableSkills}/>]:[];
        })}

        {/* ============================================================== */}
        {/* 3. RECENT PROJECTS SECTION (Borderless, system tokens)         */}
        {/* ============================================================== */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-text-secondary" />
              <h2 className="text-sm font-bold text-text-primary tracking-tight">最近作品项目</h2>
              <span className="text-[11px] text-text-muted font-mono px-2 py-0.5 rounded-full bg-bg-surface-soft">
                {visibleProjects.length}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {projects.length > 3 && (
                <div className="relative w-48">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  <input
                    type="text"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    placeholder="搜索项目..."
                    className="h-8 w-full rounded-xl bg-bg-surface-soft py-1.5 pl-8 pr-3 text-xs text-text-primary outline-none transition focus:bg-bg-surface-hover placeholder:text-text-muted"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={() => onOpenLibrary?.()}
                className="text-xs text-text-secondary hover:text-text-primary cursor-pointer font-medium flex items-center gap-1 transition-colors"
              >
                <span>进入作品库</span>
                <ArrowRight size={13} />
              </button>
            </div>
          </div>

          {/* Project Horizontal Cards List (Borderless!) */}
          <div className="space-y-3">
            {visibleProjects.map((project) => {
              const genreLabel = project.genre || project.workType || (project.format === 'single-work' ? '单部作品' : '分集作品');
              const statusLabel = project.revision > 0 ? '创作中' : '初版蓝图';
              const conceptText = project.concept || '暂无设定梗概，点击右侧继续写作完善大纲与首场剧本。';

              return (
                <div
                  key={project.id}
                  onClick={() => onOpen(project.id)}
                  className="group p-5 md:p-6 rounded-2xl bg-bg-surface hover:bg-bg-surface-hover cursor-pointer transition-all duration-300 hover:scale-[1.005] flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm hover:shadow-md"
                >
                  {/* Left Project Info */}
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="text-base font-bold text-text-primary group-hover:text-text-primary transition-colors truncate">
                        {project.title}
                      </h3>

                      {/* Genre Tag - Borderless Pill */}
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-bg-surface-soft text-text-secondary">
                        {genreLabel}
                      </span>

                      {/* Status Tag - Borderless Pill */}
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-bg-surface-soft text-text-secondary border border-border-primary/20">
                        {statusLabel}
                      </span>
                    </div>

                    {/* Premise / Concept Summary */}
                    <p className="text-xs text-text-muted line-clamp-2 leading-relaxed">
                      {conceptText}
                    </p>

                    {/* Stats Footer */}
                    <div className="flex items-center gap-3 text-[11px] text-text-muted font-mono flex-wrap">
                      <span>{project.format==='single-work'?(project.writtenUnitCount?'已有正文':'尚未写正文'):`已写 ${project.writtenUnitCount} / 计划 ${project.plannedUnitCount} 集`}</span>
                      <span>·</span>
                      <span>{project.sceneCount || 0} 场</span>
                      <span>·</span>
                      <span>{(project.totalCharacters || 0).toLocaleString()} 字</span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        <span>保存于 {new Date(project.updatedAt).toLocaleDateString('zh-CN')}</span>
                      </span>
                    </div>
                  </div>

                  {/* Right Action Button - Borderless */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(project.id);
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-bg-surface-soft group-hover:bg-text-primary group-hover:text-bg-surface text-text-secondary transition-all"
                    >
                      <span>继续写作</span>
                      <Play size={11} className="fill-current" />
                    </button>

                    {onDeleteProject && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`确定删除剧本《${project.title}》？此操作不可恢复。`)) {
                            onDeleteProject(project.id);
                          }
                        }}
                        className="p-2 rounded-xl text-text-dark hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                        title="删除剧本"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {!visibleProjects.length && (
              <div className="p-12 text-center rounded-2xl bg-bg-surface space-y-3 shadow-sm">
                <BookOpen size={32} className="mx-auto text-text-muted/40" />
                <h4 className="text-sm font-semibold text-text-secondary">
                  {projectSearch ? '没有找到匹配的剧本' : '暂无近期创作项目'}
                </h4>
                <p className="text-xs text-text-muted max-w-sm mx-auto">
                  {projectSearch
                    ? '换个关键词搜索试试。'
                    : '在上方输入故事灵感，和助手讨论方向，或直接委托创作。'}
                </p>
              </div>
            )}
          </div>
        </div>

      </div>
    </main>
  );
}
