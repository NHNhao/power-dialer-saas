import { useState } from 'react'
import { useRouter } from 'next/router'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export default function LoginPage() {
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('secret');
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
      const j = await auth.login(email, password);
      if (!j.ok) return setErr(j.error || 'login_failed');
      router.push('/agent');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
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
          <h3 style={{fontSize: '18px', marginBottom: '24px', color: 'var(--deep)'}}>
            {t('loginTitle')}
          </h3>

          {/* Email Field */}
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
              {t('email')}
            </label>
            <input 
              type="email"
              value={email} 
              onChange={e=>setEmail(e.target.value)}
              placeholder="admin@example.com"
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
            {loading ? `${t('logging_in')}...` : t('login')}
          </button>
        </form>

        {/* Demo Credentials */}
        <div style={{
          textAlign: 'center',
          marginTop: '20px',
          fontSize: '12px',
          color: 'var(--muted)'
        }}>
          <p style={{margin: 0}}>Demo: admin@example.com / secret</p>
        </div>
      </div>
    </div>
  )
}
