# 内置助手退出后的独立审查

审查日期：2026-10-24。审查提交：`5583a7d7`，对照提交：`3c1366d0`。

初审结论（修复前）：**尚不能认定完成无回归验收。** 三位子 agent 分别检查写作、制片/生成、互动；主 agent 对高影响发现做独立复现和浏览器验证。确认 7 项功能回归、1 项验收工具回归，另记录 1 项既有规则与新说明冲突。没有修改产品实现，没有调用真实模型或修改正式作品。本报告是待修清单，不是修复完成记录。

## 修复与复验结果（2026-10-24）

本报告以下反例保留为历史证据。当前 **R1–R8 与 C1 均已修复并通过针对性复验**；三位 `gpt-6.1-sol`（high）分别独立测试写作、模板/验收服务、制片/互动，主 agent 负责实现与最终浏览器验收。没有恢复内置聊天助手或自主执行层。

| 项目 | 修复与实际证据 |
| --- | --- |
| R1 | 服务端冻结大纲所有者、原文范围及节拍 ID；保留范围外原文、所属单元和场景关联。四种所有者回填/采用、越范围、旧基线与未授权节拍修改均有仓库/HTTP 回归；浏览器采用后仍为“开头应保留。目标变化已改。结尾应保留。” |
| R2 / R3 | 返回合同按 ScriptOperation 穷尽检查；目标季/故事原文进入上下文，错误所有者拒绝。测试旧 fixture 补齐真实 owner，没有放宽范围验证。 |
| R4 | 连续性与线索检查、时长估算移入作品菜单。浏览器实际打开两工具并从连续性工具进入正文勾选；reviewSceneIds 限定读取/返回范围，最多 30 场。 |
| R5 | plan 使用目标单元锚点；有场/空白/非活动单元均有采用回归。浏览器在第一集页面给第二集创建任务成功。 |
| R6 | v65/v66 实际 Zustand hydration 保留自定义；同时覆盖 v0/v54 的旧迁移，保护来源不明原文和资产名单自定义，退役模板仍过滤。 |
| R7 | 显式默认选择持久保存；真实 hydration 后仍胜过服务端旧模板，后续自定义编辑解除选择。 |
| R8 | harness 恢复普通 repository 与剧本路由；真实子进程经 12 次 HTTP 检查创建、保存、409、任务回填及采用，外部模型仍隔离。 |
| C1 | 长篇 QA 不再因集数要求商业变现资料；完整非商业样例无商业 blocking，删除结局仍报告故事缺项；作者提供的商业原文继续进入上下文。 |

主线：`test:script` **122/122**，`test:assistant-retirement` **28/28**，`test:module-readiness` **11/11 + 5 项自检**；类型、构建、文档 HTTP/版本和 diff 空白检查通过。构建仅有既有大包提示。独立写作补充套件 **44/44**；生成/H3/提交 **63/63**、网关/独立用例 **17/17**；互动 **19 组领域 + 18 项编辑/绑定/运行时**，另有 12 次 HTTP 与导出 HTML 双结局/重启检查。不同套件有重叠，不累计成一个总数。

本轮证据：`artifacts/assistant-retirement-repair-2026-10-24/`。子 agent 原始日志和独立复验摘要另见 `artifacts/assistant-retirement-independent-verification-2026-10-24/`、本报告原证据目录的 `production-interactive-recheck-summary.json`。临时浏览器服务已停止，正式作品和用户 ZIP 未修改，真实模型调用为零。软件修复完成不等于实际作品验收；视频仍暂停，互动无媒体样例为 `waiting_for_media`。

## 初审问题与复现记录

### R1 · P1 · 局部节拍修改丢失范围并可能写错大纲所有者

- 入口：故事大纲 → 关键节拍 → 与 AI 修改这一变化 → 外部回填 → 采用。
- `OutlineBeats.tsx:85–99` 已提供 `outlineRange`、`outlineBeatIds` 和归属。`ScriptWorkspace.tsx:201–203` 接收请求，但 `970–975` 未将这些范围字段接到 `ScriptTaskPanel`；节拍入口也跳过季/故事操作转换。普通 `outline` 的采用逻辑会替换整个 `brief.outline`。
- 确认：原文“开头应保留。目标关键变化。结尾应保留。”采用局部返回后变成“目标变化已改。”，范围外内容消失。季/故事节拍的返回还会改全剧大纲，自己的季/故事大纲不变。主 agent 在隔离浏览器通过实际按钮、回填和正式采用完整复现第一种情形。
- 修复验收：目标所有者、原文范围与节拍 ID 必须进入服务端任务和采用合同；仅改提示词不够。验证项目/季/故事/单元各层局部修改、旧版本冲突和范围外内容保留。
- 定位：[页面接线](../../apps/web/src/features/script/ScriptWorkspace.tsx#L970)、[节拍请求](../../apps/web/src/features/script/components/OutlineBeats.tsx#L85)、[任务创建](../../apps/web/src/features/script/ScriptTaskPanel.tsx#L65)。

### R2 · P2 · 季与故事大纲缺少返回格式合同

- 正常整理季/故事大纲入口使用 `season_outline` / `story_outline`，但 `SCRIPT_TASK_CONTRACTS` 没有这两项；`ScriptTaskPanel.tsx:54` 生成的任务要求以字面量 `undefined` 开头。
- 解析器实际需要 `{summary:string, outline:string}`；没有提供该约定，外部模型返回普通文本会失败。隔离验证：合法 JSON 均能成为候选，普通文本均被拒绝。
- 修复验收：为可用操作提供完整合同，并检查所有可选操作都有对应格式、解析及采用路径。
- 定位：[合同选择](../../apps/web/src/features/script/ScriptTaskPanel.tsx#L54)、[合同定义](../../packages/script/src/taskContracts.ts)。

### R3 · P2 · 整理季大纲没有读取目标季的已有原文

- `ScriptTaskPanel.tsx:53–56` 按当前单元构建上下文，没有传目标季范围；`methods.ts:63–64` 未提供 `outlineScopeIds`，规划上下文不会自行从 `unit.seasonId` 读取 `Season.arc`。
- 隔离样例已有明确季原文，构建的提示词不含该原文。结果可以被采用到目标季，生成依据却不完整。
- 修复验收：从任务的实际所有者构建上下文，包含目标季原文及适用资料；显示的范围、读取范围和采用范围一致。
- 定位：[任务上下文](../../apps/web/src/features/script/ScriptTaskPanel.tsx#L53)、[通用上下文](../../packages/script/src/methods.ts#L63)。

### R4 · P2 · 连续性与时长工具的唯一入口被误删

- 父版本助手头部的“连续性检查”“时长估算”按钮是两个弹窗唯一的打开入口。本次删除头部后，`isRadarOpen`、`isTimingOpen` 都只剩初始 `false` 和关闭调用，没有其他组件、事件或 URL 打开它们。
- 后果：连续性/线索/知情状态及道具变化的查看维护工具、时长估算及时间片段工具仍有实现，但人无法从界面进入。
- 修复验收：将独立领域工具放回合理的作品操作入口，不恢复聊天助手。恢复连续性入口时还应处理原“分批审阅本单元正文”回调只接单场 `review` 的隐藏缺口。
- 审查纠正：子 agent 最初将该隐藏回调报成当前可点击的批审错误；主 agent 复核后撤回该触发描述。当前确证问题是入口消失。
- 定位：[新任务头部](../../apps/web/src/features/script/ScriptWorkspace.tsx#L965)、[保留但无法打开的工具](../../apps/web/src/features/script/ScriptWorkspace.tsx#L992)。

### R5 · P2 · 全集概览无法为非活动集补分场

- 入口：活动集为第一集 → 分场规划 → 全集概览 → 第二集卡片“AI 补本集分场” → 准备本次提示词。
- 卡片按钮阻止事件冒泡，不会先切换活动集；`requestWritingTask('plan', …)` 不传 `sceneId`，`taskScene` 对非活动集返回空，而 `scriptTaskAnchor` 拒绝没有场景的 `plan`。
- 主 agent 浏览器实测：第二集明明已有场景，仍报“这项任务需要已有场景，请先规划分场或选择有效场景。”
- 修复验收：按目标集解析分场任务锚点，不能借用页面活动场。覆盖非活动集、有场集与空白集的合理行为。
- 定位：[范围解析](../../apps/web/src/features/script/ScriptWorkspace.tsx#L183)、[请求创建](../../apps/web/src/features/script/ScriptWorkspace.tsx#L198)、[任务锚点](../../apps/web/src/features/script/scriptTaskIntent.ts#L4)。

### R6 · P2 · 升级覆盖两项真实自定义提示词

- 触发：浏览器已有 version 65 的提示词存储，作者自定义了 `validateCharacters` 或 `refineCharacters`，打开 version 66。
- 新版本号触发旧迁移中的两条无条件赋默认值语句。真实 Zustand hydration 的隔离内存存储探针确认：两份自定义均被覆盖，并重新写入存储，原文字节不再存在。父版本保持 version 65 时不会执行该迁移。
- 修复验收：仅升级可确认的旧默认，保留真正自定义及来源不明文本。对完整持久化迁移执行验证，不能只测指纹辅助函数。
- 定位：[版本提升](../../src/store/usePromptStore.ts#L41)、[无条件覆盖](../../src/store/usePromptStore.ts#L178)。

### R7 · P2 · 明确“恢复默认模板”之后仍重新加载服务端旧模板

- 触发：服务端存在 `OMNI_Brains` 自定义模板；用户在编辑器恢复默认，再刷新或打开新任务。
- 新 loader 将等于默认的本地记录过滤后，重新选择服务端模板。隔离探针确认：store 已是默认，重新加载却返回 `source=server.prompt` 的旧内容；父版保留恢复默认的效果。
- 修复验收：区分系统默认缓存与作者显式选择默认的意图；模板来源、界面预览与再次执行一致。
- 定位：[本地覆盖判定](../../src/services/production/templateLoader.ts#L24)、[服务端回退](../../src/services/production/templateLoader.ts#L114)、[用户恢复按钮](../../src/components/PromptEditorModal.tsx#L732)。

### R8 · P2 · 写作浏览器验收入口不再注册业务路由

- `tests/script-browser-harness.ts` 清理旧 host 时连带移除了普通 repository 初始化及 `registerScriptRoutes` 调用。`npm run test:script:browser` 仍然存在并能启动，但所有 `/api/scripts` 请求落到隔离环境的 503 兜底。
- 主 agent 启动临时 harness 并请求 `/api/scripts`，得到 503，不能使用该入口验收项目列表、创建及回填。它不是产品服务故障，但会破坏后续回归验证。
- 修复验收：恢复仅依赖普通剧本 repository 的路由，继续禁止外部模型；至少实际请求列表、创建、回填和保存冲突。
- 定位：[验收服务](../../tests/script-browser-harness.ts#L13)。

## 既有冲突，不混为本次新增回归

`src/services/production/longFormMemory.ts:568` 仍将 `monetizationPromise` 作为必填，非商业长篇项目会得到 blocking；本次 `src/services/operator/workflowContract.ts:64` 又声明商业目标按项目要求可选。隔离非商业 100 集样例已确认冲突。整改时应统一适用范围，不通过给作品编造商业诉求消除错误。

## 已通过的检查与边界

| 范围 | 实际证据 | 不代表什么 |
| --- | --- | --- |
| 剧本历史与并发 | 两种旧 job 身份可读、五种写操作均拒绝；旧返回保留且不覆盖新稿；10 类存档样例的 handler 返回原文，数据库未变化 | 未逐一查看真实用户历史档案 |
| 制片与生成 | 核心页面/API 调用链仍在；H3 标准/动作除输入外分别 20/24 原节点保留；2 图+1 视频+1 音频编译；15 秒和关闭锁定 LoRA 被拒；候选 A/B 替换及恢复保留历史；Operator 采用路由拒绝 | 未调用真实 ComfyUI，未验收实际图片、视频或声音 |
| 互动 | 19 组领域检查、43 项编辑/绑定/传输检查、1 项跨模块 HTTP；独立 12 次 HTTP 构建三节点双结局，验证状态、409、固定剧本版本、制片准备、试玩与 HTML 导出；导出 JS 在 JSDOM 走完双结局及重启 | 独立样例为 `waiting_for_media`，不是视频成片验收；没有本轮完整互动浏览器视觉验收 |
| 主 agent 跨模块 | `test:module-readiness` 的 11 项测试及 5 项后续自检通过；浏览器完整复现 R1/R5，独立重跑写作范围与模板探针 | 测试通过不能抵消上述反例；本轮未重复完整构建 |

HTTP 检查初次受沙箱本机监听限制，获准后使用临时数据库执行成功；不计为产品缺陷。所有生成模型调用为零，真实 `OMNI_Workspace`、源资产和用户 ZIP 未修改，视频暂停继续有效。

证据目录：`artifacts/assistant-removal-independent-review-2026-10-24/`（本地忽略目录）。包含独立探针源码/结果、跨模块日志、互动审查摘要与导出 HTML、两张浏览器反例截图。子 agent 的测试摘要明确标成摘要，不冒充原始 stdout。浏览器仅操作临时数据库 `/tmp/a22-root-ui-audit.sqlite`。

## 修复顺序

1. R1 和 R6：先保护作者内容与自定义模板，新增真正能捕获反例的测试。
2. R2/R3/R5：统一任务目标、提示词上下文、返回格式和采用范围。
3. R4：恢复领域工具入口，并修好其批审承接；不恢复自主聊天运行层。
4. R7/R8：让模板选择长期生效，恢复可运行的浏览器验收工具。
5. 分别回归剧本→制片→互动的固定快照和历史保留；真实生成与媒体创作验收仍按原授权和暂停状态单独进行。
