# Web

React/Vite 工作区。新剧本 UI 位于 src/features/script，HTTP 客户端为 src/clients/scriptClient.ts。正文、配置与时长规则由 packages/script 定义。Skill 从全局技能库选择，新任务保存实际使用的版本快照；作品内不再管理或绑定 Skill。

剧本 UI 使用宿主 src/index.css 的主题变量、字号和强调色；项目库的新建弹窗复用共享 Button/Modal。ScriptWorkspace 负责编辑状态与版本，ScriptLibrary、useScriptSkills、ScriptTiming 分别负责项目入口、全局技能读取和时长诊断。全局 /skills 页面负责技能管理，聊天与任务入口负责选用。直接运行当前工作区，不复制源码启动预览。
