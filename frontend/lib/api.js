const USE_MOCK = true;

const mock = {
  token: 'mock-jwt-token',
  user: { user_id: 'u1', tenant_id: 't1', email: 'admin@example.com', name: 'Admin' },
  campaigns: [ { id: 'c1', name: 'Demo Campaign' } ],
  next: {
    queue_id: 'q1', lead_id: 'l1', full_name: 'Test Lead', phone_e164: '+15551234567', email: 'lead@example.com'
  }
};

export async function login(email, password) {
  if (USE_MOCK) {
    if (email === 'admin@example.com' && password === 'secret') {
      return { ok: true, token: mock.token, user: mock.user };
    }
    return { ok: false, error: 'invalid_credentials' };
  }

  const res = await fetch('http://localhost:3001/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  });
  return res.json();
}

export async function getCampaigns(token) {
  if (USE_MOCK) return { ok: true, campaigns: mock.campaigns };
  const r = await fetch('http://localhost:3001/campaigns', { headers: { Authorization: 'Bearer '+token } });
  return r.json();
}

export async function requestTwilioToken(token) {
  if (USE_MOCK) return { ok: true, token: 'mock-twilio-token', identity: 'admin@example.com', expires_in: 3600 };
  const r = await fetch('http://localhost:3001/twilio/token', { method: 'POST', headers: { Authorization: 'Bearer '+token } });
  return r.json();
}

export async function dialerNext(token, campaign_id) {
  if (USE_MOCK) return { ok: true, next: mock.next };
  const r = await fetch('http://localhost:3001/dialer/next', {
    method: 'POST', headers: { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaign_id })
  });
  return r.json();
}

export async function saveDisposition(token, queue_id, disposition) {
  if (USE_MOCK) return { ok: true };
  const r = await fetch('http://localhost:3001/dialer/disposition', {
    method: 'POST', headers: { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ queue_id, disposition })
  });
  return r.json();
}

export default { login, getCampaigns, requestTwilioToken, dialerNext, saveDisposition };
