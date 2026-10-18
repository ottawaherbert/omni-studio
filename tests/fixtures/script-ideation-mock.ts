// Only imported by the isolated browser harness when SCRIPT_BROWSER_IDEATION=1.
// These responses are authored fixtures, never a model-quality evaluation.
export function installIdeationMock() {
  let calls=0;
  (globalThis as any).__mockAIResponse=async ({prompt}:{prompt:string})=>{
    calls++;
    if(prompt.includes('验收触发失败') && !prompt.includes('验收重试'))throw new Error('【本地模拟失败】对话保留，改成“验收重试”再发送。');
    if(prompt.includes('这里生成的是故事资料'))return JSON.stringify({title:'验收·恢复的对话',format:'short-film',targetMinutes:5,concept:'父女在修车铺重新开口。',theme:'说不出口的关心',outline:'【本地模拟蓝图】女儿来取旧车，父亲只顾补胎。她接过扳手，留下帮忙。',characters:[{name:'女儿',voice:'简短克制'}],facts:['修车铺即将关门']});
    return JSON.stringify({question:`【本地模拟回复 ${calls}】可以从两人的一个动作开始，你更喜欢哪种？`,options:[{tag:'接过工具',text:'女儿拿过扳手，坐下来和父亲一起修车。'},{tag:'留一盏灯',text:'父亲已经收摊，却默默重新打开门口的灯。'},{tag:'自由改写',text:'她把刚买的热饭放在工具箱旁，什么也没说。'}]});
  };
}
