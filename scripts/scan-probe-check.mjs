import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/__probe',r=>r.fulfill({contentType:'text/html',body:'<html>probe</html>'}));
  await page.goto('http://127.0.0.1:5174/__probe');
  console.log(await page.evaluate(async()=>{
    const {FFmpeg,FFFSType}=await import('/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js');
    const f=new FFmpeg(); const logs=[];f.on('log',e=>logs.push(e.message));
    const u=URL.createObjectURL(new Blob([await fetch('/ffmpeg/ffmpeg-core.js').then(r=>r.text())],{type:'text/javascript'}));
    await f.load({coreURL:u,wasmURL:new URL('/ffmpeg/ffmpeg-core.wasm',location.href).href});
    const create=await f.exec(['-f','lavfi','-i','color=size=160x90:rate=15','-t','1','-c:v','libx264','fixture.mp4']);
    const p=await f.ffprobe(['-v','error','-show_entries','format=duration:stream=duration,width,height','-of','json','-o','meta.json','fixture.mp4']);
    const content=await f.readFile('meta.json','utf8');
    const b=await f.readFile('fixture.mp4');await f.createDir('/input');await f.mount(FFFSType.WORKERFS,{files:[new File([b],'fixture.mp4')]},'/input');
    const mounted=await f.ffprobe(['-v','error','-show_entries','format=duration:stream=duration,width,height','-of','json','-o','mounted.json','/input/fixture.mp4']);
    let mountedContent;try{mountedContent=await f.readFile('mounted.json','utf8');}catch(e){mountedContent=String(e);}
    f.terminate();return {create,p,content,mounted,mountedContent,logs:logs.slice(-8)};
  }));
}finally{await browser.close();}
