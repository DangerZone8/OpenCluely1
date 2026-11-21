'use strict';

// Read-only Razorpay sandbox readiness check. It never creates a charge,
// customer, subscription, or payment link.
const keyId = String(process.env.RAZORPAY_KEY_ID || '');
const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '');
const planId = String(process.env.RAZORPAY_PRO_PLAN_ID || '');
const expectedAmount = Number(process.env.RAZORPAY_EXPECTED_AMOUNT_PAISE || 39900);
const baseUrl = String(process.env.RAZORPAY_API_BASE_URL || 'https://api.razorpay.com/v1').replace(/\/$/, '');

async function main() {
  if (!keyId || !keySecret || !planId) {
    console.error('Sandbox check not run: configure RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_PRO_PLAN_ID in the protected test environment.');
    process.exitCode = 2;
    return;
  }
  if (!/^rzp_test_/.test(keyId)) {
    throw new Error('Refusing to run: the key ID is not a Razorpay test-mode key.');
  }
  if (!/^plan_[A-Za-z0-9]+$/.test(planId)) {
    throw new Error('Invalid Razorpay plan ID format.');
  }

  const response = await fetch(baseUrl + '/plans/' + encodeURIComponent(planId), {
    method: 'GET',
    headers: {
      Authorization: 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64'),
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('Razorpay sandbox plan lookup failed (HTTP ' + response.status + ', ' + String(data.error?.code || 'provider_error') + ').');
  }

  const item = data.item || {};
  const checks = {
    planIdMatches: data.id === planId,
    amountMatches: Number(item.amount) === expectedAmount,
    currencyIsINR: item.currency === 'INR',
    monthlyInterval: data.period === 'monthly' && Number(data.interval) === 1
  };
  console.log(JSON.stringify({
    mode: 'sandbox',
    plan: { id: data.id, amount: item.amount, currency: item.currency, period: data.period, interval: data.interval },
    checks
  }, null, 2));
  if (Object.values(checks).some(value => !value)) {
    throw new Error('Sandbox plan does not match the configured Slickly Pro price/currency/billing interval.');
  }
  console.log('PASS: Razorpay test-mode credentials authenticated and the Pro plan is ₹399 INR/month.');
}

main().catch(error => {
  console.error('RAZORPAY SANDBOX CHECK FAILED:', String(error.message || error).slice(0, 240));
  process.exitCode = 1;
});
