'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Module=require('node:module');

const originalLoad=Module._load;
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'slickly-session-test-'));
const mockElectron={
  app:{getPath:()=>directory},
  safeStorage:{
    isEncryptionAvailable:()=>true,
    encryptString:value=>Buffer.from(value,'utf8'),
    decryptString:value=>Buffer.from(value).toString('utf8')
  }
};
Module._load=function(request,parent,isMain){
  if(request==='electron')return mockElectron;
  return originalLoad.call(this,request,parent,isMain);
};

const SlicklyAccountSession=require('../src/services/account-session.service');
const sessionFile=path.join(directory,'session.enc');
const validSession=()=>({
  accessToken:'old-access-token-value-123456789',
  refreshToken:'old-refresh-token-value-123456789',
  supabaseUrl:'https://example-project.supabase.co',
  supabaseAnonKey:'example-publishable-key-value-123456789',
  user:{id:'11111111-1111-4111-8111-111111111111',email:'test@example.com'},
  expiresAt:Date.now()-1000
});
const response=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
  try{
    let calls=0;
    const concurrent=new SlicklyAccountSession({file:sessionFile,fetch:async(_url,options)=>{
      calls++;
      assert.match(options.body,/old-refresh-token-value/);
      await wait(30);
      return response(200,{access_token:'new-access-token-value-123456789',refresh_token:'new-refresh-token-value-123456789',expires_in:3600,user:{id:'11111111-1111-4111-8111-111111111111',email:'test@example.com'}});
    }});
    concurrent.save(validSession());
    const tokens=await Promise.all([concurrent.getAccessToken(),concurrent.getAccessToken(),concurrent.getAccessToken(),concurrent.getAccessToken()]);
    assert.equal(calls,1,'concurrent callers must share one refresh-token rotation');
    assert.deepEqual(tokens,Array(4).fill('new-access-token-value-123456789'));
    assert.equal(concurrent.read().refreshToken,'new-refresh-token-value-123456789','rotated refresh token must be persisted');

    const transient=new SlicklyAccountSession({file:path.join(directory,'transient.enc'),fetch:async()=>response(503,{error:'temporarily unavailable'})});
    transient.save(validSession());
    await assert.rejects(()=>transient.getAccessToken(),/temporarily unavailable/);
    assert.ok(fs.existsSync(path.join(directory,'transient.enc')),'transient provider failure must not erase the saved session');

    const network=new SlicklyAccountSession({file:path.join(directory,'network.enc'),fetch:async()=>{throw new Error('offline')}});
    network.save(validSession());
    await assert.rejects(()=>network.getAccessToken(),/network request failed/);
    assert.ok(fs.existsSync(path.join(directory,'network.enc')),'network failure must not erase the saved session');

    const invalid=new SlicklyAccountSession({file:path.join(directory,'invalid.enc'),fetch:async()=>response(401,{error:'invalid_grant'})});
    invalid.save(validSession());
    assert.equal(await invalid.getAccessToken(),null);
    assert.equal(fs.existsSync(path.join(directory,'invalid.enc')),false,'rejected refresh token must clear the invalid session');

    let release;
    const stale=new SlicklyAccountSession({file:path.join(directory,'stale.enc'),fetch:()=>new Promise(resolve=>{release=()=>resolve(response(200,{access_token:'late-access-token-value-123456789',refresh_token:'late-refresh-token-value-123456789',expires_in:3600,user:{id:'11111111-1111-4111-8111-111111111111'}}));})});
    stale.save(validSession());
    const pending=stale.getAccessToken();
    await wait(0);
    stale.clear();
    release();
    assert.equal(await pending,null,'a refresh must not resurrect a session after sign-out');
    assert.equal(stale.read(),null);

    console.log('PASS: concurrent refresh serialization, rotated-token persistence, transient/network failure retention, invalid-token cleanup, and sign-out race protection.');
  }finally{
    Module._load=originalLoad;
    fs.rmSync(directory,{recursive:true,force:true});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
