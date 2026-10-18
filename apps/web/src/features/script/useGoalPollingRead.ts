import {useEffect,useRef,useState} from 'react';

/** Independent read lane: no command busy flag or core refresh serial. A closed
 * view cannot publish a late result, including after a same-key reopen. */
export function useGoalPollingRead<T>(key:string|null,read:()=>Promise<T>,flightKey=key,intervalMs=3000){
  const reader=useRef(read);reader.current=read;
  const interval=useRef(intervalMs);interval.current=intervalMs;
  const flights=useRef(new Map<string,Promise<T>>());
  const [state,setState]=useState<{key:string;value:T|null;error:unknown}|null>(null);
  useEffect(()=>{
    if(!key||!flightKey)return;
    let canceled=false,running=false,timer:ReturnType<typeof setTimeout>|undefined;
    setState(null);
    const poll=async()=>{
      if(canceled||running)return;
      if(document.hidden)return;
      running=true;
      // Reopening waits for a retired flight, then reads afresh. It neither
      // overlaps the same request nor adopts the closed view's old response.
      const prior=flights.current.get(flightKey);
      if(prior)await prior.catch(()=>{});
      if(canceled){running=false;return;}
      const readCurrent=reader.current;
      const request=Promise.resolve().then(readCurrent);
      flights.current.set(flightKey,request);
      const remove=()=>{if(flights.current.get(flightKey)===request)flights.current.delete(flightKey);};
      void request.then(remove,remove);
      try{
        const value=await request;
        if(!canceled)setState(old=>old?.key===key&&!old.error&&JSON.stringify(old.value)===JSON.stringify(value)?old:{key,value,error:null});
      }catch(error){if(!canceled)setState({key,value:null,error});}
      running=false;
      if(!canceled)timer=setTimeout(poll,interval.current);
    };
    const wake=()=>{if(timer)clearTimeout(timer);void poll();};
    document.addEventListener('visibilitychange',wake);
    void poll();
    return()=>{canceled=true;if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',wake);setState(null);};
  },[key,flightKey]);
  const current=state?.key===key?state:null;
  return {value:current?.value??null,error:current?.error,loading:Boolean(key&&!current)};
}
