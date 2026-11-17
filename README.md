# O.M.N.I. Studio

本地优先的影视与互动影像创作系统：写作、剧本与场次、项目资产、分镜、摄影棚和互动制作。各阶段可编辑，导演与通用 Skill 均可选。

## 开发入口

- [接手规则](AGENTS.md)：新会话继续开发或制作前必须读取的项目约束。
- [外部 Agent 操作手册](doc/agent-guide.md)：无需 UI 的领域入口、保存格式、版本校验、导出与真实能力边界。服务也通过 `GET /api/operator/handbook` 与 `/api/operator/documents` 提供说明和数据合同。
- [系统设计](doc/design.md)：当前产品规则、架构、数据、AI 与 Operator 边界。
- [当前交接](doc/handoff.md)：当前状态、验证结果和待处理事项。

系统提供作品编辑与明确范围的写作、生成工具，不再内置聊天助手或自主写作执行器。人和外部 Agent 使用相同业务接口；外部写作结果可通过任务回填、检查并采用。旧记录只读导出，真实作品与媒体保留。当前状态见交接记录。

## 本地运行

使用 Node.js 22：

```bash
npm ci
cp src/config/auth.example.json src/config/auth.json
npm run dev
```

首次运行前，修改 `src/config/auth.json` 中的本地登录信息；此文件不提交到 Git。访问 `http://127.0.0.1:3000`。默认同一进程提供 Express API 和 Vite。AI 服务在系统设置中配置。

分离调试分别运行 `npm run dev:backend` 和 `npm run dev:frontend`，默认端口 3000 / 3001。生产模式先运行 `npm run build`，再运行 `npm start`。成片合成需要本机 `ffmpeg` / `ffprobe`；可选本地语音使用 `npm run tts:install` 和 `npm run tts:start`。

## 常用检查

```bash
npm run lint
npm run build
npm run test:script
npm run test:documentation
npm run test:agent-guide
npm run test:operator-contract
```

按改动范围选择其他检查，见设计文档。测试数据库使用 `OMNI_DB_PATH` 隔离，不默认修改已有作品。

## 目录

- `src`、`apps`、`packages`：系统源码，包含 `apps/local-tts` 本地语音服务、`apps/worker` 媒体任务和 `apps/cli` 制片命令入口。
- `tests`：开发测试代码；`tests/fixtures` 是固定测试样例，系统正常运行不读取它们。
- `tools`：按需执行的导入、迁移、修复与审计工具，系统正常启动不依赖它们。
- `doc`：系统设计、交接及专项设计与验收记录。
- `script_system_design_kit/fixtures`、`script_system_design_kit/tools`：保留的合成时长测试数据与校验工具，不是产品设计规格。
- `skills`：方法库及本机自定义方法。
- `OMNI_Workspace`：数据库、媒体、制作归档、原始素材、导出和备份。
- `OMNI_Brains`、`Movies_Data_State`：本机提示词与兼容状态。
- `node_modules`、`.local-tts`：运行依赖与可选语音环境。`dist` 为可重新构建的产物。

开发源码包保留 `tests`、`tools`，便于继续开发和维护；仅运行的交付包可排除这两项，对应测试及维护命令也将不可用。临时测试数据库、截图和报告放系统临时目录或被 Git 忽略的 `artifacts`，不放入源码或固定测试样例目录。已有作品数据另行备份，不能当作临时产物删除。

## 本机空间维护

作品位于 `OMNI_Workspace`，其中当前数据库、媒体、来源材料和项目归档需要保留。`artifacts` 也可能包含导出的成片或迁移前数据库，不能整目录清空；可清理已完成的编码中间文件、临时构建、测试下载模型。验收日志和清理清单按需保留。

`.local-tts/installed-model.json` 标明当前语音模型及固定快照；保留该快照引用的文件和 Python 环境，可清理闲置模型与已经失效的 `.incomplete` 下载。`node_modules` 是应用运行依赖，删除后需重新安装；`dist` 是构建产物，开发环境可重建，正在服务生产构建时应保留。
