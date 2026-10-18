import type { ChatOption } from '../../../../../packages/script/src/ideation';

/** A selected answer continues the question's original author intent. */
export function scriptHomeOptionIntent(turn:{input:{intent?:string};response?:{options?:ChatOption[];goal?:unknown;replyKind?:string}|null}|undefined,
  option:ChatOption):'AUTO'|'AGENT'{
  return turn?.response?.options?.some(item=>item.tag===option.tag&&item.text===option.text)
    ?scriptHomeFollowupIntent(turn):'AUTO';
}

export function scriptHomeFollowupIntent(turn:{input:{intent?:string};response?:{goal?:unknown;options?:ChatOption[];replyKind?:string}|null}|undefined):'AUTO'|'AGENT'{
  return turn?.input.intent==='AGENT'&&turn.response&&!turn.response.goal&&(!turn.response.replyKind||turn.response.replyKind==='ASK')?'AGENT':'AUTO';
}
