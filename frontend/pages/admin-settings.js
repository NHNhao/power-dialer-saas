import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../context/AuthContext'

export default function AdminSettings() {
  const router = useRouter()
  const auth = useAuth()
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  
  // Formulario 1: Editar perfil básico
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [username] = useState(auth.user?.username || '')
  
  // Formulario 2: Cambiar contraseña
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  
  // Verificación de email
  const [emailVerificationCode, setEmailVerificationCode] = useState('')
  const [showEmailVerification, setShowEmailVerification] = useState(false)
  const [newEmailPending, setNewEmailPending] = useState('')

  useEffect(() => {
    if (!auth.token || auth.user?.role !== 'admin') {
      router.push('/')
      return
    }
    
    // Cargar datos del usuario
    setName(auth.user?.name || '')
    setEmail(auth.user?.email || '')
    setLoading(false)
  }, [auth.token, auth.user])

  async function handleUpdateProfile(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!name.trim()) {
      setError('El nombre no puede estar vacío')
      return
    }

    try {
      const res = await fetch('http://localhost:3001/admin/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + auth.token
        },
        body: JSON.stringify({ name, email })
      })

      const data = await res.json()
      if (data.ok) {
        setSuccess('Perfil actualizado correctamente')
        // Actualizar el contexto de auth
        auth.user.name = name
        if (email !== auth.user.email) {
          setShowEmailVerification(true)
          setNewEmailPending(email)
        }
      } else {
        setError(data.error || 'Error al actualizar perfil')
      }
    } catch (e) {
      setError('Error de conexión: ' + e.message)
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Todos los campos son requeridos')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }

    if (newPassword.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }

    try {
      const res = await fetch('http://localhost:3001/admin/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + auth.token
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      })

      const data = await res.json()
      if (data.ok) {
        setSuccess('Contraseña cambiada correctamente')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setShowPasswordForm(false)
      } else {
        setError(data.error || 'Error al cambiar contraseña')
      }
    } catch (e) {
      setError('Error de conexión: ' + e.message)
    }
  }

  async function handleVerifyEmail(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!emailVerificationCode.trim()) {
      setError('Ingresa el código de verificación')
      return
    }

    try {
      const res = await fetch('http://localhost:3001/admin/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + auth.token
        },
        body: JSON.stringify({
          code: emailVerificationCode,
          new_email: newEmailPending
        })
      })

      const data = await res.json()
      if (data.ok) {
        setSuccess('Email verificado y actualizado correctamente')
        setShowEmailVerification(false)
        setEmailVerificationCode('')
        setNewEmailPending('')
        setEmail(newEmailPending)
        auth.user.email = newEmailPending
      } else {
        setError(data.error || 'Código de verificación inválido')
      }
    } catch (e) {
      setError('Error de conexión: ' + e.message)
    }
  }

  if (loading) {
    return <div style={{padding: '20px', textAlign: 'center'}}>Cargando...</div>
  }

  return (
    <div style={{minHeight: '100vh', background: '#f5f5f5', padding: '20px'}}>
      <div style={{maxWidth: '600px', margin: '0 auto'}}>
        {/* Header */}
        <div style={{marginBottom: '30px'}}>
          <button
            onClick={() => router.push('/admin-dashboard')}
            style={{
              padding: '8px 16px',
              background: '#666',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '600',
              marginBottom: '20px'
            }}
          >
            ← Volver al Dashboard
          </button>
          <h1 style={{margin: '0 0 10px 0', color: '#2a0066'}}>Configuración de Cuenta</h1>
          <p style={{color: '#666', margin: 0}}>Gestiona tu perfil y seguridad</p>
        </div>

        {error && (
          <div style={{background: '#ffebee', color: '#c62828', padding: '15px', borderRadius: '8px', marginBottom: '20px'}}>
            {error}
          </div>
        )}

        {success && (
          <div style={{background: '#e8f5e9', color: '#2e7d32', padding: '15px', borderRadius: '8px', marginBottom: '20px'}}>
            {success}
          </div>
        )}

        {/* Sección: Información Básica */}
        <div style={{background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', marginBottom: '20px'}}>
          <h2 style={{margin: '0 0 20px 0', color: '#2a0066'}}>Información de Cuenta</h2>
          
          <form onSubmit={handleUpdateProfile}>
            {/* Username (Read-only) */}
            <div style={{marginBottom: '15px'}}>
              <label style={{display: 'block', marginBottom: '5px', fontWeight: '600', color: '#333'}}>
                Usuario (no se puede cambiar)
              </label>
              <input
                type="text"
                value={username}
                disabled
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  background: '#f5f5f5',
                  color: '#666',
                  boxSizing: 'border-box',
                  cursor: 'not-allowed'
                }}
              />
            </div>

            {/* Name */}
            <div style={{marginBottom: '15px'}}>
              <label style={{display: 'block', marginBottom: '5px', fontWeight: '600', color: '#333'}}>
                Nombre Completo
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Email */}
            <div style={{marginBottom: '20px'}}>
              <label style={{display: 'block', marginBottom: '5px', fontWeight: '600', color: '#333'}}>
                Correo Electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  boxSizing: 'border-box'
                }}
              />
              <p style={{fontSize: '12px', color: '#999', margin: '5px 0 0 0'}}>
                Si cambias el email, deberás verificarlo
              </p>
            </div>

            <button
              type="submit"
              style={{
                width: '100%',
                padding: '10px',
                background: '#8000ff',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              Guardar Cambios
            </button>
          </form>
        </div>

        {/* Sección: Cambiar Contraseña */}
        <div style={{background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
            <h2 style={{margin: 0, color: '#2a0066'}}>Contraseña</h2>
            <button
              onClick={() => setShowPasswordForm(!showPasswordForm)}
              style={{
                padding: '8px 16px',
                background: showPasswordForm ? '#d32f2f' : '#8000ff',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '14px'
              }}
            >
              {showPasswordForm ? 'Cancelar' : 'Cambiar Contraseña'}
            </button>
          </div>

          {!showPasswordForm && (
            <p style={{color: '#666', margin: 0}}>
              Haz clic en "Cambiar Contraseña" para actualizar tu contraseña de acceso.
            </p>
          )}

          {showPasswordForm && (
            <form onSubmit={handleChangePassword}>
              <div style={{marginBottom: '15px'}}>
                <label style={{display: 'block', marginBottom: '5px', fontWeight: '600', color: '#333'}}>
                  Contraseña Actual
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Ingresa tu contraseña actual"
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
                <label style={{display: 'block', marginBottom: '5px', fontWeight: '600', color: '#333'}}>
                  Nueva Contraseña
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Ingresa tu nueva contraseña"
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{marginBottom: '20px'}}>
                <label style={{display: 'block', marginBottom: '5px', fontWeight: '600', color: '#333'}}>
                  Confirmar Contraseña
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirma tu nueva contraseña"
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <button
                type="submit"
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#2e7d32',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                Cambiar Contraseña
              </button>
            </form>
          )}
        </div>

        {/* Verificación de Email */}
        {showEmailVerification && (
          <div style={{
            background: 'white',
            padding: '20px',
            borderRadius: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            marginTop: '20px'
          }}>
            <h3 style={{margin: '0 0 15px 0', color: '#2a0066'}}>Verificar Nuevo Email</h3>
            <p style={{color: '#666', fontSize: '14px', marginBottom: '15px'}}>
              Hemos enviado un código de verificación a <strong>{newEmailPending}</strong>. 
              Ingresa el código para confirmar tu nuevo email.
            </p>

            <form onSubmit={handleVerifyEmail}>
              <input
                type="text"
                value={emailVerificationCode}
                onChange={(e) => setEmailVerificationCode(e.target.value)}
                placeholder="Ingresa el código de verificación"
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  boxSizing: 'border-box',
                  marginBottom: '15px'
                }}
              />

              <button
                type="submit"
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#2e7d32',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                Verificar Email
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
