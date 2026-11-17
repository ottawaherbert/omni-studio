# 外部剧本与互动设计创作包

这是交给外部大模型或 Agent 的创作规范，适用于把任务交给网页端 GPT、Gemini、豆包，或能够读取本地文件的反重力等客户端。**它不属于 Omni Studio 内部 Skill 库，不需要导入系统的 Skill 页面。**

版本：`1.0`。文件包中的交换格式使用 `omni-external-*.v1`，与系统内部存储格式分开。

## 从这里开始

1. 复制并填写 [项目要求模板](templates/project-brief.md)。没确定的事项可以写“待讨论”，尤其是故事方向和互动规模。
2. 普通影视创作使用 [剧本网页指令](web-prompts/screenwriting.md)；互动作品先使用 [互动设计网页指令](web-prompts/interactive-design.md)，确定结构后再使用剧本指令完成场景正文。已有剧本也可以反过来改编成互动作品。
3. 把对应网页指令全文、项目要求和已有稿件一起交给外部模型。长文件可作为附件；不支持附件时按文件名逐份粘贴，每份保持完整，最后说明“资料发送完毕”。
4. 将模型返回的交付文件保存在同一个文件夹。把整个文件夹或压缩包交回本项目进行检查和回填。长篇可按集、章或选定场次分批交付。

网页指令已经包含所需规范、Schema 和样例；不用让模型猜测相对路径里的内容。**聊天中说“执行这个 Skill”并不意味着平台会自动加载文件。** 如果模型看不到附件或正文，让它明确指出缺失资料。

能够读取文件的 Agent：交给它本文件夹，并指定以下任一入口。两个 Skill 共用 `shared/` 和 `schemas/`，请保持整个目录结构，不要只复制一个 `SKILL.md`。

| 入口 | 适用任务 |
| --- | --- |
| [剧本创作 Skill](skills/omni-external-screenwriting/SKILL.md) | 从构思到完整剧本、改编、续写、指定场次修订 |
| [互动设计 Skill](skills/omni-external-interactive-design/SKILL.md) | 叙事影游的选择、状态、分支、汇合、结局及制作量设计 |
| [修订委托模板](templates/revision-request.md) | 在明确的已有版本上局部修改，保护其他内容和稳定编号 |

例如对文件 Agent 说：

> 阅读 `skills/omni-external-interactive-design/SKILL.md` 及它要求的配套规范。以我提供的项目要求为准，先完成互动结构设计；交付 draft 包，列清需要写作的场景。随后使用剧本 Skill 完成正文，并交付完整 ready 包。文件输出到另一个作品文件夹，保留本规范包和原稿。

## 交付什么

| 文件 | 职责 |
| --- | --- |
| `manifest.json` | 本次交付版本、范围、文件清单、对象清单、修改与待决事项 |
| `story-bible.json` | 共用的人物、事实、创作方法、风格、作品形态和分集目录 |
| `screenplay-01.json` 等 | 场次和完整正文；可以拆成多个完整 JSON 文件 |
| `interactive.json` | 互动图、条件、状态变化、结局、视频制作计划；普通影视项目为 null |
| `design-notes.md` | 给人读的创作理由、玩法说明、质量检查和风险说明 |

正文只有结构化剧本一份来源。阅读版可以用下方脚本生成，修改后重新生成。`design-notes.md` 不再维护第二套台词。

完整字段、修订和分批规则见 [交付规范](shared/delivery-contract.md)。完整小型样例见 [《末班渡口》清单](examples/last-ferry/manifest.json) 和 [生成的剧本阅读版](examples/last-ferry/screenplay.reading.md)，这是虚构格式示例，不是对新作品的题材限制。

## 本地检查

需要 Python 3.10 或以上。离线校验和阅读版工具需要 `jsonschema`；没有运行环境时仍可以使用所有创作文件，并在交付说明中标注“未运行机器校验”。

```sh
python3 -m pip install -r external-creation-kit/requirements.txt
python3 external-creation-kit/scripts/validate_delivery.py external-creation-kit/examples/last-ferry
python3 external-creation-kit/scripts/render_screenplay.py external-creation-kit/examples/last-ferry --output /tmp/last-ferry-screenplay.md
```

将最后一个目录换成模型生成的作品目录即可。阅读版工具拒绝覆盖已有输出，请使用新的输出文件名。校验器只读作品文件，不访问网络、不调用模型、不连接系统数据库。

校验包括 JSON Schema、清单和编号、跨文件引用、对白说话人、变量类型与取值、可达状态中的死路和自动分流歧义、结局可达性、实际可用选项、视频计划去重统计。有限状态遍历默认最多 20000 个状态；超出上限报告“检查未完成”。目标时长与内容估算分开报告，不能据此声称真实成片时长或实际玩家中位数。

退出码：`0` 为机器检查完成且通过，`1` 为错误，`2` 为检查不完整。draft 缺正文、局部交付、状态遍历截断均不会被标为完整项目通过。**机器检查不判断作品是否好看，也不验证自然语言事实的一致性。**

## 回填到 Omni Studio

将交付包交回来后，按 [回填与验收说明](shared/import-handoff.md) 检查、映射和预览。当前目录提供外部创作与离线验收工具，**没有新增系统内一键导入入口，也没有直接写数据库的脚本**。JSON 不能直接粘到任意内部 API。后续实际回填需要使用系统已有入口，或另行实现并验收批量导入。

视频、图片、分镜和最终互动成片继续在系统里制作。外部模型的 `mediaPlan` 是制作计划，不是生成完成的媒体。

## 维护这个包

规范源文件在 `skills/`、`shared/`、`schemas/`。修改后运行：

```sh
python3 external-creation-kit/scripts/build_web_prompts.py
python3 -m unittest discover -s external-creation-kit/tests -v
```

`web-prompts/` 是从规范生成的完整网页指令，不要单独修改导致两个入口不一致。没有安装到本机 Agent 的自动发现目录；拿到文件不授予外部 Agent 系统账号、数据库或视频服务权限。
