import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../context/AuthContext'

export default function AdminDashboard() {
  const router = useRouter()
  const auth = useAuth()
  const [tenant, setTenant] = useState(null)
  const [agents, setAgents] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [showCreateCampaign, setShowCreateCampaign] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [newCampaignName, setNewCampaignName] = useState('')
  const [newCampaignDescription, setNewCampaignDescription] = useState('')
  const [newCampaignScript, setNewCampaignScript] = useState('')
  const [newCampaignStatus, setNewCampaignStatus] = useState('draft')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedCampaign, setSelectedCampaign] = useState(null)
  const [showCampaignDetails, setShowCampaignDetails] = useState(false)
  const [editingCampaign, setEditingCampaign] = useState(null)
  const [showEditCampaign, setShowEditCampaign] = useState(false)
  const [editCampaignName, setEditCampaignName] = useState('')
  const [editCampaignDescription, setEditCampaignDescription] = useState('')
  const [editCampaignScript, setEditCampaignScript] = useState('')
  const [editCampaignStatus, setEditCampaignStatus] = useState('')
  const [showAgentCredentials, setShowAgentCredentials] = useState(false)
  const [createdAgent, setCreatedAgent] = useState(null)

  useEffect(() => {
    // Verificar que está autenticado y es admin
    if (!auth.token) {
      router.push('/')
      return
    }

    if (auth.user?.role !== 'admin') {
      router.push('/agent')
      return
    }

    // Cargar datos
    loadAdminData()
  }, [auth.token, auth.user])

  async function loadAdminData() {
    try {
      setLoading(true)
      setError('')

      // Obtener información de agentes
      const res = await fetch('http://localhost:3001/admin/agents', {
        headers: { Authorization: 'Bearer ' + auth.token }
      })
      const data = await res.json()

      if (data.ok) {
        setAgents(data.agents || [])
        
      } else {
        setError(data.error)
      }

      // Obtener campañas
      const campaignsRes = await fetch('http://localhost:3001/admin/campaigns', {
        headers: { Authorization: 'Bearer ' + auth.token }
      })
      const campaignsData = await campaignsRes.json()

      if (campaignsData.ok) {
        setCampaigns(campaignsData.campaigns || [])
      }
    } catch (e) {
      setError('Error al cargar datos: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateAgent(e) {
    e.preventDefault()
    setError('')

    if (!newAgentName.trim()) {
      setError('El nombre del agente es requerido')
      return
    }

    try {
      const res = await fetch('http://localhost:3001/admin/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + auth.token
        },
        body: JSON.stringify({
          name: newAgentName
        })
      })

      const data = await res.json()
      if (data.ok) {
        setCreatedAgent(data.agent)
        setShowAgentCredentials(true)
        setNewAgentName('')
        setShowCreateAgent(false)
        loadAdminData()
      } else {
        setError(data.error || 'Error al crear agente')
      }
    } catch (e) {
      setError('Error: ' + e.message)
    }
  }

  async function handleToggleAgent(agentId, newStatus) {
    try {
      const res = await fetch(`http://localhost:3001/admin/agents/${agentId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + auth.token
        },
        body: JSON.stringify({ status: newStatus })
      })

      const data = await res.json()
      if (data.ok) {
        loadAdminData()
      } else {
        setError(data.error)
      }
    } catch (e) {
      setError('Error: ' + e.message)
    }
  }

  async function handleCreateCampaign(e) {
    e.preventDefault()
    setError('')

    try {
      const res = await fetch('http://localhost:3001/admin/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + auth.token
        },
        body: JSON.stringify({
          name: newCampaignName,
          description: newCampaignDescription,
          script: newCampaignScript,
          status: newCampaignStatus
        })
      })

      const data = await res.json()
      if (data.ok) {
        setNewCampaignName('')
        setNewCampaignDescription('')
        setNewCampaignScript('')
        setNewCampaignStatus('draft')
        setShowCreateCampaign(false)
        loadAdminData()
      } else {
        setError(data.error || 'Error al crear campaña')
      }
    } catch (e) {
      setError('Error: ' + e.message)
    }
  }

  function handleSelectCampaign(campaign) {
    setSelectedCampaign(campaign)
    setShowCampaignDetails(true)
  }

  function handleEditCampaign(campaign) {
    setEditingCampaign(campaign)
    setEditCampaignName(campaign.name)
    setEditCampaignDescription(campaign.description || '')
    setEditCampaignScript(campaign.script || '')
    setEditCampaignStatus(campaign.status)
    setShowEditCampaign(true)
  }

  async function handleSaveEditCampaign() {
    if (!editingCampaign) return
    setError('')

    try {
      const res = await fetch(`http://localhost:3001/admin/campaigns/${editingCampaign.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + auth.token
        },
        body: JSON.stringify({
          name: editCampaignName,
          description: editCampaignDescription,
          script: editCampaignScript,
          status: editCampaignStatus
        })
      })

      const data = await res.json()
      if (data.ok) {
        setEditingCampaign(null)
        setShowEditCampaign(false)
        loadAdminData()
      } else {
        setError(data.error || 'Error al actualizar campaña')
      }
    } catch (e) {
      setError('Error: ' + e.message)
    }
  }

  if (loading) {
    return <div style={{padding: '20px', textAlign: 'center'}}>Cargando...</div>
  }

  return (
    <div style={{minHeight: '100vh', background: '#f5f5f5', padding: '20px'}}>
      <div style={{maxWidth: '1200px', margin: '0 auto'}}>
        {/* Header */}
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px'}}>
          <div>
            <h1 style={{margin: 0, color: '#2a0066'}}>Dashboard Administrador</h1>
            <p style={{color: '#666', marginTop: '5px'}}>Usuario: {auth.user?.username}</p>
          </div>
          <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
            <button
              onClick={() => router.push('/admin-settings')}
              style={{
                padding: '10px 20px',
                background: '#8000ff',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              ⚙️ Settings
            </button>
            <button
              onClick={() => {
                auth.logout()
                router.push('/')
              }}
              style={{
                padding: '10px 20px',
                background: '#d32f2f',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              Logout
            </button>
          </div>
        </div>

        {error && (
          <div style={{background: '#ffebee', color: '#c62828', padding: '15px', borderRadius: '8px', marginBottom: '20px'}}>
            {error}
          </div>
        )}

        {/* Main Content Grid */}
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px'}}>
          {/* Card: Info Empresa */}
          <div style={{background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)'}}>
            <h2 style={{margin: '0 0 15px 0', color: '#2a0066'}}>{auth.user?.tenant_name || 'Mi Empresa'}</h2>
            <p style={{color: '#666', fontSize: '14px', margin: 0}}>Administrador: {auth.user?.name}</p>
          </div>

          {/* Card: Quick Stats */}
          <div style={{background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)'}}>
            <h2 style={{margin: '0 0 15px 0', color: '#2a0066'}}>Estadísticas</h2>
            <p><strong>Total de Agentes:</strong> {agents.length}</p>
            <p><strong>Agentes Activos:</strong> {agents.filter(a => a.status === 'active').length}</p>
            <p><strong>Agentes Inactivos:</strong> {agents.filter(a => a.status !== 'active').length}</p>
          </div>
        </div>

        {/* Campaigns Section */}
        <div style={{background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', marginBottom: '30px'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
            <h2 style={{margin: 0, color: '#2a0066'}}>Campañas</h2>
            <button
              onClick={() => setShowCreateCampaign(!showCreateCampaign)}
              style={{
                padding: '10px 20px',
                background: '#8000ff',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              {showCreateCampaign ? 'Cancelar' : '+ Crear Campaña'}
            </button>
          </div>

          {/* Create Campaign Form */}
          {showCreateCampaign && (
            <form onSubmit={handleCreateCampaign} style={{
              background: '#f9f9f9',
              padding: '20px',
              borderRadius: '8px',
              marginBottom: '20px',
              border: '1px solid #e0e0e0'
            }}>
              <h3>Crear Nueva Campaña</h3>
              <div style={{marginBottom: '15px'}}>
                <input
                  type="text"
                  placeholder="Nombre de la Campaña"
                  value={newCampaignName}
                  onChange={e => setNewCampaignName(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontFamily: 'inherit',
                    marginBottom: '10px'
                  }}
                />
                <select
                  value={newCampaignStatus}
                  onChange={e => setNewCampaignStatus(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontFamily: 'inherit',
                    marginBottom: '10px',
                    background: 'white'
                  }}
                >
                  <option value="draft">Draft (Borrador)</option>
                  <option value="active">Activa</option>
                </select>
                <textarea
                  placeholder="Descripción de la campaña"
                  value={newCampaignDescription}
                  onChange={e => setNewCampaignDescription(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontFamily: 'inherit',
                    marginBottom: '10px',
                    minHeight: '80px'
                  }}
                />
                <textarea
                  placeholder="Script de la campaña"
                  value={newCampaignScript}
                  onChange={e => setNewCampaignScript(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontFamily: 'inherit',
                    minHeight: '100px'
                  }}
                />
              </div>
              <button
                type="submit"
                style={{
                  padding: '10px 20px',
                  background: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                Crear Campaña
              </button>
            </form>
          )}

          {/* Campaigns List */}
          {campaigns.length === 0 ? (
            <p style={{color: '#999', fontStyle: 'italic'}}>No hay campañas creadas aún</p>
          ) : (
            <table style={{width: '100%', borderCollapse: 'collapse'}}>
              <thead>
                <tr style={{borderBottom: '2px solid #e0e0e0'}}>
                  <th style={{textAlign: 'left', padding: '12px', fontWeight: '600'}}>Nombre</th>
                  <th style={{textAlign: 'left', padding: '12px', fontWeight: '600'}}>Estado</th>
                  <th style={{textAlign: 'left', padding: '12px', fontWeight: '600'}}>Creada</th>
                  <th style={{textAlign: 'center', padding: '12px', fontWeight: '600'}}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map(campaign => (
                  <tr key={campaign.id} style={{borderBottom: '1px solid #e0e0e0'}}>
                    <td style={{padding: '12px', cursor: 'pointer', color: '#2a0066', fontWeight: '500'}} onClick={() => handleSelectCampaign(campaign)}>
                      {campaign.name}
                    </td>
                    <td style={{padding: '12px'}}>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: '600',
                        background: campaign.status === 'active' ? '#e8f5e9' : 
                                   campaign.status === 'draft' ? '#fff3e0' :
                                   campaign.status === 'paused' ? '#fce4ec' : '#f3e5f5',
                        color: campaign.status === 'active' ? '#2e7d32' : 
                               campaign.status === 'draft' ? '#e65100' :
                               campaign.status === 'paused' ? '#c2185b' : '#6a1b9a'
                      }}>
                        {campaign.status === 'active' ? 'Activa' : 
                         campaign.status === 'draft' ? 'Borrador' : 
                         campaign.status === 'paused' ? 'Pausada' : 'Completada'}
                      </span>
                    </td>
                    <td style={{padding: '12px', fontSize: '12px', color: '#666'}}>
                      {new Date(campaign.created_at).toLocaleDateString('es-ES')}
                    </td>
                    <td style={{padding: '12px', textAlign: 'center'}}>
                      <button
                        onClick={() => handleSelectCampaign(campaign)}
                        style={{
                          padding: '6px 12px',
                          background: '#2196F3',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          marginRight: '8px'
                        }}
                      >
                        Ver
                      </button>
                      <button
                        onClick={() => handleEditCampaign(campaign)}
                        style={{
                          padding: '6px 12px',
                          background: '#FF9800',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Agents Section */}
        <div style={{background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
            <h2 style={{margin: 0, color: '#2a0066'}}>Agentes</h2>
            <button
              onClick={() => setShowCreateAgent(!showCreateAgent)}
              style={{
                padding: '10px 20px',
                background: '#8000ff',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              {showCreateAgent ? 'Cancelar' : '+ Crear Agente'}
            </button>
          </div>

          {/* Create Agent Form */}
          {showCreateAgent && (
            <form onSubmit={handleCreateAgent} style={{
              background: '#f9f9f9',
              padding: '20px',
              borderRadius: '8px',
              marginBottom: '20px',
              border: '1px solid #e0e0e0'
            }}>
              <h3>Crear Nuevo Agente</h3>
              <p style={{color: '#666', fontSize: '14px', marginBottom: '15px'}}>
                Ingresa solo el nombre del agente. El usuario y contraseña se generarán automáticamente.
              </p>
              <div style={{marginBottom: '15px'}}>
                <input
                  type="text"
                  placeholder="Nombre del Agente"
                  value={newAgentName}
                  onChange={e => setNewAgentName(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    fontFamily: 'inherit'
                  }}
                />
              </div>
              <button
                type="submit"
                style={{
                  padding: '10px 20px',
                  background: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                Crear Agente
              </button>
            </form>
          )}

          {/* Agents List */}
          {agents.length === 0 ? (
            <p style={{color: '#999', fontStyle: 'italic'}}>No hay agentes creados aún</p>
          ) : (
            <table style={{width: '100%', borderCollapse: 'collapse'}}>
              <thead>
                <tr style={{borderBottom: '2px solid #e0e0e0'}}>
                  <th style={{textAlign: 'left', padding: '12px', fontWeight: '600'}}>Nombre</th>
                  <th style={{textAlign: 'left', padding: '12px', fontWeight: '600'}}>Usuario</th>
                  <th style={{textAlign: 'left', padding: '12px', fontWeight: '600'}}>Estado</th>
                  <th style={{textAlign: 'center', padding: '12px', fontWeight: '600'}}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(agent => (
                  <tr key={agent.id} style={{borderBottom: '1px solid #e0e0e0'}}>
                    <td style={{padding: '12px'}}>{agent.name}</td>
                    <td style={{padding: '12px'}}>{agent.username}</td>
                    <td style={{padding: '12px'}}>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: '600',
                        background: agent.status === 'active' ? '#e8f5e9' : '#ffebee',
                        color: agent.status === 'active' ? '#2e7d32' : '#c62828'
                      }}>
                        {agent.status}
                      </span>
                    </td>
                    <td style={{padding: '12px', textAlign: 'center'}}>
                      <button
                        onClick={() => handleToggleAgent(agent.id, agent.status === 'active' ? 'inactive' : 'active')}
                        style={{
                          padding: '6px 12px',
                          background: agent.status === 'active' ? '#d32f2f' : '#4caf50',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        {agent.status === 'active' ? 'Desactivar' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Modal: Ver Detalles de Campaña */}
        {showCampaignDetails && selectedCampaign && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              background: 'white',
              padding: '30px',
              borderRadius: '12px',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto'
            }}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
                <h2 style={{margin: 0, color: '#2a0066'}}>{selectedCampaign.name}</h2>
                <button
                  onClick={() => {setShowCampaignDetails(false); setSelectedCampaign(null)}}
                  style={{
                    background: '#f0f0f0',
                    border: 'none',
                    borderRadius: '50%',
                    width: '30px',
                    height: '30px',
                    cursor: 'pointer',
                    fontSize: '18px'
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{marginBottom: '20px'}}>
                <label style={{display: 'block', fontWeight: '600', marginBottom: '8px', color: '#333'}}>Estado:</label>
                <span style={{
                  padding: '6px 12px',
                  borderRadius: '20px',
                  fontSize: '14px',
                  fontWeight: '600',
                  background: selectedCampaign.status === 'active' ? '#e8f5e9' : 
                             selectedCampaign.status === 'draft' ? '#fff3e0' :
                             selectedCampaign.status === 'paused' ? '#fce4ec' : '#f3e5f5',
                  color: selectedCampaign.status === 'active' ? '#2e7d32' : 
                         selectedCampaign.status === 'draft' ? '#e65100' :
                         selectedCampaign.status === 'paused' ? '#c2185b' : '#6a1b9a'
                }}>
                  {selectedCampaign.status === 'active' ? 'Activa' : 
                   selectedCampaign.status === 'draft' ? 'Borrador' : 
                   selectedCampaign.status === 'paused' ? 'Pausada' : 'Completada'}
                </span>
              </div>

              {selectedCampaign.description && (
                <div style={{marginBottom: '20px'}}>
                  <label style={{display: 'block', fontWeight: '600', marginBottom: '8px', color: '#333'}}>Descripción:</label>
                  <p style={{margin: 0, color: '#666', lineHeight: '1.6'}}>{selectedCampaign.description}</p>
                </div>
              )}

              {selectedCampaign.script && (
                <div style={{marginBottom: '20px'}}>
                  <label style={{display: 'block', fontWeight: '600', marginBottom: '8px', color: '#333'}}>Script:</label>
                  <pre style={{
                    background: '#f5f5f5',
                    padding: '12px',
                    borderRadius: '6px',
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word',
                    margin: 0,
                    color: '#333'
                  }}>
                    {selectedCampaign.script}
                  </pre>
                </div>
              )}

              <div style={{marginBottom: '20px', fontSize: '12px', color: '#999'}}>
                <p style={{margin: '5px 0'}}>Creada: {new Date(selectedCampaign.created_at).toLocaleString('es-ES')}</p>
                {selectedCampaign.updated_at && <p style={{margin: '5px 0'}}>Actualizada: {new Date(selectedCampaign.updated_at).toLocaleString('es-ES')}</p>}
              </div>

              <div style={{display: 'flex', gap: '10px'}}>
                <button
                  onClick={() => {
                    setShowCampaignDetails(false)
                    setSelectedCampaign(null)
                    handleEditCampaign(selectedCampaign)
                  }}
                  style={{
                    flex: 1,
                    padding: '10px 20px',
                    background: '#FF9800',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  Editar
                </button>
                <button
                  onClick={() => {setShowCampaignDetails(false); setSelectedCampaign(null)}}
                  style={{
                    flex: 1,
                    padding: '10px 20px',
                    background: '#f0f0f0',
                    color: '#333',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Editar Campaña */}
        {showEditCampaign && editingCampaign && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              background: 'white',
              padding: '30px',
              borderRadius: '12px',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto'
            }}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
                <h2 style={{margin: 0, color: '#2a0066'}}>Editar Campaña</h2>
                <button
                  onClick={() => {setShowEditCampaign(false); setEditingCampaign(null)}}
                  style={{
                    background: '#f0f0f0',
                    border: 'none',
                    borderRadius: '50%',
                    width: '30px',
                    height: '30px',
                    cursor: 'pointer',
                    fontSize: '18px'
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{marginBottom: '15px'}}>
                <label style={{display: 'block', fontWeight: '600', marginBottom: '5px', color: '#333'}}>Nombre:</label>
                <input
                  type="text"
                  value={editCampaignName}
                  onChange={e => setEditCampaignName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{marginBottom: '15px'}}>
                <label style={{display: 'block', fontWeight: '600', marginBottom: '5px', color: '#333'}}>Estado:</label>
                <select
                  value={editCampaignStatus}
                  onChange={e => setEditCampaignStatus(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    boxSizing: 'border-box',
                    background: 'white'
                  }}
                >
                  <option value="draft">Borrador (Draft)</option>
                  <option value="active">Activa</option>
                  <option value="paused">Pausada</option>
                  <option value="completed">Completada</option>
                </select>
              </div>

              <div style={{marginBottom: '15px'}}>
                <label style={{display: 'block', fontWeight: '600', marginBottom: '5px', color: '#333'}}>Descripción:</label>
                <textarea
                  value={editCampaignDescription}
                  onChange={e => setEditCampaignDescription(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    boxSizing: 'border-box',
                    minHeight: '80px'
                  }}
                />
              </div>

              <div style={{marginBottom: '15px'}}>
                <label style={{display: 'block', fontWeight: '600', marginBottom: '5px', color: '#333'}}>Script:</label>
                <textarea
                  value={editCampaignScript}
                  onChange={e => setEditCampaignScript(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    boxSizing: 'border-box',
                    minHeight: '100px',
                    fontFamily: 'monospace'
                  }}
                />
              </div>

              {error && (
                <div style={{background: '#ffebee', color: '#c62828', padding: '10px', borderRadius: '6px', marginBottom: '15px', fontSize: '14px'}}>
                  {error}
                </div>
              )}

              <div style={{display: 'flex', gap: '10px'}}>
                <button
                  onClick={handleSaveEditCampaign}
                  style={{
                    flex: 1,
                    padding: '10px 20px',
                    background: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  Guardar Cambios
                </button>
                <button
                  onClick={() => {setShowEditCampaign(false); setEditingCampaign(null)}}
                  style={{
                    flex: 1,
                    padding: '10px 20px',
                    background: '#f0f0f0',
                    color: '#333',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Credenciales de Agente Creado */}
        {showAgentCredentials && createdAgent && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            padding: '20px',
            overflowY: 'auto'
          }}>
            <div style={{
              background: 'white',
              padding: '40px',
              borderRadius: '12px',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              maxHeight: '90vh',
              overflowY: 'auto',
              margin: 'auto'
            }}>
              <div style={{textAlign: 'center', marginBottom: '20px'}}>
                <div style={{fontSize: '48px', marginBottom: '10px'}}>✅</div>
                <h2 style={{margin: '0 0 10px 0', color: '#2e7d32'}}>¡Agente Creado!</h2>
                <p style={{color: '#666', margin: 0}}>Comparte estas credenciales con el agente</p>
              </div>

              <div style={{background: '#f5f5f5', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '2px solid #e0e0e0'}}>
                <div style={{marginBottom: '15px'}}>
                  <label style={{display: 'block', fontWeight: '600', color: '#333', marginBottom: '5px', fontSize: '12px'}}>
                    NOMBRE
                  </label>
                  <div style={{
                    padding: '12px',
                    background: 'white',
                    borderRadius: '6px',
                    border: '1px solid #ddd',
                    fontFamily: 'monospace',
                    fontSize: '16px',
                    color: '#2a0066',
                    fontWeight: '600'
                  }}>
                    {createdAgent.name}
                  </div>
                </div>

                <div style={{marginBottom: '15px'}}>
                  <label style={{display: 'block', fontWeight: '600', color: '#333', marginBottom: '5px', fontSize: '12px'}}>
                    USUARIO
                  </label>
                  <div style={{
                    padding: '12px',
                    background: 'white',
                    borderRadius: '6px',
                    border: '1px solid #ddd',
                    fontFamily: 'monospace',
                    fontSize: '16px',
                    color: '#2a0066',
                    fontWeight: '600',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <span style={{flex: 1, wordBreak: 'break-all'}}>{createdAgent.username}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        navigator.clipboard.writeText(createdAgent.username)
                        alert('Usuario copiado al portapapeles')
                      }}
                      style={{
                        background: '#8000ff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '6px 12px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '600',
                        flexShrink: 0
                      }}
                    >
                      Copiar
                    </button>
                  </div>
                </div>

                <div style={{marginBottom: '15px'}}>
                  <label style={{display: 'block', fontWeight: '600', color: '#333', marginBottom: '5px', fontSize: '12px'}}>
                    CONTRASEÑA
                  </label>
                  <div style={{
                    padding: '12px',
                    background: 'white',
                    borderRadius: '6px',
                    border: '1px solid #ddd',
                    fontFamily: 'monospace',
                    fontSize: '16px',
                    color: '#2a0066',
                    fontWeight: '600',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <span style={{flex: 1, wordBreak: 'break-all'}}>{createdAgent.generated_password}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        navigator.clipboard.writeText(createdAgent.generated_password)
                        alert('Contraseña copiada al portapapeles')
                      }}
                      style={{
                        background: '#8000ff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '6px 12px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '600',
                        flexShrink: 0
                      }}
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              </div>

              <div style={{background: '#fff3e0', padding: '15px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ffe0b2'}}>
                <p style={{margin: 0, color: '#e65100', fontSize: '13px', lineHeight: '1.5'}}>
                  <strong>⚠️ Importante:</strong> Asegúrate de compartir estas credenciales de forma segura. El agente puede cambiar su contraseña después de ingresar por primera vez.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {setShowAgentCredentials(false); setCreatedAgent(null)}}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '16px'
                }}
              >
                Entendido, Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
