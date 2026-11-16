'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const createCode=require('../api/admin/referrals');
const validateCode=require('../api/referrals/validate');
const checkout=require('../api/billing/checkout');
const webhook=require('../api/billing/webhook');
const accountMe=require('../api/account/me');
const cancel=require('../api/billing/cancel');

function response(){return{statusCode:200,headers:{},body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(b){this.body=b||'';}};}
function rpcResponse(value){return{ok:true,text:async()=>JSON.stringify(value)};}
const ids={
 admin:'123e4567-e89b-42d3-a456-426614174001',
 referralCustomer:'123e4567-e89b-42d3-a456-426614174002',
 baseCustomer:'123e4567-e89b-42d3-a456-426614174005'
};
const periodEnd='2099-12-31T23:59:59.000Z';

async function run(){
 const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SLICKLY_REFERRAL_ADMIN_EMAILS','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_PRO_PLAN_ID','RAZORPAY_WEBHOOK_SECRET','SLICKLY_BILLING_ENABLED'];
 const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const oldFetch=global.fetch;
 let savedCode=null, reserved=false, redeemed=false, appliedEvents=0, cancelled=false;
 const subscriptions=new Map(), seenEventIds=new Set(), subscriptionNotes=new Map();
 try{
  process.env.SUPABASE_URL='https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY='service-role-test';
  process.env.SLICKLY_REFERRAL_ADMIN_EMAILS='admin@slickly.example';
  process.env.RAZORPAY_KEY_ID='rzp_test';
  process.env.RAZORPAY_KEY_SECRET='razorpay-test-secret';
  process.env.RAZORPAY_PRO_PLAN_ID='plan_base';
  process.env.RAZORPAY_WEBHOOK_SECRET='webhook-test-secret';
  process.env.SLICKLY_BILLING_ENABLED='true';

  global.fetch=async(url,options={})=>{
   const u=String(url);
   if(u.endsWith('/auth/v1/user')){
    const token=String(options.headers.Authorization||'').replace(/^Bearer /,'');
    const userId=token==='admin-token'?ids.admin:token==='base-customer-token'?ids.baseCustomer:ids.referralCustomer;
    const email=userId===ids.admin?'admin@slickly.example':userId===ids.baseCustomer?'base@slickly.example':'customer@slickly.example';
    return{ok:true,json:async()=>({id:userId,email})};
   }
   if(u.includes('/rest/v1/slickly_subscriptions?')){
    const userId=decodeURIComponent((u.match(/user_id=eq\.([^&]+)/)||[])[1]||'');
    const row=subscriptions.get(userId);
    return{ok:true,json:async()=>row?[row]:[]};
   }
   if(u.includes('/rest/v1/slickly_usage_daily?'))return{ok:true,json:async()=>[]};
   if(u.includes('/rest/v1/slickly_referral_codes')){
    if(options.method==='POST'){savedCode=JSON.parse(options.body);return{ok:true,json:async()=>[{...savedCode,id:'123e4567-e89b-42d3-a456-426614174003',redemption_count:0}]};}
    if(u.includes('select=id&code=eq.'))return{ok:true,json:async()=>[]};
    return{ok:true,json:async()=>savedCode?[{...savedCode,id:'123e4567-e89b-42d3-a456-426614174003'}]:[]};
   }
   if(u.includes('/rest/v1/slickly_referral_redemptions')){
    if(options.method==='PATCH')return{ok:true,json:async()=>[]};
    return{ok:true,json:async()=>[]};
   }
   if(u.endsWith('/rest/v1/rpc/reserve_slickly_referral')){
    reserved=true;
    return rpcResponse({redemption_id:'123e4567-e89b-42d3-a456-426614174004',code_id:'123e4567-e89b-42d3-a456-426614174003',plan_id:'plan_discounted',monthly_price_paise:31920,code:'WELCOME20'});
   }
   if(u.endsWith('/rest/v1/rpc/apply_slickly_razorpay_event')){
    const args=JSON.parse(options.body);
    if(seenEventIds.has(args.p_event_id))return rpcResponse({applied:false,duplicate:true});
    seenEventIds.add(args.p_event_id);appliedEvents++;
    subscriptions.set(args.p_user_id,{
      user_id:args.p_user_id,provider_subscription_id:args.p_provider_subscription_id,
      plan:args.p_provider_status==='active'?'pro':'free',
      status:args.p_provider_status,current_period_end:args.p_current_end||periodEnd
    });
    return rpcResponse({applied:true,plan:args.p_provider_status==='active'?'pro':'free',status:args.p_provider_status});
   }
   if(u.endsWith('/rest/v1/rpc/redeem_slickly_referral')){redeemed=true;return rpcResponse(true);}
   if(u.endsWith('/rest/v1/rpc/release_slickly_referral'))return rpcResponse(true);
   if(u==='https://api.razorpay.com/v1/plans')return{ok:true,json:async()=>({id:'plan_discounted'})};
   if(u==='https://api.razorpay.com/v1/subscriptions'){
    const body=JSON.parse(options.body);
    const userId=body.notes.slickly_user_id;
    const id=userId===ids.baseCustomer?'sub_test_base':'sub_test_referral';
    subscriptionNotes.set(id,body.notes);
    return{ok:true,json:async()=>({id,short_url:'https://checkout.razorpay.com/'+id})};
   }
   if(u.endsWith('/cancel')&&u.includes('/subscriptions/')){
    const body=JSON.parse(options.body);
    assert.equal(body.cancel_at_cycle_end,true);
    cancelled=true;
    return{ok:true,json:async()=>({status:'cancelled'})};
   }
   throw new Error('Unexpected fetch '+u);
  };

  // Before a verified activation webhook, the customer must remain on Free.
  const before=response();
  await accountMe({method:'GET',headers:{authorization:'Bearer customer-token'}},before);
  assert.equal(before.statusCode,200);
  assert.equal(JSON.parse(before.body).plan,'free');

  // Admin creates a recurring discounted plan and code; customer validates it.
  const createRes=response();
  await createCode({method:'POST',headers:{authorization:'Bearer admin-token'},body:{code:'WELCOME20',discountType:'percent',discountValue:20,maxRedemptions:25,expiresAt:null}},createRes);
  assert.equal(createRes.statusCode,201);
  assert.equal(JSON.parse(createRes.body).priceDisplay,'₹319.20/month');
  assert.equal(savedCode.razorpay_plan_id,'plan_discounted');

  const validation=response();
  await validateCode({method:'POST',headers:{authorization:'Bearer customer-token'},body:{code:'WELCOME20'}},validation);
  assert.equal(validation.statusCode,200);
  assert.equal(JSON.parse(validation.body).monthlyPricePaise,31920);

  // Discounted checkout creates a provider subscription but does not grant Pro.
  const checkoutRes=response();
  await checkout({method:'POST',headers:{authorization:'Bearer customer-token'},body:{referralCode:'WELCOME20'}},checkoutRes);
  assert.equal(checkoutRes.statusCode,200);
  assert.equal(JSON.parse(checkoutRes.body).checkoutUrl,'https://checkout.razorpay.com/sub_test_referral');
  assert.equal(JSON.parse(checkoutRes.body).entitlement,'pending_webhook');
  assert.equal(reserved,true);
  assert.equal(subscriptionNotes.get('sub_test_referral').referral_redemption_id,'123e4567-e89b-42d3-a456-426614174004');

  // Baseline ₹399 checkout path must also use the configured base plan.
  const baseCheckout=response();
  await checkout({method:'POST',headers:{authorization:'Bearer base-customer-token'},body:{}},baseCheckout);
  assert.equal(baseCheckout.statusCode,200);
  assert.equal(JSON.parse(baseCheckout.body).priceDisplay,'₹399/month');
  assert.equal(subscriptionNotes.get('sub_test_base').slickly_user_id,ids.baseCustomer);

  const sendEvent=async({id,userId,subscriptionId,status='active',createdAt=1795000000,redemptionId=null})=>{
    const event={event:status==='active'?'subscription.activated':'subscription.halted',created_at:createdAt,payload:{subscription:{entity:{
      id:subscriptionId,status,current_end:4070908800,
      notes:{slickly_user_id:userId,...(redemptionId?{referral_redemption_id:redemptionId}:{})}
    }}}};
    const raw=Buffer.from(JSON.stringify(event));
    const signature=crypto.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
    const res=response();
    await webhook({method:'POST',headers:{'x-razorpay-signature':signature,'x-razorpay-event-id':id},body:raw},res);
    return {res,body:JSON.parse(res.body)};
  };

  const activated=await sendEvent({id:'evt_ref_123456',userId:ids.referralCustomer,subscriptionId:'sub_test_referral',redemptionId:'123e4567-e89b-42d3-a456-426614174004'});
  assert.equal(activated.res.statusCode,200);
  assert.equal(activated.body.applied,true);
  assert.equal(redeemed,true);
  assert.equal(appliedEvents,1);

  // Duplicate webhook delivery must be idempotent.
  const duplicate=await sendEvent({id:'evt_ref_123456',userId:ids.referralCustomer,subscriptionId:'sub_test_referral',redemptionId:'123e4567-e89b-42d3-a456-426614174004'});
  assert.equal(duplicate.res.statusCode,200);
  assert.equal(duplicate.body.applied,false);
  assert.equal(appliedEvents,1);

  const after=response();
  await accountMe({method:'GET',headers:{authorization:'Bearer customer-token'}},after);
  assert.equal(after.statusCode,200);
  assert.equal(JSON.parse(after.body).plan,'pro','only a verified active webhook may grant Pro');

  const badSignature=response();
  await webhook({method:'POST',headers:{'x-razorpay-signature':'00'.repeat(32),'x-razorpay-event-id':'evt_bad_123456'},body:Buffer.from('{}')},badSignature);
  assert.equal(badSignature.statusCode,401,'invalid webhook signatures must never grant Pro');

  // Base-plan activation and cancellation scheduling are covered independently.
  const baseActivated=await sendEvent({id:'evt_base_123456',userId:ids.baseCustomer,subscriptionId:'sub_test_base'});
  assert.equal(baseActivated.res.statusCode,200);
  const baseAccount=response();
  await accountMe({method:'GET',headers:{authorization:'Bearer base-customer-token'}},baseAccount);
  assert.equal(JSON.parse(baseAccount.body).plan,'pro');
  const cancelRes=response();
  await cancel({method:'POST',headers:{authorization:'Bearer base-customer-token'},body:{}},cancelRes);
  assert.equal(cancelRes.statusCode,200);
  assert.equal(cancelled,true);

  // A newer halted event must remove Pro entitlement.
  const halted=await sendEvent({id:'evt_halted_123456',userId:ids.baseCustomer,subscriptionId:'sub_test_base',status:'halted',createdAt:1795000100});
  assert.equal(halted.res.statusCode,200);
  const haltedAccount=response();
  await accountMe({method:'GET',headers:{authorization:'Bearer base-customer-token'}},haltedAccount);
  assert.equal(JSON.parse(haltedAccount.body).plan,'free');

  console.log('PASS: full mocked Slickly Pro journey — Free pre-checkout → standard ₹399 and discounted checkout → signed activation → Pro entitlement → duplicate/invalid webhook protection → cancellation request → halted subscription returns to Free.');
 }finally{
  global.fetch=oldFetch;
  for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
