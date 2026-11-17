#!/usr/bin/env python3
"""Build self-contained web instructions from the maintained skill resources."""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def compact_json(path):
    return json.dumps(json.loads(path.read_text(encoding="utf-8")), ensure_ascii=False, separators=(",", ":"))


def build(kind):
    skill_name = "omni-external-screenwriting" if kind == "screenwriting" else "omni-external-interactive-design"
    skill = (ROOT / "skills" / skill_name / "SKILL.md").read_text(encoding="utf-8")
    # Strip metadata; relative references below are supplied by the appended text.
    skill = skill.split("---", 2)[2].strip()
    skill = re.sub(r"\[([^\]]+)\]\(\.\./\.\./shared/[^)]+\)", r"\1（下文已附）", skill)
    title = "剧本创作" if kind == "screenwriting" else "互动叙事设计"
    sections = [f"# 外部{title}任务说明", "",
                "请按以下创作规范工作。我会在本说明后提供项目要求、已有稿件和本次范围。若要求尚未提供，先请我填写项目要求，不直接把示例改名当作我的作品。",
                "这是通用网页指令，不依赖平台原生 Skill 功能。下文已包含相对链接所指的创作规则、交付规范、全部 Schema 和完整示例；无需访问我的本地路径。",
                "若不能创建附件，就逐文件以文件名加完整代码块返回。不要声称已执行你实际无法执行的本地校验或系统导入。", "", skill]
    for name in ("creation-rules.md", "delivery-contract.md"):
        sections.extend(["", (ROOT / "shared" / name).read_text(encoding="utf-8").strip()])
    sections.extend(["", "# 机器格式定义", "",
                     "以下 JSON Schema 是规则，不是应原样交付的作品文件。每个 Schema 均独立，$ref 只指向该 Schema 的本地 $defs。"])
    for name in ("manifest", "bible", "screenplay", "interactive"):
        sections.extend(["", f"## {name}.schema.json", "", "```json", compact_json(ROOT / "schemas" / f"{name}.schema.json"), "```"])
    sections.extend(["", "# 完整格式示例：末班渡口", "",
                     "示例仅说明文件关系与具体写法；题材、人物、场数、结局数和时长都不是你接下来应套用的默认值。普通影视可将 interactive 文件设为 null 并把清单 nodeIds 设为空。"])
    for name in ("manifest.json", "story-bible.json", "screenplay-01.json", "interactive.json"):
        sections.extend(["", f"## {name}", "", "```json", compact_json(ROOT / "examples" / "last-ferry" / name), "```"])
    sections.extend(["", "## design-notes.md", "", (ROOT / "examples" / "last-ferry" / "design-notes.md").read_text(encoding="utf-8").strip(), "",
                     "# 我接下来提供的项目要求", "", "以下模板供我填写；已提供过的信息直接沿用。", "",
                     (ROOT / "templates" / "project-brief.md").read_text(encoding="utf-8").strip(), ""])
    return "\n".join(sections)


def main():
    for kind in ("screenwriting", "interactive-design"):
        path = ROOT / "web-prompts" / f"{kind}.md"
        path.parent.mkdir(exist_ok=True)
        path.write_text(build(kind), encoding="utf-8")
        print(f"{path.name}: {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
