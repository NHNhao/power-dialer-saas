import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../context/AuthContext'
import * as Api from '../lib/api'

export default function Campaigns() {
  const router = useRouter()
  const auth = useAuth()
  const [campaigns, setCampaigns] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState(null)
  const [loading, setLoading] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    status: 'draft',
    start_date: '',
    end_date: '',
    call_hours_start: '09:00',
    call_hours_end: '18:00',
    max_attempts: 3,
    retry_delay_minutes: 60,
    dialing_ratio: 1,
    script: ''
  })

  useEffect(() => {
    if (!auth.token) return router.push('/')
    loadCampaigns()
  }, [auth.token])

  async function loadCampaigns() {
    setLoading(true)
    try {
      const r = await Api.getCampaigns(auth.token)
      if (r.ok) {
        setCampaigns(r.campaigns || [])
      } else if (r.error === 'invalid_token' || r.error === 'missing_token') {
        auth.logout()
        router.push('/')
      }
    } catch (e) {
      console.error('Error loading campaigns:', e)
      auth.logout()
      router.push('/')
    } finally {
      setLoading(false)
    }
  }

  function openCreateModal() {
    setSelectedCampaign(null)
    setFormData({
      name: '',
      description: '',
      status: 'draft',
      start_date: '',
      end_date: '',
      call_hours_start: '09:00',
      call_hours_end: '18:00',
      max_attempts: 3,
      retry_delay_minutes: 60,
      dialing_ratio: 1,
      script: ''
    })
    setShowModal(true)
  }

  function openEditModal(campaign) {
    setSelectedCampaign(campaign)
    setFormData({
      name: campaign.name || '',
      description: campaign.description || '',
      status: campaign.status || 'draft',
      start_date: campaign.start_date || '',
      end_date: campaign.end_date || '',
      call_hours_start: campaign.call_hours_start || '09:00',
      call_hours_end: campaign.call_hours_end || '18:00',
      max_attempts: campaign.max_attempts || 3,
      retry_delay_minutes: campaign.retry_delay_minutes || 60,
      dialing_ratio: campaign.dialing_ratio || 1,
      script: campaign.script || ''
    })
    setShowModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      let result
      if (selectedCampaign) {
        result = await Api.updateCampaign(auth.token, selectedCampaign.id, formData)
      } else {
        result = await Api.createCampaign(auth.token, formData)
      }
      
      if (result.ok) {
        setShowModal(false)
        loadCampaigns()
      } else {
        alert('Error: ' + (result.error || 'unknown'))
      }
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUploadLeads(campaignId) {
    if (!uploadFile) {
      alert('Por favor selecciona un archivo CSV o XLSX')
      return
    }

    setLoading(true)
    try {
      const result = await Api.uploadLeads(auth.token, campaignId, uploadFile)
      if (result.ok) {
        alert(`${result.imported || 0} contactos importados exitosamente`)
        setUploadFile(null)
        loadCampaigns()
      } else {
        alert('Error: ' + (result.error || 'unknown'))
      }
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteCampaign(id) {
    if (!confirm('¿Estás seguro de eliminar esta campaña?')) return
    
    setLoading(true)
    try {
      const result = await Api.deleteCampaign(auth.token, id)
      if (result.ok) {
        loadCampaigns()
      } else {
        alert('Error: ' + (result.error || 'unknown'))
      }
    } catch (e) {
      alert('Error: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleInputChange(e) {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  function goToAgent() {
    router.push('/agent')
  }

  function logout() {
    auth.setToken(null)
    auth.setUser(null)
    router.push('/')
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <header>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>Power Dialer - Campañas</h1>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <span className="muted">{auth.user?.name || auth.user?.email}</span>
            <button className="btn ghost" onClick={goToAgent}>Panel Agente</button>
            <button className="btn ghost" onClick={logout}>Cerrar Sesión</button>
          </div>
        </div>
      </header>

      <main className="container" style={{ paddingTop: '40px', paddingBottom: '80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <h2>Gestión de Campañas</h2>
          <button className="btn primary" onClick={openCreateModal} disabled={loading}>
            + Nueva Campaña
          </button>
        </div>

        {loading && campaigns.length === 0 ? (
          <div className="card text-center" style={{ padding: '60px' }}>
            <p className="muted">Cargando campañas...</p>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="card text-center" style={{ padding: '60px' }}>
            <h3>No hay campañas creadas</h3>
            <p className="muted mt-8">Crea tu primera campaña para empezar a gestionar tus contactos</p>
            <button className="btn primary mt-24" onClick={openCreateModal}>
              Crear Primera Campaña
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '24px' }}>
            {campaigns.map(campaign => (
              <CampaignCard 
                key={campaign.id} 
                campaign={campaign}
                onEdit={() => openEditModal(campaign)}
                onDelete={() => handleDeleteCampaign(campaign.id)}
                onUpload={(file) => {
                  setUploadFile(file)
                  handleUploadLeads(campaign.id)
                }}
                loading={loading}
              />
            ))}
          </div>
        )}
      </main>

      {showModal && (
        <Modal onClose={() => setShowModal(false)}>
          <h2>{selectedCampaign ? 'Editar Campaña' : 'Nueva Campaña'}</h2>
          <form onSubmit={handleSubmit} style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                  Nombre de la Campaña *
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="Ej: Campaña Ventas Q1 2026"
                  required
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                  Descripción/Objetivo
                </label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="Describe el objetivo de esta campaña..."
                  rows="3"
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                    Estado
                  </label>
                  <select
                    name="status"
                    value={formData.status}
                    onChange={handleInputChange}
                    style={{ width: '100%' }}
                  >
                    <option value="draft">Borrador</option>
                    <option value="active">Activa</option>
                    <option value="paused">Pausada</option>
                    <option value="completed">Completada</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                    Ratio de Marcación
                  </label>
                  <input
                    type="number"
                    name="dialing_ratio"
                    value={formData.dialing_ratio}
                    onChange={handleInputChange}
                    min="1"
                    max="10"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                    Fecha Inicio
                  </label>
                  <input
                    type="date"
                    name="start_date"
                    value={formData.start_date}
                    onChange={handleInputChange}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                    Fecha Fin
                  </label>
                  <input
                    type="date"
                    name="end_date"
                    value={formData.end_date}
                    onChange={handleInputChange}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                    Hora Inicio Llamadas
                  </label>
                  <input
                    type="time"
                    name="call_hours_start"
                    value={formData.call_hours_start}
                    onChange={handleInputChange}
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                    Hora Fin Llamadas
                  </label>
                  <input
                    type="time"
                    name="call_hours_end"
                    value={formData.call_hours_end}
                    onChange={handleInputChange}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                    Intentos Máximos
                  </label>
                  <input
                    type="number"
                    name="max_attempts"
                    value={formData.max_attempts}
                    onChange={handleInputChange}
                    min="1"
                    max="10"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                    Reintento (minutos)
                  </label>
                  <input
                    type="number"
                    name="retry_delay_minutes"
                    value={formData.retry_delay_minutes}
                    onChange={handleInputChange}
                    min="5"
                    max="1440"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                  Script de Llamada
                </label>
                <textarea
                  name="script"
                  value={formData.script}
                  onChange={handleInputChange}
                  placeholder="Escribe el guión que los agentes seguirán durante las llamadas..."
                  rows="6"
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
                <button type="button" className="btn ghost" onClick={() => setShowModal(false)} disabled={loading}>
                  Cancelar
                </button>
                <button type="submit" className="btn primary" disabled={loading}>
                  {loading ? 'Guardando...' : (selectedCampaign ? 'Actualizar' : 'Crear Campaña')}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function CampaignCard({ campaign, onEdit, onDelete, onUpload, loading }) {
  const [showUpload, setShowUpload] = useState(false)
  const [file, setFile] = useState(null)

  const statusColors = {
    draft: '#7a8096',
    active: '#10b981',
    paused: '#f59e0b',
    completed: '#6366f1'
  }

  const statusLabels = {
    draft: 'Borrador',
    active: 'Activa',
    paused: 'Pausada',
    completed: 'Completada'
  }

  function handleFileChange(e) {
    const selectedFile = e.target.files[0]
    if (selectedFile) {
      const ext = selectedFile.name.split('.').pop().toLowerCase()
      if (ext !== 'csv' && ext !== 'xlsx') {
        alert('Por favor selecciona un archivo CSV o XLSX')
        return
      }
      setFile(selectedFile)
    }
  }

  function handleUpload() {
    if (file) {
      onUpload(file)
      setFile(null)
      setShowUpload(false)
    }
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ marginBottom: '8px' }}>{campaign.name}</h3>
          <span 
            className="badge" 
            style={{ 
              background: statusColors[campaign.status] || '#7a8096',
              color: 'white'
            }}
          >
            {statusLabels[campaign.status] || campaign.status}
          </span>
        </div>
      </div>

      {campaign.description && (
        <p className="muted text-small" style={{ marginBottom: '16px' }}>
          {campaign.description}
        </p>
      )}

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr', 
        gap: '12px',
        padding: '16px',
        background: 'var(--bg)',
        borderRadius: '8px',
        marginBottom: '16px'
      }}>
        <div>
          <div className="text-small muted">Total Leads</div>
          <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--deep)' }}>
            {campaign.total_leads || 0}
          </div>
        </div>
        <div>
          <div className="text-small muted">Contactados</div>
          <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--primary)' }}>
            {campaign.contacted || 0}
          </div>
        </div>
        <div>
          <div className="text-small muted">Pendientes</div>
          <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--muted)' }}>
            {campaign.pending || 0}
          </div>
        </div>
        <div>
          <div className="text-small muted">Tasa Éxito</div>
          <div style={{ fontSize: '20px', fontWeight: '700', color: '#10b981' }}>
            {campaign.success_rate || '0%'}
          </div>
        </div>
      </div>

      {showUpload ? (
        <div style={{ marginBottom: '16px', padding: '16px', background: 'var(--bg)', borderRadius: '8px' }}>
          <h4 style={{ marginBottom: '12px' }}>Subir Contactos</h4>
          <input 
            type="file" 
            accept=".csv,.xlsx" 
            onChange={handleFileChange}
            style={{ marginBottom: '12px', display: 'block', width: '100%' }}
          />
          {file && (
            <p className="text-small muted">Archivo: {file.name}</p>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button 
              className="btn secondary" 
              onClick={handleUpload} 
              disabled={!file || loading}
              style={{ flex: 1 }}
            >
              Importar
            </button>
            <button 
              className="btn ghost" 
              onClick={() => { setShowUpload(false); setFile(null); }}
              disabled={loading}
              style={{ flex: 1 }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button 
          className="btn secondary" 
          onClick={() => setShowUpload(true)}
          disabled={loading}
          style={{ marginBottom: '12px' }}
        >
          Subir Contactos
        </button>
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
        <button className="btn ghost" onClick={onEdit} disabled={loading} style={{ flex: 1 }}>
          Editar
        </button>
        <button className="btn danger" onClick={onDelete} disabled={loading} style={{ flex: 1 }}>
          Eliminar
        </button>
      </div>

      <p className="text-small muted mt-16">
        Creada: {new Date(campaign.created_at).toLocaleDateString()}
      </p>
    </div>
  )
}

function Modal({ children, onClose }) {
  return (
    <div 
      style={{ 
        position: 'fixed', 
        top: 0, 
        left: 0, 
        right: 0, 
        bottom: 0, 
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div 
        className="card"
        style={{ 
          maxWidth: '700px', 
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '32px'
        }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
