import { createContext, useContext, useState } from 'react'
import * as Api from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(typeof window !== 'undefined' ? localStorage.getItem('token') : null)
  const [user, setUser] = useState(null)

  async function login(username, password) {
    const r = await Api.login(username, password)
    if (r.ok) {
      setToken(r.token)
      setUser(r.user)
      localStorage.setItem('token', r.token)
    }
    return r
  }

  function setTokenAndUser(newToken, newUser) {
    setToken(newToken)
    setUser(newUser)
    localStorage.setItem('token', newToken)
  }

  function logout() {
    setToken(null); setUser(null); localStorage.removeItem('token')
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout, setTokenAndUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() { return useContext(AuthContext) }
