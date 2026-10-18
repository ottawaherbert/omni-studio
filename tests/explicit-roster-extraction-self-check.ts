import assert from "node:assert/strict";
import {
  extractRequiredNamedCharacters,
  extractRequiredNamedItems,
  filterMissingPlannedItems,
  mergeRequiredPlannedCharacters,
  mergeRequiredPlannedItems,
} from "../src/utils/explicitRosterExtraction";

const names = (items: Array<{ name: string }>) => items.map((item) => item.name);

const multiLineProject = {
  originalInspiration: `
项目名称：泛化测试项目
项目类型：短剧
主要角色：甲（主角）、乙（盟友）、丙（反派）
关键场景：旧码头、档案室、雨夜天台
关键道具：破损录音笔、蓝色门禁卡、旧船票
测试验收重点：最终必须能拆成 10 集，集与集连续，分镜总时长大致合理。
`,
};

const inlineProject = {
  originalInspiration:
    "标题：同一行项目；主要角色：主角A、搭档B；关键场景：办公区、地下车库；关键道具：匿名信、备用钥匙；验收要求：角色、场景、道具不能混乱。",
};

const plannedCharacters = extractRequiredNamedCharacters(multiLineProject);
assert.deepEqual(names(plannedCharacters), ["甲", "乙", "丙"]);

const plannedLocations = extractRequiredNamedItems(
  multiLineProject,
  ["关键场景", "核心场景", "场景"],
  "location",
  "fallback",
);
assert.deepEqual(names(plannedLocations), ["旧码头", "档案室", "雨夜天台"]);

const plannedProps = extractRequiredNamedItems(
  multiLineProject,
  ["关键道具", "核心道具", "道具"],
  "prop",
  "fallback",
);
assert.deepEqual(names(plannedProps), ["破损录音笔", "蓝色门禁卡", "旧船票"]);
assert.ok(!names(plannedProps).some((name) => /测试|验收|总时长|分镜/.test(name)));

assert.deepEqual(
  names(extractRequiredNamedCharacters(inlineProject)),
  ["主角A", "搭档B"],
);
assert.deepEqual(
  names(extractRequiredNamedItems(inlineProject, ["关键场景", "核心场景", "场景"], "location", "fallback")),
  ["办公区", "地下车库"],
);
assert.deepEqual(
  names(extractRequiredNamedItems(inlineProject, ["关键道具", "核心道具", "道具"], "prop", "fallback")),
  ["匿名信", "备用钥匙"],
);

const mergedCharacters = mergeRequiredPlannedCharacters(
  [{ id: "model_a", name: "甲", roleType: "lead", brief: "model", isDetailed: false }],
  plannedCharacters,
);
assert.equal(names(mergedCharacters).filter((name) => name === "甲").length, 1);
assert.ok(names(mergedCharacters).includes("乙"));
assert.ok(names(mergedCharacters).includes("丙"));

const mergedProps = mergeRequiredPlannedItems(
  [{ id: "model_prop", name: "破损录音笔", type: "prop", brief: "model", isDetailed: false }],
  plannedProps,
);
assert.equal(names(mergedProps).filter((name) => name === "破损录音笔").length, 1);
assert.ok(names(mergedProps).includes("蓝色门禁卡"));
assert.ok(names(mergedProps).includes("旧船票"));

const filteredProps = filterMissingPlannedItems(
  [{ id: "existing_prop", name: "蓝色门禁卡", type: "prop", brief: "existing", isDetailed: false }],
  mergedProps,
);
assert.ok(!names(filteredProps).includes("蓝色门禁卡"));

console.log("explicit roster extraction self-check passed");
