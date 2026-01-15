import { createContext, useContext, useState } from 'react'

const LanguageContext = createContext(null)

const translations = {
  en: {
    loginTitle: 'Agent Console — Login',
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
    callMultiple: 'CALL MULTIPLE',
    resetTestMode: 'RESET TEST MODE',
    hangup: 'Hangup',
    mute: 'Mute',
    unmute: 'Unmute',
    noActiveLead: 'No active lead',
    currentLead: 'Current Lead',
    selectCampaign: 'Select campaign',
    setReadyToReceive: 'Set READY to receive leads',
    completeCall: 'Complete Call',
    selectDisposition: 'Select disposition...',
    saveAndReady: 'Save & Ready',
    queueWaiting: 'Queue Waiting',
    takeCallFromQueue: 'TAKE CALL FROM QUEUE',
    peopleWaiting: 'people waiting',
    campaignInfo: 'Campaign Info',
    interested: 'Interested',
    noAnswer: 'No answer',
    scheduleAppointment: 'Schedule appointment',
    other: 'Other'
  },
  es: {
    loginTitle: 'Consola de Agente — Login',
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
    callMultiple: 'LLAMAR MÚLTIPLES',
    resetTestMode: 'RESETEAR MODO PRUEBA',
    hangup: 'Colgar',
    mute: 'Silenciar',
    unmute: 'Activar',
    noActiveLead: 'Sin lead activo',
    currentLead: 'Lead Actual',
    selectCampaign: 'Seleccionar campaña',
    setReadyToReceive: 'Configura LISTO para recibir leads',
    completeCall: 'Completar Llamada',
    selectDisposition: 'Seleccionar disposición...',
    saveAndReady: 'Guardar y Listo',
    queueWaiting: 'Cola de Espera',
    takeCallFromQueue: 'TOMAR LLAMADA DE LA COLA',
    peopleWaiting: 'personas esperando',
    campaignInfo: 'Info de Campaña',
    interested: 'Interesado',
    noAnswer: 'No contesta',
    scheduleAppointment: 'Agendar cita',
    other: 'Otro'
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
