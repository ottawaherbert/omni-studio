#!/usr/bin/env python3
"""Offline external-delivery checks. Never imports into Omni Studio."""
import argparse
from collections import defaultdict, deque
import json
from pathlib import Path
import sys

try:
    from jsonschema import Draft202012Validator
except ImportError:
    raise SystemExit("缺少 jsonschema；请安装本包 requirements.txt 中的依赖。")

SCHEMA_DIR = Path(__file__).resolve().parents[1] / "schemas"


def strict_json(path):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError(f"重复 JSON 字段：{key}")
            value[key] = item
        return value

    def invalid_number(value):
        raise ValueError(f"非法 JSON 数值：{value}")

    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=pairs,
                      parse_constant=invalid_number)


def contained_file(root, name):
    candidate = Path(name)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError(f"路径不能离开交付目录：{name}")
    path = (root / candidate).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"文件或软链接越过交付目录：{name}")
    return path


def read_documents(directory):
    """Return schema-checked documents and errors; no remote schema fetching."""
    root = Path(directory).resolve()
    errors, documents = [], {}

    def read(name, kind):
        try:
            path = contained_file(root, name)
            data = strict_json(path)
            schema = strict_json(SCHEMA_DIR / f"{kind}.schema.json")
            Draft202012Validator.check_schema(schema)
            problems = list(Draft202012Validator(schema).iter_errors(data))
            for issue in problems[:30]:
                location = "/".join(str(x) for x in issue.absolute_path)
                errors.append(f"{name}/{location}: {issue.message}")
            if len(problems) > 30:
                errors.append(f"{name}: 另有 {len(problems) - 30} 个结构错误")
            return data if not problems else None
        except (OSError, ValueError) as exc:
            errors.append(f"{name}: {exc}")
            return None

    manifest = read("manifest.json", "manifest")
    if manifest is None:
        return documents, errors
    documents["manifest"] = manifest
    files = manifest["files"]
    names = ["manifest.json", files["bible"], *files["scripts"], files["notes"]]
    if files["interactive"] is not None:
        names.append(files["interactive"])
    if len(names) != len(set(names)):
        errors.append("文件清单中出现同一路径承担多个文件角色")
    documents["bible"] = read(files["bible"], "bible")
    documents["scripts"] = [read(name, "screenplay") for name in files["scripts"]]
    documents["interactive"] = read(files["interactive"], "interactive") if files["interactive"] else None
    try:
        if not contained_file(root, files["notes"]).read_text(encoding="utf-8").strip():
            errors.append("设计说明文件为空")
    except (OSError, ValueError) as exc:
        errors.append(f"设计说明：{exc}")
    return documents, errors


def condition_variables(condition):
    if condition["op"] == "compare":
        return {condition["variable"]}
    if condition["op"] in ("all", "any"):
        return set().union(*(condition_variables(p) for p in condition["predicates"]))
    if condition["op"] == "not":
        return condition_variables(condition["predicate"])
    return set()


def evaluate(condition, state):
    op = condition["op"]
    if op == "always":
        return True
    if op == "all":
        return all(evaluate(p, state) for p in condition["predicates"])
    if op == "any":
        return any(evaluate(p, state) for p in condition["predicates"])
    if op == "not":
        return not evaluate(condition["predicate"], state)
    a, b = state[condition["variable"]], condition["value"]
    comparator = condition["comparator"]
    if comparator == "eq":
        return type(a) is type(b) and a == b
    if comparator == "neq":
        return type(a) is not type(b) or a != b
    if comparator == "gt":
        return a > b
    if comparator == "gte":
        return a >= b
    if comparator == "lt":
        return a < b
    return a <= b


def valid_value(variable, value, bounded=True):
    if variable["type"] == "boolean":
        return type(value) is bool
    if variable["type"] == "integer":
        return type(value) is int and (not bounded or variable["min"] <= value <= variable["max"])
    return type(value) is str and value in variable["values"]


def explore(graph, nodes, variables, scenes, report, limit):
    errors, warnings, incomplete = (report[k] for k in ("errors", "warnings", "incomplete"))
    outgoing = defaultdict(list)
    for edge in graph["edges"]:
        outgoing[edge["from"]].append(edge)
    keys = sorted(variables)

    def signature(node_id, state):
        return node_id, tuple(state[key] for key in keys)

    initial = signature(graph["entryNodeId"], {key: variables[key]["default"] for key in keys})
    queue, seen = deque([initial]), {initial}
    adjacency, reverse, predecessor = defaultdict(list), defaultdict(set), {}
    terminal, visited_nodes, used_edges = set(), set(), set()
    truncated, processed = False, 0
    while queue and not truncated:
        current = queue.popleft()
        processed += 1
        node_id, values = current
        state = dict(zip(keys, values))
        node = nodes[node_id]
        visited_nodes.add(node_id)
        if node["type"] == "ending":
            terminal.add(current)
            continue
        enabled = [edge for edge in outgoing[node_id] if evaluate(edge["condition"], state)]
        if not enabled:
            errors.append(f"可达死路：{node_id}，状态 {state}")
        elif node["type"] != "choice" and len(enabled) != 1:
            errors.append(f"自动分流有歧义：{node_id}，状态 {state} 同时满足 {len(enabled)} 条边")
        for edge in enabled:
            next_state = dict(state)
            valid = True
            for effect in edge["effects"]:
                key = effect["variable"]
                if effect["type"] == "set":
                    next_state[key] = effect["value"]
                else:
                    direction = 1 if effect["type"] == "increment" else -1
                    next_state[key] += direction * effect["amount"]
                if not valid_value(variables[key], next_state[key]):
                    errors.append(f"{edge['id']} 执行效果后 {key} 越界或类型错误：{next_state[key]}")
                    valid = False
                    break
            if not valid:
                continue
            target = signature(edge["to"], next_state)
            if target not in seen:
                if len(seen) >= limit:
                    truncated = True
                    break
                seen.add(target)
                predecessor[target] = current, edge["id"]
                queue.append(target)
            used_edges.add(edge["id"])
            adjacency[current].append(target)
            reverse[target].add(current)

    report["statistics"].update(reachableStates=len(seen), exploredStates=processed,
                                reachableNodes=len(visited_nodes), enabledEdges=len(used_edges))
    report["coverage"] = {"complete": not truncated, "stateLimit": limit,
                          "meaning": "节点与有类型状态组合；不含玩家等待时间和自然语言事实推理"}
    if truncated:
        incomplete.append(f"达到 {limit} 个状态的遍历上限；不能判定完整可达性和时长")
        return

    for node_id in sorted(set(nodes) - visited_nodes):
        errors.append(f"节点不可达：{node_id}")
    for edge in graph["edges"]:
        if edge["id"] not in used_edges:
            errors.append(f"分支从未可用：{edge['id']}")
    can_finish = set(terminal)
    queue = deque(terminal)
    while queue:
        for parent in reverse[queue.popleft()]:
            if parent not in can_finish:
                can_finish.add(parent)
                queue.append(parent)
    bad = seen - can_finish
    if bad:
        errors.append(f"{len(bad)} 个可达状态无法到达任何结局；涉及节点：{sorted({x[0] for x in bad})}")

    witnesses = []
    for ending in graph["endings"]:
        possibilities = sorted((x for x in terminal if x[0] == ending["nodeId"]), key=repr)
        if not possibilities:
            errors.append(f"结局不可达：{ending['id']}")
            continue
        cursor, edge_ids, route = possibilities[0], [], []
        final_state = dict(zip(keys, cursor[1]))
        while True:
            route.append(cursor[0])
            if cursor not in predecessor:
                break
            cursor, edge_id = predecessor[cursor]
            edge_ids.append(edge_id)
        witnesses.append({"endingId": ending["id"], "nodeIds": list(reversed(route)),
                          "edgeIds": list(reversed(edge_ids)), "finalState": final_state})
    report["endingWitnesses"] = witnesses

    # Topological statistics on the reachable state graph. Cycles are explicit.
    indegree = {state: 0 for state in seen}
    for targets in adjacency.values():
        for target in targets:
            indegree[target] += 1
    queue = deque(x for x, degree in indegree.items() if degree == 0)
    ordered = []
    while queue:
        state = queue.popleft()
        ordered.append(state)
        for target in adjacency[state]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    if len(ordered) != len(seen):
        warnings.append("存在可重复的剧情状态循环；最长游玩时长与最长无选择间隔未计算，需检查循环体验")
        report["statistics"]["routeDurationRangeSeconds"] = None
        return
    durations = {key: sum(scenes[s]["estimatedSeconds"] for s in node["sceneIds"])
                 for key, node in nodes.items()}
    low, high, gaps, counts = {initial: 0}, {initial: 0}, {initial: 0}, {initial: 1}
    max_gap = 0
    for current in ordered:
        duration = durations[current[0]]
        gap = gaps.get(current, 0) + duration
        max_gap = max(max_gap, gap)
        for target in adjacency[current]:
            low[target] = min(low.get(target, float("inf")), low[current] + duration)
            high[target] = max(high.get(target, 0), high[current] + duration)
            gaps[target] = max(gaps.get(target, 0), 0 if nodes[current[0]]["type"] == "choice" else gap)
            counts[target] = counts.get(target, 0) + counts[current]
    if terminal:
        bounds = [min(low[x] + durations[x[0]] for x in terminal),
                  max(high[x] + durations[x[0]] for x in terminal)]
        report["statistics"].update(routeDurationRangeSeconds=bounds,
                                    completeRouteCount=sum(counts[x] for x in terminal),
                                    maxSecondsWithoutChoiceEstimate=max_gap)
        estimated = graph["timing"]["estimatedPlaythroughRangeSeconds"]
        if bounds[0] < estimated[0] or bounds[1] > estimated[1]:
            warnings.append(f"按场景累计的路线范围 {bounds} 秒超出声明估算 {estimated} 秒")
        if max_gap > graph["timing"]["maxSecondsWithoutChoice"]:
            warnings.append(f"最长无选择内容约 {max_gap} 秒，超过项目目标")


def audit(directory, max_states=20000, base=None, check_revision=True):
    report = {"errors": [], "warnings": [], "incomplete": [], "statistics": {},
              "coverage": {"complete": False}, "endingWitnesses": []}
    documents, errors = read_documents(directory)
    report["errors"].extend(errors)
    if errors:
        return report, {}
    manifest, bible, scripts, graph = (documents[k] for k in ("manifest", "bible", "scripts", "interactive"))
    err, warn, incomplete = (report[k] for k in ("errors", "warnings", "incomplete"))
    ready = manifest["status"] == "ready"
    all_docs = [bible, *scripts] + ([graph] if graph else [])
    for document in all_docs:
        for field in ("projectId", "deliveryId"):
            if document[field] != manifest[field]:
                err.append(f"文件间 {field} 不一致：{document['format']}")
    if manifest["baseDeliveryId"] == manifest["deliveryId"]:
        err.append("新 deliveryId 不能与 baseDeliveryId 相同")
    if len({script["partId"] for script in scripts}) != len(scripts):
        err.append("剧本 partId 重复")
    if manifest["scope"]["kind"] == "selected":
        incomplete.append("这是局部交付；工具不合并基准，需合并并审查完整项目后再验收")
    if manifest["status"] == "draft":
        incomplete.append("交付标记为 draft，尚不是完成稿")
    if manifest["openQuestions"]:
        (err if ready else incomplete).append("存在未解决的 openQuestions")

    registry, entities = {}, {}

    def register(items, label, primary=True):
        result = {}
        for item in items:
            key = item["id"]
            if key in registry:
                err.append(f"ID 重复：{key}（{registry[key]} / {label}）")
            registry[key] = label
            result[key] = item
            if primary:
                entities[key] = item
        return result

    def references(ids, target, label):
        for key in ids:
            if key not in target:
                err.append(f"{label} 引用不存在的 ID：{key}")

    def unique_order(items, label):
        values = [x["order"] for x in items]
        if len(values) != len(set(values)):
            err.append(f"{label} 中 order 重复")

    characters = register(bible["characters"], "人物")
    facts = register(bible["facts"], "事实")
    units = register(bible["units"], "单元")
    register(bible["methods"], "方法")
    unique_order(bible["units"], "单元")
    if bible["profile"]["organization"] == "standalone" and len(units) != 1:
        err.append("standalone 作品必须只有一个单元")
    scenes = register([scene for script in scripts for scene in script["scenes"]], "场次")
    for unit_id in units:
        unique_order([s for s in scenes.values() if s["unitId"] == unit_id], f"单元 {unit_id}")
    for scene in scenes.values():
        references([scene["unitId"]], units, scene["id"])
        references(scene["characterIds"], characters, scene["id"])
        register(scene["blocks"], f"{scene['id']} 正文块", False)
        if scene["status"] == "planned":
            (err if ready else incomplete).append(f"场次未完成：{scene['id']}")
        elif not any(b["type"] in ("action", "dialogue") for b in scene["blocks"]):
            err.append(f"complete 场次缺少动作或对白正文：{scene['id']}")
        elif scene["estimatedSeconds"] <= 0:
            err.append(f"complete 场次时长必须大于零：{scene['id']}")
        for block in scene["blocks"]:
            if "speakerId" in block:
                references([block["speakerId"]], scene["characterIds"], block["id"])
                if block["type"] not in ("dialogue", "parenthetical"):
                    err.append(f"{block['id']} 的块类型不允许 speakerId")
        for item in scene["continuity"]:
            references(item["subjectIds"], set(characters) | set(facts), scene["id"])
            references(item["factIds"], facts, scene["id"])

    nodes = {}
    if graph:
        nodes = register(graph["nodes"], "节点")
        variables = register(graph["variables"], "变量")
        edges = register(graph["edges"], "边")
        endings = register(graph["endings"], "结局")
        media = register(graph["mediaPlan"], "制作单元")
        chapters = register(graph["chapters"], "章节")
        unique_order(graph["chapters"], "章节")
        references([graph["entryNodeId"]], nodes, "入口")
        membership = []
        for chapter in chapters.values():
            references(chapter["nodeIds"], nodes, chapter["id"])
            membership.extend(chapter["nodeIds"])
            for key in chapter["nodeIds"]:
                if key in nodes and nodes[key]["chapterId"] != chapter["id"]:
                    err.append(f"{key} 的章节双向映射不一致")
        if set(membership) != set(nodes) or len(membership) != len(nodes):
            err.append("每个节点必须恰好属于一个章节")
        for variable in variables.values():
            if variable["type"] == "integer" and variable["min"] > variable["max"]:
                err.append(f"变量上下界颠倒：{variable['id']}")
            if not valid_value(variable, variable["default"]):
                err.append(f"变量默认值无效：{variable['id']}")

        def check_condition(condition, label):
            op = condition["op"]
            if op in ("all", "any"):
                for child in condition["predicates"]:
                    check_condition(child, label)
            elif op == "not":
                check_condition(condition["predicate"], label)
            elif op == "compare":
                variable = variables.get(condition["variable"])
                if variable is None:
                    err.append(f"{label} 条件引用未知变量 {condition['variable']}")
                elif not valid_value(variable, condition["value"], False):
                    err.append(f"{label} 条件值类型或枚举取值错误")
                elif condition["comparator"] not in ("eq", "neq") and variable["type"] != "integer":
                    err.append(f"{label} 只有 integer 支持大小比较")

        outgoing = defaultdict(list)
        read_vars, written_vars = set(), set()
        for edge in edges.values():
            references([edge["from"], edge["to"], *edge["consequence"]["readAtNodeIds"]], nodes, edge["id"])
            outgoing[edge["from"]].append(edge)
            check_condition(edge["condition"], edge["id"])
            read_vars |= condition_variables(edge["condition"])
            for effect in edge["effects"]:
                key = effect["variable"]
                written_vars.add(key)
                variable = variables.get(key)
                if variable is None:
                    err.append(f"{edge['id']} 效果引用未知变量 {key}")
                elif effect["type"] == "set" and not valid_value(variable, effect["value"]):
                    err.append(f"{edge['id']} set 值类型或范围错误")
                elif effect["type"] != "set" and variable["type"] != "integer":
                    err.append(f"{edge['id']} 只有 integer 支持增减")
        for key in sorted(written_vars - read_vars):
            warn.append(f"变量 {key} 被修改但没有条件读取；需人工检查其可见后果")
        used_media, used_scenes = set(), set()
        for node in nodes.values():
            label = node["id"]
            references([node["chapterId"]], chapters, label)
            references(node["sceneIds"], scenes, label)
            references(node["mediaIds"], media, label)
            used_media.update(node["mediaIds"])
            used_scenes.update(node["sceneIds"])
            count = len(outgoing[label])
            if node["type"] == "ending":
                if count or node.get("endingId") not in endings:
                    err.append(f"结局节点 {label} 必须绑定结局且没有出边")
                elif endings[node["endingId"]]["nodeId"] != label:
                    err.append(f"结局映射不一致：{label}")
            elif "endingId" in node:
                err.append(f"非结局节点不能声明 endingId：{label}")
            if node["type"] == "scene" and count != 1:
                err.append(f"scene 节点必须恰有一条出边：{label}")
            if node["type"] == "router" and (not count or node["sceneIds"] or node["mediaIds"]):
                err.append(f"router 节点必须有出边且不包含正文或媒体：{label}")
            if node["type"] == "choice" and count < 2:
                err.append(f"choice 至少设计两条出边：{label}")
            if node["type"] != "router" and not node["sceneIds"]:
                err.append(f"内容节点缺少场次映射：{label}")
            source_ids = set()
            for key in node["mediaIds"]:
                if key in media:
                    source_ids.update(media[key]["sceneIds"])
                    references(media[key]["sceneIds"], node["sceneIds"], f"{label} 的媒体 {key}")
            if ready and source_ids != set(node["sceneIds"]):
                err.append(f"{label} 的媒体计划没有覆盖全部来源场次")
        for ending in endings.values():
            node = nodes.get(ending["nodeId"])
            if not node or node["type"] != "ending" or node.get("endingId") != ending["id"]:
                err.append(f"结局缺少有效的双向节点映射：{ending['id']}")
        for item in media.values():
            references(item["sceneIds"], scenes, item["id"])
            if item["id"] not in used_media:
                err.append(f"制作单元没有节点使用：{item['id']}")
        for scene_id in sorted(set(scenes) - used_scenes):
            warn.append(f"剧本场次未在本互动图使用：{scene_id}")
        media_seconds = sum(x["estimatedSeconds"] for x in media.values())
        report["statistics"].update(nodes=len(nodes), edges=len(edges), endings=len(endings),
                                    uniqueMediaUnits=len(media), uniqueMediaSeconds=media_seconds)
        if media_seconds > graph["timing"]["uniqueMediaBudgetSeconds"]:
            err.append(f"独立视频计划 {media_seconds} 秒超过预算 {graph['timing']['uniqueMediaBudgetSeconds']} 秒")
        timing_range = graph["timing"]["estimatedPlaythroughRangeSeconds"]
        if timing_range[0] > timing_range[1]:
            err.append("单次游玩估算范围上下界颠倒")

    for key, expected in (("characterIds", characters), ("unitIds", units), ("sceneIds", scenes), ("nodeIds", nodes)):
        if set(manifest["inventory"][key]) != set(expected):
            err.append(f"manifest.inventory.{key} 与实际内容不一致")
    if manifest["projectId"] in registry:
        err.append("projectId 不能与内容对象 ID 重复")
    bible_meta = {k: v for k, v in bible.items() if k not in ("format", "deliveryId", "characters", "facts", "units", "methods")}
    graph_meta = {k: v for k, v in graph.items() if k not in ("format", "deliveryId", "chapters", "variables", "nodes", "edges", "endings", "mediaPlan")} if graph else None
    entities[manifest["projectId"]] = {"bible": bible_meta, "interactive": graph_meta}
    changes = manifest["changes"]
    changed_sets = [set(changes[k]) for k in ("addedIds", "modifiedIds", "deletedIds")]
    if any(changed_sets[i] & changed_sets[j] for i in range(3) for j in range(i)):
        err.append("新增、修改与删除清单不能包含同一对象")
    references(changes["addedIds"] + changes["modifiedIds"], entities, "变更清单")
    if set(changes["deletedIds"]) & set(entities):
        err.append("deletedIds 中的对象仍出现在新包里")
    if manifest["baseDeliveryId"] is None:
        if base is not None:
            err.append("没有 baseDeliveryId 的新包不应使用 --base")
        if changes["modifiedIds"] or changes["deletedIds"]:
            err.append("首次交付没有基准，不应声明修改或删除旧对象")
        if changes["addedIds"] and set(changes["addedIds"]) != set(entities):
            err.append("首次交付的 addedIds 应为空，或准确列出全部主要对象（含 projectId）")
    elif check_revision:
        if base is None:
            incomplete.append("修订包需要 --base 核对实际基准和变更范围")
        else:
            previous, old_entities = audit(base, max_states, check_revision=False)
            old_docs, old_errors = read_documents(base)
            if old_errors or previous["errors"]:
                err.append("基准包未通过格式或逻辑检查，不能核对修订")
            else:
                old_manifest = old_docs["manifest"]
                if previous["incomplete"] or old_manifest["scope"]["kind"] != "full" or old_manifest["status"] != "ready":
                    incomplete.append("基准不是完整 ready 快照，不能证明无遗漏")
                if old_manifest["projectId"] != manifest["projectId"] or old_manifest["deliveryId"] != manifest["baseDeliveryId"]:
                    err.append("基准的 projectId / deliveryId 与修订声明不符")
                # Omitted interaction is outside this delivery, never implicit deletion.
                if graph is None and old_docs["interactive"]:
                    warn.append("本轮未提供互动图；原图与修订正文的兼容性未检查，不能视为完整互动作品验收")
                    old_graph = old_docs["interactive"]
                    omitted_ids = {item["id"] for field in ("chapters", "variables", "nodes", "edges", "endings", "mediaPlan")
                                   for item in old_graph[field]}
                    old_entities = {key: value for key, value in old_entities.items() if key not in omitted_ids}
                    old_project = old_entities[old_manifest["projectId"]]
                    old_entities[old_manifest["projectId"]] = {**old_project, "interactive": None}
                new_ids, old_ids = set(entities), set(old_entities)
                actual = {"addedIds": new_ids - old_ids,
                          "modifiedIds": {key for key in new_ids & old_ids if entities[key] != old_entities[key]},
                          "deletedIds": old_ids - new_ids}
                if manifest["scope"]["kind"] == "selected":
                    actual.pop("deletedIds")
                    references(changes["deletedIds"], old_entities, "删除清单")
                for key, values in actual.items():
                    if set(changes[key]) != values:
                        err.append(f"{key} 与基准差异不一致；实际 {sorted(values)}")
    report["statistics"].update(characters=len(characters), units=len(units), scenes=len(scenes),
                                blocks=sum(len(s["blocks"]) for s in scenes.values()),
                                totalAuthoredContentSeconds=sum(s["estimatedSeconds"] for s in scenes.values()))
    if not err:
        if graph:
            explore(graph, nodes, variables, scenes, report, max_states)
        else:
            report["coverage"] = {"complete": True, "meaning": "剧本格式与引用检查；本包没有互动图"}
    return report, entities


def check_delivery(directory, max_states=20000, base=None):
    if max_states < 1:
        raise ValueError("max_states 必须大于零")
    report, _ = audit(directory, max_states, base)
    for key in ("errors", "warnings", "incomplete"):
        report[key] = list(dict.fromkeys(report[key]))
    report["status"] = "failed" if report["errors"] else "incomplete" if report["incomplete"] else "passed"
    report["creativeReview"] = "未自动评定；需要人的创作审阅与实际系统验收"
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--base", type=Path)
    parser.add_argument("--max-states", type=int, default=20000)
    args = parser.parse_args()
    if args.max_states < 1:
        parser.error("--max-states 必须大于零")
    report = check_delivery(args.directory, args.max_states, args.base)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return {"passed": 0, "failed": 1, "incomplete": 2}[report["status"]]


if __name__ == "__main__":
    sys.exit(main())
