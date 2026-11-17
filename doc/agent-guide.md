# 外部 Agent 操作手册

handbookVersion：`2026-11-09.operator-v71`

这是 Codex 等外部 Agent 使用系统的主入口。目标是通过业务 API 读取、创作、保存和导出作品，不需要模拟 UI 点击。系统内置模型只是可选工具，Agent 可自己完成文本、设计和三维方案。Agent只做项目约定的粗审，发现明显大问题才有限返工；精细画面、声音及试玩验收交作者。JSON成功不等于作者批准。

## 制作权限：作品可改，系统只读

默认任务是使用系统制作作品。可以创建剧本、资产、GLB、场景蓝图、机位、群演调度、互动数据，以及独立作品目录内的 Blender/Three.js 建模脚本；通过正式业务 API 保存。读取公开合同或调用已有纯适配函数不等于获得修改权限。

系统源码、测试、依赖、数据库结构、全局提示词/Skill及系统说明书只读。不得修改渲染器或接口校验使本次制作通过，不直接写数据库。遇到系统缺陷，把复现、响应和受影响内容写入作品目录的交接，继续其他制作；只有用户明确委托系统开发/维护才可以修改实现。修正作品内容不需要重新申请权限，也不要求逐阶段审批。

制作 Agent 或维护人员可在开始制作前运行：

```sh
node tools/production-workspace.mjs --directory /绝对路径/本作制作目录 --base-url http://127.0.0.1:3000
node tools/production-workspace.mjs --directory /绝对路径/本作制作目录 --run -- 外部Agent命令
```

目录必须在系统仓库之外。第一条仅创建接手入口，不复制作品数据、密钥或另存一份手册；第二条在 macOS 保护系统源码、依赖代码和配置，只放开 `OMNI_Workspace` 与指定 Vite 缓存目录供既有服务正常运行。隔离制作进程可以启动服务；这不是数据库访问隔离，制作内容仍通过业务 API 保存，不直接写数据库。其他平台的隔离启动不支持时明确失败，不能退回无保护运行。桌面新会话若未采用只读挂载或隔离启动，只有指令边界，没有文件系统保护；不要声称已经隔离。

## 1. 接手与选择入口

1. 读用户本次要求及项目交接最新检查点，确认继续哪部作品、交付范围、指定生成核心和仍有效的暂停。不把交接中的历史规则、测试项目或旧版本作为当前事实。
2. 先检查并复用本机服务，默认 `http://127.0.0.1:3000`，端口以当前进程为准。服务未启动时，允许在系统仓库按已有命令 `npm run dev:fullstack` 启动，随后核对 `GET /api/health`、`/api/operator/handbook`、`/api/operator/capabilities`、`/api/operator/security`。必要时可正常重启本项目服务，先确认进程归属、在途生成及拍摄任务，避免误杀或重复启动；不需要用户另授“启动服务”权限。缺依赖或配置时报告具体问题，不为启动去升级依赖、改源码、覆盖配置或清空数据库。远程服务不可达不等于应在本机另建服务；不要为接手重复创建作品。
3. `/api/operator/documents` 提供本手册、专项说明和原生数据合同的白名单索引；`GET /api/operator/documents/:id` 返回对应文件正文。没有仓库文件访问权限时也可读，不需要前端页面。能力目录是功能发现，原生合同给字段定义；使用下表选入口，不必通读全部历史设计。
4. 若部署要求 Operator token，使用已有 `OMNI_OPERATOR_API_TOKEN`（兼容 `OPERATOR_API_TOKEN`）作为 Bearer 或 `X-Operator-Token`。遵守项目访问范围；401/403 不换路由或直接写库绕过。UI登录、Operator token和供应商Key是不同东西。当前独立业务API仍按本地部署提供，不是所有端点都统一归属 `/api/operator`。

| 要做的工作 | 正式入口和数据所有者 | 路线 |
| --- | --- | --- |
| 写剧本、续集、修正文 | `/api/scripts`，作者当前稿 | 第3节 |
| 影视制片、镜头、时间线 | `/api/projects`，制片副本 | 第4节 |
| 项目角色、场景、道具、声音 | 制片 `characters/assets` 与媒体候选 | 第4、5节 |
| 图片、视频、宫格、取帧、外部媒体 | `/api/operator/generation` | 第5节 |
| 3D影视城、场次机位、白模拍摄 | `/api/operator/previs` | 第6节 |
| 互动影游、分支、状态、内容绑定、试玩 | `/api/interactive/experiences` | 第7节 |
| 配音、剪辑、待审合成预览 | `/api/audio/speech`、`/api/assets` | 第8节 |
| 阶段质检、全局责任、正式成片 | `/api/operator/quality`（UI `/api/production/quality`） | 下方质量流程与专项手册 |
| 拉片与维护能力边界 | 各专项API；全局维护需明确任务 | 第9节 |
| 需要严格批量审计的制片任务 | Operator run/artifact → QA → commit | 第10节，可选 |

作者项目ID、制片项目ID、互动experienceId互不等同。作者单位/场次与制片episode/scene之间通过真实交付映射关联。`episode.gameData` 是旧互动投影，不用于新互动作品；`external-creation-kit` 是网页模型交换格式，不是数据库合同。

### 当前必用的质量流程

按[制作质量检查与正式交付](production-quality-workflow.md)执行，原生类型为[productionQuality](../packages/domain/src/productionQuality.ts)。总导演负责全局创作，制片统筹负责推进与依赖，各专业完成实际设计检查，可由同一人或一个Agent兼任，不启动内置自治多Agent。全剧总体 → 整场设计 → 拆镜与制作单元 → 资产布景调度（3D按需）→ 整组画面 → 视频声音 → 整场合成 → 整集总检。每步完成后严查实际成果，未通过禁止依赖下一步；这不是8次请用户批准。

使用 `Q=/api/operator/quality`：先 `GET Q/status?target=<JSON {projectId,episodeId?,sceneId?,shotIds?}>`，必要时 `PUT Q/projects/:id/responsibility {director,coordinator,intent,visualDirection,spatialMode:"scene_plan"|"previs"}`。`POST Q/inspections {target,stage,evidence?}` 冻结当前对象与媒体；查看snapshot和真实图声后，`POST Q/inspections/:id/review {verdict,findings:[{check,passed,note}],reviewerName}`，所有criterion显式判断并写实际观察，不能默认通过。`visuals/segments`可省略evidence读取当前采用媒体；整场/整集必须提供实际回看视频。缺检查、失败或来源变化都停止相关正式推进；草稿和失败候选仍可保存。

来源变化只失效相关检查，旧稿保留，人和Agent不手动管理技术版本。上限沿用制作约定/workRecords，不自动重生成。生成预检、提交、派发、导入核验前置检查；选择previs必须实际发送本镜构图，视频实际使用visuals已审图。scratch仅实验，不能直接正式推进。旧成果/在途不重发，也不自动盖通过。合成只是待审预览，整集总检通过后 `POST Q/deliveries {inspectionId}` 回取本次实际已审文件，不重编码；一般评论无法证明已看听，责任人须如实检查。

`segments` 核对实际固定剪辑的视频、入点和时长，包含剪辑仍使用的归档镜头及其历史宫格；同一源镜头多份素材均须检查。音轨与导出使用同一可听范围和库链接解析，新选库声音保存实际 URL。分集创作方向变更影响本集检查；整场已审视频被替换时，旧整集总检失效，同一视频重复检查不额外要求整集复查。详见质量流程中的素材和变化规则。

### 首次一次问清，后续按约定推进

普通制作默认由Agent筹备、生成和粗审，作者负责精审。项目开始时把会影响速度的选择合并询问，已有明确答案的不要重问：

> 本作每个视频单元要几条候选（图片是否也需多版）？Agent粗审几轮、每轮覆盖哪些素材，发现明显大问题最多返工几轮或投入多久？是否允许Agent粗审后先选制作暂用素材，最终由你精审？3D只用于生图取景，还是还需要动态预演/直接视频参考？粗剪希望按整场还是整集交付？

“粗审一轮”是对约定的一批素材快速检查一遍；修复后的定向检查计入约定轮数，不另起无限循环。候选数包含首次生成；返工是否追加候选须在同一次问答说明。次数/耗时由作者决定，不预设两次抽卡、固定复核轮数或无限返工。允许作者要求零轮Agent视觉检查，由作者接管。细节已经明确时直接执行；缺少会影响生成次数的答案时先完成剧本、资产组织和排队计划，不自行提交未定数量的生成，也不为每个镜头重复询问。

将真实问答简要写入制片 `Project.productionWorkingAgreement`，用现有 `PATCH /api/projects/:id` 只更新此字段并回读。它是普通文本制作约定，不是grant、审批表或自动重试配置；不能伪造作者答复。`GET /api/operator/projects/:id/context` 的project、生成context和workspace均返回该字段。未建制片项目时先记在作品交接；建立后保存到项目，写作/互动续作沿用同一作品约定，不分别再问。新会话读当前项目和最新用户变更，仅缺项询问，不重新问完整问卷。作者明确说“你决定”时可在其委托范围内给出并记录本次有限安排，不为补齐表单反复追问。修改约定不自动作废旧素材，也不会自动增加生成次数。

粗审只抓明显影响使用的大问题：黑屏/噪点/无法播放、主角错人或主要剧情缺失、严重空间/道具矛盾、明显可见穿模。细小表情、手指、纹理和审美偏好交作者，不为追求“完美”反复抽帧、重拍或换种子。正常来源/版本/容量校验由系统执行，不重复手工审计。无新变更、不新增检查；仅重看受影响范围。达到约定上限仍有问题，保留候选和简短问题清单交作者，继续其他工作，不重置轮数或绕过上限。已在途任务也占用约定生成次数，超时先按原ID查询；不能把换种子、重建任务、换会话或返工当作重新获得次数。

粗审未发现大问题且当前阶段检查通过，即可按约定继续依赖制作并尽早交粗剪。允许暂用时，现有review/采用接口只记录真实粗审与制作选用，notes注明“粗审后制作暂用，待作者精审”，身份仍external_agent，不能写成作者已批准。作者要求所有采用由本人完成时，保留候选供其选择，可先制作标注待审的粗剪和其他无依赖内容；不假冒作者或改采用指针。最终对外发布与作品合格结论由作者决定。零轮Agent视觉检查时不填写“粗审通过”；由作者完成真实阶段检查。未审暂用只能记录事实并保留草稿，注明“未做视觉检查，待作者精审”，不能因此越过质量依赖。

## 2. 所有操作共用的规则

- **先读后写再回读**。使用当前完整对象；列表、`shell`、`production-workspace`、`whiteboard` 等投影不能当完整快照覆盖。保留稳定ID、未知字段、原正文和不相关媒体。不直接写SQLite或浏览器存储。
- **正常工具自动处理保存保护**：制片优先使用下文的场次、镜头、协作、剪辑、资产用途及3D增量PATCH，只提交本次修改，人和AI不维护技术版本号。生成任务编辑、预检和结果review也可省略修改序号。旧全量保存、固定交付和底层导出合同继续保留必要检查，其客户端应自动携带原读取对象的保存标记，不编造、递增或删除标记来覆盖内容。
- **409不是重试指令**。读取最新内容、比较差异后重新构造请求；不删版本字段强行覆盖。超时先查询原任务/回执。只有支持 `commandId` / `idempotencyKey` 的操作才保证对应幂等；同一编号不能换内容。
- **写入、候选、采用是不同动作**。事实或审核只有实际检查后才能标通过；模型任务完成不表示作者批准。保持各领域正式采用接口，不通过修改 activeTakeId、媒体URL或数据库绕过候选检查。
- **授权沿用当前用户要求**。首次制作偏好问答不是授权审批；不增加逐项图片/视频、次数、预算、grant授权表单；保留用户明确暂停、指定核心、人工锁定及服务并发限制。当前仍由系统限制的作者操作见第11节，不能把“无需UI”解释为绕过权限。
- **单位分清**：作者稿时长以毫秒；制片镜头、视频、互动媒体时长多为秒；制片 `targetDuration` 和作品规模部分字段以分钟。读字段合同，不能全局乘除同一个数。
- **文件持久化**：上传得到 `/media/...` 才是系统媒体地址；本地文件绝对路径不能直接填作媒体URL。记录真实来源，上传文件本身不会自动成为角色图、镜头候选或正式成片。
- **模型配置不是作品数据**。外部Agent自己写作/设计无需调用模型。需要生成时按现役能力选择服务，不输出密钥，不为了让测试通过改全局路由或项目策略。

建议本地脚本用 `fetch`、`JSON.stringify` 和 `URLSearchParams` 发送JSON，检查HTTP状态，再读取响应；需要文件请求时使用正确Content-Type。不要把含正文、密钥的JSON插入shell命令字符串。进程从仓库执行 `node --import tsx` 可使用下文已有纯数据适配函数，最终保存仍必须走HTTP。

## 3. 剧本：建立当前稿、修订与交付

先 `GET /api/scripts` 选作品，再 `GET /api/scripts/:id` 取得 `{project}`。原生合同是 [script.v1](../packages/script/src/schema.ts)，字段名是正文块 `text`，不是制片正文块 `content`。

新建 `POST /api/scripts`，返回201及完整初稿。以下是合法的最小作品形态示例，题材与规模按用户要求修改：

<!-- example:script-create -->
```json
{"title":"接口验收短片","profile":{"organization":"standalone","continuity":"serialized","workType":"short-film","genres":["剧情"],"language":"zh-CN","plannedUnits":1,"targetDurationMs":60000,"toleranceMs":10000,"includeCredits":false,"aspectRatio":"16:9","productionMode":"AI-video"}}
```

**直接写入**适合Agent已完成的剧本：在返回的原生 `project` 上维护 `brief`、人物/事实、`units[].scenes[].blocks`、必要的结构与时长证据；`PUT /api/scripts/:id {project,expectedRevision}`。每个场次填地点、人物、起止状态、目的及完整动作对白。新对象用稳定ID，修订沿用原ID。传当前完整稿，不用几句话摘要代替已有正文。保存返回的新revision供下一次使用。

**候选任务**适合需要记录生成提案/比较的操作：

| 步骤 | 请求和结果 |
| --- | --- |
| 建立任务 | `POST /api/scripts/:id/jobs`，带 `operation,prompt,expectedRevision` 以及真实 `unitId,sceneId` 或该操作范围；Skill可选 `methodIds,methodVersions`。建立任务不调用模型 |
| 查冻结输入 | `GET /api/scripts/:id/jobs/:jobId` 读任务；`GET .../:jobId/input` 读冻结稿。返回格式由 [任务合同](../packages/script/src/taskContracts.ts) 按operation确定，不能统一填一个proposal格式 |
| 提交外部结果 | `POST .../:jobId/result {rawResult,provenance:{source:"manual_external",provider,modelId}}`，rawResult为字符串，来源如实写 |
| 检查/采用 | 回读job的验证和候选，再 `POST .../:jobId/approve {choiceIndex?}`；不用时 `reject` / `cancel`。改基线不能强行采用旧结果 |

全剧、故事、季、集大纲各用对应操作；局部大纲通过 `outlineRange/outlineBeatIds` 和 `OUTLINE_RANGE_CONTRACT`，不能作为整份大纲替换。`reviewSceneIds` 最多30场，只评价实际提供的正文。写作review是提案，不表示系统已自动看过全剧。旧readOnly任务不可复活。

`GET /api/scripts/:id/export?format=json|markdown|fountain` 导出当前稿；不支持历史revision导出。`GET /api/scripts/:id/delivery` 返回 `{package}`，这是系统生成的 `script-delivery.v2` 制片交付，不可手造源版本。

网页模型包先按 [外部回填说明](../external-creation-kit/shared/import-handoff.md) 校验及映射，再走上述原生保存。保留外部ID→系统ID及回执；目前没有上传zip即自动映射的一键API。已获用户授权的新建或修订不重复要求确认，只有归属或覆盖范围不清时再澄清。

## 4. 制片：导入、资产、场次与分镜

`GET /api/projects` 默认仅列表摘要。`GET /api/projects/:id` 读完整制片对象；`GET /api/projects/:id/episodes/:epId` 读完整分集。合同为 [Project/Episode/Scene/Shot](../src/types/project.ts)。

**作者稿进入制片**：读取上节delivery，使用现有纯适配函数 `createLegacyProductionProjectFromWritingSource({package,productionProjectId,importId})`（[实现](../src/services/production/writingExportLegacyAdapter.ts)），再 `POST /api/projects` 发送返回的Project。不要重复导入同一作品创建副本。远程Agent没有本地代码运行环境时可按原生合同构造请求；当前没有独立“delivery转制片”HTTP端点，不虚构 `/import-delivery`。

**直接接外部剧本/小说**：使用 `createProductionProjectFromMagicSource`（[实现](../src/services/production/productionSourceIntake.ts)）准备Project后POST。它建立来源和空制片范围，不自动拆分场次/镜头。Agent继续阅读原文，拆成真实场次并保存，不把导入成功当筹备完成。

| 写入内容 | 操作 |
| --- | --- |
| 新制片项目 | `POST /api/projects`，body为Project；已存在ID返回409 |
| 项目资料/角色/场景/道具/声音配置 | 读完整项目后 `PATCH /api/projects/:id`，仅带要更新字段，数组字段提交保留其他对象的完整数组；无通用项目元数据CAS，单写者串行处理 |
| 分集剧本/场次/镜头/故事板/时间线 | 读完整分集后 `PUT /api/projects/:id/episodes/:epId`，body为Episode，携带当前 `productionRevision`；用响应版本继续 |
| 添加新分集 | 从完整项目构造保留现有分集的Project，再 `PUT /api/projects/:id`；旧分集保留各自revision。不要用摘要清空深层内容 |
| 原文来源核对 | `GET /api/projects/:id/script-workspace`、`GET /api/projects/:id/script-units/:sourceDocumentId` |
| 当前场导演材料 | `GET /api/projects/:id/episodes/:epId/storyboard-team-context?sceneId=...`；用于筹备，不代替完整分集保存 |

**日常编辑优先用窄范围工具，无需提交技术版本号**：

| 操作 | 请求 |
| --- | --- |
| 改场次文字、目标、拆解或声音 | `PATCH /api/projects/:id/episodes/:epId/scenes/:sceneId`，只带本次字段。支持title/script/scriptBlocks/sceneGoal/breakdown/visualPlan/audioTracks/shots；整组替换shots会先归档原镜头，新镜头无ID时由服务端分配。单独提交script会替换原文本块；提交scriptBlocks会同步正文，二者同时提交须一致 |
| 改单镜拍法或估时 | `PATCH .../scenes/:sceneId/shots/:shotId`，只带本次duration、动作、调度、对白、资产引用、提示词、beatIds/eventIds等字段；不修改其他镜头或媒体采用 |
| 保存专业决定、事件和交接 | `PATCH .../scenes/:sceneId/collaboration {direction?:{intent?,rhythm?,requirements?,beatDirections?,assumptions?},eventStates?,observations?,workRecords?,beats?}`；GET同路径返回共用依据、实际结果索引与下一步。需求/事件数组代表本字段当前内容，观察按id合并，工作按scopeKey合并，原始任务身份与已用次数保留 |
| 补资产功能 | `PATCH /api/projects/:id/assets/:assetId/production-use {shotScale?,dimensions?,operations?,limitations?}`；角色也使用其正式ID，省略字段保留当前值，清空字段提交空字符串 |
| 编辑素材片段 | `PATCH .../scenes/:sceneId/edit {operation,clipId,...}`；split用offsetSeconds，trim用sourceInSeconds/durationSeconds，move用toIndex，duplicate/remove无需额外字段，transition用transition，replace用已有takeId与可选sourceInSeconds；也可提交完整clips数组。镜头和旧媒体保留 |

本场需求、状态和观察都可按需记录，不要求填完整部门报告。`requirements`为 `{id,department,description,reason?,beatIds?,targetIds?}`；`eventStates`为 `{id,event,entityId,before,after,shotIds?}`；`observations`为 `{id,note,impact:note|issue|unusable,targetIds?,mediaUrl?,contentHash?,viewpointId?,startSeconds?,endSeconds?,fixTargetId?}`。未知内容留空，实际观察不能冒称已验证动作。只有明确不可用且匹配当前具体参考的观察才影响该参考，不把一般建议变成阻塞；独立质量阶段仍须全部明确检查通过，协作observations不能代替quality review。

`workRecords`为 `{scopeKey,originTaskId?,reviewsUsed,repairsUsed,maxReviews?,maxRepairs?,lastAction?,nextStep?,handoff?}`，上限来自真实制作约定，不是新增授权额度。省略上限保留原值，作者取消上限时显式提交null；换任务/会话不能清零已用记录。达到约定上限或handoff后交付已有成果与问题，继续其他范围；GET不会自动检查、生成或返工。`mediaProgress`只读展示实际执行数量、在途数量和最近50次执行的结果/观察索引，hasMore表示可去原生成历史展开；savedReview是保存记录，不冒充当前来源或作者精审。

剪辑clips固定实际素材URL与takeId、源入点和保留时长，数组顺序决定连续剪辑位置；首版不支持空隙轨道。更换镜头当前采用不会偷偷重绑片段，需显式replace或使用界面“此片段使用当前镜头素材”。声音可用clipAnchor:{clipId,offsetSeconds}保持相对偏移并跨切点；自由音轨保持场景时间。预览、声音和导出读取同一片段解析器。

**单独编辑本场方案（不需要Skill或已有镜头）**：`PATCH /api/projects/:id/episodes/:epId/scenes/:sceneId/director-plan`，body为 `{intent:"观看重点",rhythm:"节奏与承接"}`。服务器只修改该场方案的这两个字段，自动读取当前保存标记并保留镜头、媒体和其他场次；调用者无需管理技术版本号。返回保存后的Episode。UI分镜页“导演方案与重拆镜头”中可直接编写；普通分镜返回也可在同次提供directorPlan，不要求先独立提交。已有方法决定保留，缺方案不新增审批或重试。

本场context的 `productionBasis` 共享导演决定、空间与状态，以及正文仍一致的作者上游节拍/目标/障碍等。若制片正文已改变，旧上游结构不作为当前事实输出。新建城任务同样读取这些依据；读取不会启动模型或检查。内部修改标记和来源保护由工具处理；冲突保留内容，不循环刷新重放。

制作顺序按作品需要推进：读本场剧本及独立资产 → 整场空间/事件状态和切镜意图 → 镜头动作、对白、时长 → 需要时联合故事板 → 按模型容量分视频单元 → 按制作约定粗审并交作者精审。可复用已合格阶段；3D和严格批量管线都不是必选前置。

人物/地点/独立道具各自维护资产图与稳定ID。`characters[].voiceSettings/voiceReferences` 为角色音色归属。分镜引用真实角色/场景/道具；叙事镜头、故事板画格、视频单元不是一一对应。编辑 `Scene.visualPlan`、`manualStoryboard` 或 Shot 时使用当前合同和已有对象，保留历史媒体。

先核对 `GET G/context` 的 `timingReview`（G见第5节）：它直接列出本次镜头内容、预计秒数、`motivation`、`editingNote`与整场疑点。缺估时/切出依据时在现有分镜字段补设计，不能把默认值、模型容量或目标总片长倒推成每镜固定长度。`basisStatus=described`只是有文字，`creativeStatus=not_assessed`不是验收通过。工作台每目标的 `sources[targetKey].timingReview` 与预检 `plan.timingReview/issues` 同源；提示可供人/Agent判断，不要求新增授权或审批。

- **反例**：先写12镜×12秒，再每镜4格×3秒，全部“缓慢推进、留出停顿”，用9段相加宣称108秒节奏合理。
- **正例**：本镜作用为“确认修灯成功”；动作是旋紧、放稳、按开关，点亮后留一个可辨反应切向电池。经试演暂估6.8秒，写入`duration`；`editingNote`记录上述估时/切出依据。若能力要求整数秒则请求7秒（具体按实时能力），生成实际长度另测，按真实动作和声音剪接。其他镜头独立估时，不照抄6.8秒。多格只是关键状态，不平均分秒数。
- **修订**：允许重新估时、删冗余停留或拆镜，保留剧情、原稿和候选；使用原分集PUT及版本校验，再刷新任务来源并预检。生成余量不必进成片；导出使用`sourceStartSeconds/durationSeconds`。调整互动片段时复核媒体绑定/运行时快照与等待态，不把等候时间加成剧情长度。剪短稿可作为待作者精审的粗剪，不必为交粗剪先做逐帧/逐切点精审。先复用已有素材，未知提交查询原任务，不重发。

不为符合14秒删剧情或加速整场。按实际动作、对白和合理切点分视频单元，再决定画格数；并非固定九宫格。共同空间和状态要统一，正反打/反应/插入/蒙太奇无需机械动作连贯。完整创作标准由 [系统设计的场内流程](design.md#场内视觉统一与切镜流程) 统一维护。

作者稿、制片副本和互动固定引用不会自动互相覆盖。已有制片源变化要显式比较和更新，保留原镜头、视频和绑定。当前不存在安全的“重导后自动保留所有制作字段”通用接口，不直接重复POST替换旧作品。

### 保存制作单元与并发制作

整场设计和拆镜完成后，用 `PATCH /api/projects/:id/episodes/:epId/scenes/:sceneId/storyboard-units/:unitId` 保存单个制作单元；读取完整分集可回取当前全部单元。`unitId` 是稳定业务身份，不是版本号。新增时提供 `shotIds` 与 `board.panels`；之后只传所改的 `board` 字段或 `performanceBeat/strategyDecision`。服务器合并当前场次，不覆盖其他单元、导演方案、总览或已存媒体，旧方案保留在历史中。

```json
{"shotIds":["shot-a","shot-b"],"performanceBeat":{"summary":"来人停下，对方抬头","startState":"来人尚在入口","endState":"两人互相看见"},"board":{"layout":"2x2","visualReferenceMode":"director_board","panels":[{"shotId":"shot-a","durationSeconds":1,"framePurpose":"建立来路","subjectAction":"人物经过门洞"},{"shotId":"shot-a","durationSeconds":2,"framePurpose":"确认停步","subjectAction":"人物到台阶前停下"},{"shotId":"shot-b","durationSeconds":0.8,"framePurpose":"听到脚步","subjectAction":"对方停止手上动作"},{"shotId":"shot-b","durationSeconds":1.2,"framePurpose":"建立视线","subjectAction":"对方抬头望向来人"}]}}
```

上例对应已经估时为3秒与2秒的两个镜头，数值不是默认模板。每格须有镜头归属、画面作用、动作和实际估时，覆盖对应镜头时长；默认资产只取所属镜头，显式 `assetRefs` 可进一步缩小画内范围，不能把尚未出场者带入当前画格。方案不会自动均分、删戏或挤进模型上限。`director_board` 是同次生成的联合宫格；`shot_grid` 是已采用镜头图拼格，不能混称。保存后回读 `workflow.board.id` 与 `visualPages[].id`，分别用 `target.kind:"board",boardId,pageId,shotIds` 生成/导入各组宫格；视频用 `kind:"video_unit",unitId:workflow.videoGenerationUnitId,shotIds`。只采用并发送本单元已审图，禁止为方便写入单一场次 `overview` 覆盖开场。此接口不接收媒体URL、activeTakeId、审核结论；采用继续用生成工作台review。

方案发生实际变化后只复核受影响检查。批量提交预检计划即可，系统同一服务错峰上传参考、远端仍按共享额度并发，无需Agent自己循环等上一条生成完成。上传阶段已成功的素材会随原任务保存；暂时上传错误沿用有限恢复，POST不确定仍不重发。未知任务和人工暂停保持原规则。候选需要修正时先查实际输入：身份用原始角色资产，场地用空间基准，道具用独立结构参考；失败候选只可作为明确指出问题的局部编辑对象，不能成为下一组的身份/现场基准。

### 资产图：先选用途，再选版式

“角色/场景/道具”是资产类型；“制作资料板/纯净参考”是用途；“单图/三视/四栏”是版式。不是三套必须完成的流程。`target.referenceMode` 明确选 `clean_reference`（下游参考）或 `production_board`（设计审查）；保留现有字段和历史图片，不批量转换旧作品。

| 对象 | 通常足够的参考 | 何时扩充 |
| --- | --- | --- |
| 角色 | 同一身份、服装与状态的正侧背及面部；当前默认为三视图＋面部四栏 | 表演或造型确有需要时增加表情/动作/细节，不默认八表情和三剪影 |
| 道具 | 主视图与剧情涉及的接口、开关、持握处、尺寸关系 | 按实际结构选补充角度；不把每件道具固定成四栏；操作研究放资料板，纯净输入去掉示范手 |
| 场景 | 可辨空间和固定陈设的空场参考；需要时加空间设计板 | 反打、入口、窗外或移动机位不能由主图推断时补对应角度；空场图不等于拍摄时没有群演 |
| 交通工具 | 同一结构与出入口的方向参考 | 涉及驾驶、上下车或特写时补实际使用部位 |

默认先完成本次需要的一种用途。资料板与纯净图不要求成对生成：可从足够清晰的已采用资料裁切或按同一基准补图，保留来源。不可把两套独立生成的脸、衣服和道具都当正式基准；有冲突先核对当前身份/状态。已保存的用户提示词不自动改写，旧固定版式不是新任务的普遍标准；需要变更时编辑本任务草稿。

上下文默认提示词和界面按同一个用途规则构建；缺少专用纯净提示词时不会借用制作资料板布局。提交前查看实际 `plan.prompt`：本次需要单一物件、单角度时，在任务中明确数量与布局，检查不要同时出现要求多视角/研究区的指令。多视图本身允许，但各角度须是同一物件；不要把两种不同造型当作一个身份，也不要让参考中的无关家具进入布景。

生成前简要写明每张参考负责什么：资产图负责身份和结构；3D图负责指定空间/机位/遮挡；动态预演负责运镜和走位；美术参考负责材质与风格；宫格负责本单元画面顺序。用现有 `role`、`usageNote` 和任务prompt表达，不加一套审批。3D灰模材质不要求复制到写实成片；明确采用的构图也不能被美术参考偷偷改成另一个机位。发生冲突先改来源再生成。

### 角色身体/脸部版式与状态参考

角色纯净参考统一为 `body_face`（去头身体三视图＋完整脸部特写）。左三栏只负责服装、体型与饰品，颈部以上省略头部和头发、无血腥切口；右栏清晰展示完整脸、发型、妆容和当前伤势。生成故事画面仍必须有完整头部，不把去头版式或四栏白底当故事构图。

通过 `buildVideoStoryboardAssetBoardPlan(project).characterReferenceBoards` 读取每个角色/状态的稳定 `id/assetId/variantId/characterReferenceLayout`，用 `target.kind:"asset",assetId:board.id,referenceMode:"clean_reference",shotIds:[]` 走正式生成/导入及review。这里只提供body_face；旧通用角色板ID的纯净生成同样使用新版。图片与专用提示词保存在 `characterReferenceLayouts.body_face`；采用时更新 `cleanReferenceImageUrl/cleanReferenceLayout`，不要直接改指针或来源摘要伪造采用。历史图片与standard字段保留，旧模板与版式生成入口已撤下；提交前必须核对实际提示词包含左三栏去头要求。

创可贴、伤势、换装等先在对应variant形成可用参考，按既有Shot.appearance的已接受状态选择；分镜和视频收到实际状态图与职责说明，不能用基础状态图片冒充受伤态。body_face输入仅设 `character_identity`，不能当 `first_frame`；视频继续采用本镜/单元已检查画面。实际检查小脸干扰、服装细节、完整脸型发型及状态位置，检查次数沿用项目约定。协议成功不代表远景人脸清晰度或身份已实际验收。

### 场景视角图与镜头引用

场景资产页的入口为主视图、反向平视、互补斜角全景、顶视布局图。先确定空场主图与方位，需要时以主图补互补斜角；两张覆盖充分即可继续。需要反打再补反向，需要布局才以前三张制作顶视，不必生成所有角度。它们属于同一场景；昼夜、损毁等 `variants` 分别有自己的主图与视角组，不混用基础状态。此流程不依赖3D，不要求所有旧资产补齐四张。

场景或状态可保存 `locationSpatialAnchor:{layout:"北墙书柜，东窗西门",cameras:{main:{position:"南侧平视",lookAt:"朝北书柜"},oblique:{position:"东北角平视",lookAt:"朝西南入口"}}}`。`cameras`允许 `main/reverse/oblique/top`，position明确机位所在位置和需要时的高度，lookAt明确拍摄方向或目标；不是“北面视图”一类含混标签。状态继承基础字段，局部覆盖只作用于该状态。沿用正式项目资产保存入口；不要凭参考图左右自动填写方位。当前基准自动进入提示词与引用，修改后复核受影响视角，不能把软件来源校验当空间画面验收。

外部 Agent 可读取现有纯适配函数 `buildVideoStoryboardAssetBoardPlan(project).sceneViewBoards`，取得各 `assetId/variantId/locationView/id`；沿用 `target.kind:"asset",assetId:board.id,referenceMode:"clean_reference",shotIds:[]` 的生成工作台与候选review。主图仍在 `sceneBoards/variantBoards`。补充视角保存在 `Asset.locationViews` 或 `AssetVariant.locationViews` 的 `reverse/oblique/top`，每项含图、提示词及系统管理的来源信息。不要直接填 `sourceHash/reviewedAt` 冒充采用；上传也走候选采用入口。

镜头可通过 `PATCH /api/projects/:id/episodes/:epId/scenes/:sceneId/shots/:shotId` 提交 `{"locationReferenceViews":["reverse","top"]}`。有效值 `main/reverse/oblique/top`，留空沿用原参考，按本镜需要选择，不把所有图塞进每个生成单元。单镜和宫格读取所选视角，缺图/来源变化阻止正式预检；模型不能容纳必需引用时换用容量足够的方案，不删掉输入以骗过检查。顶视只用 `environment` 布局用途，不是视频首帧或联合宫格，视频继续使用本组已审分镜。

实际核对反打是否只是镜像、门窗与固定陈设是否对应、斜俯视和顶视是否凭空改变结构；遵守项目约定的检查/返工上限。来源变化会保留旧图并提示复核，可重新导入核对过的图片形成新候选再采用，不要求必须再次付费生成。生成成功或来源校验通过都不能替代空间画面检查。

## 5. 生成与外部媒体回填

统一前缀 `G=/api/operator/generation`，原生合同 [generation.ts](../packages/domain/src/generation.ts)。图片/视频不用旧 `/api/proxy` 创建端点；其新提交已要求固定计划。

1. `GET G/capabilities` 读 `{recipes}`；按 `capability.allowedOperations/mediaKind/mode/inputs/parameters` 选方案，避免 `supersededBy` 或诊断方案。读取 `G/context?target=<URL编码JSON>` 取得正文、正式素材、真实URL和来源，再读 `G/workspaces/current?target=...` 取得草稿/固定计划/结果/策略。
2. `target` 始终有 `projectId,kind,shotIds`；资产还需assetId，镜头/场目标需episodeId/sceneId，video_unit需unitId，board按实际boardId/pageId。`kind:"scene"` 可做联合故事板，不可直接生成整场视频。全局实验使用 `projectId:"generation-global",kind:"scratch",scratchId,shotIds:[]`，不创建伪生产项目。
3. `POST G/tasks {target,operation,capabilityId,commandId}` 返回 `{task}`。`PATCH G/tasks/:id {patch,refreshSource?}` 修改prompt、references、parameters、storyboardLayout等。参数值结构是 `{value,source:"ai",locked:false}`；参考保留原始ID/来源，只勾需要发送的素材，不假称正式采用。人工锁定冲突时报告差异，不换入口绕过。
4. `POST G/tasks/:id/preflight {}` 返回 `plan` 或 `issues`。处理所有阻塞，并阅读timingReview及非阻塞节奏提醒（HTTP200不表示创作通过），核对冻结素材、叙事预计/请求/预期输出时长、分辨率、参考用途、核心及最终 `plan.prompt`；不能只看预检HTTP200或自己填写的短prompt。最终提示词还会合并项目视觉设定，发现旧的资产板、多视角、白底等要求混进连续视频，先修相应来源或作用域，再重新预检，不在末尾追加相反指令。H3仍使用指定YZ LoRA、SelfLift双采、LMS核心、每次最多14秒；可变多模态输入读真实容量，不把作者示例槽位写死。详见 [H3说明](comfyui-yz-h3-production.md)。
5. 系统生成用 `POST G/executions {planRevisionId:plan.id,planHash,idempotencyKey}`。批量 `/batches {plans:[{planRevisionId,planHash,idempotencyKey}]}`；显式依赖等待 `/queue {taskIds,commandId}`。无需grant。现役多素材组合若标为experimental，当前用户已授权测试时，可 `PATCH G/projects/:id/policy {patch:{allowExperimental:true},expectedRevision,notes}` 仅确认本项目实验选择；服务端记录external_agent。该入口不能解除暂停、改变指定核心或改写人工策略说明。服务共享并发由引擎调度，不并行绕过7路额度。
6. 外部已有图片/视频先上传（第8节），再 `POST G/imports {planRevisionId,mediaUrl,commandId}`。这登记为外部来源的实测候选，不调用供应商。仍需可用的目标与固定计划；没有兼容能力时不能伪造计划或假称完全离线导入已支持。
7. `GET G/executions/:id` 查询并处理原执行；`reconciling` 用 `POST .../reconcile`，缺上游关联时按返回指引 `/associate {providerTaskId}`。取消 `/cancel` 后继续查终态。绝不因超时重复创建付费任务。成功但 `registrationError` 存在时修原目标后 `/register-results`，不重新生成。

   无上游编号的 ComfyUI 未知提交默认仍占本地并发名额。实际核对远端队列、覆盖提交时间的历史且没有对应在途任务后，可用 `POST G/executions/:id/release-reservation {evidence:"实际检查范围及结论"}` 释放占位；人工在结果页填写核对记录后使用同一操作。不要仅凭显卡空闲或最近20条记录认定旧任务未提交。记录与未知状态保留，不取消远端、不自动重发、不创建新候选。后续找到真实编号仍可验证并关联，已关联在途任务重新计入容量；正常排队任务按原质量、暂停及来源条件推进。
8. 按项目约定完成粗审或取得作者选择、处理系统技术阻塞后，`POST G/executions/:id/review {resultId,verdict:"adopted"|"needs_changes",notes,observations?}`。保存标记和候选来源由后台根据实际执行处理；无需人工传递版本号或计算摘要。旧调用若携带expectedRevision/contentHash/sourceHash，仍核对其一致性。服务端固定审核身份为`external_agent`，保留来源、技术检查与CAS；notes写实际观察和本次选择范围；粗审暂用注明待作者精审，不能把技术成功或制作选用当作者最终批准。退回会解除该结果仍拥有的当前采用关系，保留媒体和历史；改过的宫格或已退回的参考不能沿用旧视频计划继续提交。生成完成不能自写采用指针。

参考素材用 `POST G/references {projectId,mediaUrl,mediaKind,label,role}` 冻结后返回reference，再在任务中选择。`role`区分身份、环境、构图、宫格、首尾帧、motion、voice_timbre、full_dialogue；视频原声不会自动作为音色发送。`crop/extract_frame` 是本机处理任务，来源和用途分开；真实尾帧不同于故事板代表格。能力目录决定支持参数，不复制某个旧任务的固定数量。

普通资产批次每目标只提交一次，超时保留原任务，自动检查失败保留候选而不自动重画。质量前置失败的等待任务为 `held`；条件修好后按已有授权显式重新加入队列，不需另找用户审批，修改无关策略不会恢复旧队列。普通生产调用必须带实际 target，不能漏传后依赖 scratch 默认值。生成结果已有候选 ID，补充观察与审计时沿用它，不重复登记或全量覆盖生成前的场次。

Comfy视频返回后，查看结果的 `technicalIssues`；已知输出内嵌工作流与提交图不同会阻止采用，原文件和候选保留。供应商任务接口可能只回显提交图，不能据此认定实际后端、模型/LoRA和参数均未改变。底层任务outputs的 `executionEvidence` 只表示内嵌图核对（matched/mismatch/unavailable），不表示已验证CUDA内核或实际画面；缺少元数据也不能冒称核实。

## 6. 3D虚拟制片

日常布景增量编辑优先用 `PATCH /api/operator/previs/:projectId`，body含按稳定id局部更新的locations/objects/viewpoints/routes/connections，以及可选worldBrief/title/description；省略的旧内容保留。场次排演用 `PATCH /api/operator/previs/:projectId/:episodeId/:sceneId`，只带locationId/includedLocationIds/light或objects/frames局部项。已有camera和states按字段合并，服务端自动处理保存标记；无需维护世界/分集/排演版本号。完整替换和实际图像导出仍由原工具携带其真实读取/拍摄基线，不能拿最新来源冒充旧渲染的依据。

完整执行合同集中在 [3D手册](virtual-production.md#外部-agent-不调用模型的执行顺序)，不另写第二套建城协议。Agent使用 `mode:"external"` 直接设计世界、提交/修订候选、查看真实机位图及应用；本阶段不测试系统调用外部AI建城。

设计前读[片场联合筹备与当前能力缺口](virtual-studio-library-design.md#可拍摄标准与筹备当前规则)：从剧本动作出发，同时考虑美术、摄影、灯光、道具、群演和场记；在精建前试机位和动作，不能先堆建筑再找拍法。副导演/群演协调须明确承接：按事件把人物与群演实际放入场次，区分本场人员、当前在场和画内可见；摄影看遮挡与规模，场记核对承接。静态人物代理不依赖视频，合理无人场不填人。识别色与活动说明区分主角、剧情群演和环境人群，颜色不替代服装资产。一个Agent可完成这些专业视角，结果写入现有世界/场次/资产，不新增审批或重复文档。人偶已提供接地、双段手脚、手部目标/肘部方向与逐帧拿放控制。按实际用途选择静态取景或动态拍摄，粗审/返工轮数遵守项目约定；不为一张构图参考先精调手部或拍完整白模视频。[动作与接触检查](virtual-production.md#动作控制与接触检查)用于相关接触问题，数值与粗审均不冒充作者精审。必要动作受引擎限制时记录缺口，不由制作Agent改源码。

按全剧建立/扩建世界，保存地点用途、来源、稳定ID与缺口。共享库组件、街区、完整世界要区别；多个影视城可组合，物理连接不等于叙事转场。场次复用世界并安排人偶、剧情状态、机位；本机PNG/MP4不是最终生成媒体。整集白模保留叙事时长，不受H3单次容量约束；给H3的参考仍按单元拆分。

三维质量底线：不合理穿模零容忍，发现轮胎/脚埋地、人物穿墙、手与道具穿入台面等，相关参考不得采用或进入下游。粗审发现明显穿模才针对实际支撑面、变换几何和相关接触排查；动态用途检查相关运动，静态取景不强加完整动态排演。按约定返工上限修正和重拍，未解决的保留为待修候选，不冒称合格，不因此拖住无关镜头。具体方法见 [穿模与接触标准](virtual-studio-library-design.md#穿模与接触必须通过的质量底线)。系统提供接触检测，不会自动替演员避障或修正所有动作。

## 7. 互动影游

正式主体是 `/api/interactive/experiences`，不是制片Project的 `gameData`。原生结构见 [互动合同](../src/domains/interactive/types/schema.ts)。节点图、状态、剧本绑定、媒体绑定、布局分别持久化。外部Agent可直接写原生对象，不必调用 graph-drafts/content-plans 等系统模型工具。

### 建立体验与可运行图

1. `GET /api/interactive/experiences` 选既有作品；新建 `POST` 同路径，发送 `CreateInteractiveExperienceInput`，返回aggregate。推荐 `executionPolicy:"guided"` 清楚标识由外部Agent推进，它不代表创建时自动调用模型。`scratch` 仅建体验，没有自动生成作者剧本；需要正文时先按第3节建稿，再设置 `storySource:{mode:"bind_writing",writingProjectId}`。
2. 用 `GET /api/interactive/experiences/:id` 取得完整aggregate，下文 `I` 指该路径。`GET /api/interactive/writing-projects` 是可绑定作者稿；不要把制片projectId填成writingProjectId。
3. `PUT I/experience-spec {spec,expectedVersionIndex}`；`PUT I/story-architecture {architecture,status,expectedVersionIndex}`；`PUT I/details {details,expectedUpdatedAt}`。设计明确玩家角色、核心行为、可理解的后果、结局和复用边界，分别估计单次游玩、总剧情和独立视频量。
4. `PUT I/state-schema` 发送 `variables,factDefinitions,initialFactIds,expectedVersionIndex`。变量支持boolean/number/string/enum；条件用 `PredicateAST`，效果用 `StateEffectAST`，不提交JS字符串。声明可用事实与初始已知事实不同。
5. `PUT I/graph {graph,status:"draft",expectedVersionIndex}`。**当前保存输入是 `entryNodeId,nodes[].choices,semanticContractVersion:2`**，选择写在所属源节点的choices中；每个选择有id、targetNodeId、text、intent、condition（PredicateAST）、effects及interaction。服务端把choices转换为唯一持久化transitions；完整GET再派生choices供编辑。不要只提交transitions和空choices，否则选择不会保存；提交时省略返回的transitions，避免携带两份不同的边。新节点/选择应有显式interaction合同。角色知识、选择后果、状态写读和汇合要一致，不把相同场次强行复制为每个分支的正文。
6. `POST I/structure-preview-build {}` 做结构试玩快照，读返回诊断与状态。它不表示正式视频齐全。可用共享解释器验证代表分支/结局，实际试玩验证交互与节奏。`PUT I/graph-layout {layout,expectedVersionIndex}` 只改坐标，不改图语义、播放顺序或正式内容。

合法创建输入示例（内容只是API样例，不是新作品默认设计）：

<!-- example:interactive-create -->
```json
{"title":"接口验收互动短片","genre":"剧情","executionPolicy":"guided","formatProfile":{"format":"branching_fmv","aspectRatio":"16:9","platforms":["web"],"primaryLanguage":"zh-CN","targetSessionMinutes":1,"targetCompleteMinutes":2},"experienceSpec":{"playerRole":"来访者","playerPersona":"普通观众","interactionPromise":"选择是否交还钥匙并看到不同后果","coreVerbs":["选择"],"dramaticContract":{"genre":"剧情","theme":"信任","centralConflict":"是否归还钥匙"},"choiceCadence":{"targetChoicesPerTenMinutes":2,"maxMinutesWithoutChoice":2},"consequenceHorizon":["immediate"],"failStatePolicy":"rollback","savePolicy":"auto_checkpoint","accessibilitySettings":{"closedCaptions":true,"timedChoiceOption":"extended","colorBlindSafe":true}},"storyArchitecture":{"premise":"捡到一把钥匙","protagonistGoal":"作出决定","thematicQuestion":"是否信任","mandatoryNodes":[],"variableNodes":[],"endings":[],"branchBudget":{"maxDepth":2,"maxParallelBranches":2}},"storySource":{"mode":"scratch"},"productionBoundary":{"maxBranchDepth":2,"maxParallelBranches":2,"exclusiveContentPercent":50,"maxAutomaticRepairAttempts":0}}
```

### 绑定正文、进入制片与发布

1. `PUT I/story-source` 发送StorySourceBinding；`GET I/writing-scenes` 取得完整场次和服务器生成的精确 `ref`。不手造version/checksum。`?view=summary` 省略正文，`?nodeId=...` 读取节点已有固定绑定。
2. `PUT I/bindings/script {bindings:[...]}` 专门更新剧本引用并保留既有媒体；`PUT I/bindings` 写单个完整NodeContentBinding，或 `/bindings/batch` 写多项。保留已有 `versionIndex`；`slot`为entry/main/choice_hold/exit。一个节点的有序 `scriptSceneRefs` 必须来自同一作者稿revision、同一unit。`contentFitReview` 记录实际匹配理由和按顺序的sceneChecksums，不按节点标题猜正文符合。
3. `POST I/production-preparation {}` 检查已绑定正文；`POST I/production-prep {}` 建立/复用该互动作品独立的制片目标（返回201），`GET` 同路径回读。旧 `/content-lock` 是兼容别名，不意味着禁止后续编辑。不要把普通电影的制片项目强占为互动目标。
4. `POST I/production-plan {}` 形成确定性的共享制片计划候选，`GET I/production-plan/latest` 读，检查后 `POST I/production-plan/:planId/adopt {}`。沿返回目标做第4、5节制片。按节点精确剧本范围复用，不复制整个作者单元进入每个节点。
5. `GET I/production-media?nodeId=...` 获取该节点真实制片媒体引用（nodeId必填）；通过正式bindings接口保存 `mediaTakeRefs/mediaScenarios`，保留剧本引用。替换媒体时省略GET派生的旧单数 `mediaTakeRef`，避免与新列表冲突。`mediaFitReview` 要有检查理由与真实mediaChecksums。一个节点可绑定多段视频，多节点可在可见状态兼容时复用；不同服装、持物或剧情状态不能仅因URL相同而视为合格。
6. `POST I/runtime-build {}` 构建正式快照（201）；`GET I/runtime-build`、`GET I/runtime-story?runtimeBuildId=...`、`GET I/runtime-media?runtimeBuildId=...` 回读。`ready_for_preview`只是结构预览，`waiting_for_media`缺媒体，`ready_for_player`才是正式可玩快照；`stale`必须重新构建，不能使用旧快照假称当前版本。补齐、替换或重新确认媒体后，旧快照仍保留；再次POST构建，人工在试玩页选择「用当前内容重新准备」。
7. `GET/PUT I/playtest-checkpoint` 记录 `{runtimeBuildId,currentNodeId,state}` 的试玩检查点。保存检查点不是遍历测试。按制作约定粗查代表路径的选择、状态与结局能否运行；细致的字幕、声音、表演和各路径体验交作者精审，不默认反复遍历所有组合。
8. `GET I/runtime-export?runtimeBuildId=...` 导出HTML可玩包；结构预览包与含媒体的正式包不能混称。服务需能读取实际媒体；导出成功后仍要打开最终文件核验。

`GET I/authoring-status` 汇总缺项；`GET I/bindings/history?nodeId=...&slot=...` 查看历史。模型提案的生成、采用及协调工具按需使用；不是外部Agent直写图的必经步骤。没有服务端“选择下一节点”HTTP端点；可使用导出的播放器或当前共享运行时逻辑在本地模拟，不能虚构play接口。图验证不能证明作品好玩。

## 8. 素材、配音、剪辑与导出

| 能力 | 正式请求 |
| --- | --- |
| 上传文件 | `POST /api/assets/upload-file?projectId=...`，body为真实图片/音频/视频字节与正确MIME，最大100MiB；返回url及视频实测信息 |
| 小文件DataURL | `POST /api/assets/upload {projectId,dataUrl}`；返回url。传已有HTTP URL只是透传，不代表已经下载或持久化 |
| 导入远程图片 | `POST /api/assets/import {projectId,sourceUrl}`，限实际可读取图片 |
| 配音 | `POST /api/audio/speech {purpose:"production",target:{projectId,episodeId,sceneId,shotIds?},text,voice,modelConfigId?,language?,instructions?,speed?}` 返回WAV url；须通过当前范围的preparation。音色试听明确 `purpose:"preview"`，不带target；见 [SpeechRequest](../packages/domain/src/speech.ts)。属于真实模型调用，不是文档测试步骤 |
| 自定义BGM | `POST /api/proxy/custom-bgm {purpose,target?,url,model,prompt,keySource,apiKeyEnvName?}`，正式制作purpose/target同上；keySource按现有配置为serverEnv或local，local使用已有apiKey但不输出它。返回供应商原始响应，需检查并持久化音频，不把响应当作已保存作品 |
| 移除/替换视频原声 | `POST /api/assets/rewrite-video-audio {projectId,videoUrl,mode:"strip"|"replace",replacementAudioUrl?}`，替换音轨需系统本地媒体；生成新文件，不覆盖原片 |
| 简单拼段 | `POST /api/assets/compose-video-segments {projectId,videoUrls,aspectRatio}`，2–10段 |
| 完整剪辑合成 | `POST /api/assets/compose-episode-film`，见下方；依赖ffmpeg/ffprobe |
| 媒体审计登记 | `GET/POST /api/operator/assets`，输入按 [OperatorRegisteredAsset](../src/services/operator/types.ts) 合同；登记不等于写入项目采用指针 |

合成请求包含 `projectId,aspectRatio,resolution,frameRate,shots`。每个shot恰有 `videoUrl` 或 `imageUrl`，另有 `durationSeconds,sourceStartSeconds?,transition?`（none/fade/black）；最多200项，每项不超过600秒。可带 `audioTracks:[{url,startTime,duration,volume,sourceStartSeconds}]`、`masterAudioUrl`、`subtitleUrl`，声音时间均为秒。输出 `{url,qualityStatus:"pending",purpose:"review_preview"}`，是待审合成预览，正式交付须完成quality整场/整集检查并调用deliveries；静态图片段是静态片段，不能声称已生成动态视频。保存时间线与最终导出回执，再实际播放/测量。

Gemini AUDIO 和 custom BGM 入口同样要求 `purpose` 与正式制作 `target`，共用当前范围preparation前置检查；声音可与画面并行制作，不依赖尚未产出的segments。试听和独立音乐实验不带正式target，其结果进入作品后仍须实际听审。Gemini TTS失败不自动重发。segments检查默认提供当前视频及未静音的独立声音，不能只看无配音视频后声称声音通过。

新增场次旁白或拖动解除镜头绑定后的配音可省略 `shotIds`，按整场准备检查，不必补绑无关镜头。库音频保存实际 URL；只有浏览器本地库 ID、未保存 URL 的历史音轨需要重新选择一次素材，后端不会把无法读取的声音当作已听审。

角色音色使用角色已有voiceSettings；试听/对白生成后保存候选和对应角色/台词来源，不只把url写在聊天里。配音、BGM、音效分别制作，不把BGM当角色声音。当前IndexTTS未接通，不能因未来计划而宣称可用。

旧批量管线另有 `POST /api/operator/projects/:projectId/assets/:assetId/adopt|discard`，只处理 `metadata.phase=storyboards`、`adoptionStatus=awaiting_review` 且具备真实源artifact的Operator故事板候选。它不接受生成工作台execution，不是第5节review限制的替代入口；不人为改候选类型以套用它。

## 9. Skill、拉片、设置和维护

制作时可读取所需 Skill/提示词、执行拉片；以下全局写入仅用于用户明确要求的维护任务，不因 API 可见就获得修改权限。

| 功能 | 接口/操作边界 |
| --- | --- |
| Skill与分类 | `GET /api/skills`返回 `{skills}`，`POST /api/skills`新建，`PUT/PATCH/DELETE /api/skills/:id`修改/删除；`GET /api/skills/categories`返回 `{categories}`，POST同路径新建，`PATCH/DELETE /api/skills/categories/:categoryId`维护分类。任务按需选择，不因可用就全量注入；写入字段用当前记录和 [Skill合同](../packages/domain/src/skill.ts) |
| 提示词 | `GET/PUT /api/prompts/:name`；GET返回 `{content,source?}`，PUT发送 `{content}`，不擅自重置用户自定义。默认生成模板和外部创作包各有归属 |
| 模型配置 | `GET /api/provider-key-status` 查是否具备凭证；只有需要配置时读 `/api/ai-config`。其GET为 `{config,...}`、PUT body为config自身，不是整个响应；全量保留未修改渠道/模型。部分非Comfy字段仍可能包含密钥，禁止打印完整响应 |
| 拉片 | `GET /api/video-analysis/projects?page=1&limit=10&search=...`；POST同路径新项目，`PUT /api/video-analysis/projects/:id`保存完整项目；`POST .../:id/segments`追加，`PUT .../:id/segments/:segmentId`修改。合同 [VideoAnalysisProject](../src/types/videoAnalysis.ts)。保存分析不会自动观看视频，当前没有独立服务器端自动拉片任务API |
| 历史写作 | `GET /api/script-archives`，只读导出；不复活410的旧assistant/agent/script-workspaces端点 |
| 备份/清理 | `/api/system/backup` 备份数据库；完整作品备份还要媒体。`GET /api/system/gc` 只预览，POST移入可恢复的回收区，尚不释放磁盘；`POST /api/system/gc/restore`恢复。通用清理保护整个3D模型、预览与预演目录，源模型和续拍帧不能只凭缺少URL判为垃圾。只在用户要求维护时执行，不把历史成果、本地语音模型或已安装依赖视为缓存 |

全局2D资产/音色复用模板当前由浏览器 `useGlobalStore` 持久化，尚无对应服务端CRUD；不要操作localStorage冒充系统API。当前无需UI可管理的是**项目内**资产/角色声音、Operator媒体记录和服务器3D共享库。这是范围差异，不把全局模板与项目实例混成同一套数据。

## 10. 可选的严格批量制片与审计

普通逐场制作、已有作品编辑、剧本任务和互动原生API不必先创建全部批量阶段。`GET /api/operator/workflows` 只约束显式使用的canonical batch流程；其中旧interactive阶段不是新互动领域对象的所有者。

需要制片审计时 `POST /api/operator/runs` 创建真实projectId范围的OperatorRun；`GET/PATCH /runs/:runId` 维护状态，`POST /runs/:runId/events` 记录实际操作。使用artifact管线则必须 `POST /api/operator/artifacts/draft` → `/artifacts/:id/qa` → `/artifacts/:id/commit`，不能直接写committed或假QA；输入见 [Operator合同](../src/services/operator/types.ts)，QA可 `{auto:true}` 运行真实规则。自动QA不是画面审片。

`/api/operator/projects/:projectId/context`、`long-form-memory`、`asset-continuity`、`production-cockpit` 提供既有制片摘要/缺口。部门、选角、策略试验、创作变更等能力用于对应制作需求，不是每部短剧必须提交的表格。`departmentAgentSystem` 等是方法/合同目录，不是已移除的聊天助手重新运行。

## 11. 当前边界、故障处理与完成判定

**目前不能宣称全功能都已无UI闭环**：

- 生成Operator可通过带准确媒体/来源指纹与实际观察的`review`正式采用，审核身份为`external_agent`，不会冒称人工。`policy`仅开放带说明和CAS的`allowExperimental`选择；其他策略字段仍返回403。不得解除用户暂停、覆盖人工锁定或直接写采用指针。来源变化与版本冲突须重读核对。
- 全局2D模板没有服务器CRUD；外部交换zip和delivery转换没有独立HTTP导入器。已有本地纯适配器与原生HTTP保存可完成作者/制片回填，但不能描述成“一条远程自动导入API”。
- 当前3D支持静态结构、简化关节演员、手部目标与接触检查；尚无精细蒙皮/口型、全身动作求解、刚体物理或自动避障。任意题材建造效果需实际检查。
- 个别旧接口无CAS；metadata/拉片等写入串行处理。没有自动替Agent执行所有恢复的后台助手。

400/422先改输入或引用；401/403查已有访问权限或实际角色边界；409重读差异；404确认对象与路线；410停用旧接口；供应商/网络失败保留原执行并查询。缺凭证、额度不足、能力未接通分别报告，不声称重试必定解决。文档若与实际接口不一致，保留错误响应及复现到作品交接，使用已确认可用的业务路径；制作 Agent 不修改系统文档或实现，不通过写库伪造成功。

结束时回读实际数据，记录项目/分集/场次/节点/任务ID、保存版本、媒体URL、实际检查证据及未完成项。分别报告“内容已写入”“技术通过”“Agent粗审/制作暂用”“待作者精审/作者已确认”；候选或粗剪的交付不宣称最终作品合格。制作 Agent 把项目进度写入独立作品目录的交接，包含当前要求、ID、版本、证据及下一步，并简记已生成/在途任务ID、已完成粗审轮数与范围、已用返工次数或时间及剩余安排。新会话续用该进度，结合正式任务状态核对，不重新开始计数；维护会话才汇总到 [handoff](handoff.md)。产品规则与专项合同只由维护任务更新，不在作品交接复制整套制度。
