import { createContext, useContext, useState } from 'react'

const LanguageContext = createContext(null)

const translations = {
  en: {
    loginTitle: 'Console - Login',
    email: 'Email',
    password: 'Password',
    login: 'Login',
    logging_in: 'Logging in',
    logout: 'Logout',
    agentConsole: 'Agent Console',
    agentState: 'Agent state',
    campaigns: 'Campaigns',
    ready: 'READY',
    callNext: 'CALL NEXT',
    hangup: 'Hangup',
    mute: 'Mute',
    noActiveLead: 'No active lead',
    currentLead: 'Current Lead',
    selectCampaign: 'Select campaign'
  },
  es: {
    loginTitle: 'Consola - Login',
    email: 'Correo',
    password: 'Contraseña',
    login: 'Entrar',
    logging_in: 'Iniciando sesión',
    logout: 'Salir',
    agentConsole: 'Consola de Agente',
    agentState: 'Estado agente',
    campaigns: 'Campañas',
    ready: 'LISTO',
    callNext: 'LLAMAR SIGUIENTE',
    hangup: 'Colgar',
    mute: 'Silenciar',
    noActiveLead: 'Sin lead activo',
    currentLead: 'Lead Actual',
    selectCampaign: 'Seleccionar campaña'
  }
}

export function LanguageProvider({ children }){
  const [lang, setLang] = useState('es')
  function t(key){ return (translations[lang] && translations[lang][key]) || translations.en[key] || key }
  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage(){ return useContext(LanguageContext) }
