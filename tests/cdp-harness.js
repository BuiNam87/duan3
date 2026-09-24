// Điều khiển Chrome bằng CDP thuần (không Playwright) để việc tải file giống Chrome thật.
const { spawn } = require('child_process'); const fs=require('fs'); const path=require('path'); const os=require('os');
const EXT=path.resolve(__dirname,'../batch-prompt-extension');
const S=fs.mkdtempSync(path.join(os.tmpdir(),'bp-test-')), DL=path.join(S,'downloads');
const CHROME=process.env.CHROME_PATH||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  fs.rmSync(path.join(S,'profile'),{recursive:true,force:true}); fs.rmSync(DL,{recursive:true,force:true}); fs.mkdirSync(DL,{recursive:true});
  fs.mkdirSync(path.join(S,'profile','Default'),{recursive:true});
  fs.writeFileSync(path.join(S,'profile','Default','Preferences'), JSON.stringify({download:{default_directory:DL,prompt_for_download:false,directory_upgrade:true},profile:{default_content_setting_values:{automatic_downloads:1}}}));
  const chrome=spawn(CHROME,['--headless=new','--no-sandbox','--remote-debugging-port=9334','--user-data-dir='+path.join(S,'profile'),`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,'about:blank'],{stdio:'ignore',detached:true});
  await sleep(3000);
  const ver=await (await fetch('http://127.0.0.1:9334/json/version')).json();
  const ws=new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
  let idc=0; const pend={};
  ws.onmessage=(m)=>{const d=JSON.parse(m.data); if(d.id&&pend[d.id]){pend[d.id](d); delete pend[d.id];}};
  const send=(method,params={},sessionId)=>new Promise(r=>{const id=++idc; pend[id]=r; ws.send(JSON.stringify({id,method,params,sessionId}));});
  const targets=(await send('Target.getTargets')).result.targetInfos;
  const swT=targets.find(t=>t.url.startsWith('chrome-extension://')); const extId=swT.url.split('/')[2];
  const open=async(url)=>{const {result:{targetId}}=await send('Target.createTarget',{url}); const {result:{sessionId}}=await send('Target.attachToTarget',{targetId,flatten:true}); await sleep(1500); return {targetId,sessionId};};
  const evaluate=async(sess,expr)=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true},sess.sessionId); if(r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,400)); return r.result.result.value;};
  const panel=await open(`chrome-extension://${extId}/sidepanel.html`);
  const page=await open('http://127.0.0.1:8765/flow-mock.html');
  await send('Target.activateTarget',{targetId:page.targetId}); await sleep(1500);
  try { await module.exports.run({send,evaluate,panel,page,sleep,DL}); } finally {}
  ws.close(); try{process.kill(-chrome.pid,'SIGKILL');}catch(e){}
}
module.exports={main};
