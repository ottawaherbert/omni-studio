import { fileURLToPath } from 'node:url';
import { readSkills } from '../../../../src/server/routes/skillFileStore';
import { selectSharedMethods } from '../../../../packages/script/src/methods';

export async function resolveSharedScriptMethods(ids:string[]) {
  if(Array.isArray(ids)&&ids.length===0)return [];
  const skills=await readSkills(process.env.OMNI_SKILLS_DIR||fileURLToPath(new URL('../../../../skills',import.meta.url)));
  return selectSharedMethods(skills,ids);
}
