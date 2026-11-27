import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePeerResult,parsePeerVideo,discover} from './ai-discover.mjs';
import {parseVtt} from './ai-daily.mjs';

const uuid='49396266-7123-4320-8734-56190bb36ab7';
const url='https://makertube.net/w/aaa';
const cap='/lazy-static/video-captions/test-en.vtt';
const mp4='https://media.makertube.net/streaming-playlists/hls/'+uuid+'/file-720-fragmented.mp4';
const row={uuid,shortUUID:'aaa',url,name:'A Music Interview',duration:600,language:{id:'en'},licence:{id:2},
  nsfw:false,isLocal:true,privacy:{id:1},downloadEnabled:true,account:{displayName:'An author'},
  files:[],streamingPlaylists:[{files:[{fileUrl:mp4,size:50000000,hasVideo:true,hasAudio:true,resolution:{id:720}}]}]};
const captions={data:[{language:{id:'en'},captionPath:cap}]};
const ref=parsePeerResult(row);
test('PeerTube checks original host, public access, opt-in downloads, licensing and matching English subtitle',()=>{
  assert.equal(parsePeerResult({...row,nsfw:true}),null);
  assert.equal(parsePeerResult({...row,url:url.replace('makertube.net','evil.test')}),null);
  assert.equal(parsePeerVideo(ref,{...row,downloadEnabled:false},captions),null);
  assert.equal(parsePeerVideo(ref,{...row,licence:{id:7}},captions),null);
  assert.equal(parsePeerVideo(ref,row,{data:[{language:{id:'fr'},captionPath:cap}]}),null);
  assert.equal(parsePeerVideo(ref,row,{data:[{language:{id:'en'},fileUrl:'https://evil.test/en.vtt'}]}),null);
  assert.equal(parsePeerVideo(ref,row,captions).video,mp4);
});
test('a different topic enters model candidates rather than only NOAA/NASA',async()=>{
  const transport=async(u,options)=>{
    assert.equal(options.redirect,'error');assert.equal(options.headers,undefined);
    if(u.hostname==='sepiasearch.org')return Response.json({data:[row]});
    if(u.pathname.endsWith('/captions'))return Response.json(captions);
    if(u.pathname==='/api/v1/videos/'+uuid)return Response.json(row);
    if(u.pathname===cap)return new Response('WEBVTT\n\n00:09:05.000 --> 00:09:07.000\n'+('Listen to the musicians discussing techniques. '.repeat(60)));
    if(u.href===mp4&&options.method==='HEAD')return new Response(null,{headers:{'content-type':'binary/octet-stream','content-length':'50000000'}});
    return new Response(null,{status:404});
  };
  const results=await discover({day:'2026-11-27',level:'B1',choose:async()=>({queries:['music','cooking']}),transport,parseVtt});
  assert.deepEqual(results.map(x=>x.title),['A Music Interview']);
});
