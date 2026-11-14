'use strict';

const assert = require('node:assert/strict');
const admin = require('../api/admin/cloud-config');
const publicConfig = require('../api/cloud-config');

function response() {
  return { statusCode: 200, headers: {}, body: '',
    setHeader(k,v){this.headers[k.toLowerCase()]=v;},
    end(body){this.body=body||'';}
  };
}

async function run() {
  const saved = Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SLICKLY_ADMIN_EMAILS','SLICKLY_CLOUD_CONFIG_JSON'].map(k=>[k,process.env[k]]));
  const originalFetch = global.fetch;
  let stored = null;
  let revision = 0;
  try {
    process.env.SUPABASE_URL='https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY='service-role-test';
    process.env.SLICKLY_ADMIN_EMAILS='admin@slickly.example';
    delete process.env.SLICKLY_CLOUD_CONFIG_JSON;
    global.fetch=async(url,options={})=>{
      if(String(url).endsWith('/auth/v1/user')) return {ok:true,json:async()=>({id:'123e4567-e89b-42d3-a456-426614174000',email:'admin@slickly.example'})};
      if(String(url).includes('/rest/v1/slickly_cloud_config')) {
        if(options.method==='POST') {
          const row=JSON.parse(options.body);stored=row.config;revision=row.revision_number;
          return {ok:true,json:async()=>[row]};
        }
        return {ok:true,json:async()=>stored?[{config:stored,revision_number:revision,updated_at:'2026-11-14T00:00:00Z'}]:[]};
      }
      throw new Error('Unexpected fetch '+url);
    };

    const denied=response();
    global.fetch=async(url,options={})=>{
      if(String(url).endsWith('/auth/v1/user')) return {ok:true,json:async()=>({id:'123e4567-e89b-42d3-a456-426614174000',email:'not-admin@slickly.example'})};
      return originalFetch(url,options);
    };
    await admin({method:'GET',headers:{authorization:'Bearer token'}},denied);
    assert.equal(denied.statusCode,403);

    global.fetch=async(url,options={})=>{
      if(String(url).endsWith('/auth/v1/user')) return {ok:true,json:async()=>({id:'123e4567-e89b-42d3-a456-426614174000',email:'admin@slickly.example'})};
      if(String(url).includes('/rest/v1/slickly_cloud_config')) {
        if(options.method==='POST') {const row=JSON.parse(options.body);stored=row.config;revision=row.revision_number;return {ok:true,json:async()=>[row]};}
        return {ok:true,json:async()=>stored?[{config:stored,revision_number:revision,updated_at:'2026-11-14T00:00:00Z'}]:[]};
      }
      throw new Error('Unexpected fetch '+url);
    };
    const put=response();
    await admin({method:'PUT',headers:{authorization:'Bearer token'},body:{config:{
      schemaVersion:1,revision:'admin-test',minimumAppVersion:'1.0.0',pollIntervalMs:60000,rolloutPercent:25,
      features:{cloudConfig:true,newSettingsExperience:true,premiumAi:false,advancedScreenAnalysis:true,betaFeatures:false},
      presentation:{announcement:'Hello',announcementUrl:'https://slicklyai.vercel.app/'}
    }}},put);
    assert.equal(put.statusCode,200);
    assert.equal(JSON.parse(put.body).revision,'admin-1');
    assert.equal(stored.rolloutPercent,25);
    assert.equal(stored.features.newSettingsExperience,true);

    const invalid=response();
    await admin({method:'PUT',headers:{authorization:'Bearer token'},body:{config:{schemaVersion:1,revision:'bad',minimumAppVersion:'x',pollIntervalMs:1,rolloutPercent:200,features:{},presentation:{}}}},invalid);
    assert.equal(invalid.statusCode,400);

    const pub=response();
    global.fetch=async(url)=>({ok:true,json:async()=>[{config:stored}]});
    await publicConfig({method:'GET',headers:{}},pub);
    assert.equal(pub.statusCode,200);
    assert.equal(JSON.parse(pub.body).rolloutPercent,25);
  } finally {
    global.fetch=originalFetch;
    for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
  console.log('Slickly cloud admin tests passed: allowlist enforcement, config validation, persisted revisions and public config propagation.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
