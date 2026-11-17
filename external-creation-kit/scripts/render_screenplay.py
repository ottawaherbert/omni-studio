#!/usr/bin/env python3
"""Render a reading copy from canonical JSON; never reconstruct missing prose."""
import argparse
from pathlib import Path

from validate_delivery import check_delivery, read_documents


def render(directory):
    report = check_delivery(directory)
    if report["errors"]:
        raise ValueError("\n".join(report["errors"]))
    documents, errors = read_documents(directory)
    if errors:
        raise ValueError("\n".join(errors))
    manifest, bible = documents["manifest"], documents["bible"]
    characters = {x["id"]: x["name"] for x in bible["characters"]}
    scenes = [s for script in documents["scripts"] for s in script["scenes"]]
    lines = [f"# {bible['title']}", "", f"交付：{manifest['deliveryId']}；阶段：{manifest['status']}。",
             "本阅读版由结构化正文生成；互动场次的阅读顺序不等于一次游玩的播放顺序。", ""]
    for unit in sorted(bible["units"], key=lambda u: u["order"]):
        lines.extend([f"## {unit['title']} ({unit['id']})", ""])
        for scene in sorted((s for s in scenes if s["unitId"] == unit["id"]), key=lambda s: s["order"]):
            lines.extend([f"### {scene['order']}. {scene['title']} ({scene['id']})", "",
                          f"{scene['location']} · {scene['timeOfDay']} · {scene['storyTime']}", "",
                          f"路线：{scene['route']}；状态：{scene['status']}；估算：{scene['estimatedSeconds']} 秒。", ""])
            for block in scene["blocks"]:
                if block["type"] == "dialogue":
                    if block["speakerId"] not in characters:
                        raise ValueError(f"未知说话人：{block['speakerId']}")
                    lines.extend([f"**{characters[block['speakerId']]}**", "", block["text"], ""])
                elif block["type"] == "note":
                    lines.extend(["【制作备注】", "", block["text"], ""])
                else:
                    lines.extend([block["text"], ""])
    return "\n".join(lines).rstrip() + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    # A derived copy must never overwrite a source, template, or previous artifact.
    text = render(args.directory)
    with args.output.open("x", encoding="utf-8") as output:
        output.write(text)
    print(args.output.resolve())


if __name__ == "__main__":
    main()
