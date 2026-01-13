import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../context/AuthContext'
import * as Api from '../lib/api'
import { useLanguage } from '../context/LanguageContext'

const agentStateColors = {
  idle: '#7a8096',
  ready: '#8000ff',
  on_call: '#c7ff63',
  wrapup: '#f59e0b'
}

const agentStateLabels = {
  idle: 'Inactivo',
  ready: 'Listo',
  on_call: 'En llamada',
  wrapup: 'Completando'
}

export default function Agent() {
  const router = useRouter();
  const auth = useAuth();
  const { t, lang, setLang } = useLanguage();
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [agentState, setAgentState] = useState('idle');
  const deviceRef = useRef(null);
  const connRef = useRef(null);
  const [lead, setLead] = useState(null);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(()=>{
    if (!auth.token) return router.push('/');
    (async ()=>{
      const r = await Api.getCampaigns(auth.token);
      if (r.ok) setCampaigns(r.campaigns || []);
    })();
  },[]);

  async function ready() {
    if (!auth.token) return;
    setLoading(true);
    try {
      const j = await Api.requestTwilioToken(auth.token);
      if (!j.ok) return alert('token error: '+(j.error||'unknown'));
      setAgentState('ready');
    } finally {
      setLoading(false);
    }
  }

  async function callNext() {
    if (!selectedCampaign) return alert('Selecciona una campaña');
    setLoading(true);
    try {
      const j = await Api.dialerNext(auth.token, selectedCampaign);
      if (!j.ok) return alert('error: '+(j.error||'unknown'));
      if (!j.next) return alert('No hay leads en cola');
      setLead(j.next);
      setAgentState('on_call');
    } finally {
      setLoading(false);
    }
  }

  function hangup() {
    setAgentState('wrapup');
    setLead(null);
  }

  function toggleMute() { setMuted(!muted) }

  function logout() {
    auth.logout();
    router.push('/');
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #f0f1fa 0%, #faf8ff 100%)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Top Header */}
      <header style={{
        background: 'linear-gradient(90deg, white, rgba(240,241,250,0.5))',
        padding: '20px 24px',
        boxShadow: '0 2px 8px rgba(42,0,102,0.06)',
        borderBottom: '1px solid #d0d7e0'
      }}>
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h2 style={{margin: '0 0 4px 0', fontSize: '24px', color: '#2a0066'}}>
              {t('agentConsole')}
            </h2>
            <p style={{margin: 0, fontSize: '13px', color: '#7a8096'}}>
              Agent: <span style={{fontWeight: '600', color: '#1a1d23'}}>{auth.user?.email || '—'}</span>
            </p>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '24px'
          }}>
            {/* Status Indicator */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              background: 'rgba(240,241,250,0.6)',
              borderRadius: '999px',
              border: '1px solid #d0d7e0'
            }}>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: agentStateColors[agentState],
                display: 'inline-block',
                animation: 'pulse 2s infinite'
              }} />
              <span style={{
                fontSize: '12px',
                fontWeight: '600',
                color: '#1a1d23',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                {agentStateLabels[agentState]}
              </span>
            </div>

            {/* Language Selector */}
            <select 
              value={lang} 
              onChange={e=>setLang(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #d0d7e0',
                backgroundColor: 'white',
                color: '#1a1d23',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              <option value="es">ES</option>
              <option value="en">EN</option>
            </select>

            {/* Logout Button */}
            <button 
              onClick={logout}
              className="btn ghost"
              style={{
                padding: '8px 12px',
                fontSize: '12px'
              }}
            >
              {t('logout') || 'Logout'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div style={{
        flex: 1,
        padding: '24px',
        maxWidth: '1400px',
        width: '100%',
        margin: '0 auto'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '24px',
          '@media (max-width: 768px)': {
            gridTemplateColumns: '1fr'
          }
        }}>
          {/* Left Panel - Campaign Selection */}
          <div className="card">
            <h3 style={{marginTop: 0, marginBottom: '16px'}}>
              📋 {t('campaigns')}
            </h3>
            
            <div style={{marginBottom: '16px'}}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: '#1a1d23',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                {t('selectCampaign')}
              </label>
              <select 
                onChange={e=>setSelectedCampaign(e.target.value)} 
                value={selectedCampaign||''}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #d0d7e0',
                  fontSize: '14px',
                  fontFamily: 'inherit'
                }}
              >
                <option value="">{t('selectCampaign')}</option>
                {campaigns.map(c=>(<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </div>

            {/* Control Buttons */}
            <div style={{display: 'flex', gap: '12px', flexDirection: 'column'}}>
              <button 
                className="btn primary"
                onClick={ready}
                disabled={loading || agentState === 'ready'}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontWeight: '700',
                  fontSize: '15px'
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.98 19.98 0 0 1-6-6 19.86 19.86 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                {t('ready')}
              </button>
              <button 
                className="btn secondary"
                onClick={callNext}
                disabled={loading || !selectedCampaign || agentState === 'on_call'}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontWeight: '700',
                  fontSize: '15px'
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 16.5v2.25A2.25 2.25 0 0 0 16.25 21h1.5A2.25 2.25 0 0 0 20 18.75v-4.5M9 9h6m-6 0V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3m0 0v3" />
                </svg>
                {t('callNext')}
              </button>
            </div>

            {/* Campaign Info (if selected) */}
            {selectedCampaign && campaigns.find(c=>c.id==selectedCampaign) && (
              <div style={{
                marginTop: '20px',
                padding: '16px',
                background: 'rgba(199,255,99,0.1)',
                borderRadius: '8px',
                border: '1px solid rgba(199,255,99,0.3)'
              }}>
                <h4 style={{margin: 0, marginBottom: '8px', color: '#2a0066', fontSize: '12px'}}>
                  CAMPAIGN INFO
                </h4>
                <p style={{margin: 0, fontSize: '13px', color: '#1a1d23'}}>
                  <strong>{campaigns.find(c=>c.id==selectedCampaign)?.name}</strong>
                </p>
              </div>
            )}
          </div>

          {/* Right Panel - Current Lead & Controls */}
          <div className="card">
            <h3 style={{marginTop: 0, marginBottom: '16px'}}>
              👤 {t('currentLead') || 'Current Lead'}
            </h3>

            {lead ? (
              <div style={{
                padding: '20px',
                background: 'linear-gradient(135deg, rgba(199,255,99,0.1) 0%, rgba(128,0,255,0.05) 100%)',
                borderRadius: '12px',
                border: '2px solid rgba(199,255,99,0.3)',
                marginBottom: '16px'
              }}>
                <div style={{fontSize: '16px', fontWeight: '700', color: '#2a0066', marginBottom: '8px'}}>
                  {lead.full_name}
                </div>
                <div style={{fontSize: '14px', color: '#1a1d23', marginBottom: '4px'}}>
                  <strong>☎️ Phone:</strong> {lead.phone_e164}
                </div>
                <div style={{fontSize: '14px', color: '#1a1d23'}}>
                  <strong>📧 Email:</strong> {lead.email}
                </div>
              </div>
            ) : (
              <div style={{
                padding: '20px',
                textAlign: 'center',
                color: '#7a8096',
                background: 'rgba(122,128,150,0.05)',
                borderRadius: '8px',
                marginBottom: '16px'
              }}>
                {agentState === 'ready' ? t('noActiveLead') : 'Set READY to receive leads'}
              </div>
            )}

            {/* Call Controls */}
            <div style={{display: 'flex', gap: '12px', flexDirection: 'column'}}>
              <button 
                className="btn danger"
                onClick={hangup}
                disabled={agentState === 'idle' || agentState === 'wrapup'}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontWeight: '700',
                  fontSize: '15px'
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.98 19.98 0 0 1-6-6 19.86 19.86 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                {t('hangup')}
              </button>

              <button 
                className={`btn ${muted ? 'primary' : 'ghost'}`}
                onClick={toggleMute}
                disabled={agentState !== 'on_call'}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontWeight: '700',
                  fontSize: '15px'
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {muted ? (
                    <path d="M1 1l22 22M9 9v6a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                  ) : (
                    <>
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2m14 0a9 9 0 0 1-18 0v-2h18v2z" />
                    </>
                  )}
                </svg>
                {muted ? '🔇 Unmute' : '🎤 Mute'}
              </button>
            </div>

            {/* Disposition Section */}
            {agentState === 'wrapup' && (
              <div style={{
                marginTop: '16px',
                padding: '16px',
                background: 'rgba(59,130,246,0.05)',
                borderRadius: '8px',
                border: '1px solid rgba(59,130,246,0.2)'
              }}>
                <h4 style={{margin: 0, marginBottom: '12px', color: '#2a0066'}}>
                  ✓ Complete Call
                </h4>
                <select style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #d0d7e0',
                  fontSize: '14px',
                  marginBottom: '12px'
                }}>
                  <option>Select disposition...</option>
                  <option>✓ Interesado</option>
                  <option>✗ No contesta</option>
                  <option>📅 Agendar cita</option>
                  <option>⏸ Otro</option>
                </select>
                <button className="btn primary" style={{width: '100%'}}>
                  Save & Ready
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}
