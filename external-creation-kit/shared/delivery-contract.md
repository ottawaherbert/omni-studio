# 外部交付规范 v1

本规范服务于“外部创作 → 检查 → 系统回填”。Schema 是字段的机器定义；本文件规定字段语义。所有 JSON 顶层均带 `format`、`projectId`、`deliveryId`，同一包的后两项必须一致。`deliveryId` 是外部稿件标识，不是系统内部修订号。

## 清单与版本

`manifest.json` 使用 `omni-external-manifest.v1`：

| 字段 | 规则 |
| --- | --- |
| `baseDeliveryId` | 首次创作为 null；修订填写实际基准的 deliveryId。不能猜测 |
| `status` | draft 允许 planned 场次和待决事项；ready 要求本轮范围内正文与引用齐全 |
| `scope.kind` | full 为本轮交付模块的完整快照（剧本，以及实际提供的互动图）；selected 为明确选定的集、场或节点范围 |
| `scope.description` | 用自然语言解释本次交付边界，局部交付尤其要明确 |
| `files.bible` | 共用设定 JSON 的相对路径 |
| `files.scripts` | 一个或多个剧本 JSON 文件的相对路径；各场只出现一次 |
| `files.interactive` | 互动 JSON 路径；普通影视或不交付互动部分时为 null，绝不表示删除旧互动图 |
| `files.notes` | 人读的 Markdown 说明路径 |
| `inventory` | 本包实际包含的人物、单元、场次、节点 ID 清单，与文件内容准确一致 |
| `changes` | summary 说明修改；addedIds / modifiedIds / deletedIds 列本次主要对象变化 |
| `openQuestions` | 尚未解决的事项；ready 时为空 |

文件路径必须位于交付目录内，使用英文字母、数字、下划线、横线与斜杠；不能使用绝对路径或 `..`。不要修改格式版本字符串来绕过校验。新格式需求应先明确扩展设计。

`changes` 以人物、事实、方法、单元、场次、章节、变量、节点、边、结局和制作单元为对象。正文块的改变统一计入所属场次，块自身仍保持稳定 ID。作品级字段（标题、profile、风格、时长目标等）的修改计入 `projectId`。首次创作可把三个 ID 数组都留空，含义为“本轮全部新建”；修订必须准确列出差异。

校验修订时提供 `--base 基准包目录`，工具核对 baseDeliveryId 并比较实际对象差异。它不证明该基准就是系统的最新稿，回填时仍须核对系统版本。只交付剧本时，检查通过仅针对剧本；旧互动图与新正文的兼容性仍需另行检查。

## 共用设定

`story-bible.json` 使用 `omni-external-bible.v1`。其中：

- `profile.organization` 为 standalone 或 episodic；单部作品仍使用一个 `unit`，不把幕或分支误做多集。
- `profile.continuity` 为 serialized / procedural / anthology / mixed；`workType` 用作品自己的名称，例如“互动短片”。
- `characters` 记录稳定身份、欲望、需要、内在矛盾、弧光与语言特征。
- `facts` 的 fixed 是用户确定事实，proposed 是建议。角色的谎言不可当作 fixed 客观事实。
- `methods` 可以为空；每项注明 framework / technique / genre、具体规则与适用范围。
- `units.order` 决定单元顺序，`summary` 为大纲，完整正文在剧本文件中。
- `style` 描述叙述、节奏、对白、影像和避免事项。它是创作方向，不是视频接口参数。

## 剧本文件

每份使用 `omni-external-screenplay.v1`，含唯一 `partId` 和 `scenes`。分批以完整场次为边界；同一场不得跨两个文件或重复出现。清单列出的所有脚本文件共同组成当前包。

每场必填：`id`、`unitId`、`order`、`title`、`location`、`timeOfDay`、`storyTime`、`route`、`summary`、`purpose`、`characterIds`、`entryState`、`exitState`、`status`、`estimatedSeconds`、`blocks`、`continuity`。

`order` 是该单元内的阅读顺序，同一单元不能重复，允许编号有间隙。它不替代故事发生时间，也不代表互动播放顺序；互动播放顺序由图决定。`route` 说明适用路线，普通影视写“共同”；它不是运行条件。

`blocks` 支持 action / dialogue / parenthetical / transition / note。每块包含 `id`、`type`、`text`。对白必有 `speakerId`，且人物出现在该场 `characterIds`；parenthetical 可关联说话人，其他类型不填 speakerId。scene 已有场头字段，不再把场头假装成对白。正文为完整文字，不能只保留概要。

`planned` 可空正文；`complete` 必须有可演出的正文块。ready 包不能有 planned 场次。`estimatedSeconds` 是该场单次播放估算，不包括无限等待玩家选择的时间；complete 场次必须大于零。

`continuity` 记录 knowledge / prop / relationship / plant / payoff / time 变化。`subjectIds` 可引用人物或事实，`factIds` 引用事实；`incoming` / `outgoing` / `routeNote` 说明进入、离开与路线适用性。这些自然语言记录供人审查，不会自动控制互动图。

## 互动文件

使用 `omni-external-interactive.v1`，包含 entryNodeId、timing、chapters、variables、nodes、edges、endings、mediaPlan 等。

### 状态与条件

变量按全作品持久保存。v1 不隐式按章节清零，若要清零必须明确设置。

- boolean：default 为 true / false。
- integer：default、min、max 均为整数，效果执行后必须仍在范围内；不会自动截断。
- enum：values 明确列举字符串，default 与 set 值必须属于其中。

条件允许：`{"op":"always"}`；all / any 加非空 predicates；not 加 predicate；compare 加 variable、comparator、value。comparator 支持 eq、neq；整数额外支持 gt、gte、lt、lte。类型严格一致，不把字符串 `"true"` 当布尔值。比较条件的整数阈值可以超出变量范围，但这可能产生永不成立的分支。

效果为 set(variable,value)、increment(variable,amount)、decrement(variable,amount)，amount 为正整数。效果只在选中该边后按列表顺序执行一次；再进入目标节点。节点本身没有隐含状态效果。条件始终读取效果执行前的状态。不支持 eval、JavaScript 字符串或任意表达式。

### 节点与边

| 节点 type | 流转规则 |
| --- | --- |
| scene | 播放 sceneIds 对应内容；恰好一条出边，当前条件成立后自动进入下个节点 |
| choice | 播放内容后显示可用选项；设计至少两条出边，每个可达状态至少有一个可用选项 |
| router | 无正文和媒体，按条件自动流转；任一可达状态下恰好一条出边成立 |
| ending | 播放结局内容后停止，endingId 对应 endings，不得有出边 |

每个节点归属一个 chapter，chapter.nodeIds 和 node.chapterId 双向一致。非 router 节点必须引用场次；ready 时有完整制作计划映射。`sceneIds` 和 `mediaIds` 都是有序列表，媒体源场次必须属于该节点的 sceneIds。不同可见版本先分别成场，再通过图选择；v1 不在单个节点中隐式求值媒体变体。

每条边写明 label、condition、effects、feedback 与 consequence。自动边的 label 也可写“继续”等明确信息。`consequence.readAtNodeIds` 指后果被读取或呈现的节点，用于审阅；真正生效必须有对应条件、效果和正文，不能只写在说明里。

剧情循环可以存在；只要状态有限，工具会探索不同的“节点＋状态”组合。可退出的玩家循环仍可能让最长游玩时间无上限，工具会明确报告。无法离开且到不了结局的循环属于错误。选择等待的画面循环用 hold 描述，不增设反复执行状态效果的剧情边。

### 制作量与时长

`timing` 将单次游玩目标、单次范围估算、独立视频预算、最长无选择间隔分开。说明是否包含片头片尾以及等待时间；当前校验器的路径统计只累加场景估算，排除玩家等待。

`mediaPlan` 每项代表一个独立制作的视频单元，含来源 sceneIds、估算秒数、复用理由、视觉与声音连续性要求。一个场景可拆成多个视频单元，多个场景也可合并；节点可以复用已有单元。独立视频总量按 media ID 去重累计，**不能用重复 ID 隐藏实际变体成本**。

全分支正文总量按 scene ID 去重累计；单次路线时长按实际经过节点的 sceneIds 累计；独立视频总量按 mediaPlan 的 ID 累计。三者不等价，视频重试次数和等待循环播放次数也不属于独立素材时长。

## 分批与修订

长篇完整交付：先固定本轮的 deliveryId 和文件/对象清单，再按完整场次拆文件，最后对整包校验。没有实际交付的文件不能在最终包标齐。聊天输出中断时续交完整新文件，不把截断 JSON 当作已经交付。

选定范围交付：scope.kind=selected；仅包含本轮的完整场次或对象，说明与基准的关系。省略代表没有交付，绝不代表删除。**本校验器不会自动合并选定范围，也不会对它给出完整项目通过结论。** 使用它发现格式问题后，由接收方对基准做差异预览、合并并再次校验完整快照。

修订完整快照：保留未改内容，填写 baseDeliveryId 和 changes，使用 `--base` 检查差异。缺失但没有列入 deletedIds 的旧对象视为遗漏；ready 包不能自动把这种遗漏解释为删除。删除场次前检查仍引用它的节点和制作计划。

## 设计说明应包含

说明本次创作方向和方法取舍、已完成范围、估算依据、未决事项、实际检查结果。互动项目补充关键选择的代价与兑现、两条不同路径的状态推演、视频复用理由和制作预算。阅读剧本如需另存，必须从结构化正文生成。不要宣称已调用系统、通过系统试玩或已生成视频。
