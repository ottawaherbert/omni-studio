import { sha256 } from 'js-sha256';
import type { Character, AssetVariant, CharacterReferenceLayout, Project } from '../../../../../src/types/project';
export const CHARACTER_REFERENCE_LAYOUTS: CharacterReferenceLayout[] = ['body_face'];
export const characterReferenceLayoutLabels = { standard: '完整三视图＋面部', body_face: '去头身体三视图＋脸部特写' };
export const characterReferenceOwner = (character: Character, variantId?: string): Character | AssetVariant | undefined => variantId ? character.variants?.find(v => v.id === variantId) : character;
export const characterReferenceBasis = (character: Character, variantId?: string) => {
  const owner = characterReferenceOwner(character, variantId);
  return owner?.characterReferenceBasisUrl || owner?.cleanReferenceImageUrl || owner?.boardImageUrl || (variantId ? (owner as AssetVariant)?.imageUrl : character.referenceImageUrl || character.defaultReferenceUrl || character.multiViewUrl)
    || (variantId ? character.cleanReferenceImageUrl || character.referenceImageUrl || character.boardImageUrl : undefined);
};
export const characterReferenceImage = (character: Character, layout: CharacterReferenceLayout, variantId?: string) => {
  const owner = characterReferenceOwner(character, variantId);
  return owner?.characterReferenceLayouts?.[layout]?.imageUrl || ((owner?.cleanReferenceLayout || 'standard') === layout ? owner?.cleanReferenceImageUrl : undefined);
};
const stable = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v) ?? 'null' : Array.isArray(v) ? `[${v.map(stable).join(',')}]` : `{${Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
export const characterReferenceSourceHash = (project: Project, character: Character, layout: CharacterReferenceLayout, variantId?: string) => {
  const owner = characterReferenceOwner(character, variantId);
  const variant = variantId ? owner as AssetVariant : undefined;
  return sha256(stable({version:'character-reference-layout.body-face-only.v2',characterId:character.id,identity:character.visualIdentity,facts:character.visualFacts,
    variant:variant ? {id:variant.id,description:variant.description,promptModifiers:variant.promptModifiers,appearanceFields:variant.appearanceFields} : undefined,
    layout,prompt:owner?.characterReferenceLayouts?.[layout]?.prompt,basis:characterReferenceBasis(character,variantId),
    style:project.visualStyleLock,direction:project.creativeDirection,localStyle:character.visualOverride,localDirection:character.creativeDirection}));
};
export const characterReferenceUsage = (layout?: CharacterReferenceLayout, state?: string) => [
  layout === 'body_face' ? '此角色参考是同一人的去头身体三视图与独立脸部大特写：左侧仅负责服装、饰品与体型；五官、脸型、发型、妆容只从右侧脸部特写读取。身体图省略头部只是参考排版，故事画面必须生成人物完整头部，不复制四栏、白底或无头外观。' : '此角色图用于同一人的脸部身份、服装和体型；按本镜拍摄角度呈现，不复制参考板排版。',
  state ? `本参考对应状态：${state}。仅用于匹配此状态的画格，不把伤势、创可贴、换装或污损提前/延后。` : '',
].filter(Boolean).join('\n');
