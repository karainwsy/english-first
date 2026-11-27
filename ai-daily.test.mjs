import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,copyFile,realpath} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,webcrypto} from 'node:crypto';
import {runDaily,parseVtt,modelClient,modelURL} from './ai-daily.mjs';
import {resolveDaily,dailyPaths,verifiedDailyAssets} from './daily-media.mjs';
import {defaultLex,selectModelBatch} from './study-engine.mjs';

test('provider adapter keeps keys at a fixed HTTPS endpoint and parses structured choices',async()=>{
  assert.throws(()=>modelURL('http://example.org/v1'));
  assert.throws(()=>modelURL('https://a:b@example.org/v1'));
  assert.throws(()=>modelURL('https://example.org/v1?x=y'));
  const c=modelClient({base:'https://model.example/v1/',model:'test-model',key:'mock-credential',transport:async(url,opt)=>{
    assert.equal(url,'https://model.example/v1/chat/completions');
    assert.equal(opt.redirect,'error');
    assert.equal(opt.headers.authorization,'Bearer mock-credential');
    assert.equal(JSON.parse(opt.body).messages[1].role,'user');
    return Response.json({choices:[{message:{content:'```json\n{"id":"second"}\n```'}}]});
  }});
  assert.deepEqual(await c('System',{videos:[1,2]}),{id:'second'});
});
const digest=x=>createHash('sha256').update(x).digest('hex');
const vtt='WEBVTT\n\n00:00:00.100 --> 00:00:02.200\nA resilient structure is feasible.\n\n00:09:15.010 --> 00:09:17.700\nA spacecraft enters orbit.\n';
test('AI pick → intact original → extension verifies media/captions → grounded vocabulary; safe fallback and atomic rerun',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ef-ai-case-'));
  try{
    if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});
    await copyFile(new URL('./manifest.json',import.meta.url),join(root,'manifest.json'));
    const video=join(root,'fixture.mp4');
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=black:s=32x32:r=1:d=600','-f','lavfi','-i',
      'sine=frequency=440:sample_rate=8000:duration=600','-c:v','mpeg4','-q:v','12','-c:a','aac','-b:a','8k',video],
      {timeout:30000,windowsHide:true});
    await writeFile(join(root,'fixture.en.vtt'),vtt);
    const catalog=join(root,'catalog.json');
    const entries=['first','second'].map(id=>({id,title:id,durationSec:600,level:'B1',topic:id,
      video:id==='first'?'fixture.mp4':'https://content.example/fixture.mp4',
      captions:id==='first'?'fixture.en.vtt':'https://content.example/fixture.en.vtt',attribution:'Test synthetic media'}));
    await writeFile(catalog,JSON.stringify(entries));
    const original=await readFile(video);
    let calls=0, downloads=0;
    const transport=async(url,options)=>{
      assert.equal(url.host,'content.example');
      assert.equal(options.redirect,'error');
      assert.equal(options.credentials,'omit');
      assert.equal(options.headers,undefined);
      downloads++;
      return new Response(url.pathname.endsWith('.vtt')?vtt:original);
    };
    const choose=async(_prompt,data)=>{
      calls++;
      if(data.videos){
        assert.equal(Object.hasOwn(data.videos[0],'video'),false);
        if(data.day.endsWith('28')){assert.deepEqual(data.videos.map(x=>x.id),['first']);return {id:'first'};}
        return {id:'second'};
      }
      assert.ok(data.candidates.some(x=>x.key==='spacecraft'&&x.context.includes('spacecraft')));
      return {words:['spacecraft','feasible','imaginary']};
    };
    const first=await runDaily({root,catalog,day:'2026-11-27',choose,transport});
    assert.deepEqual(first,{status:'prepared',day:'2026-11-27',title:'second',aiWords:2,vocabFallback:false});
    assert.equal(downloads,2);
    const local=async(url)=>new Response(await readFile(join(root,url.split('?')[0])));
    const meta=await resolveDaily('2026-11-27',x=>x,local);
    assert.deepEqual(meta.aiWords,['spacecraft','feasible']);
    const assets=await verifiedDailyAssets(meta,x=>x,local);
    assert.equal(digest(Buffer.from(await assets.media.arrayBuffer())),digest(original));
    assert.equal(assets.captions,vtt);
    const batch=selectModelBatch(parseVtt(Buffer.from(vtt)),defaultLex,new Set(['feasible']),12,[...meta.aiWords,'imaginary']);
    assert.ok(batch.some(x=>x.key==='spacecraft'&&x.seconds>550&&x.example.includes('spacecraft')));
    assert.equal(batch.some(x=>x.key==='feasible'||x.key==='imaginary'),false);
    const rerun=await runDaily({root,catalog,day:'2026-11-27',choose,transport});
    assert.equal(rerun.status,'already-ready');assert.equal(calls,2);
    const next=await runDaily({root,catalog,day:'2026-11-28',choose:async(p,d)=>{
      if(d.candidates)throw new Error('Provider timed out');
      return choose(p,d);
    },transport});
    assert.equal(next.title,'first');assert.equal(next.vocabFallback,true);
    assert.ok(await resolveDaily('2026-11-27',x=>x,local));
    assert.ok(await resolveDaily('2026-11-28',x=>x,local));
    await assert.rejects(runDaily({root,catalog,day:'2026-11-29',choose:async()=>({id:'https://bad.example'}),transport}));
    assert.ok(await resolveDaily('2026-11-28',x=>x,local));
    const current=await resolveDaily('2026-11-28',x=>x,local);
    await writeFile(join(root,dailyPaths(current).captions),'Invalid');
    assert.equal(await resolveDaily('2026-11-28',x=>x,local),null);
  }finally{const temp=await realpath(tmpdir()), target=await realpath(root);assert.match(relative(temp,target),/^ef-ai-case-[A-Za-z0-9]+$/);await rm(target,{recursive:true,force:true});}
});
