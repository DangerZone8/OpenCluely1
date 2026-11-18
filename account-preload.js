'use strict';
const {contextBridge,ipcRenderer}=require('electron');
let pendingOAuthCode=null;
const oauthListeners=new Set();
ipcRenderer.on('slickly-oauth-code',(_event,code)=>{
  if(typeof code!=='string'||!code)return;
  if(!oauthListeners.size){pendingOAuthCode=code;return;}
  for(const listener of oauthListeners){try{listener(code);}catch(_){}}
});
contextBridge.exposeInMainWorld('slicklyDesktopAccount',{
  saveSession:session=>ipcRenderer.invoke('slickly-account-save-session',session),
  getAccessToken:()=>ipcRenderer.invoke('slickly-account-get-access-token'),
  clearSession:()=>ipcRenderer.invoke('slickly-account-clear-session'),
  openOAuthUrl:url=>ipcRenderer.invoke('slickly-account-open-oauth',url),
  onOAuthCode:callback=>{
    if(typeof callback!=='function')return ()=>{};
    oauthListeners.add(callback);
    if(pendingOAuthCode){const code=pendingOAuthCode;pendingOAuthCode=null;queueMicrotask(()=>callback(code));}
    return ()=>oauthListeners.delete(callback);
  }
});
