import { createContext, useContext, useState } from 'react'
import * as Api from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(typeof window !== 'undefined' ? localStorage.getItem('token') : null)
  const [user, setUser] = useState(null)

  async function login(email, password) {
    const r = await Api.login(email, password)
    if (r.ok) {
      setToken(r.token)
      setUser(r.user)
      localStorage.setItem('token', r.token)
    }
    return r
  }

  function logout() {
    setToken(null); setUser(null); localStorage.removeItem('token')
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() { return useContext(AuthContext) }
