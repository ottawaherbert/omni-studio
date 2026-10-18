import { upgradeAppearanceTemplate } from "./appearanceContract";
import { upgradeDirectorPlanTemplate } from "./directorPlanContract";
import { PromptTemplate } from './types';

export const base_visual_guidelines = `【全局视觉底线规范 (Negative Constraints)】
1. 严禁使用“8k、电影级、大师级、超高分辨率”等无意义画质附加词，这会导致 AI 画风趋向虚假的廉价感。
2. visualAction、microExpression 与最终媒体提示词应以可见或可听的表现支撑情绪，按角色造型和作品媒介选择视线、姿态、动作、声音或节奏；不要给非人角色、无脸角色或静物强加人类面部肌肉动作。
3. 绝对不要包含任何特定 AI 工具的平台技术参数（如 --ar, --v, --q 等）。
4. 不添加生成工具 UI、水印和说明排版；剧本或作者明确要求的招牌、信件、屏幕界面、字幕及其他画内文字属于作品内容，必须保留其原文、位置和叙事作用，不得当作杂字删除。`;

export const visualsTemplates: Record<string, PromptTemplate> = {
  'generateShots': {
    id: 'generateShots',
    name: '生成分镜',
    template: upgradeDirectorPlanTemplate(upgradeAppearanceTemplate(`【角色设定】
你是电影导演与分镜师。把当前场景剧本拆解为可拍摄、可连续执行的 Shot 清单。

${base_visual_guidelines}

【任务目标】
请根据以下剧本内容，将场景拆解为具体的拍摄镜头 (Shots)。
1. **物理性 (Physicality)**：仅描述画面中发生的物理动作、物体状态和空间关系。严禁使用任何抽象的情感词汇。
2. **专业性 (Professionalism)**：使用标准的电影摄影术语（景别、角度、运镜）来定义镜头。
3. **时长控制**：按本场对白、动作、停顿和作者要求决定镜头时长，完整覆盖剧本；不为凑常见秒数、固定镜头数或模型单次上限拆碎长镜头，后续视频生成单元再适配所选模型。目标时长不可行时明确提示，不删剧情或强行加速。
4. **连续性要求**：continuityNote 只记录本镜实际相关的轴线、视线、动作和空间承接；空镜、插入镜头、蒙太奇等不适用的项可注明不适用，不为填四项编造人物关系。故意越轴、跳切或打破连续性时说明创作意图和观众可辨认的承接点。

【创作视点 (Creative Vision)】
{{stylePrompt}}

【注入的前置设定/参考上下文】
{{selectedContext}}

【互动节点制作上下文】
{{interactiveProductionContext}}

【当前原文、相邻场次与已采用制作结果】
{{productionTeamContext}}
本次直接完成分镜或媒体表达所需的摄影、表演、灯光和声音设计；缺少历史方案时依据原文和作者要求完成，不要求另行筹备。

【当前场景正式资产与状态】
{{formalAssetContext}}

【场景物理属性】
{{scenePhysicalContext}}
请基于上述物理属性，在 lightingAtmo 中推演合理的光影意图。

【角色与资产管理】
你必须根据剧情判断每个镜头中出现的资产，并填入对应 ID。
{{characterPrompt}}
{{locationPrompt}}
{{propPrompt}}
注意：在此阶段，你只需要关注角色在画面中的位置和动作（例如：“男人坐在窗边”），不需要描述外观。

【道具 ID 绑定硬性要求】
1. propIds 只填写“本镜头画面中真实可见、被持有、被使用、被交接或被特写展示”的道具 ID。
2. 不要因为道具出现在场景 breakdown 或资产列表中，就把它填进每个镜头。
3. 如果某个镜头填写了 propIds，必须在 visualAction、blocking 或 composition 中写出该道具的中文名或核心名，例如“擂台令”“毒囊”“青鸾剑”。
4. 灵力波动、光芒、毒雾、印记、动作效果和情绪状态不是道具；除非它们是物理可追踪物件，否则不要填 propIds。
5. 如果镜头只表现角色反应、运镜或环境气氛，没有可见道具，propIds 必须返回空数组。

【输出字段规范 (JSON Schema)】
你必须返回一个 JSON 数组，每个对象包含以下字段：
1. shotNumber: 镜号 (1, 2, 3...)
2. motivation: 简短、可审计的导演动机。说明该镜头服务的叙事动作、表演信息与景别选择，不要输出内部思维链。
3. visualAction: 纯物理画面描述。描述角色动作、物体状态、空间布局。（例如：“周墨的手指悬停在屏幕上方”。）
4. microExpression: 与角色造型、景别和媒介相适配的可见表演；不追求每镜都有微表情，不强加面部肌肉细节。无人物或无需表演的镜头可留空。
5. shotSize: 景别 (严格枚举: EWS, WS, FS, MS, MCU, CU, ECU)
6. cameraAngle: 摄影机角度 (严格枚举: Eye-Level, High, Low, Bird, Worm, Dutch)
7. cameraMovement: 摄影机运动 (严格枚举: Static, Pan, Tilt, Track, Zoom, Push-in, Pull-out, Handheld)
8. focalLength: 焦距或镜头选择。
9. lighting: 具体布光方案。
10. composition: 构图与画面层次。
11. blocking: 人物、道具、空间调度。
12. continuityNote: 写明实际相关的轴线、视线、动作或空间承接，以及有意打破连续性的安排。
13. lightingAtmo: 光影意图。描述导演期望的光影氛围（例如：“夕阳侧光，温暖的暖色调，高反差阴影”。）
14. voiceover: 兼容旧字段。若有角色台词，优先写入 dialogueLines；voiceover 可留空。严禁把多人的台词合并到 voiceover。
15. characterId: 兼容旧字段。如果使用 voiceover，请填入该说话角色的 ID。
16. dialogueLines: 本镜头所有角色台词数组，包含画外声音。每句填写 delivery：on_screen（画内对白）、off_screen（画外对白）、voice_over（旁白或广播）、phone（电话声音）；保留剧本声音来源，不因声音出现而把说话人画进镜头，不给其他角色安排嘴型。正式项目角色必须填写有效 characterId 和 text；未建立正式人物资产的本场临时人物必须填写 speakerName 和 text，并让 characterId 为空。即使只有一句角色台词，也要写入 dialogueLines。逐句保留剧本的说话人、原文、标点、重复次数和先后顺序，不得合并不同说话人的台词、翻译、润色或删减；不得为临时人物伪造 characterId。
17. characterIdsInShot: 画面中出现的角色 ID 数组
18. locationId: 当前画面所属的场地 ID
19. propIds: 画面中出现的道具 ID 数组
20. duration: 预计时长（秒）

本次只生成分镜结构，不生成 visualSummary、imagePrompt 或 videoPrompt；这些内容由后续两个独立操作分别生成，避免长场次输出过载。

【场景剧本】
{{scriptContent}}

【时长与构图要求】
{{durationInstruction}}
{{framingInstruction}}
{{interactiveInstruction}}`))
  },
  'generateShotSpatial': {
    id: 'generateShotSpatial',
    name: '生成单镜头3D空间数据',
    template: `【角色设定】
你是电影美术指导与 3D 场景设计师。请将镜头描述转换为可执行的 3D 空间布局。

【任务目标】
请根据以下镜头的详细描述，推演出该镜头的3D空间数据（compositionData）。

【镜头详细描述】
导演动机: {{motivation}}
画面动作: {{visualAction}}
景别: {{shotSize}}
角度: {{cameraAngle}}
运动: {{cameraMovement}}
光影氛围: {{lightingAtmo}}

【互动节点制作上下文】
{{interactiveProductionContext}}

【角色与资产 ID】
角色 ID: {{characterIds}}
场地 ID: {{locationId}}
道具 ID: {{propIds}}

【输出要求】
1. **空间逻辑**：根据 visualAction 和景别，合理安排摄影机和实体的 3D 坐标。
2. **坐标系**：Y轴向上，1单位=1米。
3. **摄影机状态 (cameraState)**：包含 position[x,y,z], target[x,y,z] (摄影机看向的点), fov (视场角，通常 30-60)。
4. **实体列表 (entities)**：包含 id, type('character'|'prop'), position[x,y,z], rotationY (绕Y轴旋转角度，0-360)。**注意：绝对不要将场地 (场地 ID) 作为实体放入此列表中！场地是整个环境，不是可以摆放的物体。**

请严格按照 JSON 格式返回，包含 compositionData 字段。`
  },
  'generateImagePrompts': {
    id: 'generateImagePrompts',
    name: '生成图片提示词',
    template: `你是电影摄影指导与静帧提示词编剧。只为已确认分镜生成图片提示词，不生成或改写视频提示词，不改动分镜结构。

【创作视点】
{{creativeVision}}

【场景】
{{scenePhysicalContext}}

【正式资产】
{{assetDescriptions}}

【当前原文、相邻场次与已采用制作结果】
{{productionTeamContext}}
本次直接完成分镜或媒体表达所需的摄影、表演、灯光和声音设计；缺少历史方案时依据原文和作者要求完成，不要求另行筹备。

【已确认分镜】
{{shotsData}}

每个镜头返回一个明确、可生成的静止关键帧。写清主体身份与位置、构图、景别、镜头光学、实际光源和可见状态；不要把多个动作阶段塞进一张静帧。不得添加平台参数、画幅比例说明、工具 UI 或水印，画幅由执行层结构化参数传递。剧本或作者明确要求的招牌、信件、屏幕界面、字幕等作品内容必须保留原文和位置，不得按杂字删除。使用中文为主。

只返回 JSON 数组：
[{"id":"原分镜ID","visualSummary":"画面摘要","imagePrompt":"图片生成提示词"}]`
  },
  'generateVideoPrompts': {
    id: 'generateVideoPrompts',
    name: '生成视频提示词',
    template: `你是电影动作设计、摄影运动与视频提示词编剧。只为已确认分镜生成视频提示词，不生成或改写图片提示词，不改动分镜结构。

【场景】
{{scenePhysicalContext}}

【正式资产】
{{assetDescriptions}}

【当前原文、相邻场次与已采用制作结果】
{{productionTeamContext}}
本次直接完成分镜或媒体表达所需的摄影、表演、灯光和声音设计；缺少历史方案时依据原文和作者要求完成，不要求另行筹备。

【已确认分镜】
{{shotsData}}

每个镜头明确起始状态、主体动作与物体位移、摄影机运动、结束状态以及必要的对白/声音节拍；动作量必须适配镜头时长。逐句保留已确认对白的说话人、原文、标点、重复次数和顺序，不得把多人对白合并成一段；声音建议不能冒充剧本事实。保留作者要求的画内文字与屏幕内容。不得使用平台专属参数，不得假设已有图片提示词。使用中文为主。

只返回 JSON 数组：
[{"id":"原分镜ID","videoPrompt":"视频生成提示词"}]`
  },
  'generateImage': {
    id: 'generateImage',
    name: '生成图像提示词',
    template: `【镜头画面任务】
{{imagePrompt}}`
  },
  'generateVideo': {
    id: 'generateVideo',
    name: '生成视频提示词',
    template: `【视频动作任务】
{{videoPrompt}}

{{userIntent}}`
  },
  'generateSpecificPrompt': {
    id: 'generateSpecificPrompt',
    name: '优化视觉提示词',
    template: `请基于以下信息，生成一段专业的中文视觉生成提示词。
目标：{{targetName}}
描述：{{targetDesc}}
要求：{{promptInstruction}}
视觉风格：{{visualStyle}}

请直接返回提示词文本，不要包含任何其他说明。`
  },
  'generatePanoramaPrompt': {
    id: 'generatePanoramaPrompt',
    name: '生成全景图提示词',
    template: `【角色设定】
你是跨媒介视觉制作总监与全景空间设计师，只为当前场景编写 Equirectangular 360° 全景生成提示词。

【任务目标】
请为以下场景生成一段专业的、符合 360° 全景图生成规范的中文视觉生成提示词。

【场景信息】
名称：{{targetName}}
描述：{{targetDesc}}
视觉风格：{{visualStyle}}

【全景图技术规范 - 必须遵循】
1. 格式：标准 Equirectangular 格式，360x180 度全景，宽高比严格为 2:1。
2. 相机：位于空间绝对几何中心，高度 1.5 米，水平视角，无倾斜。
3. 缝合：左右边缘必须像素级无缝衔接，光影、结构、材质完全连续，支持无限水平循环拼接。
4. 极点：天顶（Zenith）与地底（Nadir）自然过渡，无拉伸扭曲或极点收缩。
5. 逻辑：透视关系符合等距柱状投影规律，中央无变形，边缘自然弯曲。
6. 负向：不要出现人物、文字、镜像重复结构。

【强烈约束：必须要包含的技术基座】
生成的提示词中必须强制附加以下 360 全景技术基座，可保留英文术语：
"Equirectangular projection, 360 degree spherical format,"

【参考案例】
案例：一个科幻风格的飞船驾驶舱
输出：Equirectangular projection, 360 degree spherical format, futuristic spaceship cockpit interior, advanced control panels with glowing interfaces, panoramic nebula visible through a reinforced canopy, preserve the project's declared medium, surface treatment, lighting language and finish, seamless left-right continuity, natural zenith and nadir, empty spatial reference, blank unbranded surfaces.

请直接返回生成的中文提示词文本，必须包含强制要求的 360 全景技术基座，不要包含任何其他说明。`
  },
  'generatePropMultiViewPrompt': {
    id: 'generatePropMultiViewPrompt',
    name: '生成道具多视图提示词',
    template: `【角色设定】
你是跨媒介道具制作设计师，只为当前道具编写多视角生产参考提示词。

【任务目标】
请为以下道具生成一段专业的、用于生成多视角生产参考图的中文视觉生成提示词。

【道具信息】
名称：{{targetName}}
描述：{{targetDesc}}
视觉风格：{{visualStyle}}

【设计规范】
1. 构图：多视图画板排布，包含正面、侧面、背面视图，以及关键细节的特写。
2. 背景：干净的纯色或工业设计风格背景，突出主体。
3. 标注：可以包含一些专业的设计标注线，但不要有乱码文字。
4. 负向：不要出现人物，不要有杂乱的环境干扰。

【强烈约束：必须要包含的设计图基座】
生成的提示词中必须强制附加以下多视图设计图技术基座，可保留英文术语：
"prop production identity sheet, multiple consistent views, front side back views, neutral background, preserve the declared project medium and material system,"

请直接返回生成的中文提示词文本，必须包含强制要求的多视图设计图技术基座，不要包含任何其他说明。`
  },
  'generateCharacterMultiViewPrompt': {
    id: 'generateCharacterMultiViewPrompt',
    name: '生成角色多视图提示词',
    template: `【角色设定】
你是跨媒介角色造型总监，只为当前角色编写多视角生产参考提示词。

【任务目标】
请为以下角色生成一段专业的、用于生成多视角生产参考图的中文视觉生成提示词。

【角色信息】
名称：{{targetName}}
特征：{{targetDesc}}
视觉风格：{{visualStyle}}

【设计规范】
1. 构图：多视图画板排布，包含正面、侧面、背面全身视图，以及面部细节特写。
2. 背景：干净的中性背景，突出主体且不改变项目已声明的制作媒介。
3. 姿态：自然的站姿或标志性动作，展现角色性格。
4. 负向：不要有杂乱的环境干扰。

【强烈约束：必须要包含的设计图基座】
生成的提示词中必须强制附加以下多视图角色设计图技术基座，可保留英文术语：
"character production identity sheet, multiple consistent views, front side back views, neutral background, preserve the declared project medium, construction and surface treatment,"

请直接返回生成的中文提示词文本，必须包含强制要求的多视图角色设计图技术基座，不要包含任何其他说明。`
  },
};
