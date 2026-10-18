import type { Scene, ScriptProject } from '../../../../../../packages/script/src/schema';

export function boardAdviceBody(project:ScriptProject,scenes:Scene[],limit=16000):string{
  const body=scenes.map(scene=>{
    const lines=scene.blocks.filter(block=>block.text.trim()).map(block=>{
      const speaker=block.speakerName||project.characters.find(character=>character.id===block.speakerId)?.name;
      return `${speaker?`${speaker}：`:''}${block.text}`;
    });
    return lines.length?`【${scene.title}】\n${lines.join('\n')}`:'';
  }).filter(Boolean).join('\n\n');
  if(!body)return '所选场景尚无已写正文；建议只能依据分场规划。';
  if(body.length<=limit)return body;
  return `以下仅是所选场景正文的末尾 ${limit} 字符；前面 ${body.length-limit} 字符未读取，不能据此判断整场。\n${body.slice(-limit)}`;
}
