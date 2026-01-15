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

export async function dialerNextAndCall(token, campaign_id) {
  if (USE_MOCK) return { ok: true, next: mock.next, call_sid: 'MOCK_SID' };
  const r = await fetch('http://localhost:3001/dialer/next_and_call', {
    method: 'POST', headers: { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaign_id })
  });
  return r.json();
}

export async function resetTestMode(token, campaign_id) {
  if (USE_MOCK) return { ok: true, reset_count: 0 };
  const r = await fetch('http://localhost:3001/dialer/reset-test-mode', {
    method: 'POST', headers: { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaign_id })
  });
  return r.json();
}

export async function getQueueStatus(token, queue_name) {
  if (USE_MOCK) return { ok: true, waiting: 2, queue_exists: true };
  const r = await fetch(`http://localhost:3001/dialer/queue-status/${encodeURIComponent(queue_name)}`, {
    method: 'GET', headers: { Authorization: 'Bearer '+token }
  });
  return r.json();
}

export async function dequeueCall(token, queue_name) {
  if (USE_MOCK) return { ok: true, dequeued: true, call_sid: 'MOCK_SID' };
  const r = await fetch('http://localhost:3001/dialer/dequeue', {
    method: 'POST', headers: { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ queue_name })
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

export async function getLeads(token, params = {}) {
  if (USE_MOCK) {
    const mockLeads = [
      { id: 'l1', full_name: 'Juan Pérez', phone_e164: '+573001234567', email: 'juan@example.com', status: 'new', campaign_count: 2, last_call_at: null, created_at: new Date().toISOString() },
      { id: 'l2', full_name: 'María García', phone_e164: '+573007654321', email: 'maria@example.com', status: 'contacted', campaign_count: 1, last_call_at: new Date().toISOString(), created_at: new Date().toISOString() }
    ];
    return { ok: true, leads: mockLeads, total: mockLeads.length, limit: 100, offset: 0 };
  }
  
  const queryParams = new URLSearchParams(params);
  const r = await fetch(`http://localhost:3001/leads?${queryParams}`, {
    headers: { Authorization: 'Bearer '+token }
  });
  return r.json();
}

export async function deleteLead(token, id) {
  if (USE_MOCK) {
    return { ok: true };
  }
  const r = await fetch(`http://localhost:3001/leads/${id}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer '+token }
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
  getLeads,
  deleteLead,
  requestTwilioToken, 
  dialerNext,
  dialerNextAndCall,
  resetTestMode,
  getQueueStatus,
  dequeueCall, 
  saveDisposition 
};

