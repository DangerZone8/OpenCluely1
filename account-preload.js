'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('slicklyDesktopAccount',{
  saveSession:session=>ipcRenderer.invoke('slickly-account-save-session',session),
  getAccessToken:()=>ipcRenderer.invoke('slickly-account-get-access-token'),
  clearSession:()=>ipcRenderer.invoke('slickly-account-clear-session')
});
