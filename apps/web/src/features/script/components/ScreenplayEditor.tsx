import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  Sparkles, Check, Copy, Film, Clock, ArrowRight, RotateCcw, Edit3, BookOpen
} from 'lucide-react';
import type { Scene, Character, ScriptProject } from '../../../../../../packages/script/src/schema';
import { blocksToScreenplayText, screenplayTextToBlocks } from '../../../../../../packages/script/src/fountainAdapter';
import type {TextSelection} from '../../../../../../packages/script/src/proposals';
import toast from 'react-hot-toast';

interface Props {
  project: ScriptProject;
  scene: Scene;
  characters: Character[];
  onUpdateScene: (updatedScene: Scene) => void;
  onRegisterSpeaker: (name: string) => void;
  onRequestSceneTask: () => void;
  onReadThrough: () => void;
  onDiscuss: () => void;
  onRequestTextTask:(selection:TextSelection,request:string)=>void;
  onSelectCharacter?: (charId: string) => void;
}

export function ScreenplayEditor({
  project,
  scene,
  characters,
  onUpdateScene,
  onRegisterSpeaker,
  onRequestSceneTask,
  onReadThrough,
  onDiscuss,
  onRequestTextTask,
}: Props) {
  // Sync plain text representation of the scene
  const [text, setText] = useState(() => blocksToScreenplayText(scene.blocks, characters));
  const blocksRef = useRef(scene.blocks);
  const sceneIdRef = useRef(scene.id);
  const lastLocalBlocksTextRef = useRef<string | null>(null);
  const lastIncomingTextRef = useRef(blocksToScreenplayText(scene.blocks, characters));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [isManualWriting, setIsManualWriting] = useState(false);

  // Floating AI action bubble state
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number; text: string; sourceText: string } | null>(null);
  const [bubblePosition, setBubblePosition] = useState<{ top: number; left: number } | null>(null);

  // A save acknowledgement changes the revision without changing the user's
  // current scene content. Keep their raw spacing, selection and caret intact.
  // A different scene or genuinely different blocks still replace the canvas.
  useEffect(() => {
    const formatted = blocksToScreenplayText(scene.blocks, characters);
    const changedScene = sceneIdRef.current !== scene.id;
    if (changedScene || (lastLocalBlocksTextRef.current !== null && formatted !== lastLocalBlocksTextRef.current)
      || (lastLocalBlocksTextRef.current === null && formatted !== lastIncomingTextRef.current)) {
      setText(formatted);
      lastLocalBlocksTextRef.current = null;
      setSelectionRange(null);
      setBubblePosition(null);
      if (changedScene) setIsManualWriting(false);
    }
    sceneIdRef.current = scene.id;
    lastIncomingTextRef.current = formatted;
    blocksRef.current = scene.blocks;
  }, [scene.id, scene.blocks, characters]);

  // Push updates to parent blocks
  const propagateChange = useCallback((newText: string) => {
    setText(newText);
    const { blocks } = screenplayTextToBlocks(newText, characters, blocksRef.current);
    blocksRef.current = blocks;
    lastLocalBlocksTextRef.current = blocksToScreenplayText(blocks, characters);
    onUpdateScene({
      ...scene,
      blocks,
    });
  }, [characters, onUpdateScene, scene]);

  // Handle text selection for inline AI copilot
  const handleSelect = () => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = el.value.substring(start, end);

    if (selected && selected.length >= 2) {
      setSelectionRange({ start, end, text: selected, sourceText: el.value });
      const rect = el.getBoundingClientRect();
      setBubblePosition({
        top: Math.max(10, el.offsetTop + 20),
        left: Math.min(rect.width - 260, Math.max(20, rect.width / 2 - 120)),
      });
    } else {
      {
        setSelectionRange(null);
        setBubblePosition(null);
      }
    }
  };

  // Keyboard shortcut listener (Tab indentation)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const cur = text;
      const updated = cur.substring(0, start) + '    ' + cur.substring(end);
      propagateChange(updated);
      setTimeout(() => el.setSelectionRange(start + 4, start + 4), 10);
    }
  };

  const handleAiAction = (request:string) => {
    if(!selectionRange)return;
    onRequestTextTask({start:selectionRange.start,end:selectionRange.end,text:selectionRange.text},request);
  };

  const isSceneEmpty = !text.trim() && !isManualWriting;
  const wordCount = text.replace(/\s/g, '').length;
  const unregisteredSpeakers=[...new Set(scene.blocks.filter(block=>block.type==='dialogue'&&!block.speakerId&&block.speakerName?.trim()).map(block=>block.speakerName!.trim()))];

  const sceneNumber=(project.units.find(unit=>unit.scenes.some(item=>item.id===scene.id))?.scenes.findIndex(item=>item.id===scene.id)??0)+1;
  return (
    <div className="relative flex flex-col h-full bg-bg-primary overflow-hidden">
      {/* Clean Minimalist Header (No manual typing format toolbars) */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border-primary/20 bg-bg-surface shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-bg-surface-soft text-text-secondary border border-border-primary/25 shrink-0 font-mono">
            SCENE {String(sceneNumber).padStart(2, '0')}
          </span>
          <span className="text-sm font-bold text-text-primary truncate">
            {scene.title || `第 ${sceneNumber} 场`}
          </span>
          {(scene.location || scene.timeOfDay) && (
            <span className="text-xs text-text-muted hidden sm:inline truncate">
              · {scene.location || '内外景未定'} {scene.timeOfDay ? `(${scene.timeOfDay})` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={onReadThrough} title="按场次顺序阅读正文" className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg text-text-secondary hover:bg-bg-surface-hover"><BookOpen size={13}/>{project.profile.organization==='standalone'?'阅读全文':'阅读本集'}</button>
          <span className="text-xs font-mono text-text-muted">
            {wordCount} 字
          </span>
          <button
            type="button"
            onClick={onRequestSceneTask}
            className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover focus-visible:outline focus-visible:outline-2"
           title="请 AI 试写或修改本场正文" aria-label="请 AI 试写或修改本场正文"><Sparkles size={16} /></button>
        </div>
      </div>

      {scene.generation?.status==='partial'&&<div className="flex flex-wrap items-center gap-3 px-4 py-2 text-xs border-b border-border-primary/20 bg-bg-surface" role="status">
        <span className="text-text-secondary">本场正文尚未写完；手动补齐后可确认完成。</span>
        <button type="button" className="underline text-text-primary" onClick={()=>onUpdateScene({...scene,generation:{...scene.generation!,status:'complete'}})}>本场已写完</button>
      </div>}

      {unregisteredSpeakers.length>0&&<div className="px-6 py-2 bg-bg-surface-soft border-b border-border-primary/20 text-xs text-text-secondary flex flex-wrap items-center gap-2"><span>正文里有尚未登记的人物：</span>{unregisteredSpeakers.map(name=><button key={name} type="button" onClick={()=>onRegisterSpeaker(name)} className="px-2 py-1 rounded-md border border-border-primary/30 hover:text-text-primary">登记「{name}」到当前故事人物表</button>)}<span className="text-text-muted">不登记也会保留原文姓名。</span></div>}

      {/* Floating Inline AI Copilot Bubble (When user highlights text) */}
      {bubblePosition && selectionRange && (
        <div
          style={{ top: `${bubblePosition.top}px`, left: `${bubblePosition.left}px` }}
          className="absolute z-30 p-2.5 rounded-xl bg-bg-surface/95 border border-border-primary/40 shadow-2xl backdrop-blur-md text-xs text-text-primary max-w-sm transition-all animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center justify-between gap-3 mb-2 pb-1.5 border-b border-border-primary/20">
            <span className="flex items-center gap-1.5 text-text-primary font-medium">
              <Sparkles size={13}  />
              <span>AI 选段精修</span>
            </span>
            <button
              onClick={() => {
                setSelectionRange(null);
                setBubblePosition(null);
                          }}
              className="text-text-muted hover:text-text-primary text-[10px] cursor-pointer"
            >
              关闭
            </button>
          </div>

          <div className="flex flex-wrap gap-2 p-2 text-xs">
            {['按我的要求润色','让对白更口语化','用动作表达情绪'].map(request=><button key={request} onClick={()=>handleAiAction(request)} className="px-2 py-1 rounded hover:bg-bg-surface-soft">{request}</button>)}
          </div>
        </div>
      )}

      {/* Main Screenplay Canvas */}
      <div className="flex-1 overflow-auto p-6 flex justify-center bg-bg-primary/95">
        {isSceneEmpty ? (
          /* Empty State: AI Scene Generation Hero Card */
          <div className="w-full max-w-xl my-auto p-8 rounded-3xl bg-bg-surface border border-border-primary/30 shadow-xl flex flex-col items-center text-center space-y-5 animate-in fade-in duration-200">
            <div className="w-14 h-14 rounded-2xl bg-bg-surface-soft text-text-secondary border border-border-primary/30 flex items-center justify-center shadow-xs">
              <Sparkles size={28} />
            </div>

            <div>
              <h3 className="text-base font-bold text-text-primary">本场还没有正文</h3>
              <p className="text-xs text-text-muted mt-1.5 leading-relaxed max-w-sm mx-auto">可以直接写，或从已有想法试写一场。人物和分场安排可以边写边补。</p>
              {(project.brief.concept||project.brief.outline)&&<p className="mt-3 text-xs text-left whitespace-pre-wrap max-h-32 overflow-auto select-text">{project.brief.concept||project.brief.outline}</p>}
            </div>

            {/* Beat Context Card */}
            <div className="w-full p-4 rounded-2xl bg-bg-surface-soft/80 border border-border-primary/20 text-left text-xs space-y-2">
              <div className="text-[11px] font-semibold text-text-muted">
                本场已有规划
              </div>
              <div className="flex items-start gap-2">
                <span className="text-text-secondary font-medium shrink-0">发生什么：</span>
                <span className="text-text-secondary">
                  {scene.purpose || '尚未填写，可以边写边确定'}
                </span>
              </div>
              {(scene.entryState || scene.exitState) && (
                <div className="flex items-start gap-2">
                  <span className="text-text-secondary font-medium shrink-0">前后变化：</span>
                  <span className="text-text-secondary font-medium">
                    {scene.entryState || '未定'} → {scene.exitState || '未定'}
                  </span>
                </div>
              )}
            </div>

            <div className="w-full space-y-3">
              <button
                type="button"
                data-primary="true"
                onClick={onRequestSceneTask}
                className="script-primary-btn w-full py-3 px-5 rounded-2xl bg-text-primary text-bg-surface font-medium text-xs hover:opacity-90 active:scale-[0.98] transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Sparkles size={15} />
                <span>请 AI 试写本场</span>
              </button>

              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsManualWriting(true)}
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-primary transition-all cursor-pointer shadow-2xs"
                >
                  手写正文
                </button>
                <button
                  type="button"
                  onClick={onDiscuss}
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary transition-all cursor-pointer shadow-2xs"
                >
                  先讨论本场
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Standard Screenplay Document View */
          <div className="w-full max-w-3xl min-h-full flex flex-col rounded-2xl bg-bg-surface/85 border border-border-primary/20 shadow-xl p-10 focus-within:border-border-primary/50 transition-colors">
            <textarea
              aria-label="本场正文"
              ref={textareaRef}
              value={text}
              onChange={(e) => propagateChange(e.target.value)}
              onSelect={handleSelect}
              onKeyDown={handleKeyDown}
              placeholder={`INT. 场景地点 - 日/夜\n\n【环境与动作】描述场景氛围、角色动作与环境细节...\n\n角色名字\n（语气/潜台词提示）\n台词内容...\n`}
              className="w-full flex-1 bg-transparent text-text-primary font-mono text-[14px] leading-[1.8] resize-none focus:outline-none placeholder:text-text-muted/40 selection:bg-text-primary/20 selection:text-text-primary"
              style={{
                fontFamily: '"Courier Prime", "Source Han Serif SC", "Noto Serif SC", monospace',
                tabSize: 4,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
