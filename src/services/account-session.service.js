'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {app,safeStorage}=require('electron');

class SlicklyAccountSession {
  constructor(options={}) {
    this.fetch=options.fetch||globalThis.fetch;
    this.file=options.file||path.join(app.getPath('userData'),'slickly-account-session.enc');
    this.cached=null;
  }
  save(payload) {
    if(!safeStorage.isEncryptionAvailable()) throw new Error('Secure account storage is unavailable on this device.');
    const accessToken=String(payload?.accessToken||'');
    const refreshToken=String(payload?.refreshToken||'');
    const supabaseUrl=String(payload?.supabaseUrl||'').replace(/\/$/,'');
    const supabaseAnonKey=String(payload?.supabaseAnonKey||'');
    const userId=String(payload?.user?.id||'');
    const expiresAt=Number(payload?.expiresAt||0);
    if(accessToken.length<20||accessToken.length>8192||refreshToken.length<20||refreshToken.length>8192||
       !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)||
       supabaseAnonKey.length<20||supabaseAnonKey.length>8192||
       !/^[0-9a-f-]{36}$/i.test(userId)||!Number.isFinite(expiresAt)) {
      throw new Error('The account session could not be validated.');
    }
    const session={accessToken,refreshToken,supabaseUrl,supabaseAnonKey,user:{id:userId,email:String(payload.user.email||'').slice(0,254)},expiresAt};
    const encrypted=safeStorage.encryptString(JSON.stringify(session));
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const temp=this.file+'.tmp';
    fs.writeFileSync(temp,encrypted,{mode:0o600});
    fs.renameSync(temp,this.file);
    this.cached=session;
    return {saved:true,email:session.user.email};
  }
  clear() {
    this.cached=null;
    try{fs.unlinkSync(this.file);}catch(error){if(error.code!=='ENOENT')throw error;}
    return {cleared:true};
  }
  read() {
    if(this.cached)return this.cached;
    if(!safeStorage.isEncryptionAvailable())return null;
    try {
      const encrypted=fs.readFileSync(this.file);
      const parsed=JSON.parse(safeStorage.decryptString(encrypted));
      if(!parsed||typeof parsed.refreshToken!=='string'||typeof parsed.supabaseUrl!=='string')return null;
      this.cached=parsed;return parsed;
    }catch(_){return null;}
  }
  async getAccessToken() {
    const session=this.read();
    if(!session)return null;
    if(session.accessToken&&session.expiresAt>Date.now()+60000)return session.accessToken;
    const response=await this.fetch(session.supabaseUrl+'/auth/v1/token?grant_type=refresh_token',{
      method:'POST',headers:{apikey:session.supabaseAnonKey,'Content-Type':'application/json'},
      body:JSON.stringify({refresh_token:session.refreshToken}),signal:AbortSignal.timeout(10000)
    });
    const next=await response.json().catch(()=>({}));
    if(!response.ok||!next.access_token||!next.refresh_token){
      this.clear();return null;
    }
    this.save({
      accessToken:next.access_token,refreshToken:next.refresh_token,
      expiresAt:Date.now()+Math.max(60,Number(next.expires_in)||3600)*1000,
      supabaseUrl:session.supabaseUrl,supabaseAnonKey:session.supabaseAnonKey,
      user:{id:session.user.id,email:next.user?.email||session.user.email}
    });
    return next.access_token;
  }
}
module.exports=SlicklyAccountSession;
