import { useCallback, useEffect, useMemo, useState } from 'react';
import { skillClient } from '../../clients/skillClient';
import { methodFromSkill } from '../../../../../packages/script/src/methods';
import type { SkillDTO } from '../../../../../packages/domain/src/skill';

/** All new selections come from the shared library; running tasks keep their snapshots. */
export function useScriptSkills() {
  const [skills,setSkills]=useState<SkillDTO[]>([]);
  const [error,setError]=useState('');
  const [loaded,setLoaded]=useState(false);
  const refresh=useCallback(async()=>{
    try{setSkills(await skillClient.listSkills());setError('');}
    catch(cause){setError(cause instanceof Error?cause.message:'无法读取全局技能库');}
    finally{setLoaded(true);}
  },[]);
  useEffect(()=>{
    void refresh();
    const onFocus=()=>void refresh();
    window.addEventListener('focus',onFocus);
    return()=>window.removeEventListener('focus',onFocus);
  },[refresh]);
  const methods=useMemo(()=>skills.map(methodFromSkill),[skills]);
  return {skills,methods,error,loaded,refresh};
}
