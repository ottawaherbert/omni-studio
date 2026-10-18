import { useEffect, useRef, useState } from "react";
import { Box, ChevronDown, ChevronUp, Film, Layers3, Palette, PencilRuler, TimerReset } from "lucide-react";

import type {
  VisualAppearance,
  VisualImplementationMedium,
  VisualProductionMode,
} from "../../clients/domainTypes";
import { createNeutralVisualImplementation } from "../../clients/productionVisualStyleClient";
import { cn } from "../../lib/utils";
import {
  rememberProjectVisualSeedDraft,
  resolveProjectVisualSeedDraft,
  type ProjectVisualSeedDrafts,
} from "./projectVisualSeedState";

interface ProjectVisualSeedFieldsProps {
  value: VisualImplementationMedium | null;
  onChange: (value: VisualImplementationMedium | null) => void;
  disabled?: boolean;
  className?: string;
}

const implementationOptions: Array<{
  id: VisualProductionMode;
  label: string;
  hint: string;
  icon: typeof Film;
}> = [
  { id: "live_action", label: "真人实拍", hint: "摄影机与实体场景", icon: Film },
  { id: "2d_animation", label: "2D 动画", hint: "手绘、赛璐璐或绘本", icon: PencilRuler },
  { id: "3d_animation", label: "3D 动画", hint: "PBR、NPR 或实时渲染", icon: Box },
  { id: "stop_motion", label: "定格动画", hint: "偶、黏土、纸艺或物件", icon: TimerReset },
  { id: "mixed_media", label: "混合媒介", hint: "实拍、2D 与 3D 合成", icon: Layers3 },
];

const appearance = (
  realism: VisualAppearance["realism"],
  dimensionality: VisualAppearance["dimensionality"],
  finish: VisualAppearance["finish"],
  descriptor: string,
): VisualAppearance => ({ realism, dimensionality, finish, descriptors: [descriptor] });

const appearanceOptions: Record<VisualProductionMode, Array<{
  label: string;
  hint: string;
  value: VisualAppearance;
}>> = {
  live_action: [
    { label: "自然写实", hint: "克制摄影与可信光线", value: appearance("naturalistic", "physical_capture", "clean", "自然写实的电影画面") },
    { label: "强化电影感", hint: "更明确的色彩与光影设计", value: appearance("stylized", "physical_capture", "polished", "强化电影感的现实画面") },
    { label: "图形化 / 超现实", hint: "保留实拍质地并强化造型", value: appearance("graphic", "physical_capture", "graphic", "图形化与超现实的实拍画面") },
  ],
  "2d_animation": [
    { label: "赛璐璐", hint: "清晰轮廓与分层色块", value: appearance("stylized", "flat_2d", "clean", "赛璐璐与有限动画画面") },
    { label: "手绘绘本", hint: "保留笔触与纸面材料感", value: appearance("stylized", "layered_2d", "painterly", "手绘绘本质感的二维动画画面") },
    { label: "水墨 / 材料绘画", hint: "以墨色、留白与材料肌理造型", value: appearance("abstract", "layered_2d", "painterly", "水墨与材料绘画风格的二维动画画面") },
  ],
  "3d_animation": [
    { label: "写实 PBR", hint: "物理材质与可信光照", value: appearance("photoreal", "volumetric_3d", "polished", "写实 PBR 三维动画画面") },
    { label: "风格化 PBR", hint: "保留体积并主动简化造型", value: appearance("stylized", "volumetric_3d", "polished", "风格化 PBR 三维动画画面") },
    { label: "NPR / 卡通渲染", hint: "非写实着色与图形化轮廓", value: appearance("graphic", "volumetric_3d", "graphic", "NPR 卡通渲染三维动画画面") },
  ],
  stop_motion: [
    { label: "黏土", hint: "可见塑形与逐格手作痕迹", value: appearance("stylized", "physical_miniature", "raw", "黏土定格动画画面") },
    { label: "实体偶", hint: "布景、关节偶与摄影灯光", value: appearance("naturalistic", "physical_miniature", "clean", "实体偶定格动画画面") },
    { label: "纸艺 / 剪纸", hint: "平面材料与层叠空间", value: appearance("graphic", "physical_miniature", "graphic", "纸艺剪纸定格动画画面") },
  ],
  mixed_media: [
    { label: "实拍 + 动画", hint: "以实拍空间承接动画层", value: appearance("stylized", "hybrid", "polished", "真人实拍与动画合成画面") },
    { label: "2D + 3D", hint: "统一造型与合成关系", value: appearance("stylized", "hybrid", "clean", "二维动画与三维动画混合画面") },
    { label: "多媒介拼贴", hint: "允许材料切换但保持规则一致", value: appearance("graphic", "hybrid", "raw", "多媒介拼贴与实验影像画面") },
  ],
};

const realismOptions: Array<{ value: VisualAppearance["realism"]; label: string }> = [
  { value: "unspecified", label: "尚未指定" },
  { value: "photoreal", label: "照片级写实" },
  { value: "naturalistic", label: "自然主义" },
  { value: "stylized", label: "风格化" },
  { value: "graphic", label: "图形化" },
  { value: "abstract", label: "抽象" },
];

const dimensionalityOptions: Array<{ value: VisualAppearance["dimensionality"]; label: string }> = [
  { value: "physical_capture", label: "实体摄影空间" },
  { value: "flat_2d", label: "平面二维" },
  { value: "layered_2d", label: "分层二维" },
  { value: "volumetric_3d", label: "体积三维" },
  { value: "physical_miniature", label: "实体微缩空间" },
  { value: "hybrid", label: "混合空间 / 混合流程" },
];

const finishOptions: Array<{ value: VisualAppearance["finish"]; label: string }> = [
  { value: "unspecified", label: "尚未指定" },
  { value: "raw", label: "保留原始痕迹" },
  { value: "clean", label: "清洁明确" },
  { value: "painterly", label: "绘画性" },
  { value: "graphic", label: "图形化" },
  { value: "polished", label: "精细完成" },
];

const descriptorsFromText = (value: string) => value
  .split(/[\n,，]/)
  .map((item) => item.trim())
  .filter(Boolean);

const matchesAppearance = (left?: VisualAppearance, right?: VisualAppearance) => (
  Boolean(left)
  && left?.realism === right?.realism
  && left?.dimensionality === right?.dimensionality
  && left?.finish === right?.finish
  && JSON.stringify(left?.descriptors || []) === JSON.stringify(right?.descriptors || [])
);

export function ProjectVisualSeedFields({
  value,
  onChange,
  disabled = false,
  className,
}: ProjectVisualSeedFieldsProps) {
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const implementationDraftsRef = useRef<ProjectVisualSeedDrafts>(
    value ? rememberProjectVisualSeedDraft({}, value) : {},
  );
  const selectedMode = value?.productionMode;
  const selectedAppearance = value?.appearance;
  const currentAppearanceOptions = selectedMode ? appearanceOptions[selectedMode] : [];
  const neutralAppearance = selectedMode
    ? createNeutralVisualImplementation(selectedMode).appearance
    : undefined;
  const hasAppearanceChoice = Boolean(
    selectedAppearance
    && (
      selectedAppearance.realism !== "unspecified"
      || selectedAppearance.finish !== "unspecified"
      || selectedAppearance.descriptors.length
      || selectedAppearance.dimensionality !== neutralAppearance?.dimensionality
    ),
  );

  useEffect(() => {
    if (!value) return;
    implementationDraftsRef.current = rememberProjectVisualSeedDraft(
      implementationDraftsRef.current,
      value,
    );
  }, [value]);

  const emitImplementation = (next: VisualImplementationMedium) => {
    implementationDraftsRef.current = rememberProjectVisualSeedDraft(
      implementationDraftsRef.current,
      next,
    );
    onChange(next);
  };

  const selectMode = (productionMode: VisualProductionMode) => {
    if (value?.productionMode === productionMode) return;
    if (value) {
      implementationDraftsRef.current = rememberProjectVisualSeedDraft(
        implementationDraftsRef.current,
        value,
      );
    }
    emitImplementation(resolveProjectVisualSeedDraft(implementationDraftsRef.current, productionMode));
  };

  const updateAppearance = (appearance: VisualAppearance) => {
    if (!value) return;
    emitImplementation({ ...value, appearance });
  };

  return (
    <fieldset className={cn("space-y-4", className)} disabled={disabled}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <legend className="text-xs font-bold text-text-primary">项目视觉起点</legend>
          <p className="mt-1 text-[11px] leading-5 text-text-muted">这里只确定实现方式和画面目标，完整规范可在项目 Bible 中继续细化。</p>
        </div>
        <button
          type="button"
          aria-pressed={value === null}
          onClick={() => {
            if (value) {
              implementationDraftsRef.current = rememberProjectVisualSeedDraft(
                implementationDraftsRef.current,
                value,
              );
            }
            onChange(null);
          }}
          className={cn(
            "shrink-0 rounded-md border px-2.5 py-1.5 text-[10px] font-bold transition-colors",
            value === null
              ? "border-gold/45 bg-gold/10 text-gold"
              : "border-border-soft/30 text-text-muted hover:border-border-soft/60 hover:text-text-primary",
          )}
        >
          稍后设置
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="影像实现方式">
        {implementationOptions.map(({ id, label, hint, icon: Icon }) => {
          const selected = selectedMode === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              onClick={() => selectMode(id)}
              className={cn(
                "flex min-h-20 flex-col items-start justify-between rounded-lg border p-3 text-left transition-colors",
                selected
                  ? "border-gold/50 bg-gold/10 text-text-primary"
                  : "border-border-soft/25 bg-bg-surface text-text-muted hover:border-border-soft/55 hover:text-text-primary",
              )}
            >
              <Icon className={cn("h-4 w-4", selected && "text-gold")} />
              <span>
                <span className="block text-xs font-bold">{label}</span>
                <span className="mt-0.5 block text-[9px] leading-4 text-text-muted">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {value && selectedMode && (
        <div className="border-t border-border-soft/20 pt-4">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold text-text-muted">
            <Palette className="h-3.5 w-3.5" />
            画面目标
          </div>
          <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="画面目标">
            {currentAppearanceOptions.map((option) => {
              const selected = matchesAppearance(selectedAppearance, option.value);
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => updateAppearance(structuredClone(option.value))}
                  className={cn(
                    "min-h-16 rounded-lg border px-3 py-2 text-left transition-colors",
                    selected
                      ? "border-gold/50 bg-gold/10 text-text-primary"
                      : "border-border-soft/25 bg-bg-surface text-text-muted hover:border-border-soft/55 hover:text-text-primary",
                  )}
                >
                  <span className="block text-xs font-bold">{option.label}</span>
                  <span className="mt-1 block text-[10px] leading-4 text-text-muted">{option.hint}</span>
                </button>
              );
            })}
          </div>
          {!hasAppearanceChoice && (
            <p className="mt-2 text-[10px] leading-4 text-text-muted">画面目标尚未选择。系统不会替你采用第一个预设。</p>
          )}

          <div className="mt-4 border-t border-border-soft/20 pt-3">
            <button
              type="button"
              onClick={() => setIsCustomOpen((current) => !current)}
              aria-expanded={isCustomOpen}
              className="flex w-full items-center justify-between gap-3 text-left text-[10px] font-bold text-text-muted hover:text-text-primary"
            >
              <span>自定义画面目标</span>
              {isCustomOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {isCustomOpen && (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="space-y-1.5 text-[10px] font-bold text-text-muted">
                  <span>真实感</span>
                  <select
                    value={selectedAppearance?.realism || "unspecified"}
                    onChange={(event) => updateAppearance({
                      ...value.appearance,
                      realism: event.target.value as VisualAppearance["realism"],
                    })}
                    className="h-9 w-full rounded-md border border-border-soft/30 bg-bg-surface px-2 text-xs text-text-primary outline-none focus:border-gold/55"
                  >
                    {realismOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5 text-[10px] font-bold text-text-muted">
                  <span>空间维度</span>
                  <select
                    value={selectedAppearance?.dimensionality || neutralAppearance?.dimensionality}
                    onChange={(event) => updateAppearance({
                      ...value.appearance,
                      dimensionality: event.target.value as VisualAppearance["dimensionality"],
                    })}
                    className="h-9 w-full rounded-md border border-border-soft/30 bg-bg-surface px-2 text-xs text-text-primary outline-none focus:border-gold/55"
                  >
                    {dimensionalityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5 text-[10px] font-bold text-text-muted">
                  <span>完成质感</span>
                  <select
                    value={selectedAppearance?.finish || "unspecified"}
                    onChange={(event) => updateAppearance({
                      ...value.appearance,
                      finish: event.target.value as VisualAppearance["finish"],
                    })}
                    className="h-9 w-full rounded-md border border-border-soft/30 bg-bg-surface px-2 text-xs text-text-primary outline-none focus:border-gold/55"
                  >
                    {finishOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1.5 text-[10px] font-bold text-text-muted sm:col-span-3">
                  <span>画面描述</span>
                  <textarea
                    value={(selectedAppearance?.descriptors || []).join("\n")}
                    onChange={(event) => updateAppearance({
                      ...value.appearance,
                      descriptors: descriptorsFromText(event.target.value),
                    })}
                    placeholder="每行一条，只写你明确选择的画面特征"
                    className="min-h-20 w-full resize-y rounded-md border border-border-soft/30 bg-bg-surface px-3 py-2 text-xs leading-5 text-text-primary outline-none placeholder:text-text-dark focus:border-gold/55"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}
