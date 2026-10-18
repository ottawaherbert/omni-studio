import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  Camera,
  Clapperboard,
  ClipboardList,
  Dumbbell,
  Loader2,
  Lightbulb,
  MapPin,
  PackageOpen,
  Palette,
  Plus,
  RefreshCw,
  Shirt,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Badge } from "../ui/Badge";
import { cn } from "../../lib/utils";
import { createCreativeChange as postCreativeChange } from "../../clients/operatorClient";
import type { Asset, Character, Episode, Project, Scene, Shot } from "../../clients/domainTypes";
import type {
  ProductionCockpitFinding,
  ProductionCockpitSnapshot,
} from "../../hooks/useProductionCockpit";
import type { ManualFilmTeamReadModel } from "../../clients/productionPreparationWorkflowClient";

type DepartmentBoardId =
  | "directing"
  | "cinematography"
  | "lighting"
  | "production_design"
  | "wardrobe"
  | "makeup_hair"
  | "performance_directing"
  | "action_choreography"
  | "props"
  | "continuity";
type CreativeChangeKind = "new_asset" | "asset_variant" | "scene_change" | "shot_change" | "prompt_change";
type CreativeChangeDepartment =
  | "directing"
  | "writing"
  | "cinematography"
  | "lighting"
  | "production_design"
  | "wardrobe"
  | "makeup_hair"
  | "performance_directing"
  | "action_choreography"
  | "props"
  | "wardrobe_makeup"
  | "location_art"
  | "continuity"
  | "production";
type VariantKind = "wardrobe" | "makeup_hair" | "prop_state" | "location_state" | "injury_state" | "performance_state" | "other";

interface DepartmentBoardsPanelProps {
  project: Project;
  episode: Episode;
  scene: Scene;
  activeShot: Shot | null;
  cockpit: ProductionCockpitSnapshot | null;
  manualReadModel?: ManualFilmTeamReadModel | null;
  onRefresh: () => void;
}

interface DepartmentBoardCoverage {
  department: string;
  required: boolean;
  readiness: string;
  readyPackageCount: number;
  needsReviewPackageCount: number;
  blockedPackageCount: number;
  sceneIds: string[];
  shotIds: string[];
  hasSpecialistPayload: boolean;
  missingSpecialistPayload: boolean;
  reason?: string;
}

interface DepartmentBoardPrepPackage {
  id: string;
  department: string;
  ownerAgentId: string;
  readiness: string;
  requiredAssetCount: number;
  variantCount: number;
  continuityCount: number;
  openQuestionCount: number;
  sampleAssets: Array<{ name: string; type: string }>;
}

interface DepartmentBoardQaSummary {
  severity?: string;
  resolutionClass?: string;
  messages?: string[];
}

interface DepartmentBoardItem {
  id: string;
  title: string;
  subtitle: string;
  meta: string[];
  assetId?: string;
  assetType?: Asset["type"] | "character";
  empty?: boolean;
}

const departments: Array<{
  id: DepartmentBoardId;
  label: string;
  shortLabel: string;
  icon: typeof Shirt;
  prepDepartments: string[];
  mappedFindingDepartments: string[];
}> = [
  { id: "directing", label: "导演组", shortLabel: "导演", icon: Clapperboard, prepDepartments: ["directing"], mappedFindingDepartments: ["creative_commercial", "directing"] },
  { id: "cinematography", label: "摄影组", shortLabel: "摄影", icon: Camera, prepDepartments: ["cinematography"], mappedFindingDepartments: ["storyboard_video_unit", "cinematography"] },
  { id: "lighting", label: "灯光组", shortLabel: "灯光", icon: Lightbulb, prepDepartments: ["lighting"], mappedFindingDepartments: ["storyboard_video_unit", "lighting"] },
  { id: "production_design", label: "美术/置景", shortLabel: "美术", icon: Palette, prepDepartments: ["production_design", "location_art"], mappedFindingDepartments: ["asset", "production_design", "location_art"] },
  { id: "wardrobe", label: "服装组", shortLabel: "服装", icon: Shirt, prepDepartments: ["wardrobe", "wardrobe_makeup"], mappedFindingDepartments: ["asset", "wardrobe", "wardrobe_makeup"] },
  { id: "makeup_hair", label: "化妆组", shortLabel: "化妆", icon: Sparkles, prepDepartments: ["makeup_hair", "wardrobe_makeup"], mappedFindingDepartments: ["asset", "makeup_hair", "wardrobe_makeup"] },
  { id: "performance_directing", label: "演员/表演", shortLabel: "表演", icon: UserRound, prepDepartments: ["performance_directing", "casting"], mappedFindingDepartments: ["creative_commercial", "performance_directing", "casting"] },
  { id: "action_choreography", label: "动作组", shortLabel: "动作", icon: Dumbbell, prepDepartments: ["action_choreography", "extras_stunts"], mappedFindingDepartments: ["storyboard_video_unit", "action_choreography", "extras_stunts"] },
  { id: "props", label: "道具组", shortLabel: "道具", icon: PackageOpen, prepDepartments: ["props"], mappedFindingDepartments: ["asset", "props"] },
  { id: "continuity", label: "连续性/场记", shortLabel: "场记", icon: ClipboardList, prepDepartments: ["continuity"], mappedFindingDepartments: ["continuity"] },
];

const uniq = (items: Array<string | undefined | null>) =>
  Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));

const isObjectLocation = (value: unknown): value is { name?: string; state?: string } =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const rawListLabel = (items: unknown[] | undefined, fallback = "未登记") => {
  const labels = (items || []).map((item) => {
    if (typeof item === "string") return item;
    if (isObjectLocation(item)) return [item.name, item.state].filter(Boolean).join(" / ");
    return "";
  }).filter(Boolean);
  return labels.length ? labels.join(" / ") : fallback;
};

const findingMatchesDepartment = (finding: ProductionCockpitFinding, departmentId: DepartmentBoardId) => {
  const findingDepartment = String(finding.department || "").toLowerCase();
  const text = `${findingDepartment} ${finding.target || ""} ${finding.message || ""}`.toLowerCase();
  const department = departments.find((item) => item.id === departmentId);
  if (!department) return false;
  if (department.prepDepartments.includes(findingDepartment)) return true;
  if (department.mappedFindingDepartments.includes(findingDepartment)) {
    if (departmentId === "props") return /prop|道具|asset/.test(text);
    if (departmentId === "production_design") return /location|scene|set|场景|置景|地点|asset|production_design|location_art/.test(text);
    if (departmentId === "wardrobe") return /wardrobe|costume|服装|角色|asset/.test(text);
    if (departmentId === "makeup_hair") return /makeup|hair|妆|发|伤妆|asset/.test(text);
    if (departmentId === "cinematography") return /camera|lens|coverage|axis|摄影|镜头|机位/.test(text);
    if (departmentId === "lighting") return /lighting|light|灯光|光源/.test(text);
    if (departmentId === "performance_directing") return /performance|acting|表演|演员|情绪/.test(text);
    if (departmentId === "action_choreography") return /action|stunt|combat|chase|动作|打斗|追逐/.test(text);
    return true;
  }
  return false;
};

const severityTone = (finding: ProductionCockpitFinding) => {
  if (finding.resolutionClass === "hard_blocking" || finding.severity === "blocking" || finding.severity === "error") return "danger";
  if (finding.resolutionClass === "auto_repairable") return "warning";
  if (finding.resolutionClass === "soft_hold" || finding.severity === "warning") return "info";
  return "secondary";
};

const readinessTone = (readiness?: string) => {
  if (readiness === "ready_for_department_review" || readiness === "ready") return "success";
  if (readiness === "needs_review") return "warning";
  if (readiness === "blocked" || readiness === "missing") return "danger";
  return "secondary";
};

const readinessLabel = (readiness?: string) => ({
  ready: "已确认",
  ready_for_department_review: "待部门确认",
  needs_review: "待复核",
  blocked: "有阻断",
  missing: "待筹备",
  not_started: "未开始",
}[readiness || ""] || "不需要");

const findingLabel = (finding?: DepartmentBoardQaSummary) => {
  const value = finding?.resolutionClass || finding?.severity;
  if (value === "hard_blocking" || value === "blocking" || value === "error") return "需要处理";
  if (value === "auto_repairable") return "可局部修复";
  if (value === "soft_hold" || value === "warning") return "建议复核";
  return "无问题";
};

const assetTypeLabel = (type?: DepartmentBoardItem["assetType"]) => ({
  character: "角色",
  location: "场景",
  prop: "道具",
}[type || ""] || "说明");

export function DepartmentBoardsPanel({
  project,
  episode,
  scene,
  activeShot,
  cockpit,
  manualReadModel,
  onRefresh,
}: DepartmentBoardsPanelProps) {
  const [activeDepartmentId, setActiveDepartmentId] = useState<DepartmentBoardId>("directing");
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);

  const assetById = useMemo(() => new Map((project.assets || []).map((asset) => [asset.id, asset])), [project.assets]);
  const characterById = useMemo(() => new Map((project.characters || []).map((character) => [character.id, character])), [project.characters]);
  const allFindings = useMemo<ProductionCockpitFinding[]>(() => {
    if (manualReadModel) {
      return manualReadModel.findings.map((finding) => ({
        id: finding.id,
        department: finding.canonicalDepartment,
        severity: finding.severity,
        resolutionClass: finding.resolutionClass,
        message: finding.message,
        repairInstruction: finding.repairInstruction,
      }));
    }
    return [
      ...(cockpit?.hardBlocks || []),
      ...(cockpit?.autoRepairableFindings || []),
      ...(cockpit?.softHolds || []),
      ...(cockpit?.advisoryFindings || []),
    ];
  }, [cockpit, manualReadModel]);

  const prepPackages = useMemo<DepartmentBoardPrepPackage[]>(() => {
    if (manualReadModel) {
      return manualReadModel.departmentPrepPackages.map((prepPackage) => ({
        id: prepPackage.id,
        department: prepPackage.department,
        ownerAgentId: prepPackage.ownerAgentId,
        readiness: prepPackage.readiness,
        requiredAssetCount: prepPackage.requiredAssets.length,
        variantCount: prepPackage.variants.length,
        continuityCount: prepPackage.continuityInOut.length,
        openQuestionCount: prepPackage.openQuestions.length,
        sampleAssets: prepPackage.requiredAssets.slice(0, 8).map((asset) => ({
          name: asset.name,
          type: asset.type,
        })),
      }));
    }
    return (cockpit?.productionPrep?.departmentPrepPackages || []).map((prepPackage) => ({
      id: prepPackage.id || `${prepPackage.department || "department"}-prep`,
      department: prepPackage.department || "production",
      ownerAgentId: prepPackage.ownerAgentId || "production",
      readiness: prepPackage.readiness || "needs_review",
      requiredAssetCount: prepPackage.requiredAssetCount || 0,
      variantCount: prepPackage.variantCount || 0,
      continuityCount: prepPackage.continuityCount || 0,
      openQuestionCount: prepPackage.openQuestionCount || 0,
      sampleAssets: (prepPackage.sampleAssets || []).map((asset) => ({
        name: asset.name || asset.assetId || "未命名资产",
        type: asset.type || "asset",
      })),
    }));
  }, [cockpit?.productionPrep?.departmentPrepPackages, manualReadModel]);

  const coverageRows = useMemo<DepartmentBoardCoverage[]>(() => {
    if (manualReadModel) {
      return manualReadModel.coverage.map((coverage) => {
        const prepPackage = manualReadModel.departmentPrepPackages.find(
          (item) => item.department === coverage.canonicalDepartment,
        );
        const hasSpecialistPayload = Boolean(prepPackage?.specialistPayload?.manualOutput);
        return {
          department: coverage.canonicalDepartment,
          required: true,
          readiness: coverage.readiness,
          readyPackageCount: coverage.readiness === "ready" ? 1 : 0,
          needsReviewPackageCount: coverage.readiness === "needs_review" ? 1 : 0,
          blockedPackageCount: coverage.readiness === "blocked" ? 1 : 0,
          sceneIds: prepPackage?.sceneRefs || prepPackage?.sceneIds || [],
          shotIds: prepPackage?.shotRefs || [],
          hasSpecialistPayload,
          missingSpecialistPayload: !hasSpecialistPayload,
          reason: coverage.reasons.join(" / "),
        };
      });
    }
    return (cockpit?.departmentCoverage?.departments || []) as DepartmentBoardCoverage[];
  }, [cockpit?.departmentCoverage?.departments, manualReadModel]);

  const departmentFindings = useMemo(() => {
    const grouped = Object.fromEntries(departments.map((department) => [department.id, []])) as Record<DepartmentBoardId, ProductionCockpitFinding[]>;
    for (const finding of allFindings) {
      for (const department of departments) {
        if (findingMatchesDepartment(finding, department.id)) {
          grouped[department.id].push(finding);
        }
      }
    }
    return grouped;
  }, [allFindings]);

  const boards = useMemo<Record<DepartmentBoardId, DepartmentBoardItem[]>>(() => {
    const characterIds = uniq([
      ...(scene.breakdown?.characterIds || []),
      ...(activeShot?.characterIdsInShot || []),
    ]);
    const propIds = uniq([
      ...(scene.breakdown?.propIds || []),
      ...(activeShot?.propIds || []),
    ]);
    const locationId = activeShot?.locationId || scene.breakdown?.locationId;

    const characterItems = characterIds.map((id) => {
      const character = characterById.get(id) as Character | undefined;
      const variantId = scene.breakdown?.assetVariantMap?.[id];
      return {
        id,
        title: character?.name || id,
        subtitle: rawListLabel([...(scene.breakdown?.wardrobe || []), ...(scene.breakdown?.makeupHair || [])], "未记录服装/妆发状态"),
        meta: [
          `variants ${character?.variants?.length || 0}`,
          variantId ? `当前变体 ${variantId}` : "未绑定变体",
          activeShot?.characterIdsInShot?.includes(id) ? "当前镜头出现" : "本场关联",
        ],
        assetId: id,
        assetType: "character" as const,
      };
    });

    const wardrobeItems = characterItems.map((item) => ({
      ...item,
      subtitle: rawListLabel(scene.breakdown?.wardrobe, "未记录服装状态"),
      meta: item.meta.map((meta) => meta.includes("变体") ? meta : meta),
    }));

    const makeupItems = characterItems.map((item) => ({
      ...item,
      subtitle: rawListLabel(scene.breakdown?.makeupHair, "未记录化妆/发型/伤妆状态"),
    }));

    const propItems = propIds.map((id) => {
      const asset = assetById.get(id);
      const variantId = scene.breakdown?.assetVariantMap?.[id];
      return {
        id,
        title: asset?.name || id,
        subtitle: asset?.description || rawListLabel(scene.breakdown?.props, "未记录道具状态"),
        meta: [
          asset?.type || "prop",
          variantId ? `当前变体 ${variantId}` : "未绑定状态变体",
          activeShot?.propIds?.includes(id) ? "当前镜头出现" : "本场关联",
        ],
        assetId: id,
        assetType: asset?.type || "prop",
      };
    });

    const locationAsset = locationId ? assetById.get(locationId) : undefined;
    const locationItems: DepartmentBoardItem[] = locationId ? [{
      id: locationId,
      title: locationAsset?.name || String(isObjectLocation(scene.breakdown?.location) ? scene.breakdown.location.name : scene.breakdown?.location || locationId),
      subtitle: [
        scene.environment || scene.breakdown?.setting,
        scene.timeOfDay || scene.breakdown?.time,
        isObjectLocation(scene.breakdown?.location) ? scene.breakdown.location.state : undefined,
      ].filter(Boolean).join(" / ") || locationAsset?.description || "未记录置景状态",
      meta: [
        locationAsset?.variants?.length ? `variants ${locationAsset.variants.length}` : "无变体",
        scene.sceneNumber ? `场号 ${scene.sceneNumber}` : "未编号",
        `${scene.shots?.length || 0} 镜头`,
      ],
      assetId: locationId,
      assetType: "location",
    }] : [];

    const continuityItems: DepartmentBoardItem[] = [
      {
        id: activeShot?.id || scene.id,
        title: activeShot ? `当前镜头 ${activeShot.id}` : scene.title,
        subtitle: activeShot?.continuityNote || scene.description || "未记录连续性备注",
        meta: [
          activeShot?.duration ? `${activeShot.duration}s` : "时长未填",
          scene.timeOfDay || scene.breakdown?.time || "时段未填",
          activeShot?.transition ? `转场 ${activeShot.transition}` : "转场未填",
        ],
        assetId: activeShot?.id || scene.id,
      },
    ];

    const shotItems = (scene.shots || []).length ? (scene.shots || []).map((shot, index) => ({
      id: shot.id || `shot-${index + 1}`,
      title: shot.id ? `镜头 ${shot.id}` : `镜头 ${index + 1}`,
      subtitle: [
        shot.shotSize,
        shot.cameraAngle,
        shot.cameraMovement,
        shot.focalLength,
        shot.composition,
      ].filter(Boolean).join(" / ") || shot.visualAction || "未记录镜头摄影参数",
      meta: [
        shot.duration ? `${shot.duration}s` : "时长未填",
        shot.continuityNote ? "有轴线/连续性备注" : "连续性备注弱",
        shot.locationId || scene.breakdown?.locationId || "地点未绑定",
      ],
      assetId: shot.id,
    })) : [emptyItem("cinematography", "当前场暂无镜头摄影清单")];

    const lightingItems = (scene.shots || []).length ? (scene.shots || []).map((shot, index) => ({
      id: shot.id || `lighting-${index + 1}`,
      title: shot.id ? `灯光 ${shot.id}` : `灯光 ${index + 1}`,
      subtitle: [shot.lighting, shot.lightingAtmo, scene.timeOfDay || scene.breakdown?.time].filter(Boolean).join(" / ") || "未记录灯光方案、光源逻辑或时段",
      meta: [
        scene.breakdown?.time || scene.timeOfDay || "时段未填",
        shot.locationId || scene.breakdown?.locationId || "地点未绑定",
        (scene.breakdown?.vfx || []).length ? `VFX ${scene.breakdown?.vfx?.length}` : "无 VFX 光效",
      ],
      assetId: shot.id,
    })) : [emptyItem("lighting", "当前场暂无灯光清单")];

    const performanceItems = characterIds.length ? characterIds.map((id) => {
      const character = characterById.get(id) as Character | undefined;
      const relatedShots = (scene.shots || []).filter((shot) => shot.characterIdsInShot?.includes(id));
      return {
        id,
        title: character?.name || id,
        subtitle: uniq(relatedShots.flatMap((shot) => [shot.microExpression, shot.motivation, shot.visualAction])).slice(0, 4).join(" / ") || scene.sceneGoal || "未记录表演节拍",
        meta: [
          `${relatedShots.length} 镜头出现`,
          scene.scriptBlocks?.some((block) => block.type === "dialogue") ? "含对白" : "无对白块",
          character?.actingStyle || "表演风格未填",
          [character?.mbti, character?.enneagram].filter(Boolean).join(" / ") || "行为模型未填",
        ],
        assetId: id,
        assetType: "character" as const,
      };
    }) : [emptyItem("performance_directing", "当前场暂无表演角色清单")];

    const actionShots = (scene.shots || []).filter((shot) =>
      /战|打|追|摔|跌|跑|爆|火|危险|搏|杀|逃|跳|撞|fight|chase|stunt|combat|fall|run|explosion/i.test([
        shot.visualAction,
        shot.blocking,
        shot.cameraMovement,
        shot.motivation,
      ].filter(Boolean).join(" ")),
    );
    const actionItems = actionShots.length ? actionShots.map((shot) => ({
      id: shot.id,
      title: `动作镜头 ${shot.id}`,
      subtitle: [shot.visualAction, shot.blocking, shot.motivation].filter(Boolean).join(" / ") || "动作链未记录",
      meta: [
        shot.propIds?.length ? `道具 ${shot.propIds.length}` : "无道具",
        shot.continuityNote ? "有动作连续性备注" : "动作连续性备注弱",
        shot.duration ? `${shot.duration}s` : "时长未填",
      ],
      assetId: shot.id,
    })) : [emptyItem("action_choreography", "当前场暂无动作/特技风险镜头")];

    const directingItems: DepartmentBoardItem[] = [{
      id: scene.id,
      title: scene.title || "未命名场景",
      subtitle: scene.sceneGoal || scene.description || scene.hook || "未记录导演意图",
      meta: [
        scene.valueCharge ? `价值 ${scene.valueCharge}` : "价值变化未填",
        `${scene.scriptBlocks?.length || 0} script blocks`,
        `${scene.shots?.length || 0} shots`,
      ],
      assetId: scene.id,
    }];

    return {
      directing: directingItems,
      cinematography: shotItems,
      lighting: lightingItems,
      production_design: locationItems.length ? locationItems : [emptyItem("production_design", "本场暂无美术/置景资产绑定")],
      wardrobe: wardrobeItems.length ? wardrobeItems : [emptyItem("wardrobe", "本场/本镜头暂无角色服装清单")],
      makeup_hair: makeupItems.length ? makeupItems : [emptyItem("makeup_hair", "本场/本镜头暂无化妆/发型清单")],
      performance_directing: performanceItems,
      action_choreography: actionItems,
      props: propItems.length ? propItems : [emptyItem("props", "本场/本镜头暂无道具清单，可创建临时道具回流")],
      continuity: continuityItems,
    };
  }, [activeShot, assetById, characterById, scene]);

  const activeDepartment = departments.find((department) => department.id === activeDepartmentId) || departments[0];
  const ActiveIcon = activeDepartment.icon;
  const activeItems = boards[activeDepartment.id];
  const activeFindings = departmentFindings[activeDepartment.id] || [];
  const activeCoverageItem = useMemo(() => {
    return coverageRows.find((row) => activeDepartment.prepDepartments.includes(String(row.department || "")));
  }, [activeDepartment.prepDepartments, coverageRows]);
  const activeQaSummary = useMemo<DepartmentBoardQaSummary | undefined>(() => {
    if (manualReadModel) {
      const findings = departmentFindings[activeDepartment.id] || [];
      if (!findings.length) return undefined;
      return {
        severity: findings.some((finding) => finding.severity === "blocking") ? "blocking" : "warning",
        resolutionClass: findings.some((finding) => finding.resolutionClass === "hard_blocking")
          ? "hard_blocking"
          : "soft_hold",
        messages: findings.map((finding) => finding.message || "").filter(Boolean),
      };
    }
    const summaries = cockpit?.departmentQaSummary || [];
    return summaries.find((summary) => activeDepartment.prepDepartments.includes(String(summary.department || "")));
  }, [activeDepartment.id, activeDepartment.prepDepartments, cockpit?.departmentQaSummary, departmentFindings, manualReadModel]);
  const activePrepPackages = useMemo(() => {
    return prepPackages.filter((prepPackage) => activeDepartment.prepDepartments.includes(String(prepPackage.department || "")));
  }, [activeDepartment.prepDepartments, prepPackages]);

  const createDepartmentChange = async ({
    actionId,
    kind,
    department,
    title,
    description,
    creativePurpose,
    proposedAsset,
    variantRequest,
    assetIds = [],
  }: {
    actionId: string;
    kind: CreativeChangeKind;
    department: CreativeChangeDepartment;
    title: string;
    description: string;
    creativePurpose: string;
    proposedAsset?: Partial<Pick<Asset, "type" | "name" | "description">> & { assetType?: Asset["type"] };
    variantRequest?: {
      assetId: string;
      variantKind: VariantKind;
      name: string;
      description: string;
    };
    assetIds?: string[];
  }) => {
    setSubmittingAction(actionId);
    try {
      await postCreativeChange(project.id, {
        provider: "codex",
        userRequest: `Department board change: ${title}`,
        title,
        description,
        creativePurpose,
        kind,
        department,
        episodeIds: [episode.id],
        sceneIds: [scene.id],
        shotIds: activeShot?.id ? [activeShot.id] : [],
        assetIds,
        proposedAsset,
        variantRequests: variantRequest ? [variantRequest] : undefined,
        source: {
          stageType: "storyboard",
          requestedBy: "operator",
          page: `storyboard.department.${activeDepartmentId}`,
          note: `${episode.title} / ${scene.title}${activeShot ? ` / ${activeShot.id}` : ""}`,
        },
        autoQa: true,
      });
      toast.success("部门变更单已创建");
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "部门变更单创建失败");
    } finally {
      setSubmittingAction(null);
    }
  };

  const handlePrimaryAction = (item: DepartmentBoardItem) => {
    if ((activeDepartmentId === "wardrobe" || activeDepartmentId === "makeup_hair") && item.assetId && !item.empty) {
      createDepartmentChange({
        actionId: `variant:${activeDepartmentId}:${item.id}`,
        kind: "asset_variant",
        department: activeDepartmentId,
        title: `${item.title} ${activeDepartmentId === "wardrobe" ? "服装" : "化妆/发型"}状态变体`,
        description: `为 ${scene.title} / ${activeShot?.id || "当前场"} 创建${activeDepartmentId === "wardrobe" ? "服装" : "化妆、发型或伤妆"}状态变体。`,
        creativePurpose: "保证角色在当前场景和镜头中的服化妆连续性，并让后续参考包可追踪该状态。",
        variantRequest: {
          assetId: item.assetId,
          variantKind: activeDepartmentId === "wardrobe" ? "wardrobe" : "makeup_hair",
          name: `${item.title} 当前场${activeDepartmentId === "wardrobe" ? "服装" : "化妆"}状态`,
          description: item.subtitle,
        },
        assetIds: [item.assetId],
      });
      return;
    }
    if (activeDepartmentId === "props" && item.assetId && !item.empty) {
      createDepartmentChange({
        actionId: `variant:${activeDepartmentId}:${item.id}`,
        kind: "asset_variant",
        department: "props",
        title: `${item.title} 道具状态变体`,
        description: `为 ${scene.title} / ${activeShot?.id || "当前场"} 创建道具使用、破损、归属或连续性状态。`,
        creativePurpose: "保证道具状态进入 scene visual pack、asset reference pack 和 video unit 链路。",
        variantRequest: {
          assetId: item.assetId,
          variantKind: "prop_state",
          name: `${item.title} 当前镜头道具状态`,
          description: item.subtitle,
        },
        assetIds: [item.assetId],
      });
      return;
    }
    if (activeDepartmentId === "props") {
      createDepartmentChange({
        actionId: "pending:props",
        kind: "new_asset",
        department: "props",
        title: `${scene.title} 临时道具回流`,
        description: "本场/本镜头需要新增临时道具，请进入 pending asset 和局部 asset_sync。",
        creativePurpose: "允许分镜阶段的道具灵感合法倒流，不直接污染 canonical assets。",
        proposedAsset: {
          assetType: "prop",
          name: `${scene.title} 临时道具`,
          description: "由道具部门面板创建，等待转正、合并、废弃或豁免。",
        },
      });
      return;
    }
    if (activeDepartmentId === "production_design" && item.assetId && !item.empty) {
      createDepartmentChange({
        actionId: `variant:${activeDepartmentId}:${item.id}`,
        kind: "asset_variant",
        department: "production_design",
        title: `${item.title} 美术/置景状态`,
        description: `为 ${scene.title} 创建时段、损毁、天气、灯光或置景状态变体。`,
        creativePurpose: "保证场景视觉包复用和置景连续性可追踪。",
        variantRequest: {
          assetId: item.assetId,
          variantKind: "location_state",
          name: `${item.title} 当前场置景状态`,
          description: item.subtitle,
        },
        assetIds: [item.assetId],
      });
      return;
    }
    if (activeDepartmentId !== "continuity") {
      createDepartmentChange({
        actionId: `review:${activeDepartmentId}:${item.id}`,
        kind: activeShot ? "shot_change" : "scene_change",
        department: activeDepartmentId,
        title: `${activeDepartment.label}复检：${item.title}`,
        description: item.subtitle || `${scene.title} 需要${activeDepartment.label}复核。`,
        creativePurpose: `把${activeDepartment.label}意见转成可追踪的创作回流和局部复检，避免直接改写正式资产或提示词。`,
        assetIds: item.assetId ? [item.assetId] : [],
      });
      return;
    }
    createDepartmentChange({
      actionId: `continuity:${item.id}`,
      kind: activeShot ? "shot_change" : "scene_change",
      department: "continuity",
      title: `${scene.title} 连续性复检`,
      description: activeShot?.continuityNote || "请求场记复核人物、道具、场景、轴线、首尾状态和转场连续性。",
      creativePurpose: "把连续性疑点转成可追踪的创作回流和局部复检，而不是隐藏在备注里。",
    });
  };

  return (
    <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" size="sm">历史制作参考</Badge>
            <Badge variant="secondary" size="sm">{episode.title}</Badge>
          </div>
          <p className="mt-2 line-clamp-2 text-xs font-medium text-gray-500 dark:text-neutral-400">
            {manualReadModel
              ? "已有制作方案仅作历史参考；当前分镜以原文、已采用资产和镜头承接为依据。"
              : "已有制作方案仅作历史参考；当前分镜以原文、已采用资产和镜头承接为依据。"}
          </p>
        </div>
        {manualReadModel ? (
          <Badge variant="success" size="sm">当前场景已同步</Badge>
        ) : (
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 text-[10px] font-black uppercase tracking-widest text-gray-600 transition-colors hover:bg-white dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[240px_1fr_0.9fr]">
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-1">
          {departments.map((department) => {
            const Icon = department.icon;
            const findings = departmentFindings[department.id] || [];
            const prepCount = prepPackages.filter((prepPackage) =>
              department.prepDepartments.includes(String(prepPackage.department || "")),
            ).length;
            const coverage = coverageRows.find((row) =>
              department.prepDepartments.includes(String(row.department || "")),
            );
            return (
              <button
                key={department.id}
                type="button"
                onClick={() => setActiveDepartmentId(department.id)}
                className={cn(
                  "flex min-h-16 items-center gap-3 rounded-2xl border p-3 text-left transition-colors",
                  activeDepartmentId === department.id
                    ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/20 dark:text-violet-300"
                    : "border-gray-100 bg-gray-50 text-gray-500 hover:bg-white dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-900",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black">{department.label}</p>
                  <p className="mt-1 text-[10px] font-bold opacity-70">
                    {prepCount} 份筹备 · {findings.length} 项问题 · {readinessLabel(coverage?.readiness)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <ActiveIcon className="h-4 w-4 text-violet-500" />
              <h3 className="truncate text-xs font-black tracking-widest text-gray-900 dark:text-white">{activeDepartment.label}</h3>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge variant={activeCoverageItem?.required ? "info" : "secondary"} size="sm">{activeCoverageItem?.required ? "本场必需" : "按需"}</Badge>
              <Badge variant={readinessTone(activeCoverageItem?.readiness)} size="sm">{readinessLabel(activeCoverageItem?.readiness)}</Badge>
              <Badge variant="outline" size="sm">{activeItems.length} 项</Badge>
            </div>
          </div>
          {(activeCoverageItem || activeQaSummary) && (
            <div className="mb-3 rounded-2xl bg-white p-3 dark:bg-neutral-900">
              <div className="grid gap-2 text-[10px] text-gray-500 dark:text-neutral-400 md:grid-cols-4">
                <div>
                  <p className="font-black tracking-widest text-gray-400">筹备状态</p>
                  <p className="mt-1 text-gray-800 dark:text-neutral-100">
                    已确认 {(activeCoverageItem?.readyPackageCount || 0)} · 待复核 {(activeCoverageItem?.needsReviewPackageCount || 0)} · 阻断 {(activeCoverageItem?.blockedPackageCount || 0)}
                  </p>
                </div>
                <div>
                  <p className="font-black tracking-widest text-gray-400">覆盖范围</p>
                  <p className="mt-1 text-gray-800 dark:text-neutral-100">
                    {(activeCoverageItem?.sceneIds || []).length} 场 · {(activeCoverageItem?.shotIds || []).length} 个镜头
                  </p>
                </div>
                <div>
                  <p className="font-black tracking-widest text-gray-400">筹备内容</p>
                  <p className="mt-1 text-gray-800 dark:text-neutral-100">
                    {activeCoverageItem?.hasSpecialistPayload ? "已提交" : activeCoverageItem?.missingSpecialistPayload ? "尚未提交" : "本场不需要"}
                  </p>
                </div>
                <div>
                  <p className="font-black tracking-widest text-gray-400">核对结果</p>
                  <p className="mt-1 text-gray-800 dark:text-neutral-100">
                    {findingLabel(activeQaSummary)}
                  </p>
                </div>
              </div>
              {(activeQaSummary?.messages || activeCoverageItem?.reason) && (
                <p className="mt-2 line-clamp-2 text-[10px] text-gray-500 dark:text-neutral-400">
                  {(activeQaSummary?.messages || [activeCoverageItem?.reason]).filter(Boolean).join(" / ")}
                </p>
              )}
            </div>
          )}
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            {activePrepPackages.slice(0, 4).map((prepPackage) => (
              <div key={prepPackage.id || prepPackage.department} className="rounded-2xl bg-white p-3 dark:bg-neutral-900">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-black text-gray-800 dark:text-neutral-100">{activeDepartment.label}筹备单</p>
                  <Badge variant={readinessTone(prepPackage.readiness)} size="sm">{readinessLabel(prepPackage.readiness)}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-gray-400">
                  <span>资产 {prepPackage.requiredAssetCount || 0}</span>
                  <span>状态变体 {prepPackage.variantCount || 0}</span>
                  <span>连续性 {prepPackage.continuityCount || 0}</span>
                  <span>待确认 {prepPackage.openQuestionCount || 0}</span>
                </div>
                {(prepPackage.sampleAssets || []).length > 0 && (
                  <p className="mt-2 line-clamp-2 text-[10px] text-gray-500 dark:text-neutral-400">
                    {(prepPackage.sampleAssets || []).map((asset) => asset.name || asset.type).filter(Boolean).join(" / ")}
                  </p>
                )}
              </div>
            ))}
            {!activePrepPackages.length && (
              <div className="rounded-2xl bg-white p-3 text-[10px] text-gray-400 dark:bg-neutral-900 md:col-span-2">
                没有历史方案，可直接依据本场原文和既有资产制作分镜。
              </div>
            )}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {activeItems.map((item) => (
              <div key={item.id} className="rounded-2xl bg-white p-3 dark:bg-neutral-900">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-black text-gray-900 dark:text-white">{item.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-neutral-400">{item.subtitle}</p>
                  </div>
                  <Badge variant={item.empty ? "secondary" : "info"} size="sm">{assetTypeLabel(item.assetType)}</Badge>
                </div>
                <div className="mt-3 flex max-h-14 flex-wrap gap-1.5 overflow-y-auto">
                  {item.meta.map((meta) => (
                    <span key={meta} className="rounded-lg bg-gray-50 px-2 py-1 text-[10px] font-bold text-gray-500 dark:bg-neutral-950 dark:text-neutral-400">
                      {meta}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => handlePrimaryAction(item)}
                  disabled={Boolean(submittingAction)}
                  className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-3 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                >
                  {submittingAction?.endsWith(item.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {actionLabel(activeDepartmentId, item.empty)}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-black tracking-widest text-gray-900 dark:text-white">待处理事项</h3>
            <Badge variant={activeFindings.length ? "warning" : "success"} size="sm">
              {activeFindings.length ? `${activeFindings.length} 待看` : "清爽"}
            </Badge>
          </div>
          <div className="space-y-2">
            {activeFindings.slice(0, 5).map((finding) => (
              <div key={finding.id || finding.message} className="rounded-2xl bg-white p-3 dark:bg-neutral-900">
                <div className="flex items-center justify-between gap-2">
                  <p className="line-clamp-1 text-xs font-black text-gray-800 dark:text-neutral-100">{findingLabel(finding)}</p>
                  <Badge variant={severityTone(finding)} size="sm">{finding.department || "QA"}</Badge>
                </div>
                <p className="mt-1 line-clamp-3 text-[10px] text-gray-500 dark:text-neutral-400">{finding.message || finding.target || "无说明"}</p>
                {finding.repairInstruction && (
                  <p className="mt-2 line-clamp-2 rounded-xl bg-gray-50 p-2 text-[10px] text-gray-500 dark:bg-neutral-950 dark:text-neutral-400">
                    {finding.repairInstruction}
                  </p>
                )}
              </div>
            ))}
            {!activeFindings.length && (
              <div className="rounded-2xl bg-white p-4 text-xs text-gray-400 dark:bg-neutral-900">
                {manualReadModel
                  ? "当前部门没有待处理的筹备或质检问题。"
                  : "当前部门没有来自 cockpit 的 hard block、auto repair 或 soft hold。"}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function emptyItem(id: DepartmentBoardId, title: string): DepartmentBoardItem {
  return {
    id: `empty-${id}`,
    title,
    subtitle: "可以从当前部门面板创建回流单，让系统生成 pending asset、variant request 或局部复检。",
    meta: ["暂无绑定项"],
    empty: true,
  };
}

function actionLabel(departmentId: DepartmentBoardId, empty?: boolean) {
  if (departmentId === "directing") return "创建导演复检";
  if (departmentId === "cinematography") return "创建摄影复检";
  if (departmentId === "lighting") return "创建灯光复检";
  if (departmentId === "performance_directing") return "创建表演复检";
  if (departmentId === "action_choreography") return "创建动作复检";
  if (departmentId === "wardrobe") return "申请服装变体";
  if (departmentId === "makeup_hair") return "申请化妆变体";
  if (departmentId === "props") return empty ? "新增临时道具" : "申请道具状态";
  if (departmentId === "production_design") return "申请美术状态";
  return "创建连续性复检";
}
