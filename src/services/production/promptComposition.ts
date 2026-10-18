export interface PromptCompositionBlockInput {
  blockId: string;
  source: string;
  purpose: string;
  content?: string | null;
  required?: boolean;
  omissionReason?: string;
  duplicateOf?: string;
}

export interface PromptCompositionManifestBlock {
  blockId: string;
  source: string;
  purpose: string;
  charCount: number;
  hash: string;
  required: boolean;
  optional: boolean;
  included: boolean;
  omissionReason?: string;
  duplicateOf?: string;
}

export interface PromptCompositionManifest {
  version: "prompt-composition/v1";
  blocks: PromptCompositionManifestBlock[];
  finalCharCount: number;
  finalHash: string;
  issues: Array<{
    code: "EMPTY_REQUIRED_BLOCK" | "EMPTY_PLACEHOLDER" | "DUPLICATE_BLOCK";
    blockId: string;
    message: string;
  }>;
}

const normalizeForHash = (value: string) => value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();

export const promptContentHash = (value: string) => {
  const text = normalizeForHash(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const emptyPlaceholderPattern = /^(?:无|暂无|无内容|未设置|待补全|待填写|不适用|none|n\/a|null|undefined)[。.!！]?$/i;

const promptSectionHeadingPattern = /^(?:【[^】]+】|\[[^\]\n]{1,80}\]|#{1,6}\s+\S.*)$/;

const placeholderLinePattern = /^(?:[-*]\s*)?(?:[^：:\n]{1,40}[：:]\s*)?(?:无|暂无|无内容|未设置|未填写|待补全|待填写|不适用|none|n\/a|null|undefined|--)[。.!！]?$/i;

export const isPromptEmptyPlaceholder = (value: string) => {
  const text = value.trim();
  if (emptyPlaceholderPattern.test(text)) return true;
  const contentLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !promptSectionHeadingPattern.test(line));
  return contentLines.length === 0 || contentLines.every((line) => placeholderLinePattern.test(line));
};

export const promptBlocksFromText = ({
  prompt,
  blockIdPrefix = "text.task",
  source = "generateAIContent.prompt",
  purpose = "业务任务提示词",
}: {
  prompt: string;
  blockIdPrefix?: string;
  source?: string;
  purpose?: string;
}): PromptCompositionBlockInput[] => {
  const lines = String(prompt || "").replace(/\r\n/g, "\n").split("\n");
  const sections: Array<{ heading?: string; lines: string[] }> = [];
  let current: { heading?: string; lines: string[] } = { lines: [] };
  const flush = () => {
    if (current.lines.some((line) => line.trim())) sections.push(current);
    current = { lines: [] };
  };
  lines.forEach((line) => {
    if (promptSectionHeadingPattern.test(line.trim())) {
      flush();
      current = { heading: line.trim(), lines: [line] };
      return;
    }
    current.lines.push(line);
  });
  flush();
  if (!sections.length) {
    return [{ blockId: blockIdPrefix, source, purpose, content: prompt, required: true }];
  }
  return sections.map((section, index) => ({
    blockId: `${blockIdPrefix}.${index + 1}`,
    source,
    purpose: section.heading?.replace(/^[【\[#\s]+|[】\]]+$/g, "") || purpose,
    content: section.lines
      .filter((line) => promptSectionHeadingPattern.test(line.trim()) || !placeholderLinePattern.test(line.trim()))
      .join("\n")
      .trim(),
    required: index === 0,
  }));
};

export const composePromptBlocks = (
  blocks: PromptCompositionBlockInput[],
): { prompt: string; manifest: PromptCompositionManifest } => {
  const seen = new Map<string, string>();
  const included: string[] = [];
  const issues: PromptCompositionManifest["issues"] = [];
  const manifestBlocks = blocks.map((block): PromptCompositionManifestBlock => {
    const content = String(block.content || "").trim();
    const required = Boolean(block.required);
    const hash = promptContentHash(content);
    let omissionReason = block.omissionReason;
    let duplicateOf = block.duplicateOf;

    if (!content) {
      omissionReason ||= "empty";
      if (required) {
        issues.push({
          code: "EMPTY_REQUIRED_BLOCK",
          blockId: block.blockId,
          message: `必需提示词块 ${block.blockId} 为空。`,
        });
      }
    } else if (isPromptEmptyPlaceholder(content)) {
      omissionReason ||= "empty_placeholder";
      issues.push({
        code: required ? "EMPTY_REQUIRED_BLOCK" : "EMPTY_PLACEHOLDER",
        blockId: block.blockId,
        message: required
          ? `必需提示词块 ${block.blockId} 只有空占位内容。`
          : `提示词块 ${block.blockId} 只有空占位内容，未发送给模型。`,
      });
    } else {
      duplicateOf ||= seen.get(hash);
      if (duplicateOf) {
        omissionReason ||= "duplicate";
        issues.push({
          code: "DUPLICATE_BLOCK",
          blockId: block.blockId,
          message: `提示词块 ${block.blockId} 与 ${duplicateOf} 重复，未重复发送。`,
        });
      } else if (!omissionReason) {
        seen.set(hash, block.blockId);
        included.push(content);
      }
    }

    return {
      blockId: block.blockId,
      source: block.source,
      purpose: block.purpose,
      charCount: Array.from(content).length,
      hash,
      required,
      optional: !required,
      included: Boolean(content && !isPromptEmptyPlaceholder(content) && !duplicateOf && !omissionReason),
      ...(omissionReason ? { omissionReason } : {}),
      ...(duplicateOf ? { duplicateOf } : {}),
    };
  });
  const prompt = included.join("\n\n").trim();
  return {
    prompt,
    manifest: {
      version: "prompt-composition/v1",
      blocks: manifestBlocks,
      finalCharCount: Array.from(prompt).length,
      finalHash: promptContentHash(prompt),
      issues,
    },
  };
};

export const markPromptBlocksDuplicatedByManifest = (
  blocks: PromptCompositionBlockInput[],
  manifest: PromptCompositionManifest,
) => {
  const priorBlocksByHash = new Map(
    manifest.blocks
      .filter((block) => block.included)
      .map((block) => [block.hash, block.blockId]),
  );
  return blocks.map((block) => {
    const content = String(block.content || "").trim();
    const duplicateOf = content ? priorBlocksByHash.get(promptContentHash(content)) : undefined;
    return duplicateOf ? { ...block, duplicateOf } : block;
  });
};
