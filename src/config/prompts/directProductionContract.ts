const directDesignInstruction = '本次直接完成分镜或媒体表达所需的摄影、表演、灯光和声音设计；缺少历史方案时依据原文和作者要求完成，不要求另行筹备。';

/** Update obsolete workflow wording without resetting the author's prompt edits. */
export const upgradeDirectProductionTemplate = (template: string) => {
  let result = template.replace(/【(?:已确认的制片筹备结果|已确认制片筹备结果|已确认制片筹备|制片筹备结果)】/g, '【当前原文、相邻场次与已采用制作结果】')
    .replace('4. 是否正确继承制片筹备中的摄影、灯光、表演和动作约束。', '4. 是否忠实于原文、复用已采用的资产身份，并与相邻场次和已采用镜头的状态一致。不得把缺少部门方案当作问题。')
    .replace('【已确认部门筹备】', '【可选历史制作参考；没有记录时以原文和既有资产为准】');
  if (result.includes('{{productionTeamContext}}') && !result.includes(directDesignInstruction)) {
    result = result.replace('{{productionTeamContext}}', `{{productionTeamContext}}\n${directDesignInstruction}`);
  }
  return result;
};
