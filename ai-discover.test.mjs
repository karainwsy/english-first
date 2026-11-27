import test from 'node:test';
import assert from 'node:assert/strict';
import {discover,parseNoaaPage,parseNasaPage,searchTerms,sourceURL} from './ai-discover.mjs';
import {parseVtt} from './ai-daily.mjs';

const site='https://oceantoday.noaa.gov', nasa='https://svs.gsfc.nasa.gov';
const page=site+'/teekandtom/episode-3.html';
const html='<h2>Episode 3: A Lesson (10:00)</h2><video><source src="/english.mp4"><track kind="subtitles" srclang="en" src="/english.vtt"></video>';
const nasadata={title:'Native NASA result',media_groups:[{widget:'Video player',items:[
  {instance:{url:nasa+'/vis/a/lesson.mp4',filename:'lesson.mp4',media_type:'Movie'}},
  {instance:{url:nasa+'/vis/a/lesson.en_US.vtt',filename:'lesson.en_US.vtt'}},
  {instance:{url:nasa+'/vis/a/other.en_US.vtt',filename:'other.en_US.vtt'}}
]}]};
const sitemap='<urlset><url><loc>'+page+'</loc><video:video><video:description>Test lesson</video:description></video:video></url></urlset>';
const vtt='WEBVTT\n\n00:09:00.000 --> 00:09:04.000\n'+('A useful vocabulary term. '.repeat(60))+'\n';

test('source parser binds English tracks to a publisher video and rejects unsafe hosts',()=>{
  assert.equal(sourceURL('https://lookalike.example'),null);
  assert.equal(sourceURL(site+':9443'),null);
  assert.deepEqual(searchTerms(['javascript: bad','https://bad.test','climate'], 'space'),['climate','space']);
  assert.equal(parseNoaaPage(html.replace('srclang="en"','srclang="es"'),page).length,0);
  assert.equal(parseNoaaPage(html.replace('/english.vtt','https://lookalike.example/english.vtt'),page).length,0);
  assert.equal(parseNoaaPage(html,page)[0].durationSec,600);
  assert.equal(parseNasaPage(nasadata,nasa+'/1/').length,1);
});
test('model suggests queries; live-source adapter fetches English-captioned candidates without a catalog',async()=>{
  let searches=0;
  const transport=async (url,options)=>{
    assert.equal(options.redirect,'error');
    assert.equal(options.headers,undefined);
    if(url.pathname==='/sitemap.xml')return new Response(sitemap);
    if(url.href===page)return new Response(html);
    if(url.pathname==='/api/search/'){searches++;return Response.json({results:[{id:12,result_type:'Produced Video',description:'lesson.en_US.vtt'}]});}
    if(url.pathname==='/api/12/')return Response.json(nasadata);
    if(url.pathname.endsWith('.vtt'))return new Response(vtt);
    if(url.pathname.endsWith('.mp4')&&options.method==='HEAD')return new Response(null,{headers:{'content-type':'video/mp4','content-length':10000000}});
    return new Response(null,{status:404});
  };
  const flags={day:'2026-11-27',level:'B1',topic:'space',transport,parseVtt,choose:async()=>({queries:['orbital history']})};
  const all=await discover(flags);
  assert.equal(all.length,2);
  assert.ok(searches>=2);
  assert.ok(all.every(x=>Number.isFinite(x.estimatedSec)));
  const fresh=await discover({...flags,recent:[all[0].id]});
  assert.deepEqual(fresh.map(x=>x.id),[all[1].id]);
});
