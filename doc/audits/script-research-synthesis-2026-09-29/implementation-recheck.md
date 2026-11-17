# 综合研究的当前实现复核

日期：2026-09-29。分支 `codex/script-system-rebuild`，HEAD `a9a3a86b`。

本次先完整阅读交接与四份核心报告，再做定向复核。没有把旧报告的 20 项测试当作本轮执行结果。以下以当前未提交工作区为准；未修改业务代码，未执行迁移、提交、生成或采用作品内容。

## 1. 本轮实际做了什么

- 用 `git -c core.fsmonitor=false status --short` 核对已有未提交代码与研究文件；起始时 HBO、电影案例文件尚不存在。
- 阅读创建、蓝图、结构、共享范围、普通候选、审阅请求、Agent 范围、采用、四页入口的相关代码。
- 浏览现有 `127.0.0.1:3000/writing` 首页及一个已有单篇作品的四页。仅切换导航，没有发送消息、修改字段、生成、保存、采用或加集；保存按钮保持禁用。页面初始化包含应用自身的会话打开逻辑，未做数据库文件前后字节比对。
- 执行仅操作内存对象的函数探针，结果保存为 [in-memory-recheck.json](/Users/yang/Desktop/code/movie/a-22/doc/audits/script-research-synthesis-2026-09-29/in-memory-recheck.json)。该探针不打开数据库，不调用模型。
- 没有新建隔离服务、重启用户服务，也没有在真实作品上重新复现错集或批量采用。

## 2. 当前证据与判断

| 项目 | 本轮证据 | 结论与边界 |
| --- | --- | --- |
| 形式与关系 | [schema.ts](/Users/yang/Desktop/code/movie/a-22/packages/script/src/schema.ts:7)、[creation.ts](/Users/yang/Desktop/code/movie/a-22/packages/script/src/creation.ts:6) | `organization`、`continuity`、`workType`、`genres`、作品及单集时长已存在；默认数值不是行业标准。 |
| 蓝图产物 | [blueprint.ts](/Users/yang/Desktop/code/movie/a-22/packages/script/src/blueprint.ts:7) | 已要求一次提出精简人物和设定，区分建议与已定要求，生成后停在蓝图。不要重复建设。 |
| 目标错位 | [聊天取目标](/Users/yang/Desktop/code/movie/a-22/apps/web/src/features/script/ScriptDurablePanel.tsx:496) 对照 [委托取目标](/Users/yang/Desktop/code/movie/a-22/apps/web/src/features/script/ScriptDurablePanel.tsx:407) | 聊天用 `chatContext.unitId`，委托仍传工作区 `unit`。本轮静态确认缺口仍在；页面复现沿用旧隔离证据。 |
| 正文上下文 | [scriptDraftCapabilities.ts](/Users/yang/Desktop/code/movie/a-22/apps/api/src/agent/scriptDraftCapabilities.ts:87) | 蓝图与目标场正文已带入；单元投影只有标题、摘要和部分场景规划，没有本集覆盖时长、结尾、相关前集实际结果。`plan_scenes` 另有尾场衔接来源，不能将其说成所有操作一律无前文。 |
| 检查依据 | [scriptReviewCapabilities.ts](/Users/yang/Desktop/code/movie/a-22/apps/api/src/agent/scriptReviewCapabilities.ts:106) | 默认组装为批次原文、作者要求、可选 Skill／显式来源／记忆，没有稳定附带蓝图依据；旧冻结请求证据支持这个判断。 |
| 两套组装 | [methods.ts](/Users/yang/Desktop/code/movie/a-22/packages/script/src/methods.ts:34) 对照上面的普通候选 | 旧任务含目标单集时长、邻场原文、其他集摘要，不能据此推断普通助手也已得到这些内容。宜共用上下文合同，保留各操作的窄读写范围。 |
| 常驻资料丢失 | [creation.ts](/Users/yang/Desktop/code/movie/a-22/packages/script/src/creation.ts:72) 与内存探针 | 初始化资料全落首集范围；新增第二集可见人物、设定均为 0。小传写“常驻”没有改变结构作用域。 |
| 跨集故事组 | [ScriptUnitSettings.tsx](/Users/yang/Desktop/code/movie/a-22/apps/web/src/features/script/components/ScriptUnitSettings.tsx:6)、[continuity.ts](/Users/yang/Desktop/code/movie/a-22/packages/script/src/continuity.ts:145) | **已有页面下拉与预览**，可把本集加入另一故事范围。探针加入后人物、设定各为 1。无需另建故事组主页面；欠缺合理默认、创建委托和上下文联通。 |
| 新集权限 | [scriptGoalAuthoring.ts](/Users/yang/Desktop/code/movie/a-22/apps/web/src/features/script/scriptGoalAuthoring.ts:25) 与内存探针 | 新集 target 只有数量、最大场数；显式前文来源只有选中一集，未带人物／设定新建范围。不能把后端能力存在说成此入口已接通。 |
| 批量分集采用 | [planning.ts](/Users/yang/Desktop/code/movie/a-22/packages/script/src/planning.ts:101) 与内存探针 | 计划24、原有1、返回1，采用后确实变成24集且仅1集有摘要。需按本次结果与目标范围采用。 |
| 首次分场 | [agentDraft.ts](/Users/yang/Desktop/code/movie/a-22/packages/script/src/agentDraft.ts:116)、[planning.ts](/Users/yang/Desktop/code/movie/a-22/packages/script/src/planning.ts:121) | 普通 `plan_scenes` 直接追加；旧 `applyScenePlans` 会在没有作者内容时替换空场。修复应复用已有作者内容判定，不能删除作者已有空对白但填写了地点的场。 |
| 幕／段落范围 | [schema.ts](/Users/yang/Desktop/code/movie/a-22/packages/script/src/schema.ts:18)、[scriptGoalAuthoring.ts](/Users/yang/Desktop/code/movie/a-22/apps/web/src/features/script/scriptGoalAuthoring.ts:9) | 有场次、故事顺序、故事线，无幕／段落实体与场景归属；范围仅当前单元、项目总纲、选场。需要最小结构层才能可靠按段委托。 |
| 长片默认 | [ScriptDurablePanel.tsx](/Users/yang/Desktop/code/movie/a-22/apps/web/src/features/script/ScriptDurablePanel.tsx:122) | 新增场数默认4，单批规划允许1–30；都不是全片容量上限。改变默认数值不足以证明全片覆盖。 |
| 完成标准 | [agentGoal.ts](/Users/yang/Desktop/code/movie/a-22/packages/script/src/agentGoal.ts:59)、[goalChecks.ts](/Users/yang/Desktop/code/movie/a-22/packages/script/src/goalChecks.ts:284) | 已有原文覆盖和范围检查、两轮返修上限；结构对齐是可选要求。应按任务接通，不建评分中心。 |
| 候选采用 | [ScriptDurablePanel.tsx](/Users/yang/Desktop/code/movie/a-22/apps/web/src/features/script/ScriptDurablePanel.tsx:550) | 已有候选应用到工作稿，再安全采用到作者稿的路径，包含版本冲突保护；存在其他工作稿变化时进入比较。应保持页面成果可见，不另建手工复制回填流程。 |

## 3. 实际页面读取得到的补充

首页存在“生成作品蓝图”，说明生成后停止；“交给 Agent 处理”另行指定阶段。作品内四页均可导航，正文有“阅读全文”和局部 AI 讨论。

单篇大纲页虽已写“完整故事大纲即可进入分场，右侧摘要可选”，仍显示“与 AI 规划分集安排”；分场页仍显示“全剧分场建议”“补本集分场”。这是有证据的小型文案与入口修正，不是重做页面布局的理由。

大纲页未传入加集回调；分场与正文场景树已接 `handleAddUnit`。将既有加集能力接到大纲页即可，不再创造第二套新增集机制。跨集故事共享设置实际挂在单集详情的 `ScriptUnitSettings`，不是另一个主页面。

## 4. 哪些结论仍未被本轮证明

没有调用真实模型写完一部长片、多集连续剧或短剧，没有证明艺术质量达标。对话定位、上下文和采用的旧隔离运行证据仍可引用，但必须标为历史验证。三个内存探针仅证明当前函数行为，不等于所有 API、浏览器路径均验收通过。

最终实施验收应重新冻结实际模型请求，并在隔离作品中做页面操作；不能仅测试辅助函数后宣布各入口一致。

## 5. 交付前文件保护检查

对本轮写文档前记录的1309个工作区文件做内容哈希比较，既有非文档文件无变化；既有文档仅修改剧集报告的来源说明和本次交接补注。HEAD仍为 `a9a3a86b`，未提交。详见 [preservation-check.json](/Users/yang/Desktop/code/movie/a-22/doc/audits/script-research-synthesis-2026-09-29/preservation-check.json)。这项比较覆盖工作区文件，不覆盖数据库或浏览器存储。
