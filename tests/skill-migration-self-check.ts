import assert from "assert/strict";
import fs from "fs/promises";
import path from "path";

import {
  createTempSkillMigrationDir,
  migrateLegacySkillsToUniversal,
} from "../tools/migrate-legacy-skills-to-universal";

const main = async () => {
  const skillsDir = await createTempSkillMigrationDir();
  try {
    const legacyPath = path.join(skillsDir, "配角刻画.json");
    await fs.writeFile(legacyPath, JSON.stringify({
      id: "skill-supporting-character",
      name: "配角刻画",
      sourceType: "custom",
      category: "人物",
      description: "配角要有自己的欲望、弱点和选择，不能只是服务主角的工具人。",
      narrative: {
        themeFocus: ["配角立体感"],
        dialogueStyle: "每个配角说话方式不同。",
      },
      directing: { shotSizePreference: "特写" },
      audioEditorial: { soundscape: "环境声" },
      promptModifiers: { scriptInstruction: "强制指令" },
      formatCompatibility: { recommendedFormats: ["short-drama"] },
    }, null, 2));

    const dryRun = await migrateLegacySkillsToUniversal({
      skillsDir,
      dryRun: true,
      timestamp: 1780000000000,
    });
    assert.deepEqual(dryRun.migrated, ["配角刻画.json -> 配角刻画_skill_supporting_character.md"]);
    assert.equal((await fs.readdir(skillsDir)).some((fileName) => fileName.endsWith(".md")), false);

    const result = await migrateLegacySkillsToUniversal({
      skillsDir,
      timestamp: 1780000000000,
    });
    assert.deepEqual(result.categoriesCreated, ["人物"]);
    assert.deepEqual(result.migrated, ["配角刻画.json -> 配角刻画_skill_supporting_character.md"]);

    const migrated = await fs.readFile(path.join(skillsDir, "配角刻画_skill_supporting_character.md"), "utf-8");
    assert.match(migrated, /title: "配角刻画"/);
    assert.match(migrated, /categoryId: "cat_人物_1780000000000"/);
    assert.match(migrated, /配角要有自己的欲望、弱点和选择/);
    assert.doesNotMatch(migrated, /promptModifiers/);
    assert.doesNotMatch(migrated, /formatCompatibility/);
    assert.doesNotMatch(migrated, /audioEditorial/);
    assert.doesNotMatch(migrated, /directing/);

    const categories = JSON.parse(await fs.readFile(path.join(skillsDir, "categories.json"), "utf-8"));
    assert.equal(categories[0].name, "人物");

    const skipped = await migrateLegacySkillsToUniversal({
      skillsDir,
      timestamp: 1780000000001,
    });
    assert.deepEqual(skipped.skipped, ["配角刻画.json: skill id already exists"]);

    const duplicateTitleDir = await createTempSkillMigrationDir();
    try {
      await fs.writeFile(path.join(duplicateTitleDir, "高压对白.md"), "已经手动迁移过的 Skill 正文。");
      await fs.writeFile(path.join(duplicateTitleDir, "高压对白.json"), JSON.stringify({
        id: "legacy-dialogue",
        name: "高压对白",
        description: "旧 JSON 内容。",
      }, null, 2));
      const duplicateTitle = await migrateLegacySkillsToUniversal({
        skillsDir: duplicateTitleDir,
        timestamp: 1780000000002,
      });
      assert.deepEqual(duplicateTitle.skipped, ["高压对白.json: skill title already exists"]);
      assert.equal((await fs.readdir(duplicateTitleDir)).filter((fileName) => fileName.endsWith(".md")).length, 1);
    } finally {
      await fs.rm(duplicateTitleDir, { recursive: true, force: true });
    }

    console.log("skill migration self-check passed");
  } finally {
    await fs.rm(skillsDir, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
