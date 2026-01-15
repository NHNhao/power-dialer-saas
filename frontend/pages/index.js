import { useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export default function LoginPage() {
  const [mode, setMode] = useState('login'); // 'login' o 'register'
  const [username, setUsername] = useState(''); // Solo para login
  const [email, setEmail] = useState(''); // Solo para registro
  const [password, setPassword] = useState('');
  const [name, setName] = useState(''); // Solo para registro
  const [tenantName, setTenantName] = useState(''); // Solo para registro
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const auth = useAuth();
  const { t, lang, setLang } = useLanguage();

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      if (mode === 'register') {
        // Registro - enviar nombre de empresa, nombre, email y contraseña
        const res = await fetch('http://localhost:3001/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenant_name: tenantName,
            admin_name: name,
            admin_email: email,
            admin_password: password
          })
        });
        const j = await res.json();
        console.log('Respuesta de registro:', j);
        if (!j.ok) {
          console.log('Error en registro:', j.error);
          const errorMsg = getErrorMessage(j.error, false); // false = registro
          return setErr(errorMsg);
        }
        // Auto-login después de registro usando el username generado
        const generatedUsername = j.user?.username;
        console.log('Username generado para auto-login:', generatedUsername);
        const loginRes = await auth.login(generatedUsername, password);
        console.log('Resultado de auto-login:', loginRes);
        if (!loginRes.ok) {
          console.log('Error en auto-login:', loginRes.error);
          const errorMsg = getErrorMessage(loginRes.error, true); // true = login
          return setErr(errorMsg);
        }
        // Redirigir al dashboard de administrador
        router.push('/admin-dashboard');
      } else {
        // Login - usar username
        const j = await auth.login(username, password);
        if (!j.ok) {
          const errorMsg = getErrorMessage(j.error, true); // true = login
          return setErr(errorMsg);
        }
        // Redirigir según rol
        const userRole = j.user?.role;
        if (userRole === 'admin') {
          router.push('/admin-dashboard');
        } else {
          router.push('/agent');
        }
      }
    } catch (e) {
      setErr('Error de conexión. Verifica que el servidor esté funcionando.');
    } finally {
      setLoading(false);
    }
  }

  function getErrorMessage(error, isLogin = true) {
    // Mensajes específicos para login
    const loginMessages = {
      'invalid_credentials': 'Usuario o contraseña incorrectos',
      'missing_username_or_password': 'Por favor ingresa usuario y contraseña',
    };

    // Mensajes específicos para registro
    const registerMessages = {
      'missing_fields': 'Por favor completa todos los campos requeridos',
      'register_failed': 'Error al crear la cuenta. Intenta nuevamente.',
      'duplicate_key': 'Ya existe una cuenta con ese email',
    };

    // Mensajes comunes
    const commonMessages = {
      'login_failed': 'Error al iniciar sesión',
      'connection_error': 'Error de conexión. Verifica que el servidor esté funcionando.',
    };

    // Si el error contiene información de base de datos
    if (error && (error.includes('autentificación') || error.includes('password') || error.includes('dialer_owner'))) {
      return 'Error de conexión con la base de datos. Por favor contacta al administrador.';
    }

    // Si es un error de duplicate key
    if (error && error.includes('duplicate')) {
      return 'Ya existe una cuenta con ese email. Por favor intenta con otro.';
    }

    // Seleccionar el mensaje apropiado según el contexto
    if (isLogin) {
      return loginMessages[error] || commonMessages[error] || 'Ha ocurrido un error. Por favor intenta nuevamente.';
    } else {
      return registerMessages[error] || commonMessages[error] || 'Ha ocurrido un error al crear la cuenta. Por favor intenta nuevamente.';
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      {/* Language Selector */}
      <div style={{position: 'absolute', top: 20, right: 20}}>
        <select 
          value={lang} 
          onChange={e=>setLang(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            backgroundColor: 'white',
            color: 'var(--text)',
            fontWeight: '600',
            cursor: 'pointer',
            fontSize: '13px'
          }}
        >
          <option value="es">ES</option>
          <option value="en">EN</option>
        </select>
      </div>

      {/* Main Card */}
      <div style={{
        width: '100%',
        maxWidth: '420px'
      }}>
        {/* Logo/Header */}
        <div style={{textAlign: 'center', marginBottom: '32px'}}>
          <div style={{
            width: '64px',
            height: '64px',
            margin: '0 auto 16px',
            background: 'linear-gradient(135deg, var(--primary) 0%, var(--deep) 100%)',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(128,0,255,0.3)'
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
            </svg>
          </div>
          <h1 style={{fontSize: '28px', marginBottom: '8px', color: 'var(--deep)'}}>Power Dialer</h1>
          <p style={{color: 'var(--muted)', fontSize: '14px', margin: 0}}>Agente de Ventas</p>
        </div>

        {/* Form Card */}
        <form onSubmit={submit} style={{
          background: 'white',
          borderRadius: '12px',
          padding: '32px 24px',
          boxShadow: '0 4px 20px rgba(42,0,102,0.08)',
          border: '1px solid rgba(240,241,250,0.6)'
        }}>
          <h3 style={{fontSize: '18px', marginBottom: '24px', color: 'var(--deep)', textAlign: 'center'}}>
            {mode === 'login' ? t('loginTitle') : 'Crea una cuenta para tu empresa'}
          </h3>

          {/* Tenant Name (solo en registro) */}
          {mode === 'register' && (
            <div style={{marginBottom: '16px'}}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--text)',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Nombre de la Empresa
              </label>
              <input 
                type="text"
                value={tenantName} 
                onChange={e=>setTenantName(e.target.value)}
                placeholder="Mi Empresa"
                required
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  fontSize: '14px',
                  transition: 'all 160ms ease',
                  fontFamily: 'inherit'
                }}
              />
            </div>
          )}

          {/* Name (solo en registro) */}
          {mode === 'register' && (
            <div style={{marginBottom: '16px'}}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--text)',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Nombre Completo
              </label>
              <input 
                type="text"
                value={name} 
                onChange={e=>setName(e.target.value)}
                placeholder="Juan Pérez"
                required
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  fontSize: '14px',
                  transition: 'all 160ms ease',
                  fontFamily: 'inherit'
                }}
              />
            </div>
          )}

          {/* Usuario Field (solo en login) */}
          {mode === 'login' && (
            <div style={{marginBottom: '16px'}}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--text)',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Usuario
              </label>
              <input 
                type="text"
                value={username} 
                onChange={e=>setUsername(e.target.value)}
                placeholder="usuario"
                required
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  fontSize: '14px',
                  transition: 'all 160ms ease',
                  fontFamily: 'inherit'
                }}
              />
            </div>
          )}

          {/* Email Field (solo en registro) */}
          {mode === 'register' && (
            <div style={{marginBottom: '16px'}}>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--text)',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Email
              </label>
              <input 
                type="email"
                value={email} 
                onChange={e=>setEmail(e.target.value)}
                placeholder="admin@empresa.com"
                required
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  fontSize: '14px',
                  transition: 'all 160ms ease',
                  fontFamily: 'inherit'
                }}
              />
            </div>
          )}

          {/* Password Field */}
          <div style={{marginBottom: '24px'}}>
            <label style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: '600',
              color: 'var(--text)',
              marginBottom: '6px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              {t('password')}
            </label>
            <input 
              type="password" 
              value={password} 
              onChange={e=>setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                fontSize: '14px',
                transition: 'all 160ms ease',
                fontFamily: 'inherit'
              }}
            />
          </div>

          {/* Error Message */}
          {err && (
            <div style={{
              background: '#fee2e2',
              color: '#991b1b',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '13px',
              marginBottom: '16px',
              border: '1px solid #fca5a5'
            }}>
              {t(err) || err}
            </div>
          )}

          {/* Submit Button */}
          <button 
            type="submit" 
            disabled={loading}
            className="btn primary"
            style={{
              width: '100%',
              padding: '11px 16px',
              fontSize: '15px',
              fontWeight: '700',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 
              (mode === 'login' ? `${t('logging_in')}...` : 'Creando cuenta...') : 
              (mode === 'login' ? t('login') : 'Crear Cuenta')
            }
          </button>

          {/* Toggle Mode */}
          <div style={{
            textAlign: 'center',
            marginTop: '16px',
            fontSize: '13px',
            color: 'var(--muted)'
          }}>
            {mode === 'login' ? (
              <>
                ¿No tienes cuenta?{' '}
                <button 
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setErr('');
                    setUsername('');
                    setPassword('');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--primary)',
                    fontWeight: '600',
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  crea una para tu empresa
                </button>
              </>
            ) : (
              <>
                ¿Ya tienes cuenta?{' '}
                <button 
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErr('');
                    setUsername('admin');
                    setPassword('secret');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--primary)',
                    fontWeight: '600',
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  Iniciar sesión
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
