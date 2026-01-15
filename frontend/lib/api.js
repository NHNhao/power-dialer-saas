const USE_MOCK = false;

const mock = {
  token: 'mock-jwt-token',
  user: { user_id: 'u1', tenant_id: 't1', email: 'admin@example.com', name: 'Admin' },
  campaigns: [ 
    { 
      id: 'c1', 
      name: 'Campaña Demo Ventas', 
      description: 'Campaña de prueba para ventas Q1',
      status: 'active',
      total_leads: 150,
      contacted: 45,
      pending: 105,
      success_rate: '30%',
      created_at: new Date().toISOString()
    },
    { 
      id: 'c2', 
      name: 'Seguimiento Clientes', 
      description: 'Campaña de seguimiento a clientes existentes',
      status: 'paused',
      total_leads: 80,
      contacted: 60,
      pending: 20,
      success_rate: '75%',
      created_at: new Date(Date.now() - 86400000).toISOString()
    }
  ],
  next: {
    queue_id: 'q1', lead_id: 'l1', full_name: 'Test Lead', phone_e164: '+15551234567', email: 'lead@example.com'
  }
};

export async function login(username, password) {
  if (USE_MOCK) {
    if (username === 'admin' && password === 'secret') {
      return { ok: true, token: mock.token, user: mock.user };
    }
    return { ok: false, error: 'invalid_credentials' };
  }

  const res = await fetch('http://localhost:3001/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
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

export async function createCampaign(token, data) {
  if (USE_MOCK) {
    const newCampaign = {
      id: 'c' + Date.now(),
      ...data,
      total_leads: 0,
      contacted: 0,
      pending: 0,
      success_rate: '0%',
      created_at: new Date().toISOString()
    };
    mock.campaigns.push(newCampaign);
    return { ok: true, campaign: newCampaign };
  }
  const r = await fetch('http://localhost:3001/campaigns', {
    method: 'POST',
    headers: { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return r.json();
}

export async function updateCampaign(token, id, data) {
  if (USE_MOCK) {
    const idx = mock.campaigns.findIndex(c => c.id === id);
    if (idx >= 0) {
      mock.campaigns[idx] = { ...mock.campaigns[idx], ...data };
      return { ok: true, campaign: mock.campaigns[idx] };
    }
    return { ok: false, error: 'not_found' };
  }
  const r = await fetch(`http://localhost:3001/campaigns/${id}`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return r.json();
}

export async function deleteCampaign(token, id) {
  if (USE_MOCK) {
    mock.campaigns = mock.campaigns.filter(c => c.id !== id);
    return { ok: true };
  }
  const r = await fetch(`http://localhost:3001/campaigns/${id}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer '+token }
  });
  return r.json();
}

export async function uploadLeads(token, campaignId, file) {
  if (USE_MOCK) {
    // Simulate upload
    const randomCount = Math.floor(Math.random() * 50) + 10;
    return { ok: true, imported: randomCount };
  }
  const formData = new FormData();
  formData.append('file', file);
  formData.append('campaign_id', campaignId);
  
  const r = await fetch('http://localhost:3001/leads/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer '+token },
    body: formData
  });
  return r.json();
}

export default { 
  login, 
  getCampaigns, 
  createCampaign,
  updateCampaign,
  deleteCampaign,
  uploadLeads,
  requestTwilioToken, 
  dialerNext, 
  saveDisposition 
};

