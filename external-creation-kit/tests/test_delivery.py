import copy
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from validate_delivery import check_delivery
from render_screenplay import render
from build_web_prompts import build


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "delivery"
        shutil.copytree(ROOT / "examples" / "last-ferry", self.path)

    def read(self, name):
        return json.loads((self.path / name).read_text(encoding="utf-8"))

    def write(self, name, data):
        (self.path / name).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def assert_fails(self, fragment):
        report = check_delivery(self.path)
        self.assertEqual(report["status"], "failed", report)
        self.assertTrue(any(fragment in error for error in report["errors"]), report)

    def test_full_example_has_two_endings_and_preserves_state_at_merge(self):
        report = check_delivery(self.path)
        self.assertEqual(report["status"], "passed", report)
        stats = report["statistics"]
        self.assertEqual(stats["routeDurationRangeSeconds"], [105, 105])
        self.assertEqual(stats["completeRouteCount"], 2)
        self.assertEqual(stats["totalAuthoredContentSeconds"], 160)
        self.assertEqual(stats["uniqueMediaSeconds"], 160)
        states = {x["endingId"]: x["finalState"]["var_key_disclosed"] for x in report["endingWitnesses"]}
        self.assertEqual(states, {"ending_record": True, "ending_return": False})
        self.assertTrue(all("node_depart" in x["nodeIds"] for x in report["endingWitnesses"]))

    def test_missing_file_is_an_error(self):
        (self.path / "screenplay-01.json").unlink()
        self.assert_fails("screenplay-01.json")

    def test_duplicate_json_keys_are_rejected(self):
        p = self.path / "manifest.json"
        p.write_text(p.read_text().replace('"status": "ready"', '"status": "draft", "status": "ready"'))
        self.assert_fails("重复 JSON 字段")

    def test_untrusted_manifest_cannot_read_outside_package(self):
        manifest = self.read("manifest.json")
        manifest["files"]["bible"] = "../outside.json"
        self.write("manifest.json", manifest)
        self.assert_fails("路径不能离开")

    def test_duplicate_object_ids(self):
        script = self.read("screenplay-01.json")
        script["scenes"][1]["blocks"][0]["id"] = script["scenes"][0]["blocks"][0]["id"]
        self.write("screenplay-01.json", script)
        self.assert_fails("ID 重复")

    def test_complete_scene_must_contain_body(self):
        script = self.read("screenplay-01.json")
        script["scenes"][0]["blocks"] = []
        self.write("screenplay-01.json", script)
        self.assert_fails("缺少动作或对白正文")

    def test_dialogue_speaker_must_be_in_scene(self):
        script = self.read("screenplay-01.json")
        script["scenes"][0]["blocks"][1]["speakerId"] = "char_missing"
        self.write("screenplay-01.json", script)
        self.assert_fails("char_missing")

    def test_dangling_node_and_media_references(self):
        graph = self.read("interactive.json")
        graph["edges"][0]["to"] = "node_missing"
        graph["nodes"][0]["mediaIds"] = ["media_missing"]
        self.write("interactive.json", graph)
        self.assert_fails("node_missing")
        self.assert_fails("media_missing")

    def test_boolean_string_cannot_be_used_as_boolean_condition(self):
        graph = self.read("interactive.json")
        graph["edges"][-1]["condition"]["value"] = "false"
        self.write("interactive.json", graph)
        self.assert_fails("条件值类型")

    def test_composite_conditions_and_finite_types(self):
        graph = self.read("interactive.json")
        graph["variables"].extend([
            dict(id="var_place", type="enum", default="boat", values=["shore", "boat"], meaning="位置"),
            dict(id="var_count", type="integer", default=0, min=0, max=2, meaning="交接次数")])
        graph["edges"][0]["effects"].extend([
            dict(type="set", variable="var_place", value="shore"),
            dict(type="increment", variable="var_count", amount=2),
            dict(type="decrement", variable="var_count", amount=1)])
        graph["edges"][-2]["condition"] = dict(op="all", predicates=[
            dict(op="not", predicate=dict(op="compare", variable="var_key_disclosed", comparator="eq", value=False)),
            dict(op="compare", variable="var_place", comparator="eq", value="shore"),
            dict(op="compare", variable="var_count", comparator="gte", value=1)])
        graph["edges"][-1]["condition"] = dict(op="any", predicates=[
            dict(op="compare", variable="var_place", comparator="eq", value="boat"),
            dict(op="compare", variable="var_count", comparator="lt", value=0)])
        self.write("interactive.json", graph)
        report = check_delivery(self.path)
        self.assertEqual(report["status"], "passed", report)
        self.assertEqual(report["statistics"]["completeRouteCount"], 2)

    def test_automatic_router_ambiguity_is_rejected(self):
        graph = self.read("interactive.json")
        graph["edges"][-1]["condition"] = {"op": "always"}
        self.write("interactive.json", graph)
        self.assert_fails("自动分流有歧义")

    def test_no_exit_after_merge_is_reported(self):
        graph = self.read("interactive.json")
        graph["edges"][-1]["condition"]["value"] = True
        self.write("interactive.json", graph)
        self.assert_fails("可达死路")

    def test_overwriting_branch_memory_makes_ending_unreachable(self):
        graph = self.read("interactive.json")
        graph["edges"][4]["effects"] = [{"type": "set", "variable": "var_key_disclosed", "value": True}]
        self.write("interactive.json", graph)
        self.assert_fails("结局不可达")

    def test_numeric_effect_overflow_is_not_clamped(self):
        graph = self.read("interactive.json")
        graph["variables"].append(dict(id="var_charge", type="integer", default=0, min=0, max=1, meaning="有限资源"))
        graph["edges"][0]["effects"].append(dict(type="increment", variable="var_charge", amount=2))
        self.write("interactive.json", graph)
        self.assert_fails("越界或类型错误")

    def test_video_budget_counts_unique_assets(self):
        graph = self.read("interactive.json")
        graph["timing"]["uniqueMediaBudgetSeconds"] = 159
        self.write("interactive.json", graph)
        self.assert_fails("独立视频计划 160 秒超过预算 159 秒")

    def test_finite_state_limit_does_not_report_complete(self):
        report = check_delivery(self.path, max_states=2)
        self.assertEqual(report["status"], "incomplete", report)
        self.assertFalse(report["coverage"]["complete"])
        self.assertFalse(any("不可达" in x for x in report["errors"]))

    def test_optional_player_loop_is_reported_without_fake_finite_duration(self):
        graph = self.read("interactive.json")
        edge = copy.deepcopy(graph["edges"][0])
        edge.update(id="edge_reconsider", to="node_start", label="再想一想", effects=[])
        graph["edges"].append(edge)
        self.write("interactive.json", graph)
        report = check_delivery(self.path)
        self.assertEqual(report["status"], "passed", report)
        self.assertIsNone(report["statistics"]["routeDurationRangeSeconds"])
        self.assertTrue(any("循环" in x for x in report["warnings"]))

    def test_trapped_loop_is_rejected(self):
        graph = self.read("interactive.json")
        graph["edges"][3]["to"] = "node_keep"
        self.write("interactive.json", graph)
        self.assert_fails("无法到达任何结局")

    def test_multiple_script_parts_form_one_complete_delivery(self):
        script = self.read("screenplay-01.json")
        second = copy.deepcopy(script)
        second["partId"] = "part_02"
        second["scenes"] = script["scenes"][3:]
        script["scenes"] = script["scenes"][:3]
        self.write("screenplay-01.json", script)
        self.write("screenplay-02.json", second)
        manifest = self.read("manifest.json")
        manifest["files"]["scripts"].append("screenplay-02.json")
        self.write("manifest.json", manifest)
        report = check_delivery(self.path)
        self.assertEqual(report["status"], "passed", report)
        self.assertEqual(report["statistics"]["scenes"], 6)

    def test_selected_and_draft_are_not_full_acceptance(self):
        manifest = self.read("manifest.json")
        manifest["scope"]["kind"] = "selected"
        manifest["status"] = "draft"
        self.write("manifest.json", manifest)
        report = check_delivery(self.path)
        self.assertEqual(report["status"], "incomplete", report)
        self.assertTrue(any("局部交付" in x for x in report["incomplete"]))

    def revise(self):
        base = Path(self.temporary.name) / "base"
        shutil.copytree(self.path, base)
        for path in self.path.glob("*.json"):
            data = self.read(path.name)
            data["deliveryId"] = "delivery_last_ferry_002"
            self.write(path.name, data)
        manifest = self.read("manifest.json")
        manifest["baseDeliveryId"] = "delivery_last_ferry_001"
        manifest["changes"]["modifiedIds"] = ["scene_001"]
        self.write("manifest.json", manifest)
        script = self.read("screenplay-01.json")
        script["scenes"][0]["blocks"][0]["text"] += " 她停了停。"
        self.write("screenplay-01.json", script)
        return base

    def test_revision_requires_base_and_matches_actual_scope(self):
        base = self.revise()
        self.assertEqual(check_delivery(self.path)["status"], "incomplete")
        report = check_delivery(self.path, base=base)
        self.assertEqual(report["status"], "passed", report)
        script = self.read("screenplay-01.json")
        script["scenes"][1]["summary"] += " 未声明的更改。"
        self.write("screenplay-01.json", script)
        report = check_delivery(self.path, base=base)
        self.assertEqual(report["status"], "failed", report)
        self.assertTrue(any("modifiedIds 与基准差异" in x for x in report["errors"]))

    def test_revision_cannot_point_to_wrong_project_or_version(self):
        base = self.revise()
        manifest = self.read("manifest.json")
        manifest["baseDeliveryId"] = "delivery_other"
        self.write("manifest.json", manifest)
        report = check_delivery(self.path, base=base)
        self.assertEqual(report["status"], "failed", report)
        self.assertTrue(any("修订声明不符" in x for x in report["errors"]))

    def test_script_revision_omitting_interaction_does_not_delete_old_graph(self):
        base = self.revise()
        manifest = self.read("manifest.json")
        manifest["files"]["interactive"] = None
        manifest["inventory"]["nodeIds"] = []
        self.write("manifest.json", manifest)
        report = check_delivery(self.path, base=base)
        self.assertEqual(report["status"], "passed", report)
        self.assertNotIn("nodes", report["statistics"])

    def test_reading_copy_contains_every_verbatim_block(self):
        text = render(self.path)
        for scene in self.read("screenplay-01.json")["scenes"]:
            for block in scene["blocks"]:
                self.assertIn(block["text"], text)

    def test_reading_copy_cannot_silently_omit_a_scene_with_unknown_unit(self):
        script = self.read("screenplay-01.json")
        script["scenes"][0]["unitId"] = "unit_missing"
        self.write("screenplay-01.json", script)
        with self.assertRaisesRegex(ValueError, "unit_missing"):
            render(self.path)

    def test_generated_web_instructions_match_current_sources(self):
        for kind in ("screenwriting", "interactive-design"):
            self.assertEqual((ROOT / "web-prompts" / f"{kind}.md").read_text(encoding="utf-8"), build(kind))


if __name__ == "__main__":
    unittest.main()
