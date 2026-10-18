# 剧本 Agent 整体进度复核

> 审计后续：2026-09-27 用户明确缩减使用前门槛并授权 C1–C4；现已完成最小消息保护、切手动暂停、限定验收与正常服务启动。此文保留审计时点事实；最新交付状态以 [主计划顶部](script-agent-repair-plan-2026-09-27.md) 为准。

日期：2026-09-27。核查代码：`222433e8`，分支 `codex/script-system-rebuild`。本轮按用户要求暂停启动正常服务，仅做代码、设计、测试和隔离内存库探针核查；未调用外部模型，未改作者作品或实现代码。

> 审计后的范围决定：用户要求先交付核心可用版，后续在使用中优化。下列六项仍是对原完整设计的差距，但不全部是本轮交付门槛。当前仅补运行中消息保护、切手动联动暂停，再做有界验收和服务启动；完整迁移、直接工作稿编辑、长前集分批和接受审阅意见延后。具体 Todo 以 [主清单顶部的最小收口计划](script-agent-repair-plan-2026-09-27.md) 为准。

## 结论

**通用 Agent 核心已有实质实现并接入正式剧本 runtime，但原设计的一整套底座与剧本作者流程尚未开发完毕。当前仍处于功能整合阶段，不能表述为只剩用户验收。**

此前把“核心机制通过测试、局部隔离作者路径走通”概括为“底座代码已完成”，范围过大。本次从原始设计重新核查，确认六项实现或接线缺口。它们与真实模型质量、演读时长等作者验收项目不同；是否立即开发，按用户最新的核心可用范围决定。

判断依据包括研究目录 `04-agent-foundation-design.md`、`04-contracts-and-migration.md`、`13-goal-workspace-implementation-plan.md`、当前 R0–R10 主清单和当前代码。旧 `script-agent-acceptance-matrix.md` 顶部的第三集、电影和前集记忆断点已经落后，不能沿用为当前失败结论。

## 已确认落地的部分

| 层次 | 当前事实 | 证据与边界 |
|---|---|---|
| 可复用包 | `agent-core`、`agent-context`、`agent-sqlite` 已实现能力/资源协议、Goal/Run/Turn/Sampling、worker、租约与防迟到写入、模型日志、预算、持久上下文和记忆 | `tests/agent-core.test.ts:45` 有非剧本清单能力；`:174` 起检查领域依赖和迁移快照；`tests/agent-goal-review.test.ts:28` 有文档 Goal 夹具。不是只建目录或空接口 |
| 正式运行接线 | 正式 server 注册共享 runtime 并启动父 worker、子 worker、记忆循环 | `server.ts:152,317`；`apps/api/src/agent/scriptRuntime.ts:25–56`。不能据此推导每个页面入口都已迁移 |
| 剧本领域能力 | 固定授权的读稿、候选、采用到工作稿、分批检查、有限返修、完成证明已有实现 | `scriptHost.ts` 注册 `script.read/propose/apply_patch/check_status/check_batch/begin_repair/mark_repaired`；对应领域和正式宿主回归已存在 |
| 新助手主要入口 | 首页可创建持久 Goal；作品内聊天可派发写作/审阅委托；ASK 回答、明确修订、下一集固定来源已有实现 | 当前 R1–R7 定向证据有效；不代表运行中自由输入、所有快捷入口与接管编辑都已完成 |
| 隔离交付 | 单集、第二集、短片的标识模拟运行成功；双集页面预览、采用、重开和固定导出走通 | 证明所测规模和所测路径的执行/保存，不证明 90 分钟长片、全量浏览器异常路径或真实创作质量 |

## 确认尚未完成的开发项

### A1：全部入口共用底座尚未实现

现役故事板和分集节拍页仍走 `createJob → 浏览器 generateAIContent → submitJob`。实际入口见 `ScriptWorkspace.tsx:766,798`；调用见 `components/StoryGridBoard.tsx:178–183,316–321`、`components/EpisodeBeatView.tsx:183–188`。`ScriptWorkspace.tsx:933–935` 对部分操作和审阅来源仍渲染旧 `ScriptAssistant`，其模型调用在 `ScriptAssistant.tsx:63`。

这些操作没有走新底座的同一套 Invocation/Attempt、持久执行、共享预算和恢复协议。不能宣称“所有快捷按钮、手动和 Agent 已共用能力”。原设计阶段 C/F、T20 的迁移收口仍需完成；保留旧历史读取与允许新请求继续进旧链是两回事。

### A2：活动委托中的自由输入没有优先调向能力

原设计要求作者输入先阻止旧计划继续派发，再建立优先 CONTROL Turn（`13-goal-workspace-implementation-plan.md:264`；`04-contracts-and-migration.md:18,95`）。当前 `conversationStore.ts:66` 总是建立普通 CHAT Run，`store.ts:193–204` 会让它等待同线程活动 Goal。`ScriptDurablePanel.tsx:407–422` 未绑定正在运行的 Goal 控制身份。

本轮隔离内存库实际探针：创建外部回填渠道的 Goal，冻结首个决策，再在原会话提交“第二场改温和一些”并尝试 worker 领取新消息。结果如下：

```json
{"before":{"status":"WAITING_EXTERNAL","generation":1},"after":{"status":"WAITING_EXTERNAL","generation":1},"chat":"QUEUED","goalActive":true}
```

旧 Goal 的控制代际未改变，新消息只是排队。明确点击暂停和随后修订可以工作，但不能替代原设计的运行中自然语言调整。

### A3：从 Agent 切回手动没有联动暂停

`ScriptWorkspace.tsx:927–928` 的模式按钮只修改 React 状态；`ScriptDurablePanel.tsx:277` 的模式 effect 只切工作稿选择。关联手动步骤要求 Goal 已处于 PAUSED/WAITING_INPUT/NEEDS_REBASE（`:125–127`）。原设计要求模式切手动即撤销旧推进权限、保存安全状态，再允许接管。当前仍需要作者另找暂停按钮，因此该模式切换行为未完成。

### A4：AI 工作稿不能直接在页面中途手写编辑

后端工作稿 PUT/saveAuthor 与客户端 `saveWorkspace` 已有（`scriptWorkspaceRoutes.ts:14`；`scriptClient.ts:131`），但搜索 `apps/web/src` 只有该客户端定义，没有调用方。首页 `ScriptHomeGoal.tsx:133–141`、作品内 `ScriptDurablePanel.tsx:660–697` 只提供工作稿阅读、候选比较和采用。

原编辑器仍编辑正式作者稿。现有“改作者稿→同步工作稿”与“先采用→再编辑”路径不能等同于“未采用的 AI 工作稿中途接管、直接手写、继续同一委托”。需要把编辑器读写目标真正接到 workspace 版本和接管接口。

### A5：长前集来源仍可能让写作/检查无法启动

Goal 决策只放来源元数据并提供分页 `script.read`（`scriptGoalPlugin.ts:124`），但候选准备 `scriptDraftCapabilities.ts:81,99–105`、检查准备 `scriptReviewCapabilities.ts:102–109` 会把每份所选来源全文作为必需输入塞进 48k 预算。前面的分页读取不能减少这些后续请求的全文注入。

本轮正式 host + 内存 SQLite + 外部回填机械决策探针：选定含 90,000 个字符的固定前集单元；Goal 的决策能够冻结；返回一次合法 `script.propose(scene_body)` 后，worker 在候选准备时失败，未生成 draft 外部请求：

```json
{"previousChars":90000,"decisionFrozen":true,"status":"FAILED","reason":"CONTEXT_BUDGET_EXCEEDED","result":{"error":"完整必要输入约需 138109 tokens，应用预算 48000，请分批处理；未截断正文"},"externalDraftRequests":0}
```

拒绝静默截断是正确保护，但“请分批”目前没有对应的候选/检查来源分批执行路径。需要接通有来源的必要片段、按需读回与完整覆盖策略，不能把扩大预算当作唯一解决办法。

### A6：作者接受审阅意见的分支仅停在领域函数

`packages/script/src/goalChecks.ts:269` 已有 `acceptFindingByAuthor`，目前只有领域单测调用。`ScriptAuthorCommand`（`scriptCommands.ts:24–29`）、审阅仓储、作者路由和 `ScriptDurablePanel` 没有持久命令/页面路径。页面只展示问题，作者无法按原设计明确接受某项阻断意见并形成可追溯的合同修订。

这不会授权模型自行放宽完成条件；应补作者身份、精确问题/版本、命令幂等及合同修订，而非直接修改 finding 状态。

## 验证范围与仍待验收

- 本轮重新运行 `npm run test:agent-foundation`：110/110，通过，约 25.8 秒；包括非剧本能力、依赖边界、持久恢复等已有测试。
- 本轮两个新隔离探针实际复现 A2 和 A5。使用 `:memory:` SQLite；transport 在被调用时抛 `NETWORK_FORBIDDEN`；全部外部回填仅为机械协议，没有创作或供应商调用。
- A1/A3/A4/A6 由当前活跃组件、注册路径和调用引用交叉核查；独立审查者同样确认。
- 前一阶段的宿主 14/14、domain 80/80、类型和构建通过仍是各自范围的有效证据；本轮没有把它们重新运行，也不以其数量覆盖本次新发现。
- 当前单场短片/有限双集模拟不能替代原设计 T14 的 90 分钟目标长片与长链返修交付。完整长片、前集较长时续写、工作稿直接接管、自然语言运行中调整必须在开发后补实际路径验收。
- BFCache、存储失败后取消离开、跨标签页助手/工作稿竞态、中文输入法及页面 ASK 完整交互还有验收缺口。
- 不调用外部大模型是当前交接约束；真实供应商、艺术质量和演读时长由后续授权的实际使用验收。不能把这些约束造成的未验项混同为上面的工程缺口。

## 审计后的收口决定

原建议“六项全部补齐再做完整验收”已被用户最新要求收窄。当前执行 C1–C4：A2 先用明确暂停/修订路径及防误排队保护，A3 复用现有暂停接口，完成一轮针对改动的检查后启动服务。A1/A4/A5/A6 完整能力、90 分钟长片全流程及严格历史性能对照进入使用后待办，不阻止核心可用版交付。本轮仅制定计划，未实施。
