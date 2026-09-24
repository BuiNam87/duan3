const fs=require('fs'), path=require('path');
const listFiles=(d,b=d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?listFiles(path.join(d,e.name),b):[path.relative(b,path.join(d,e.name))]).sort();
const h=require('./cdp-harness.js');
h.run=async({evaluate,panel,page,sleep,DL})=>{
  await evaluate(panel,`(()=>{ window.__dbg=[]; const T0=Date.now(); const L=(...a)=>__dbg.push(((Date.now()-T0)/1000).toFixed(1)+' '+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '));
    const oc=callPage; callPage=async(t,m,...a)=>{ L('call',m,...a.slice(0,1).map(x=>typeof x==='string'?x:'')); const r=await oc(t,m,...a); L(' <-',m, m==='findBatch'?{found:r&&r.found,n:r&&r.ids&&r.ids.length}:r); return r;};
    const ow=waitForDownload; waitForDownload=(f,n,ms)=>{L('expect',f,n); return ow(f,n,ms).then(r=>{L('dl result',f,n,r); return r;});};

    chrome.downloads.onCreated.addListener((it)=>L('created',it.id));
    const set=(el,v)=>{el.value=v; el.dispatchEvent(new Event('change'));};
    els.prompts.value='tạo ảnh hồ\\ntạo ảnh núi Phú Sĩ\\ntạo ảnh hồ'; els.preset.value='flow'; loadSelectors('flow');
    set(els.fixedSec,'3'); set(els.gapSec,'0'); els.autoDl.checked=true; els.autoDl.dispatchEvent(new Event('change')); set(els.genMaxSec,'60');
    window.__done=false; start().then(()=>window.__done=true); return 1;})()`);
  for(let k=0;k<25;k++){ await sleep(4000); if(await evaluate(panel,'__done')) break; }
  console.log((await evaluate(panel,'__dbg')).filter(l=>/dl result/.test(l)).join('\n')); console.log('LOG PANEL:\n'+(await evaluate(panel,`[...document.querySelectorAll('#log li')].map(x=>x.innerText.replace(/\\n/g,' | ')).join('\\n')`))); console.log('DLLOG\n'+(await evaluate(panel,'__dlLog')).join('\n'));
  console.log('page:', JSON.stringify(await evaluate(page,`({sent, downloadsFired})`)));
  console.log('files:\n'+listFiles(DL).join('\n'));
};
h.main();
