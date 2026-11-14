'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const createCode=require('../api/admin/referrals');
const validateCode=require('../api/referrals/validate');
const checkout=require('../api/billing/checkout');
const webhook=require('../api/billing/webhook');

function response(){return{statusCode:200,headers:{},body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(b){this.body=b||'';}};}
function rpcResponse(value){return{ok:true,text:async()=>JSON.stringify(value)};}

async function run(){
 const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SLICKLY_REFERRAL_ADMIN_EMAILS','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_PRO_PLAN_ID','RAZORPAY_WEBHOOK_SECRET'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const oldFetch=global.fetch;
 let savedCode=null, subscriptionNotes=null, reserved=false, redeemed=false, applied=false;
 try{
  process.env.SUPABASE_URL='https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY='service-role-test';
  process.env.SLICKLY_REFERRAL_ADMIN_EMAILS='admin@slickly.example';
  process.env.RAZORPAY_KEY_ID='rzp_test';
  process.env.RAZORPAY_KEY_SECRET='razorpay-test-secret';
  process.env.RAZORPAY_PRO_PLAN_ID='plan_base';
  process.env.RAZORPAY_WEBHOOK_SECRET='webhook-test-secret';

  global.fetch=async(url,options={})=>{
   const u=String(url);
   if(u.endsWith('/auth/v1/user')){
    const admin=options.headers.Authorization==='Bearer admin-token';
    return{ok:true,json:async()=>({id:admin?'123e4567-e89b-42d3-a456-426614174001':'123e4567-e89b-42d3-a456-426614174002',email:admin?'admin@slickly.example':'customer@slickly.example'})};
   }
   if(u.includes('/rest/v1/slickly_referral_codes')){
    if(options.method==='POST'){savedCode=JSON.parse(options.body);return{ok:true,json:async()=>[{...savedCode,id:'123e4567-e89b-42d3-a456-426614174003',redemption_count:0}]};}
    if(u.includes('select=id&code=eq.'))return{ok:true,json:async()=>[]};
    return{ok:true,json:async()=>savedCode?[{...savedCode,id:'123e4567-e89b-42d3-a456-426614174003'}]:[]};
   }
   if(u.includes('/rest/v1/slickly_referral_redemptions')){
    if(options.method==='PATCH')return{ok:true,json:async()=>[]};
    return{ok:true,json:async()=>[]};
   }
   if(u.endsWith('/rest/v1/rpc/reserve_slickly_referral')){reserved=true;return rpcResponse({redemption_id:'123e4567-e89b-42d3-a456-426614174004',code_id:'123e4567-e89b-42d3-a456-426614174003',plan_id:'plan_discounted',monthly_price_paise:31920,code:'WELCOME20'});}
   if(u.endsWith('/rest/v1/rpc/apply_slickly_razorpay_event')){applied=true;return rpcResponse({applied:true,plan:'pro',status:'active'});}
   if(u.endsWith('/rest/v1/rpc/redeem_slickly_referral')){redeemed=true;return rpcResponse(true);}
   if(u==='https://api.razorpay.com/v1/plans')return{ok:true,json:async()=>({id:'plan_discounted'})};
   if(u==='https://api.razorpay.com/v1/subscriptions'){
    subscriptionNotes=JSON.parse(options.body).notes;
    return{ok:true,json:async()=>({id:'sub_test_123',short_url:'https://checkout.razorpay.com/test'})};
   }
   throw new Error('Unexpected fetch '+u);
  };

  const createRes=response();
  await createCode({method:'POST',headers:{authorization:'Bearer admin-token'},body:{code:'WELCOME20',discountType:'percent',discountValue:20,maxRedemptions:25,expiresAt:null}},createRes);
  assert.equal(createRes.statusCode,201);
  assert.equal(JSON.parse(createRes.body).priceDisplay,'₹319.20/month');
  assert.equal(savedCode.razorpay_plan_id,'plan_discounted');

  const validation=response();
  await validateCode({method:'POST',headers:{authorization:'Bearer customer-token'},body:{code:'WELCOME20'}},validation);
  assert.equal(validation.statusCode,200);
  assert.equal(JSON.parse(validation.body).monthlyPricePaise,31920);

  const checkoutRes=response();
  await checkout({method:'POST',headers:{authorization:'Bearer customer-token'},body:{referralCode:'WELCOME20'}},checkoutRes);
  assert.equal(checkoutRes.statusCode,200);
  assert.equal(JSON.parse(checkoutRes.body).checkoutUrl,'https://checkout.razorpay.com/test');
  assert.equal(reserved,true);
  assert.equal(subscriptionNotes.referral_redemption_id,'123e4567-e89b-42d3-a456-426614174004');

  const event={event:'subscription.activated',created_at:1794614400,payload:{subscription:{entity:{id:'sub_test_123',status:'active',current_end:1797206400,notes:{slickly_user_id:'123e4567-e89b-42d3-a456-426614174002',referral_redemption_id:'123e4567-e89b-42d3-a456-426614174004'}}}}};
  const raw=Buffer.from(JSON.stringify(event));
  const signature=crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  const webhookRes=response();
  await webhook({method:'POST',headers:{'x-razorpay-signature':signature,'x-razorpay-event-id':'evt_test_123456'},body:raw},webhookRes);
  assert.equal(webhookRes.statusCode,200);
  assert.equal(applied,true);
  assert.equal(redeemed,true);
  console.log('Slickly referral E2E simulation passed: admin creates code/plan → customer validates → discounted checkout reserves code → signed activation webhook grants Pro and redeems code.');
 }finally{
  global.fetch=oldFetch;
  for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
