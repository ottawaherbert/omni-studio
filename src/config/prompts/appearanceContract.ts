export const appearanceContract = `
【镜头外观与连续性 appearance.v3】
在同一次分镜返回的每个镜头中附带 appearance:{states:[]}。已检查且没有变化可为空数组；不要另发质检或资产筹备报告。
每个可见角色/物件的状态条目：{assetId,assetName,timelineKey,origin:"script"|"proposal",evidence,event,continuity:"new"|"continue"|"uncertain",inheritFromShotId,startChanges:{},endChanges:{},imageMoment:"start"|"end",referenceNeed:"text"|"image",existingVariantId?}。
assetId 必须来自资产目录。evidence 是当前原文逐字摘录；新增创作设定标 proposal，不得冒充剧本事实。timelineKey 表示故事时间线，同一连续时间使用同一个值，回忆/梦境/平行时间必须分开。跨场承接请引用 appearanceHistory 中确切 shotId；同次返回的前一个同角色镜头可写 inheritFromShotId:"previous"，但绝不能仅因放映顺序就假定故事连续。承接不明用 uncertain。
startChanges/endChanges 是增量字段，仅可包含 clothing服装、dirt污损、injury伤势、hair发型、makeup妆容、other其他外观。未变化字段省略，消除状态须明确写“干净”“已痊愈”等并有依据。换装不得自动消除伤势；新伤不得清除原来的泥污。
这些外观字段会直接用于生图，只写图片中能看见的形状、颜色、材质、部位和外观状态；不写剧情原因、事件顺序、心理、用途、原文出处或创作说明。事件写 event，依据写 origin/evidence，继承关系写 inheritFromShotId/existingVariantId，不挤进外观句子。例如“写完留言后折断”写为“蓝色粉笔折断”；“尚未发生探测造成的出血”若无变化则省略；“再次中弹后口中涌血”只写可见的伤口部位与血迹。已有衣物颜色和材质可直接描述，不能附带“本轮补足、原文未指定”。不得为了写得完整编造伤口位置、服装细节或额外变化。
镜头开始用 startChanges，镜头内事件用 event，结束改变用 endChanges；不要为了换装或受伤强行切碎长镜头。静态图片 imageMoment 默认 start，不得提前出现尚未发生的伤势。连续镜头需要保留已发生的变化，即使本镜头没有新变化也可返回承接条目。
外观状态不等于资产变体。referenceNeed 默认 text：状态进入镜头生图/视频提示词，复用基础身份或 existingVariantId 的参考图，不创建新资产。仅实际换装、变身/明显年龄或妆发变化、持续且显著的形体损坏、物件结构改变、场景物理破坏等需要单独稳定参考的外观，才用 image。仅跨场出现、描述换了说法、增加汗水/少量泥污/眼圈发红/指尖或鼻下少量血迹，不足以创建变体。没有变化就继承，不重复描写基础服装，不把“沿用基础”“本轮补足”“原文未指定”等依据说明写进外观字段；来源写 origin/evidence。
先检查资产目录的现有变体：同一服装/造型使用同一个 existingVariantId，小伤势等用 startChanges/endChanges 增量描述并选 text，不能为每一种小变化重新要求整张参考图。需要看清局部细节时在相关镜头安排细节描述，不默认新建全身三视图。已有状态 ID 只可来自本资产目录，不能编造。
例如：已有“黑外套”变体，下一镜手指少量出血，仍复用黑外套的 existingVariantId，endChanges:{injury:"右手食指少量出血"}、referenceNeed:"text"；后续镜头沿承该状态。真的换成白色礼服且没有对应参考时，才返回 clothing:"白色礼服" 和 referenceNeed:"image"，换装不清除已有手伤。哭泣、跪下、力竭、回头等写入分镜动作/表演，不写 other，不创建资产；other 仅容纳未被其他字段覆盖的物理外观变化。相同外观保留已有措辞，不因补充解释拆出新状态。状态可以先保存而没有参考图。旧版没有 appearance 的返回仍可解析，但不代表已检查。
`;
export const upgradeAppearanceTemplate = (template: string) => {
  const updated = template.replace('注意：在此阶段，你只需要关注角色在画面中的位置和动作（例如：“男人坐在窗边”），不需要描述外观。', '人物基础身份沿用资产档案；本镜头中服装、污损、伤势等变化写入 appearance，和分镜一起返回。');
  if (updated.includes('appearance.v3')) return updated;
  // Upgrade the shipped section only; retain author text before and after it.
  const legacyStart = updated.search(/【镜头外观与连续性 appearance\.v[12]】/);
  const legacyEndMarker = '旧版没有 appearance 的返回仍可解析，但不代表已检查。';
  const legacyEnd = legacyStart < 0 ? -1 : updated.indexOf(legacyEndMarker, legacyStart);
  if (legacyEnd >= 0) return updated.slice(0, legacyStart) + appearanceContract.trim() + updated.slice(legacyEnd + legacyEndMarker.length);
  return `${updated}\n${appearanceContract}`;
};
