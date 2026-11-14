'use strict';

const { json, authenticate, getConfig, safeError } = require('../_lib/slickly-auth');
const { sanitizeConfig, DEFAULT_CONFIG } = require('../cloud-config');

function isAdmin(user) {
  const emails = [
    process.env.SLICKLY_ADMIN_EMAILS || '',
    process.env.SLICKLY_REFERRAL_ADMIN_EMAILS || ''
  ].join(',').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return Boolean(user?.email && emails.includes(String(user.email).toLowerCase()));
}

module.exports = async function adminCloudConfig(req, res) {
  try {
    const { user } = await authenticate(req);
    if (!isAdmin(user)) return json(res, 403, { error: 'This account is not authorised to manage Slickly Cloud.' });
    const config = getConfig();
    const url = config.supabaseUrl + '/rest/v1/slickly_cloud_config';
    const headers = {
      apikey: config.serviceRoleKey,
      Authorization: 'Bearer ' + config.serviceRoleKey,
      'Content-Type': 'application/json'
    };

    if (req.method === 'GET') {
      const response = await fetch(url + '?select=config,revision_number,updated_at,updated_by&id=eq.true&limit=1', { headers });
      if (!response.ok) throw new Error('Could not load the cloud configuration.');
      const rows = await response.json();
      const row = rows[0];
      return json(res, 200, {
        config: row?.config ? sanitizeConfig(row.config) : sanitizeConfig(
          process.env.SLICKLY_CLOUD_CONFIG_JSON ? JSON.parse(process.env.SLICKLY_CLOUD_CONFIG_JSON) : DEFAULT_CONFIG
        ),
        revisionNumber: row?.revision_number || 0,
        updatedAt: row?.updated_at || null
      });
    }

    if (req.method === 'PUT') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON.' }); }
      }
      let next;
      try { next = sanitizeConfig(body?.config); }
      catch (error) { error.statusCode = 400; throw error; }
      // Always move the revision forward, even if an admin reuses a label.
      const existing = await fetch(url + '?select=revision_number&id=eq.true&limit=1', { headers });
      if (!existing.ok) throw new Error('Could not read the current cloud revision.');
      const currentRows = await existing.json();
      const revisionNumber = Number(currentRows[0]?.revision_number || 0) + 1;
      const revision = 'admin-' + revisionNumber;
      next.revision = revision;
      const saved = await fetch(url + '?on_conflict=id', {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          id: true, config: next, revision_number: revisionNumber,
          updated_by: user.id, updated_at: new Date().toISOString()
        })
      });
      if (!saved.ok) throw new Error('Could not save the cloud configuration.');
      return json(res, 200, { saved: true, revision, config: next });
    }

    res.setHeader('Allow', 'GET, PUT');
    return json(res, 405, { error: 'Use GET or PUT.' });
  } catch (error) {
    return safeError(res, error);
  }
};
