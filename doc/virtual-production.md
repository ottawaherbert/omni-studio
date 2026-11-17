# 3D 虚拟制片：人和外部 Agent 共用工具

建城前按[制作质量流程](production-quality-workflow.md)明确总导演/制片统筹并检查全剧总体方案。新建城任务及保存世界要求project_plan通过；登记场次白模静图或创建动态拍摄要求shot_plan通过。白模用于检查preparation，不反过来要求preparation先通过。旧世界、拍摄、候选和失败记录保留，检查失败不自动重建；普通制作不必启用3D。

## 人工按钮与外部 Agent 共用的 AI 建城

项目「3D影视城」顶部 **AI 构建 / 扩建**；空世界主按钮 **根据剧本构建影视城**。读取整剧已导入剧本、人物/资产资料和已保存世界，用户只补充时代、范围、要保留或扩建的内容。调用系统中选择的文本模型，在后台产出三维候选；关闭页面保留任务，重开后查看构建历史。左侧要求与模型，中间当前/候选三维对照，右侧变更、具体缺口、真实检查图及应用。应用不会写改剧本或拍摄记录；不同版本冲突须重新基于现稿构建。

这是一项领域建造工具，不恢复旧聊天助手。人和外部 Agent 用同一接口及声明式建造合同：

- `GET /api/operator/previs/build-contract`：`world-blueprint.v1` 示例、坐标与模型部件规则。`GET /:projectId/build-options` 列出已配置文本模型，可用 `modelId` 显式选择。
- `POST /:projectId/builds {commandId,mode:"api"|"external",modelId?,sourceTaskId?,instructions}`：保存剧本/世界快照和任务提示。外部方式不调用模型；Agent可读取任务提示自行建造。`sourceTaskId` 可在来源未变化时继续修改未应用的候选，或纠正失败返回；不要求先应用。人工对应“让 AI 修改这个候选”。
- `GET /:projectId/builds` / `GET /:projectId/builds/:id`：任务历史、原始要求、状态、候选和 `sourceCurrent`。任务准备好不表示画面验收通过。
- `POST /:projectId/builds/:id/result {rawResult:JSON字符串}`：外部返回通过同一编译器；每次返回留档，`GET /:id/returns` 可查。API模式使用相同返回合同。重复相同成功返回幂等；新修改创建新任务。
- `POST /:projectId/builds/:id/previews` / `GET`：本机后台渲染候选实际检查机位及PNG网址，不必先应用或发布进共享库。人工可在页面自由取景，Agent可读取实际图片检查。
- `POST /:projectId/builds/:id/apply`：检查剧本来源及世界revision，经过正式世界保存校验后应用；旧拍摄引用继续保护。缺失旧项代表保留，不自动删除。已应用任务重复提交不再次改写。

返回 `summary,worldBrief,locations,objects,viewpoints` 及可选 `routes,connections,reuse,modelRecipes`。可选择库中模型、`kit:inn` 等结构组件，或用有界部件描述新结构；原始GLB仍可经模型库导入。系统创建真实几何、压缩LOD与共享资源，**不执行模型返回的JS代码**。复用时原地点ID只有在本次复用存在唯一匹配时才会解析为实例ID；多实例同名须写完整ID。库的已有检查机位自动继承，仅看到库索引时不要臆造室内机位，应先查看候选再调整。重复布置用于已设计好的街道、地块与设施，不以随机撒房子代替规划。新题材不局限现代社区样板。

机器校验只能判定结构可用，不能保证设计合理。候选要检查出入口、路网、尺度、反向画面、门窗内外、外围环境和远景；模型可能犯错，用户可按具体缺口继续扩建/修改。服务故障、无正文或错误JSON会显示失败，保留任务和已有返回；没有隐式降级成样板，没有静默改换供应商，也不自动重发中断任务。


> 2026-10-26 接手必读：共享影视城、完整社区样板及建城任务已接通。用户已否定“三栋建筑就是街区”的标准。完整世界须按整剧规划地形、道路、街坊、功能配套和周边远景；现有客栈/实验楼仅为建筑组件。详见[世界建造纠偏与验收](virtual-studio-library-design.md#本轮纠偏完整世界不是若干建筑的陈列)。本文件旧基础几何示例只演示接口，不能作为完整影视城建设模板。


跨作品影视城库、多城组合、结构模型与性能的设计背景见 [可复用三维影视城设计](virtual-studio-library-design.md)。其中落地范围已在顶部列明；已提供简化双段肢体与手部目标，精细蒙皮、全身动作求解和导航等扩展仍未实现；以下是当前工具合同。

本功能是可选高级工作区，入口为制片顶部「3D 影视城」，或场次的「白模预演」。普通分镜、故事板、资产和摄影棚继续独立使用。它不增加内部聊天助手，不要求所有项目走 3D，也不把单图、宫格、动态预演排成必须依次完成的步骤。

文本模型配置也属于可用性前提：建城页直接选择模型，设置页支持可选思考开关与最大输出 Token；未配置时沿用服务默认，不强行给所有模型同一参数。兼容服务的思考开关参考 [Qwen 官方部署说明](https://qwen.readthedocs.io/en/latest/deployment/vllm.html)。长请求使用流式返回、明确截止时间及完成事件检查；空正文、截断、HTTP失败均保留失败，不能转为几何候选。共享库传入索引而非重复整套场地详情，已有项目世界和剧本不因此截断。长剧或复杂扩建超过所选模型容量时，换容量合适的模型或由外部 Agent 分批构建，不能删剧情/删旧世界来掩盖超限。

## 作品与空间的归属

一部剧只有一份项目级影视城。先读已有剧本、资产和世界，建立全剧已知的固定空间；新剧集增加新地点或扩建旧地点，沿用稳定地点及物体编号。不要在每个镜头里重新搭景。场次拍摄方案引用 `locationId`，只保存演员、活动道具、剧情状态和机位关键帧。

- 世界：地点名称、剧本依据、场景资产、世界坐标、地面范围及固定布景。
- 场次：引用地点、布光、演员/道具代理、镜头关键帧和状态覆盖。
- 拍摄：镜头沿用正式分镜的 `shotId`、顺序和时长。同镜头关键帧之间插值，镜头之间切换。正反打、插入、反应、时间省略等仍由创作者设计。
- 导出：构图图、白模宫格和动态 MP4 各自独立。白模宫格是三维渲染的构图参考，不是 AI 联合生成故事板，也不表示已通过创作验收。

固定布景不要混入剧情后段的破坏、伤势、临时特效。状态用场次关键帧表达。人物、场景、独立道具继续在正式资产系统维护外观与音色，三维代理通过 `assetId` 关联，不另建一套资产库。

## 页面怎么用

页面只有三个平级工具：

1. **影视城**：左侧地点/物体，中央三维编辑，右侧属性。可以添加墙体、圆柱、台阶，绑定场景资产，关联多集场次。「影视城总览」查看所有地点。选中物体可拖坐标轴，或直接输入位置、尺寸与旋转。
2. **场次与机位**：选择已有地点；进入时默认查看已保存机位。左侧镜头/关键帧及演员/道具优先，固定和周边布景折叠；列表下方是唯一接触检查入口。右侧调整状态，人物的「接地与手部动作」按需展开。点击「编辑布置」可自由取景；「当前视角设为机位」才保存编辑视角，环绕查看不改正式机位。进度条只查看时间，不改关键帧。
3. **导出与参考**：勾一格导出构图图，勾多格导出宫格；可独立导出所选镜头、本场、本集或全剧无声 MP4。「搭配资产生成故事板」「搭配资产准备视频」进入现有生成工作台，仅准备任务；由用户或外部 Agent 检查、调整并决定何时提交。

新增场次的默认演员/机位只是可编辑起点，没有读懂剧本或自动完成导演设计的含义。完整作品的布景、演员走位、镜头设计由人或外部 Agent 结合剧本填写。修改时保留旧导出；来源变化会提示重新核对。

## 新会话的外部 Agent

先读 `doc/design.md`、`doc/handoff.md`，再查 `/api/operator/capabilities` 的 `virtualProduction`。不要从旧对话猜世界、机位或已完成范围。使用方法由当前任务决定，例如只要构图图、用白模宫格配资产图、导出某段运镜，或者把全剧排演成连续视频。

### 外部 Agent 不调用模型的执行顺序

粗审次数、候选数、返工上限和3D用途先按[项目制作约定](agent-guide.md#首次一次问清后续按约定推进)确定；精审交作者。静态取景只做所需机位，不默认拍完整白模动画或精调手指。下列是接口顺序；开始设计前先参考[片场联合筹备规范](virtual-studio-library-design.md#可拍摄标准与筹备当前规则)，尤其是精建前的实际机位/动作试验。规范中的角色是检查视角，不是额外审批；结构校验不会自动证明片场可用。当前人偶接地/步态、简化灯光与静态模型通道的限制见该文能力审查。

当前阶段以这条路线为准：执行任务的 Codex 等外部 Agent 本身负责设计，系统负责保存、几何编译、渲染与拍摄；`mode:"external"` 不需要模型 Key，也不会向已配置文本模型发请求。无需先测试 KIE、Qwen 或 DeepSeek。以下 `BASE` 为当前运行服务的 `/api/operator/previs`，项目ID从当前项目读取，不照抄历史测试ID。

1. `GET BASE/:projectId` 读取全剧已导入场次文本和当前世界；`GET BASE/build-contract` 读取当前可执行结构。素材/场次细节按下文正式API继续读取，不把摘要当全部剧本。记录世界版本与旧地点ID。
2. `GET BASE/library/studios` 查询现有场地；选择后读 `GET BASE/library/studios/:id?revision=N`，按需查看其固定版本预览。`GET BASE/library/models` 查询可用结构模型。可复用、组合或新建，现代样板不是所有题材的默认答案。完整世界标准与实际图检查仍然适用。
3. `POST BASE/:projectId/builds`，请求为 `{"commandId":"本次唯一操作编号","mode":"external","instructions":"本剧需要的建造或改造范围，以及需要保留的内容"}`。读取返回的 `task.id`、`task.prompt` 和 `task.productionWorkingAgreement`；新提示包含创建时的制作约定，详情返回当前约定。旧任务提示保持冻结，续作以当前约定控制粗审与返工；约定修改不让几何来源失效。由当前 Agent 自己据此设计，不需要再把它发给另一个模型。
4. 按合同编写实际蓝图，通过 `POST BASE/:projectId/builds/:id/result` 提交 `{"rawResult":"序列化后的蓝图JSON"}`。应使用JSON序列化，不手工拼接转义。接口返回候选或明确错误；失败原文可由 `GET BASE/:projectId/builds/:id/returns` 读取。自定义结构可用 `modelRecipes`；复杂静态模型可先按下文GLB接口导入。不要只交文字规划或几栋示意楼。
5. 候选 `ready` 后，`POST BASE/:projectId/builds/:id/previews` 开始本机拍图，再用同路径 `GET` 查询。按约定选有代表性的PNG粗审空间与明显大问题，细节交作者；不是每次都遍历全部机位，检查图完成不代表作者精审。预览由本机Three.js/浏览器完成，不调用图片模型。
6. 粗审发现明显大问题且尚在约定返工范围内时，新建 `mode:"external"` 任务，并带 `sourceTaskId` 指向未应用候选，写清具体修订要求并定向复查，计入约定轮数；达到上限保留候选与问题交作者，继续其他可制作内容，不无限循环。失败任务可纠正返回；已有有效候选不能用不同返回原地覆盖。来源改变（`sourceCurrent:false` 或409）时重读现稿并建立新任务，保留旧记录，不绕过版本校验。
7. 达到本次建设范围后，`POST BASE/:projectId/builds/:id/apply`，再 `GET BASE/:projectId` 回读真实版本与地点。已应用方案要再改时，从当前世界创建新任务，不用已应用任务作为 `sourceTaskId`。分批扩建保持稳定ID和总规划；任何未完成区明确写入 `worldBrief.gaps`，不能把局部完成写成全城验收。
8. 如本次任务需要静态取景，按下文“正式 API”保存场次机位并导出图即可；明确需要动态参考时才创建白模视频任务，通过 `POST BASE/:projectId/videos/:videoId/capture` 后台拍摄、`GET` 查询，按约定粗审并交作者。建城机位PNG不等于已登记的场次构图参考，世界完成也不等于整剧拍摄完成。

这条路径不依赖系统内助手或当前会话记忆。完成后把项目/地点/任务ID、版本、实际画面证据、未完成项及下一步写入交接。本阶段暂不测试系统调用外部 AI 服务建城；若后续制作需要真实图片或视频，另遵守该作品当前要求与生成规则。

### 从世界继续制作

1. 读取当前制片项目、全部相关剧本、资产及已有影视城。区分世界固定几何、场次剧情变化和分镜意图。明确副导演/群演协调的本次执行者，按事件安排在场、入退场、位置、活动及画内可见性；该有的人员落到场次，合理无人区域不填人。静态摆放不依赖视频。
2. 若需要此工具，通过同一正式 API 保存或扩建世界；读取并修改场次拍摄方案。可以用 JSON 批量操作，不必模拟拖动每一个物体。
3. 使用系统页面 Three.js 渲染器导出实际画面/视频，查看遮挡、构图、走位和切点。亦可在合法浏览器运行环境中复用 `src/components/spatial/previsRenderer.ts` 的确定性渲染函数，通过帧上传接口完成视频。不要提交占位图片声称实际排演已完成。
4. 如继续生成，使用现有生成工作台/API，参考路线遵守项目制作约定。采用“3D只用于生图”时，先用白模取景+独立资产生成最终风格图片，再把这些图片用于视频，不能直接勾白模图/视频。作者明确选择动态直接参考时才使用对应motion等能力；模型支持不等于本作必须使用。只提交本单元相关素材。
5. 按项目约定粗审并交粗剪；画面、声音、切点和整场精审由作者负责。白模准确不保证生成模型永远服从几何，不能据此扩大检查和重生成次数。

### 转绘时先核对真实输入作用

多参考容量不代表每个槽位作用相同。检查当前固定计划和实际工作流：哪些图供身份/构图条件，输出潜空间来自哪里，是否只是按某张参考图的尺寸创建空潜空间。不要把 `compiled` 当成这一组合已经通过真实画面验收。

2026-10-25《此地不通》实测的 Qwen 多图部署将五张图接入 `TextEncodeQwenImage21`，首图缩放到2048×1152。该节点输出的是按首图尺寸建立的**空潜空间**，并非首图像素的编辑潜空间；参见[Comfy官方节点文档](https://github.com/Comfy-Org/embedded-docs/blob/main/comfyui_embedded_docs/docs/TextEncodeQwenImage21/en.md)。实测出现木偶/灰模残留，但不能仅凭连接推断首图复制的因果。可试验调整参考顺序、明确外观与构图分工，并通过实际对照判断；不要为此盲改采样连接。复杂整图修改失败后，可按真实问题做少量局部编辑，不反复原样重跑。

白模短视频搭配独立资产直接生成，也是高级工具允许的路线；无需为了形式重复生成一套AI宫格。只发送该生成单元的白模片段，明确人偶动作是粗略调度，最终模型仍需完成自然表演。白模的空间验收、生成画面验收和声音验收分别记录。

工具不会自行解除项目的图片/视频暂停，不自动采用结果，也不改用户指定的 YZ H3 核心。单纯本机白模渲染不调用生成供应商，不新增费用授权表单。

## 数据合同

共享定义：`packages/domain/src/previs.ts`。世界保存在 `previs_documents` 的项目 `world` 行；拍摄方案在同表独立场次行；视频任务在 `previs_videos`。普通剧本/分镜保存不会覆盖这些记录。便携导出分别保存世界 JSON、各场方案 JSON 和媒体；普通作品 JSON 不包含这些独立表，完整备份应包含工作区数据库和媒体。

坐标单位为米，Y 向上；物体 `position` 是底面中心，旋转为弧度。页面以度显示。世界 `origin` 用于全剧总览；拍摄使用地点局部坐标；同一物理世界及明确物理连接的周边保留，叙事转场不会自动混入。镜头焦距单位毫米，filmGauge固定36mm。几何为 `box | cylinder | stairs | actor | model`（`modelId` 必须引用已导入的不可变模型清单），姿态为 `stand | walk | run | reach | crouch | kneel | sit | lean`。渲染v2的人偶实际脚底基准为0；`seatHeight` 默认0.45米，表示座面相对支撑面的高度。`kneel` 为独立跪姿；`lean` 从髋部前倾。家具、握点和动作必须按实际几何核验，不能通过旋转整个人偶冒充伏台。

世界示例（实际 `sourceSceneIds` 和 `assetId` 必须来自本项目，未绑定可省略 `assetId`）：

```json
{
  "schemaVersion": "previs-world.v1",
  "title": "全剧影视城",
  "description": "各集共用固定空间，新集只扩建所需地点",
  "locations": [{
    "id": "courtyard", "name": "庭院", "description": "北侧门洞，西侧台阶",
    "origin": [0, 0, 0], "ground": [18, 14], "sourceSceneIds": []
  }],
  "objects": [{
    "id": "courtyard-wall-west", "locationId": "courtyard", "label": "西墙",
    "kind": "box", "position": [-6, 0, -2], "rotation": [0, 0, 0],
    "size": [0.5, 3.8, 8], "color": "#aab2b5", "pose": "stand"
  }]
}
```

场次方案示例（替换 `shot-existing-id` 为正式镜头 ID，时间不得超过该镜头）：

```json
{
  "schemaVersion": "scene-previs.v1", "locationId": "courtyard",
  "light": {"position": [5, 10, 4], "intensity": 2},
  "objects": [{
    "id": "actor-visitor", "label": "来访者", "kind": "actor",
    "position": [-1, 0, -3], "rotation": [0, 0, 0],
    "size": [0.6, 1.8, 0.4], "color": "#b5c8d0", "pose": "walk"
  }],
  "frames": [{
    "id": "shot-enter-start", "shotId": "shot-existing-id", "timeInShot": 0,
    "label": "进门", "note": "沿门洞走向台阶",
    "camera": {"position": [8, 4, 10], "target": [0, 1, -1], "focalLength": 28},
    "states": {}
  }, {
    "id": "shot-enter-end", "shotId": "shot-existing-id", "timeInShot": 2,
    "label": "台阶前", "note": "保持行走路线",
    "camera": {"position": [5, 3, 8], "target": [-2, 1, 0], "focalLength": 32},
    "states": {"actor-visitor": {"position": [-2, 0, 0]}}
  }]
}
```

同镜头关键帧时间不能重复。`frames` 按正式镜头顺序、镜内时间排列；宫格遵循保存顺序。位置、旋转和摄影机线性插值；人物姿态在相邻键之间平滑过渡。走跑以编排的移动距离驱动脚步，停路则停步；相邻镜头的走跑和位置明确承接时保留节奏。可见性、挂点在键处切换。缺省属性继承本场基准，不隐式继承上一镜头状态；跨镜承接仍应明确写出人物、持物及布景状态。

场次 actor 可选 `performanceRole:"principal"|"background"` 和 `activity`，用于区分剧情演员与背景活动；旧对象省略时行为不变。背景演员可不绑 assetId，不能为了群演虚构主角档案。`color` 保存稳定识别色：主角各自可辨，剧情群演与环境人群使用不同色系（建议橙色/青绿色），具体职责写入 `activity`；不是最终服装颜色。人工可在场次演员检查器调整识别色。布置与镜间承接按 [建城标准中的背景调度](virtual-studio-library-design.md#背景人物与环境活动)，正反案例见 [案例包](../examples/virtual-production/README.md)。

人物关键帧仍兼容 `leftArm/rightArm` 三轴相对旋转（弧度，各轴不超过2π）。新动作优先使用下文目标控制；显式目标优先于对应旧手臂角度。当前有简化双段IK及网格检查，没有手指、刚体求解和自动寻路。

### 动作控制与接触检查

所有设置沿用世界对象或场次 `objects/frames.states`，不另建动画时间线：

- 人物对象可选 `grounding:{mode:"authored"|"surface",maxStep?:0.35}`。默认按保存高度；surface模式在指定高差内跟随实际支撑面，保持数据原值。它不能自行设计过障碍/登阶动作，仍要检查整个路线。`seatHeight` 可设置0.1–1.5米，按实际椅凳与地面测量。
- 人物状态 `leftHand/rightHand:[x,y,z]` 为**人物局部坐标的米**，经人物旋转变到场景；原点是保存的人物position，不随支撑面跟随偷偷偏移；不是世界坐标或角度。起止键都填写目标才能插值，目标超出手臂范围会报告 `unreachable`。
- `leftElbow/rightElbow` 为非零的局部弯曲方向向量，可控制肘朝外、朝上绕开台面/道具；不是强制肘点。`leftHandRotation/rightHandRotation` 为弧度握持方向。接近握点也需检查：必要时先抬手再接近，不能只让终点看似正确。
- 本场道具状态 `attachment:{objectId:"人物ID",socket:"leftHand"|"rightHand"|"waist"}` 可拿起；`attachment:null` 可放下。省略继承对象基准挂点，不表示继承上一键。绑定时位置/旋转属于挂点局部坐标，放下后属于场次坐标；用 `挂点世界矩阵 × 道具局部矩阵` 及其逆换算，保持切换前后世界变换相同。系统不会在两种坐标系之间错误插值，检查会报告拿放瞬间的跳变。UI在当前关键帧切换时自动换算并保留位置，不重写其他键。

保存后，`POST BASE/:projectId/checks` 发送例如 `{scope:"scene",episodeId,sceneId,fps:24,expectedWorldRevision}`，返回202及 `check.id`。`GET BASE/:projectId/checks/:id` 查询，`GET BASE/:projectId/checks` 读最近记录。也支持 `scope:"world"|"episode"|"project"`，世界检查不需分集/场次；可选 `objectIds` 仅查指定物体，不宣称覆盖整场。

检查由本机浏览器使用同一SpatialRuntime、实际加载LOD、变换网格与支撑射线执行；包围盒仅筛疑点，真正门洞不会仅因包围盒重叠被判穿墙。动态包含端点与中途采样，按速度和尺寸增加到最高240Hz；需要更高频率时 `complete:false`，不能宣称通过。报告保留世界版本、内容/渲染指纹、实际物体、身体部位、镜头、首次/末次问题时间及采样数；首次至末次之间不代表每一时刻都失败。不可达手部、错误穿透、脚底悬空/无支撑和拿放跳变均可定位。普通物体主要查穿透，悬挂物的支撑用途与所有轮子的接地仍须专门测量；结构装配相交可能为review，不能机械删掉合理连接。

执行结果 `status:"complete"` 只表示完成检查；判断数值结果用 `report.complete && report.passed && sourceCurrent`。这不是要求每张静图先跑整场动态检查，也不要求数值通过后再补一轮逐帧精审。相关当前整场失败会成为白模参考的 `qualityIssue`，已有生成预检与执行会阻止它继续使用；在约定返工范围内修内容并定向重拍/复查；同版本已完成的检查复用，超出约定则交作者处理，继续无关镜头。检查与失败证据可保存，不新增审批、费用授权或强制用户逐步确认。

渲染v2改变人偶几何及动作，旧媒体和计划保留，依赖旧渲染的参考显示来源变化。旧未完成视频任务不续拍新画面，创建新任务重拍；不能直接改旧任务的版本字段冒充一致。需要隔离维护验收时，可同时设置 `OMNI_DB_PATH` 与 `OMNI_MEDIA_DIR` 为临时位置，现有默认工作区不变。

当前上限为 200 个地点、3000 件固定布景；每场 150 个活动物体、120 个关键帧。一次宫格选择 1–24 格，1–4 列，末尾空位保持空白。宫格叙事时长按不同镜头去重，不能按关键帧数量推算。整剧预演不受宫格数量、14秒或15秒限制。

## 正式 API

人用 `/api/production/previs`，外部 Agent 用 `/api/operator/previs`；后者沿用现有项目访问边界。两者使用同一领域规则。下表路径接在 basePath 后，所有 JSON 保存要读取最新版本，不用旧稿覆盖。

| 操作 | 路径与请求 |
| --- | --- |
| 读世界和全剧上下文 | `GET /:projectId`，返回 `project, world, scenes`；world 可为 null |
| 保存/扩建世界 | `PUT /:projectId {plan, expectedRevision}`；初建版本为0 |
| 读场次 | `GET /:projectId/:episodeId/:sceneId`，返回 `scene, project, world, document, episodeRevision` |
| 保存拍摄方案 | `PUT /:projectId/:episodeId/:sceneId {plan, expectedRevision, expectedEpisodeRevision, expectedWorldRevision}` |
| 登记本机 PNG | `POST /:projectId/:episodeId/:sceneId/exports {expectedRevision, frameIds, columns, sourceHash, imageUrl, commandId}` |
| 新白模视频 | `POST /:projectId/videos {scope:"scene"|"episode"|"project", episodeId?, sceneId?, shotIds?, fps:12|24}` |
| 视频列表 | `GET /:projectId/videos`，最近50项，含来源是否仍一致 |
| 视频快照和进度 | `GET /:projectId/videos/:videoId` |
| 上传渲染帧 | `POST /:projectId/videos/:videoId/frames {start, images:[JPEG data URLs]}`，一批最多12帧 |
| 编码 MP4 | `POST /:projectId/videos/:videoId/finish {}` |
| 取消未完成任务 | `POST /:projectId/videos/:videoId/cancel {}` |

PNG 的 `sourceHash` 和画格映射通过共享 `previsExportSpec` 算出，`renderPrevisGrid` 输出实际 PNG；服务端验证当前来源、版本、图片尺寸与画幅。`commandId` 是幂等编号。世界修改不再有效的旧文件仍保留，不能冒充新画面登记。

视频创建会冻结世界、拍摄方案、正式镜头顺序和时长。每个范围必须全部存在机位与有效时长，否则列出缺项，不静默省略未完成的场次。`shotIds` 只适用于 `scope:"scene"`，按正式顺序填写。输出最长边960像素，偶数尺寸，无声音，UI默认12fps，API支持24fps。

渲染器从 `receivedFrames` 继续，时间为 `frameIndex / fps`。`createPrevisVideoRenderer(timeline,width,height)` 的 `frame(time)` 返回 JPEG data URL，完成后 `dispose()`。分批上传必须连续，重复的完整旧批次不增加帧数。浏览器关闭/暂停不会丢掉已上传帧。`finish` 只接受完整帧序列，由本机 FFmpeg 编码并测量，成功后删除可重建 JPEG 中间文件，保留 MP4 和冻结快照。部署需要本机 `ffmpeg`、`ffprobe` 与支持 WebGL 的浏览器。

## 生成衔接与验收边界

白模 PNG/本场白模视频自动出现在该场的可用参考列表，默认不勾选。明确使用时保留 `previsSource`、来源镜头、用途说明；不能把白模改名为已采用故事板或正式首帧。修改相关地点、机位、剧情或镜头时长，会使该参考及使用它的生成候选变为来源变化，提交和采用重新校验。扩建不相关地点不使旧镜头失效，完全不使用白模的普通任务不受影响。

生成容量来自当前能力目录，不在白模工具中固定图片数量、音频数量、二采参数或供应商。搭配参考需要兼容 `composition` / `motion`；无兼容服务时明确说明并保留下载出口，不偷偷更换工作流。多镜头视频按正式视频单元交接；整剧预演可用于整体检查，供 H3 的片段仍按14秒上限及实际输入能力拆分，不能删剧情、加速或强行压缩。

本功能是几何、调度和剪辑预演，尚非精细骨骼表演、口型或物理模拟系统。当前只有简化人偶动作、无声 MP4；未来视频模型可使用这些白模视频，但特定服务能否接受、如何服从参考必须实际验证，不能以本机导出成功宣称最终生成画质合格。

## 共享影视城、完整空间与取景

共用前缀 `/api/production/previs` 或 `/api/operator/previs`：

- `GET /library/studios` 与 `GET /library/studios/:id?revision=N`：读取固定版本、空间说明、用途、资源和缺口。页面在资产的「3D影视城」及项目的「共享影视城库」使用同一组件。实际三维预览可看，不能只读标签决定场地已合格。
- `POST /library/models?name=...&license=...`，body 为独立 GLB，Content-Type 为 `model/gltf-binary`：原件保留，worker 生成无贴图、非金属、Meshopt 压缩和简化 LOD。单文件最多100MB；不接收外部资源 URI，角色骨骼/动画不能被静默当静态布景导入。尺寸过大应拆分，不能把整城塞入单GLB。
- `POST /library/studios`：`{id,expectedRevision,commandId,name,description,tags,license,plan}` 发布不可变版本；使用库中的原始模型清单，移除项目独有角色/资产及场次绑定。重复 commandId 只允许相同内容。UI 目前支持发布独立副本，版本更新使用同一接口。
- `POST /library/district`：安装原创“清水·河岸社区”参考包，包含社区、医院、学校、店铺、公园、河岸、连续路网和外围环境。它是可改装的现代样板，不是任意年代的自动建城器；剧本要求未覆盖的空间要继续建造。
- `POST /library/studios/:id/previews {revision}`：后台拍摄该固定版本的全部 `viewpoints`；`GET .../previews?revision=N` 返回状态、实际PNG URL、地点和取景说明。可由Agent实际读图；不是自动视觉验收。服务重启可重新提交，完成清单按固定版本缓存。
- `POST /library/samples`：安装/更新**建筑组件测试包**，不是完整影视城。旧引用固定原版本，不自动更新。
- 本剧 `world.plan` 可包含 `models`、`instances`、`connections`、`worldBrief`、`viewpoints`、`routes`。加入库内容时为地点/物体/物理空间加实例命名空间，几何文件共享；修改本剧对象不修改库。物理连接和叙事转场不同。
- 地点 `spaceId` 相同表示同一实际空间，`usage` 记录功能，`detailTier` 为 `shootable | context | horizon`。拍摄时默认保留同一物理世界全部周边；`includedLocationIds` 用于额外明确选入。旧无 spaceId 且未声明 physical 连接的地点仍按原本地规则处理。连接只声明关系，不自动挪动街道；必须实际对齐入口并检查接缝。`parentId` 组织街区/建筑/楼层，坐标始终相对世界，不继承父级变换；自建地形可设 `groundVisible:false` 防止默认地面覆盖河流或地下空间。
- `POST /:projectId/videos/:videoId/capture` 开始后台确定帧拍摄，`GET` 同一路径查询本机队列。一次运行一个后台浏览器，关闭页面不会终止。需要本机Chrome/Chromium，可通过 `OMNI_CHROME_PATH` 指定；前台拍摄可选。服务重启后从已保存帧手动继续，不自动重做作品。`POST /:projectId/videos/:videoId/capture/pause` 在当前批次完成后暂停，保留已拍帧；再次 POST capture 继续。

### 人工与外部 Agent 的共同操作

1. 在共享库按年代和用途检索，读取固定版本、用途和 `worldBrief.gaps`。看实际三维和机位PNG，按剧本判断需要复用、改装或新增哪些地点。
2. 加入本剧生成命名空间化的独立布置，保留源版本。组合不同城后，用地点位置调整空间，用 physical/narrative 区分实际连接和剪辑转场。旧项目和库版本不会被隐式更新。
3. 在地点视图“保存当前取景点”。总览检查器可重命名取景点、从同地点取景点组成路线、调整时长；视口左上角选择机位或播放/拖动巡视路线。JSON中 `viewpoints` 为 `{id,name,locationId,camera,note}`；`routes` 为 `{id,name,locationId,duration,keys:[{time,camera}]}`，首尾time必须为0和duration，机位均相对所属地点。
4. 场次引用已有地点，安排人物/道具与机位关键帧。`pivot:[x,y,z]` 是门等对象的局部旋转枢轴；`attachment:{objectId,socket:'leftHand'|'rightHand'|'waist'}` 将本场道具附着于本场人物，`position` 此时表示挂点偏移。挂点随姿态/走位/可见状态变化，不能用它替代动作与接触验收。
5. 独立选择导出单图、宫格或整场/整集/全剧无声MP4。背景取景PNG用于识别场地，进入作品的白模参考仍走场次正式导出，保留来源校验。

### 运行资源与能力边界

运行时常驻场景，仅更新人物/关键帧矩阵。导入期把灰模材质色转为顶点色合批；LOD资源共享，按地点和48米格实例化。远区按192米格合并当前低细节实体；只增量更新变化分区，编辑会重建相应运行时，不复用过期代理。远景合并额外几何预算96MiB，超出保留有效实例；几何估算超过256MiB明确提示优化。资源零引用释放，关闭视口释放几何/材质/阴影和WebGL上下文。压缩文件大小、几何估算和驱动显存是不同指标。

拍摄按整条镜头路径选择并预载所需LOD、预热材质，再固定细节等级输出确定帧；不在视频中随每帧临时降级。后台取景与视频共用单任务队列。视口保留性能面板，不能把一次设备上的达标推广成所有机器和任意城市都流畅。

人物是基于关节/Bone的简化结构代理，包含走、跑、蹲、跪、坐、伏台、手/腰挂点、手部目标与接触检查；没有外部蒙皮动画导入、面部、口型、全身动作求解或刚体物理模拟。自由取景允许穿过物体，正式巡视路线必须检查穿墙/遮挡。室内不启用未经验证的强制遮挡裁剪，以免窗外或开门后丢失环境。可导入详细静态GLB替换需要特写的建筑部分，不将现有参考建筑宣称为竣工建筑模型或最终美术。
