# 剧本领域

本目录记录实际实现，不以旧设计包替代用户确认的交互。schema.ts 验证项目、单元、场景、正文块、时间片段与证据；runtime.ts 计算整数毫秒的并集和分轨覆盖。模型提案与手工编辑遵守同一版本边界，估算不能冒充实测。

运行 npm run test:script。

时间轴可声明 `scope: story | credits`，早期文档缺省为 story。`analyseTimeline` 的第四个参数支持 `includeCredits` 和 `toleranceMs`。范围过滤只影响目标比较；`spanMs` 与 `fullCoverageMs` 始终描述完整计划，实测状态始终由证据流程决定。
