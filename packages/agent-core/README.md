# 通用 Agent 执行基础

此包正在实现已评审的 Agent 底座，不依赖剧本、制片、UI 或全局数据库。当前已有严格 JSON 身份、能力准备与校验、资源版本读取、授权/执行权端口和租约心跳保护。运行与持久记录类型由本包定义，SQLite 实现位于 `packages/agent-sqlite`。

`migration/manifest.json` 记录 duilang 当前工作树的来源文件、SHA256、迁移差异；`migration/source/*.txt` 保存对应原文，避免用源 HEAD 冒充未提交实现。快照不参与构建，不带入源项目的数据库或业务依赖。

注册器要求宿主提供真实的权限与执行权检查。它不会单独提供外部副作用的 exactly-once，也不允许把元数据当授权证明。实际稿件写入必须由持久层和领域适配在同一个受 fencing 保护的事务中完成。

当前还实现了模型单次调用协议、协调 worker 与独立 DURABLE 子 worker：INLINE 使用 Run 租约，DURABLE 原子交接并释放父租约，子 token 同时检查独立 fence 与父控制/输入版本。请求/返回由注入的 journal 持久化，未知请求暂停核对，不自动重发；worker 不依赖浏览器生命周期。领域效果与回执先提交，调度确认和父唤醒随后在另一个原子事务中完成；确认前崩溃恢复只读取回执，不重复效果。暂停恢复也必须先确认残留子占位才能派发下一步。

验证入口：`npm run test:agent-foundation`。`npm run test:agent-script-http` 使用独立 API/worker 进程、临时 SQLite 和实际 GPT-6 Sol 子 Agent 产生的模拟返回，验证局部改写候选、采用、原文保护和恢复。正式宿主现已装配固定路由的单次模型 transport；相同组合根通过隔离 HTTP 验收，未重启用户正式服务。完整连续委托与自动记忆提取/重建调度仍未完成；不能把这个增量当成全流程完成。
