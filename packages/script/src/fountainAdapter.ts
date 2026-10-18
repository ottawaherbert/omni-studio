import type { ScriptBlock, Character, Scene } from './schema';
import { newId } from './project';

/**
 * Convert blocks to human-readable screenplay formatted text.
 */
export function blocksToScreenplayText(blocks: ScriptBlock[], characters: Character[] = []): string {
  if (!blocks || blocks.length === 0) return '';
  const charMap = new Map(characters.map(c => [c.id, c.name]));
  const lines: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const text = (b.text || '').trim();
    if (!text) continue;

    if (b.type === 'parenthetical' && blocks[i + 1]?.type === 'dialogue' && blocks[i + 1].text.trim()) {
      const dialogue = blocks[++i];
      const charName = (dialogue.speakerId ? charMap.get(dialogue.speakerId) : null) || dialogue.speakerName || '人物';
      lines.push(`${charName}\n(${text.replace(/^[（(]|[）)]$/g, '')})\n${dialogue.text.trim()}`);
      continue;
    }

    if (b.type === 'action') {
      lines.push(text);
    } else if (b.type === 'dialogue') {
      const charName = (b.speakerId ? charMap.get(b.speakerId) : null) || b.speakerName || '人物';
      lines.push(`${charName}\n${text}`);
    } else if (b.type === 'parenthetical') {
      lines.push(`(${text.replace(/^[（(]|[）)]$/g, '')})`);
    } else if (b.type === 'transition') {
      lines.push(`> ${text}`);
    } else if (b.type === 'note') {
      lines.push(`[[${text}]]`);
    } else {
      lines.push(text);
    }
  }

  return lines.join('\n\n');
}

/** Coordinates in the formatted canvas, including grouped parentheticals. */
export function screenplayBlockTextRanges(blocks:ScriptBlock[],characters:Character[]=[]):Array<{index:number;start:number;end:number;bodyStart:number;bodyEnd:number}>{
  const ranges:Array<{index:number;start:number;end:number;bodyStart:number;bodyEnd:number}>=[];
  let offset=0;
  for(let index=0;index<blocks.length;index++){
    const paired=blocks[index].type==='parenthetical'&&Boolean(blocks[index].text.trim())
      &&blocks[index+1]?.type==='dialogue'&&Boolean(blocks[index+1].text.trim());
    const rendered=blocksToScreenplayText(blocks.slice(index,index+(paired?2:1)),characters);
    if(!rendered){if(paired)index++;continue;}
    if(paired){
      const parenthetical=blocks[index], dialogue=blocks[index+1];
      const parentheticalText=parenthetical.text.trim().replace(/^[（(]|[）)]$/g,'');
      const parentheticalStart=rendered.indexOf(`(${parentheticalText})`);
      const dialogueStart=rendered.lastIndexOf(dialogue.text.trim());
      ranges.push({index,start:offset+parentheticalStart,end:offset+parentheticalStart+parentheticalText.length+2,
        bodyStart:offset+parentheticalStart+1,bodyEnd:offset+parentheticalStart+1+parentheticalText.length});
      ranges.push({index:index+1,start:offset,end:offset+rendered.length,
        bodyStart:offset+dialogueStart,bodyEnd:offset+dialogueStart+dialogue.text.trim().length});
      index++;
    }else{
      const body=blocks[index].text.trim(),bodyAt=rendered.lastIndexOf(body);
      ranges.push({index,start:offset,end:offset+rendered.length,bodyStart:offset+bodyAt,bodyEnd:offset+bodyAt+body.length});
    }
    offset+=rendered.length+2;
  }
  return ranges;
}

/** Reparse only the intersecting paragraphs; untouched blocks retain their exact data and IDs. */
export function replaceScreenplaySelection(blocks:ScriptBlock[],characters:Character[],selection:{start:number;end:number;text:string},replacement:string):ScriptBlock[]{
  const source=blocksToScreenplayText(blocks,characters);
  if(source.slice(selection.start,selection.end)!==selection.text)throw new Error('选中的原文已改变');
  let offset=0;
  const spans:{firstIndex:number;lastIndex:number;start:number;end:number}[]=[];
  for(let index=0;index<blocks.length;index++){
    const lastIndex=blocks[index].type==='parenthetical'&&blocks[index].text.trim()
      &&blocks[index+1]?.type==='dialogue'&&blocks[index+1].text.trim()?index+1:index;
    const rendered=blocksToScreenplayText(blocks.slice(index,lastIndex+1),characters);
    if(rendered){
      spans.push({firstIndex:index,lastIndex,start:offset,end:offset+rendered.length});
      offset+=rendered.length+2;
    }
    index=lastIndex;
  }
  const first=spans.find(span=>span.end>selection.start);
  const last=[...spans].reverse().find(span=>span.start<selection.end);
  if(!first||!last||first.firstIndex>last.lastIndex)throw new Error('请选择正文中的文字');
  const segment=source.slice(first.start,selection.start)+replacement+source.slice(selection.end,last.end);
  const original=blocks.slice(first.firstIndex,last.lastIndex+1);
  const parsed=screenplayTextToBlocks(segment,characters,original).blocks;
  return [...structuredClone(blocks.slice(0,first.firstIndex)),...parsed,...structuredClone(blocks.slice(last.lastIndex+1))];
}

/**
 * Parse plain screenplay text back to structured ScriptBlocks.
 */
export function screenplayTextToBlocks(text: string, existingCharacters: Character[] = [], previousBlocks: ScriptBlock[] = []): { blocks: ScriptBlock[]; newCharacters: string[] } {
  const blocks: ScriptBlock[] = [];
  const charNameMap = new Map(existingCharacters.map(c => [c.name.trim().toLowerCase(), c.id]));
  const detectedNewCharNames = new Set<string>();

  const rawParagraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  let i = 0;
  while (i < rawParagraphs.length) {
    const para = rawParagraphs[i];

    // Check for note
    if (para.startsWith('[[') && para.endsWith(']]')) {
      blocks.push({ id: newId('block'), type: 'note', text: para.slice(2, -2).trim() });
      i++;
      continue;
    }

    // Check for transition
    if (para.startsWith('>') || /^(切至|淡入|淡出|化入|FADE IN|FADE OUT|CUT TO):?/i.test(para)) {
      blocks.push({ id: newId('block'), type: 'transition', text: para.replace(/^>\s*/, '').trim() });
      i++;
      continue;
    }

    // Check for parenthetical
    if (/^[（(].*[）)]$/.test(para) && para.length < 50) {
      blocks.push({ id: newId('block'), type: 'parenthetical', text: para.replace(/^[（(]|[）)]$/g, '').trim() });
      i++;
      continue;
    }

    // Check if paragraph contains Character Heading + Dialogue or is Character name
    const lines = para.split('\n').map(l => l.trim()).filter(Boolean);

    // Case 1: First line is character name, next line(s) is dialogue
    // e.g.:
    // 陆沉
    // （冷笑）
    // 你以为你赢了？
    if (lines.length >= 2) {
      const firstLine = lines[0].replace(/^[@#]\s*/, '').trim();
      const isKnownChar = charNameMap.has(firstLine.toLowerCase());
      const looksLikeChar = isKnownChar || (/^[\u4e00-\u9fa5A-Za-z0-9_·]{1,16}$/.test(firstLine) && !/[，。！？,.!?；;]/.test(firstLine));

      if (looksLikeChar) {
        let speakerId = charNameMap.get(firstLine.toLowerCase());
        if (!speakerId && firstLine) {
          detectedNewCharNames.add(firstLine);
        }

        let lineIdx = 1;
        // Check if second line is parenthetical
        if (lines[lineIdx] && /^[（(].*[）)]$/.test(lines[lineIdx])) {
          blocks.push({
            id: newId('block'),
            type: 'parenthetical',
            text: lines[lineIdx].replace(/^[（(]|[）)]$/g, '').trim(),
          });
          lineIdx++;
        }

        const dialogueText = lines.slice(lineIdx).join('\n');
        if (dialogueText) {
          blocks.push({
            id: newId('block'),
            type: 'dialogue',
            speakerId,
            speakerName: speakerId ? undefined : firstLine,
            text: dialogueText,
          });
        }
        i++;
        continue;
      }
    }

    // Case 2: Paragraph is just a character name, and the next paragraph is dialogue
    const singleNameCandidate = para.replace(/^[@#]\s*/, '').trim();
    const isSingleChar = charNameMap.has(singleNameCandidate.toLowerCase()) || 
      (singleNameCandidate.length <= 15 && /^[\u4e00-\u9fa5A-Za-z0-9_·]{1,15}$/.test(singleNameCandidate) && i + 1 < rawParagraphs.length);

    if (isSingleChar && i + 1 < rawParagraphs.length) {
      let speakerId = charNameMap.get(singleNameCandidate.toLowerCase());
      if (!speakerId) {
        detectedNewCharNames.add(singleNameCandidate);
      }

      let nextPara = rawParagraphs[i + 1];
      i += 2;

      // If next paragraph is parenthetical, check if there's a third for dialogue
      if (/^[（(].*[）)]$/.test(nextPara) && i < rawParagraphs.length) {
        blocks.push({
          id: newId('block'),
          type: 'parenthetical',
          text: nextPara.replace(/^[（(]|[）)]$/g, '').trim(),
        });
        nextPara = rawParagraphs[i];
        i++;
      }

      blocks.push({
        id: newId('block'),
        type: 'dialogue',
        speakerId,
        speakerName: speakerId ? undefined : singleNameCandidate,
        text: nextPara,
      });
      continue;
    }

    // Default: Action block
    blocks.push({
      id: newId('block'),
      type: 'action',
      text: para,
    });
    i++;
  }

  const parsed = blocks.length > 0 ? blocks : [{ id: newId('block'), type: 'action' as const, text: '' }];
  const unused = new Set(previousBlocks.map(block => block.id));
  // Keep exact paragraphs first, then retain the identity of an edited paragraph
  // at the same position. Newly inserted paragraphs receive new IDs.
  for (const block of parsed) {
    const same = previousBlocks.find(old => unused.has(old.id) && old.type === block.type && old.text === block.text && old.speakerId === block.speakerId && old.speakerName === block.speakerName);
    if (same) { Object.assign(block,structuredClone(same));if(!Object.hasOwn(same,'speakerId'))delete block.speakerId;if(!Object.hasOwn(same,'speakerName'))delete block.speakerName;unused.delete(same.id); }
  }
  parsed.forEach((block, index) => {
    if (previousBlocks.some(old => old.id === block.id)) return;
    const old = previousBlocks[index];
    if (old && unused.has(old.id) && old.type === block.type && old.speakerId === block.speakerId && old.speakerName === block.speakerName) {
      // Keep opaque metadata from older files without interpreting it as writing rules.
      Object.assign(block,{...structuredClone(old),...block,id:old.id}); unused.delete(old.id);
    }
  });
  return {
    blocks: parsed,
    newCharacters: Array.from(detectedNewCharNames),
  };
}
