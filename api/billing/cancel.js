'use strict';

const { json, authenticate, getConfig, safeError } = require('../_lib/slickly-auth');

module.exports=async function cancelSubscription(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return json(res,405,{error:'Use POST to schedule subscription cancellation.'});}
  try{
    const {user,supabaseUrl,serviceRoleKey}=await authenticate(req);
    const keyId=String(process.env.RAZORPAY_KEY_ID||'');
    const keySecret=String(process.env.RAZORPAY_KEY_SECRET||'');
    if(!keyId||!keySecret)return json(res,503,{error:'Subscription management is not configured.'});
    const config=getConfig();
    const headers={apikey:serviceRoleKey,Authorization:'Bearer '+serviceRoleKey};
    const lookup=await fetch(supabaseUrl+'/rest/v1/slickly_subscriptions?select=provider_subscription_id,status,plan,current_period_end&user_id=eq.'+encodeURIComponent(user.id)+'&limit=1',{headers});
    if(!lookup.ok)throw new Error('Could not load your subscription.');
    const rows=await lookup.json(),subscription=rows[0];
    if(!subscription?.provider_subscription_id||subscription.plan!=='pro')return json(res,409,{error:'There is no active Pro subscription to cancel.'});
    if(['cancelled','completed','expired'].includes(subscription.status))return json(res,200,{cancelled:true,status:subscription.status,currentPeriodEnd:subscription.current_period_end});
    const provider=await fetch('https://api.razorpay.com/v1/subscriptions/'+encodeURIComponent(subscription.provider_subscription_id)+'/cancel',{
      method:'POST',
      headers:{Authorization:'Basic '+Buffer.from(keyId+':'+keySecret).toString('base64'),'Content-Type':'application/json'},
      body:JSON.stringify({cancel_at_cycle_end:true})
    });
    const data=await provider.json().catch(()=>({}));
    if(!provider.ok)return json(res,502,{error:'The payment provider could not schedule cancellation. Please contact Slickly support.'});
    return json(res,200,{cancelled:true,cancelAtCycleEnd:true,status:data.status||'pending',currentPeriodEnd:subscription.current_period_end});
  }catch(error){return safeError(res,error);}
};
