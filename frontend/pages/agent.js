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
  const [queueWaiting, setQueueWaiting] = useState(0);
  
  // Polling para actualizar el contador de cola cada 5 segundos
  useEffect(() => {
    if (!selectedCampaign || !auth.token) return;
    
    const updateQueueStatus = async () => {
      try {
        const result = await Api.getQueueStatus(auth.token, selectedCampaign);
        if (result.ok) {
          setQueueWaiting(result.waiting || 0);
        }
      } catch (error) {
        console.error('Error actualizando cola:', error);
      }
    };
    
    updateQueueStatus();
    const interval = setInterval(updateQueueStatus, 5000);
    
    return () => clearInterval(interval);
  }, [selectedCampaign, auth.token]);

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
    if (loading) {
      console.log('⚠️ Ya hay una llamada en proceso, ignorando click');
      return;
    }
    
    setLoading(true);
    console.log('📞 Iniciando llamada única...');
    
    try {
      const j = await Api.dialerNextAndCall(auth.token, selectedCampaign);
      if (!j.ok) {
        alert('error: '+(j.error||'unknown'));
        return;
      }
      if (!j.next) {
        alert('No hay leads en cola');
        return;
      }
      setLead(j.next);
      setAgentState('on_call');
      console.log('✅ Llamada iniciada, Call SID:', j.call_sid);
    } catch (error) {
      console.error('❌ Error en llamada:', error);
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  async function callMultiple() {
    if (!selectedCampaign) return alert('Selecciona una campaña');
    if (loading) return;
    
    const count = prompt('¿Cuántas llamadas simultáneas? (1-10)', '3');
    if (!count) return;
    
    const num = parseInt(count);
    if (isNaN(num) || num < 1 || num > 10) return alert('Número inválido');
    
    setLoading(true);
    try {
      const promises = [];
      for (let i = 0; i < num; i++) {
        promises.push(Api.dialerNextAndCall(auth.token, selectedCampaign));
      }
      
      const results = await Promise.all(promises);
      const successful = results.filter(r => r.ok && r.next).length;
      
      alert(`${successful}/${num} llamadas iniciadas exitosamente`);
      console.log('Llamadas múltiples:', results);
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  async function resetTest() {
    if (!selectedCampaign) return alert('Selecciona una campaña');
    if (loading) return;
    
    if (!confirm('¿Resetear todos los contactos de esta campaña a estado "queued"?')) return;
    
    setLoading(true);
    try {
      const result = await Api.resetTestMode(auth.token, selectedCampaign);
      if (result.ok) {
        alert(`✅ ${result.reset_count} contactos reseteados. Ya puedes llamar de nuevo.`);
      } else {
        alert('Error: ' + (result.error || 'unknown'));
      }
    } catch (error) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  async function takeCallFromQueue() {
    if (!selectedCampaign) return alert('Selecciona una campaña');
    if (loading) return;
    
    if (queueWaiting === 0) {
      return alert('No hay llamadas en espera');
    }
    
    setLoading(true);
    console.log('📞 Tomando llamada de la cola...');
    
    try {
      const result = await Api.dequeueCall(auth.token, selectedCampaign);
      if (result.ok && result.dequeued) {
        alert(`✅ Llamada conectada! Call SID: ${result.call_sid}`);
        setAgentState('on_call');
        console.log('✅ Llamada tomada de la cola:', result);
      } else {
        alert(result.message || 'No hay llamadas disponibles');
      }
    } catch (error) {
      console.error('❌ Error tomando llamada:', error);
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  function hangup() {
    // Desconectar la llamada activa de Twilio
    if (connRef.current) {
      console.log('🔴 Colgando llamada activa...');
      connRef.current.disconnect();
      connRef.current = null;
    }
    
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

            {/* Campaign Manager Link */}
            <button 
              className="btn ghost"
              onClick={() => router.push('/campaigns')}
              style={{ fontSize: '13px' }}
            >
              Campañas
            </button>

            {/* Contacts Link */}
            <button 
              className="btn ghost"
              onClick={() => router.push('/contacts')}
              style={{ fontSize: '13px' }}
            >
              📇 Contactos
            </button>

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
              <button 
                className="btn"
                onClick={callMultiple}
                disabled={loading || !selectedCampaign}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontWeight: '700',
                  fontSize: '14px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  cursor: loading || !selectedCampaign ? 'not-allowed' : 'pointer',
                  opacity: loading || !selectedCampaign ? 0.5 : 1
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3h6l3 9-3 3a16 16 0 006 6l3-3 9 3v6a2 2 0 01-2 2A20 20 0 013 5a2 2 0 012-2z"/>
                  <path d="M15 9h6m-3-3v6"/>
                </svg>
                {t('callMultiple')}
              </button>
              <button 
                className="btn"
                onClick={resetTest}
                disabled={loading || !selectedCampaign}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontWeight: '700',
                  fontSize: '14px',
                  background: '#f59e0b',
                  color: 'white',
                  border: 'none',
                  cursor: loading || !selectedCampaign ? 'not-allowed' : 'pointer',
                  opacity: loading || !selectedCampaign ? 0.5 : 1
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
                {t('resetTestMode')}
              </button>
            </div>

            {/* Queue Status */}
            {selectedCampaign && (
              <div style={{
                marginTop: '20px',
                padding: '16px',
                background: queueWaiting > 0 ? 'rgba(199,255,99,0.2)' : 'rgba(128,0,255,0.05)',
                borderRadius: '8px',
                border: queueWaiting > 0 ? '2px solid #c7ff63' : '1px solid rgba(128,0,255,0.2)',
                animation: queueWaiting > 0 ? 'pulse 2s infinite' : 'none'
              }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  marginBottom: queueWaiting > 0 ? '12px' : '0'
                }}>
                  <div>
                    <h4 style={{margin: 0, fontSize: '12px', color: '#2a0066', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.5px'}}>
                      {queueWaiting > 0 ? '🔔 ' + t('peopleWaiting').toUpperCase() : '📞 ' + t('queueWaiting').toUpperCase()}
                    </h4>
                    <p style={{
                      margin: '4px 0 0 0', 
                      fontSize: queueWaiting > 0 ? '32px' : '18px', 
                      fontWeight: '700',
                      color: queueWaiting > 0 ? '#2a0066' : '#7a8096'
                    }}>
                      {queueWaiting}
                    </p>
                  </div>
                  {queueWaiting > 0 && (
                    <div style={{ fontSize: '48px' }}>🎵</div>
                  )}
                </div>
                
                {queueWaiting > 0 && (
                  <button 
                    className="btn"
                    onClick={takeCallFromQueue}
                    disabled={loading}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontWeight: '700',
                      fontSize: '14px',
                      background: 'linear-gradient(135deg, #c7ff63 0%, #8bc34a 100%)',
                      color: '#2a0066',
                      border: 'none',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      opacity: loading ? 0.5 : 1,
                      boxShadow: '0 4px 12px rgba(199,255,99,0.3)'
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.98 19.98 0 0 1-6-6 19.86 19.86 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    {t('takeCallFromQueue')}
                  </button>
                )}
              </div>
            )}

            {/* Campaign Info (if selected) */}
            {selectedCampaign && campaigns.find(c=>c.id==selectedCampaign) && (
              <div style={{
                marginTop: '20px',
                padding: '16px',
                background: 'rgba(199,255,99,0.1)',
                borderRadius: '8px',
                border: '1px solid rgba(199,255,99,0.3)'
              }}>
                <h4 style={{margin: 0, marginBottom: '8px', color: '#2a0066', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px'}}>
                  {t('campaignInfo')}
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
                marginBottom: '16px',
                fontSize: '14px'
              }}>
                {agentState === 'ready' ? t('noActiveLead') : t('setReadyToReceive')}
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
                  fontSize: '14px'
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
                  fontSize: '14px'
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {muted ? (
                    <>
                      <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                      <line x1="23" y1="9" x2="17" y2="15"/>
                      <line x1="17" y1="9" x2="23" y2="15"/>
                    </>
                  ) : (
                    <>
                      <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                    </>
                  )}
                </svg>
                {muted ? t('unmute') : t('mute')}
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
                <h4 style={{margin: 0, marginBottom: '12px', color: '#2a0066', fontSize: '14px', fontWeight: '700'}}>
                  ✓ {t('completeCall')}
                </h4>
                <select style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #d0d7e0',
                  fontSize: '14px',
                  marginBottom: '12px'
                }}>
                  <option>{t('selectDisposition')}</option>
                  <option>✓ {t('interested')}</option>
                  <option>✗ {t('noAnswer')}</option>
                  <option>📅 {t('scheduleAppointment')}</option>
                  <option>⏸ {t('other')}</option>
                </select>
                <button className="btn primary" style={{width: '100%', fontSize: '14px', padding: '12px', fontWeight: '700'}}>
                  {t('saveAndReady')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { 
            box-shadow: 0 0 0 0 rgba(199, 255, 99, 0.7);
          }
          50% { 
            box-shadow: 0 0 0 10px rgba(199, 255, 99, 0);
          }
        }
      `}</style>
    </div>
  )
}
