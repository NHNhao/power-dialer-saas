# 📊 Análisis de Conexión Frontend-Backend

## 🏗️ Arquitectura General

```
FRONTEND (Next.js - Puerto 3002)          BACKEND (Node.js/Express - Puerto 3001)
├─ pages/
│  ├─ index.js (Login/Register)   ──────> POST /auth/login
│  ├─ agent.js (Dialer Console)   ──────> POST /auth/register
│  └─ campaigns.js                        
│
├─ lib/
│  └─ api.js (Client HTTP)        ──────> GET/POST /campaigns
│                                          POST /twilio/token
│                                          POST /dialer/next
│                                          POST /dialer/disposition
│                                          POST /leads/upload
│
└─ context/
   ├─ AuthContext.js
   └─ LanguageContext.js
```

---

## 🔐 PASO 1: AUTENTICACIÓN (Login/Register)

### Frontend → Backend

**Archivo:** [frontend/pages/index.js](frontend/pages/index.js#L26-L34)

```javascript
// LOGIN
const res = await fetch('http://localhost:3001/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});

// REGISTER
const res = await fetch('http://localhost:3001/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tenant_name: tenantName,
    admin_email: email,
    admin_name: name,
    admin_password: password,
    role: role
  })
});
```

**Backend Endpoints:** [backend/index.js](backend/index.js#L1-L100)

```javascript
// POST /auth/login
// POST /auth/register
// Autentica con JWT_SECRET
// Retorna: { ok: true, token: "jwt", user: {...} }
```

---

## 📋 PASO 2: CARGAR CAMPAÑAS

### Frontend → Backend

**Archivo:** [frontend/lib/api.js](frontend/lib/api.js#L41-L46)

```javascript
export async function getCampaigns(token) {
  const r = await fetch('http://localhost:3001/campaigns', {
    headers: { Authorization: 'Bearer '+token }
  });
  return r.json();
}
```

**Backend Response:**
```json
{
  "ok": true,
  "campaigns": [
    {
      "id": "c1",
      "name": "Campaña Demo Ventas",
      "status": "active",
      "total_leads": 150,
      "contacted": 45,
      "pending": 105,
      "success_rate": "30%"
    }
  ]
}
```

---

## 🎙️ PASO 3: INICIAR COMUNICACIÓN TWILIO

### Frontend → Backend

**Archivo:** [frontend/lib/api.js](frontend/lib/api.js#L48-L52)

```javascript
export async function requestTwilioToken(token) {
  const r = await fetch('http://localhost:3001/twilio/token', {
    method: 'POST',
    headers: { Authorization: 'Bearer '+token }
  });
  return r.json();
}
```

**Backend Response:**
```json
{
  "ok": true,
  "token": "twilio-access-token",
  "identity": "agent@example.com",
  "expires_in": 3600
}
```

**Usado en:** [frontend/pages/agent.js](frontend/pages/agent.js#L35-L45)

```javascript
async function ready() {
  const j = await Api.requestTwilioToken(auth.token);
  setAgentState('ready');
}
```

---

## 📞 PASO 4: OBTENER SIGUIENTE LEAD (Dialer)

### Frontend → Backend

**Archivo:** [frontend/lib/api.js](frontend/lib/api.js#L54-L62)

```javascript
export async function dialerNext(token, campaign_id) {
  const r = await fetch('http://localhost:3001/dialer/next', {
    method: 'POST',
    headers: { 
      Authorization: 'Bearer '+token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ campaign_id })
  });
  return r.json();
}
```

**Backend Response:**
```json
{
  "ok": true,
  "next": {
    "queue_id": "q1",
    "lead_id": "l1",
    "full_name": "Test Lead",
    "phone_e164": "+15551234567",
    "email": "lead@example.com"
  }
}
```

**Usado en:** [frontend/pages/agent.js](frontend/pages/agent.js#L47-L57)

```javascript
async function callNext() {
  const j = await Api.dialerNext(auth.token, selectedCampaign);
  setLead(j.next);
  setAgentState('on_call');
}
```

---

## ✅ PASO 5: GUARDAR DISPOSICIÓN (Resultado de llamada)

### Frontend → Backend

**Archivo:** [frontend/lib/api.js](frontend/lib/api.js#L64-L72)

```javascript
export async function saveDisposition(token, queue_id, disposition) {
  const r = await fetch('http://localhost:3001/dialer/disposition', {
    method: 'POST',
    headers: { 
      Authorization: 'Bearer '+token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ queue_id, disposition })
  });
  return r.json();
}
```

**Disposiciones válidas:** (a definir en el backend)
- `contact_attempted`
- `contact_completed`
- `no_answer`
- `wrong_number`
- `callback_requested`
- etc.

---

## 📁 PASO 6: CARGAR LEADS (Upload)

### Frontend → Backend

**Archivo:** [frontend/lib/api.js](frontend/lib/api.js#L117-L131)

```javascript
export async function uploadLeads(token, campaignId, file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('campaign_id', campaignId);
  
  const r = await fetch('http://localhost:3001/leads/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer '+token },
    body: formData
  });
  return r.json();
}
```

**Backend Response:**
```json
{
  "ok": true,
  "imported": 45
}
```

---

## 🔄 FLUJO COMPLETO DE UN AGENTE

```
1. USUARIO ACCEDE A LA APP
   └─> Frontend: http://localhost:3002
   
2. INGRESA CREDENCIALES
   └─> Backend: POST /auth/login
   └─> Recibe: JWT Token + User info
   └─> Redirige a /agent
   
3. AGENTE SELECCIONA CAMPAÑA
   └─> Backend: GET /campaigns (lista campañas)
   └─> Muestra: Select con campañas disponibles
   
4. AGENTE PRESIONA "LISTO"
   └─> Backend: POST /twilio/token
   └─> Recibe: Token para Twilio Voice SDK
   └─> Estado: ready
   
5. AGENTE PRESIONA "SIGUIENTE"
   └─> Backend: POST /dialer/next
   └─> Recibe: Siguiente lead (nombre, teléfono, email)
   └─> Estado: on_call
   
6. LLAMA AL CLIENTE (Twilio)
   └─> Twilio SDK llama: +15551234567
   
7. COMPLETA LLAMADA
   └─> Backend: POST /dialer/disposition
   └─> Envía: { queue_id, disposition }
   └─> Estado: wrapup → idle
   
8. PUEDE MARCAR SIGUIENTE
   └─> Vuelve a paso 5
```

---

## ⚙️ CONFIGURACIÓN REQUERIDA

### Backend (.env)

```env
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
JWT_SECRET=tu_secreto_aqui
PORT=3001
PUBLIC_BASE_URL=http://localhost:3001

# Twilio
TWILIO_API_KEY_SID=xxx
TWILIO_API_KEY_SECRET=xxx
TWILIO_TWIML_APP_SID=xxx
```

### Frontend (hardcodeado en lib/api.js)

```javascript
// Base URL Backend
'http://localhost:3001'

// Mock mode (para testing sin backend)
const USE_MOCK = false; // Cambiar a true para usar datos mockeados
```

---

## ✅ CHECKLIST PARA INICIAR

- [ ] Backend: npm install en `backend/`
- [ ] Backend: Configurar `.env` con credenciales
- [ ] Backend: Verificar conectividad a PostgreSQL
- [ ] Frontend: npm install en `frontend/`
- [ ] Frontend: Iniciar backend en puerto 3001
- [ ] Frontend: Iniciar frontend en puerto 3002
- [ ] Test: Intentar login con `admin@example.com` / `secret`
- [ ] Test: Cargar campaña
- [ ] Test: Obtener siguiente lead
- [ ] Test: Registrar disposición

---

## 📌 ENDPOINTS PRINCIPALES DEL BACKEND

| Método | Endpoint | Autenticación | Descripción |
|--------|----------|---------------|-------------|
| POST | `/auth/login` | ❌ | Login del usuario |
| POST | `/auth/register` | ❌ | Registro de nuevo tenant |
| GET | `/campaigns` | ✅ Bearer | Listar campañas del usuario |
| POST | `/campaigns` | ✅ Bearer | Crear campaña |
| PUT | `/campaigns/:id` | ✅ Bearer | Actualizar campaña |
| DELETE | `/campaigns/:id` | ✅ Bearer | Eliminar campaña |
| POST | `/twilio/token` | ✅ Bearer | Obtener token Twilio |
| POST | `/dialer/next` | ✅ Bearer | Obtener siguiente lead |
| POST | `/dialer/disposition` | ✅ Bearer | Guardar disposición |
| POST | `/leads/upload` | ✅ Bearer | Subir archivo de leads |

---

## 🧪 MODO MOCK (Testing sin Backend)

Si el backend no está disponible, el frontend puede usar modo mock:

**Archivo:** [frontend/lib/api.js](frontend/lib/api.js#L1)

```javascript
const USE_MOCK = true; // Cambiar a true
```

Con esto, todos los datos son simulados localmente en el navegador.

