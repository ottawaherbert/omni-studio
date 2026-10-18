# 剧本 Agent 目标与验收矩阵

> 2026-09-27 本轮收口完成：用户授权的 C1–C4 已实现并验收，35 项定向测试、类型检查、构建及限定独立复核通过；隔离页面完成运行保护→暂停切手动→采用→编辑保存→同步→明确继续。正常服务已启动于 http://127.0.0.1:3000/writing 。当前阶段为“核心可用版，进入用户实践”，原完整设计的延后项不再作为本轮门槛。详情见 [本轮交付记录](script-agent-repair-plan-2026-09-27.md)。下面为此前计划/审计与历史证据，不代表仍需全部完成。

> 最新交付范围：用户已要求先收口核心可用版。原完整设计验收矩阵保留参考，本轮门槛缩为 [主清单的 C1–C4](script-agent-repair-plan-2026-09-27.md)，其余根据实际使用反馈推进，不要求全部补齐才允许开始使用。

> 当前状态索引（2026-09-27，代码 `222433e8`）：本文件以下内容为历史检查点，不代表最新进度。当前实现与新增缺口见 [整体进度复核](script-agent-progress-audit-2026-09-27.md)，执行状态以 [R0–R10 与 A1–A6 主清单](script-agent-repair-plan-2026-09-27.md) 为准。前集记忆接线及有限单集/续集/短片模拟已有新证据，但全入口共用、运行中调向、工作稿直接编辑等仍未完成。

2026-09-27 S18 当前检查点：S17 `1e0693ee` 已提交。第二集隔离原 Goal/Run 完成 10/10 真实检查、FINISH、作者采用 v2、固定版本 Fountain 导出及原页面重开；这证明执行与保存流程，不证明艺术质量。第三集在同一新 Goal/Run revision3 继续，已有真实 `script.read` 前集和数次候选采用，最终检查/FINISH/作者采用未完成；电影原 Goal 正继续检查。S18 修复范围外记忆导致候选/检查提交误报的授权读者缺失，并修复作者审阅状态在缩窄来源后仍计旧覆盖或被 `MEMORY_SOURCE_RANGE_DENIED` 阻断的问题。正式宿主正反例、独立复评无剩余 P0–P2；相关 57/57、扩展正式宿主 14/14、作者审阅撤权 2/2、HTTP 3/3、`lint` 与生产 `build` 通过。隔离第三集有六条已提取记忆，但当前固定前集 readgrant 尚不能让对应第二集三条进入新 Goal 冻结上下文，属未实现/未验收，不能把公开 API 的六条当作注入证据。页面配额失败的提示与离开确认已可见，取消后留稿与 BFCache 仍待真实浏览器验收。以下旧表及段落是当时检查点，当前状态以本段和代码为准；完整目标 ACTIVE。

2026-09-27 S17 当前检查点：S16 已提交 `b96ecb4b`。原 3030 第二集 Goal 仍为 9/10 检查，第十项旧回填与已提交九项回执保存；旧子步骤在实现变化后安全要求作者明确重订。原 3032 电影 Goal 已采用 8/10 场，第九场冻结请求等待指定 Sol 回填。S17 将同一真实 DB 租约检查点接到父/子 worker、Goal 决策和内部 `invokeModel`，一个模型事务的多个来源核验共享 23 秒上限，来源核验后必须再次确认执行 fence；异步让出后重验能力来源，已提交 child 确认前以有上限的延长租约覆盖两个必要核验，短心跳不能缩短该期限。监督具体反例 7/7、独立评审反例 5/5，最终独立复评无未关闭 P0–P2；版本化测试见 `tests/agent-lease-independent-regressions.test.ts`、`tests/agent-model-headroom.test.ts`。最后代码改动后 foundation 110/110、Goal 45/45、domain 80/80、真实 HTTP 13/13 与 7/7、类型检查、生产 build 和文档自检通过；阶段提交在途。这些机械与冻结 Sol 模拟只证明执行流程，不证明作品艺术质量。原页面存储配额失败提示与离开确认已在浏览器可见，弹窗取消后的留稿仍待 Mac 解锁实测。整集/电影 FINISH、采用、固定版本导出/恢复、下一集和最终页面验收仍待完成，目标 ACTIVE。以下为旧检查点。

2026-09-27 S16 当前检查点：S15 已提交 `dbc45996`。第二集原 3030 库已按真实作者 HTTP 扩额并在原 Run 恢复，旧第十项因实现变化明确重订且原文/hash 保留；当前 revision 5 新决策冻结待 Sol 回填，九项已提交检查未变。针对长链同步校验新增 23 秒批次停止与两次过期重占上限，`LEASE_STALL_LIMIT` / `CONTEXT_VALIDATION_LIMIT` 由作者明确继续恢复原冻结结果，暂停或同内容修订不能绕过。记忆任务保留已接收原文、按持久退避跨工作区推进；作者保存同步入失效队列，后台重扫前旧记忆读取仍实时核来源。正式宿主 9/9、核心组合 91/91、预算恢复机械 9/9 加真实 HTTP 1/1、独立故障反例 13/13、lint/build 已通过；独立终评未见未关闭 P0–P2，阶段提交待完成。单个不返回的来源解析函数仍不能被同步时限强制中断，持久重占上限只防止无限重试。完整第二集、电影和下一集交付仍待真实 Sol 模拟与页面验收，目标 ACTIVE。以下既有数字为各自检查点。

2026-09-27 S15 更新：S14 已提交 `c98c7a7f`。预算终止后同一 run/step 恢复、旧子租约 fence、已接收结果单次消费、COMMITTED 未确认回执、重启、内联冻结读取、实现/作者稿变化触发 `NEEDS_REBASE` 与显式修订来源保留已通过机械 8/8；其中一项走真实作者 HTTP、隔离 SQLite 和 worker。独立评审无新增 P0/P1/P2，`lint`/生产构建通过。第二集 3030 原库仍为 9/10，须在阶段提交后以新代码恢复并完成 Sol 模拟回填、FINISH 与交付；这批机械测试不证明创作质量。完整目标 ACTIVE。

2026-09-27 检查点：`61abdb58` 与 `7720ea5f` 已提交，后者的子租约跨同步边界续期通过定向回归与独立复核。S14 草稿隔离修复已做 3029 真实页面/API 验收，独立复评又推动复制标签页、BFCache、同页切作品与存储失败导航保护；缓存反例5/5、lint/构建通过，配额失败导航与 BFCache 尚未真实浏览器注入，详见研究目录 `s14-browser-3029-evidence.md`。原第二集 Goal 在第 10 项已接收模型结果后耗尽活动时间，实际停于 9/10；同 Goal 扩额后继续会绕开旧回执，定为 S15 待修。完整目标保持 ACTIVE。机械常量不代表模型创作，Sol 模拟不代表艺术质量。

| 用户要求 | 当前实现与真实证据 | 尚待验收 |
| --- | --- | --- |
| 原有同页聊天、想法选择、模式下拉、Skill 选择；手动与 Agent 共用能力 | 原助手入口由 `ScriptDurablePanel` 接持久命令、Goal、候选和对话；`agent-conversation-http.test.ts` 真实 API/worker 两轮 Sol 回放、选项与 Skill；3015 浏览器桌面/窄屏记录在 `07-implementation-progress.md`，3028 页面故障见 `browser-3028-faults/README.md` | 两个 Chrome 标签的旧作者稿保存冲突已实测且不会覆盖；完整助手对话跨标签切换及真实中文输入法组合事件仍需实机复现 |
| 自由表达能派发明确写作要求，范围不清时询问，讨论时回答；快捷按钮同能力 | `scriptManualDispatch.ts` 固定作者目标后只允许一次 CALL/ASK/REPLY；`script-manual-dispatch.test.ts` 覆盖真实冻结范围、CALL 到候选、ASK 保留对话、无权操作拒绝；早期 Sol HTTP 来源在 `sol-manual-dispatch-http-acceptance.json` | 当前原页面按自由写作、ASK、REPLY 三条语义路径的 Sol 回填与页面候选比较仍需最终实测 |
| 完整 Skill 内容、版本与 usage 生效；无 Skill 可用；API/复制回填只作渠道 | `script-agent-methods.test.ts`、`script-review-capabilities*.test.ts` 验证按操作筛选、全文/版本/usage及来源追踪；`sol-context-acceptance.json` 记录 Sol 冻结请求、回填、采用；无 Skill 用例在剧本域回归 | 当前整集 Goal 的 Skill/无 Skill 交叉证据需与最终成果版本关联，不把测试夹具当作者艺术认可 |
| 作者稿与 AI 工作稿分离、局部不越界、手写保存/切场/重开/异步返回/恢复不丢稿 | `script-workspace.test.ts`、`script-workspace-http.test.ts` 覆盖独立版本、结构冲突逐项选择、接管、迟到返回、采用/固定旧版导出/恢复；workspace 33/33、script 132/132；3028 浏览器双标签草稿丢失先复现，3029 真实页面/API 验证分键恢复、在途编辑、同/跨作品迟到回执、恢复稿保存刷新、借读与撤销，见 `s14-browser-3029-evidence.md`；独立代码复评及缓存5/5通过 | S14 的 BFCache 与配额失败导航未作真实浏览器故障注入；整集正文最终采用后再做跨页/重开及固定导出检查；跨标签页工作稿候选与助手消息的页面竞态仍待验收 |
| Goal 有限预算、暂停/接管/改目标/继续、幂等与 UNKNOWN | `script-goal-host.test.ts`、`script-goal-shared-creation.test.ts`、`script-memory-recovery-review.test.ts` 验证续作共享预算、同一创建额度、作者改稿、迟到返回和 UNKNOWN；3028 浏览器预算 503 原请求核对；S15 `script-budget-recovery.test.ts` 8/8 覆盖同一 run 恢复、重启、幂等、旧租约、来源变化及真实 HTTP/worker | 3030 原 Goal 第 10 项真实 Sol 回执仍停在 9/10，须以新代码恢复并完成；完整暂停、接管、改目标流程仍待验收 |
| 自动记忆提取、来源失效、重建、执行渠道与持久恢复 | `script-memory-scheduler.test.ts` 13/13，含队列分页、API 日限额隔离、回填渠道、UNKNOWN、重启和撤回；`sol-memory-http-acceptance.json` 与 `sol-memory-rebuild-http-acceptance.json` 是真实 runtime HTTP + 隔离 SQLite + Sol 标注模拟回填，后者重建到 revision 3 | 最终整集采用后的新来源、旧记忆撤回与新 Goal 读取需要联动复核，不把记忆事实当正文原文 |
| 正文为成果，检查定位真实原文、有限返修复查，规划/估算/实测分清 | `script-goal-host.test.ts`、`script-review-capabilities*.test.ts`、`script-goal-checks.test.ts` 校验实际 raw/index 范围与上游回执，完成证明无法由模型自报；原页面分列目标、对白估算、计划、预览和实测 | 第二集同一 WRITE Goal 在第 10 项 RECEIVED 后活动时间耗尽，正式提交仍为 9/10，须先修 S15 再恢复 FINISH 与采用。电影原 Goal、后续一集与完整交付仍未结束；真实 ffprobe 实测须有真实媒体才可声称 |
| 作品/来源/候选的 owner、撤权、跨 Run 不泄露 | `script-project-owner-boundary.test.ts`、`script-read-routes-http.test.ts`、`agent-context-execution.test.ts` 覆盖 owner 绑定、撤权列表过滤、递归来源、迟到回填及旧命令重放拒绝；正式只读 HTTP 10/10 组合通过 | 最终按新完成版本做只读投影和跨 Run UNKNOWN 复核；不得操作正式作品 |

阶段回归：最新租约修复后 `lint`、生产 `build`、foundation 100/100、正式 Goal 宿主 9/9、审阅能力 9/9；其余已验收检查点为 Goal 42/42、domain 80/80、script 132/132、workspace 33/33、正式 HTTP 10/10、作者命令 13/13。Goal/手动组合 53 项中 52 项通过，唯一 `listen EPERM` 在获准 localhost 环境单项 1/1 通过。独立复核覆盖连续慢校验、暂停、撤权、租约过期和原返回单次消费；单次同步校验时间超过租约时仍会失租，需有界停止或缩短该校验。
