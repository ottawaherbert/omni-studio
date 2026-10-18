import { PromptTemplate } from './types';

export const shotAnalysisTemplates: Record<string, PromptTemplate> = {
  shotAnalysisSegment: {
    id: 'shotAnalysisSegment',
    name: '拉片：局部微观分析',
    template: `{{shotAnalysisPrompt}}

{{skills}}

【作者额外要求】
{{userIntent}}`
  },
  shotAnalysisMacro: {
    id: 'shotAnalysisMacro',
    name: '拉片：全剧整体合成',
    template: `{{shotAnalysisPrompt}}

{{skills}}

【作者额外要求】
{{userIntent}}`
  }
};
