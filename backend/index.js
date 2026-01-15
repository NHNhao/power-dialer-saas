// index.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const twilio = require("twilio");
const multer = require("multer");
const csv = require("csv-parser");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
// Twilio manda webhooks como application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));

// Configurar multer para subida de archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generar nombre único con timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Filtro para aceptar solo archivos CSV y Excel
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'text/csv',
    'application/csv',
    'text/x-csv',
    'application/x-csv',
    'text/comma-separated-values',
    'text/x-comma-separated-values',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  
  const allowedExtensions = ['.csv', '.xls', '.xlsx'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos CSV (.csv) y Excel (.xls, .xlsx)'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // límite de 10MB
  }
});

// Crear carpeta uploads si no existe
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ---------------------
// Auth middleware
// ---------------------
function requireAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "missing_token" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { user_id, tenant_id, role, email, name }
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "invalid_token" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ ok: false, error: "forbidden_admin_only" });
  return next();
}

// ---------------------
// Helpers
// ---------------------
async function getTwilioClientForTenant(tenantId) {
  const r = await pool.query(
    `SELECT account_sid, auth_token, default_from_number
     FROM public.tenant_twilio_config
     WHERE tenant_id=$1
     LIMIT 1`,
    [tenantId]
  );
  if (r.rowCount === 0) throw new Error("twilio_config_missing");

  const { account_sid, auth_token, default_from_number } = r.rows[0];
  return {
    client: twilio(account_sid, auth_token),
    account_sid,
    default_from_number,
  };
}

async function getTaskRouterCfg(tenantId) {
  const r = await pool.query(
    `SELECT workspace_sid, workflow_sid, taskqueue_sid
     FROM public.tenant_taskrouter_config
     WHERE tenant_id=$1
     LIMIT 1`,
    [tenantId]
  );
  return r.rows[0] || null;
}

async function getActivitySidByName(trClient, wsSid, name) {
  const acts = await trClient.taskrouter.v1.workspaces(wsSid).activities.list({ limit: 50 });
  const a = acts.find((x) => x.friendlyName === name);
  if (!a) throw new Error(`Activity no existe: ${name}`);
  return a.sid;
}

/**
 * ✅ CLAVE: setWorkerAvailability()
 * - fetch Worker actual para NO perder contact_uri ni otros attrs
 * - merge tenant_id + is_available
 * - update activity + attributes
 */
async function setWorkerAvailability({ trClient, wsSid, workerSid, tenantId, makeAvailable }) {
  // 1) Fetch attrs actuales (para NO perder contact_uri)
  const w = await trClient.taskrouter.v1.workspaces(wsSid).workers(workerSid).fetch();

  let attrs = {};
  try {
    attrs = JSON.parse(w.attributes || "{}");
  } catch {
    attrs = {};
  }

  // 2) Merge (NO tocar attrs.contact_uri)
  attrs.tenant_id = tenantId;
  attrs.is_available = !!makeAvailable;

  // 3) Activity
  const activitySid = await getActivitySidByName(trClient, wsSid, makeAvailable ? "Available" : "Offline");

  // 4) Update
  await trClient.taskrouter.v1.workspaces(wsSid).workers(workerSid).update({
    activitySid,
    attributes: JSON.stringify(attrs),
  });

  return attrs;
}

// ---------------------
// Base / Health
// ---------------------
app.get("/", (req, res) => res.send("OK. Try /health"));

app.get("/health", async (req, res) => {
  try {
    const r = await pool.query("select now() as now");
    res.json({ ok: true, db: true, now: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, db: false, error: e.message });
  }
});

/**
 * DEV ONLY: crea un tenant + un admin.
 */
app.post("/setup/bootstrap", async (req, res) => {
  const { tenant_name, admin_email, admin_name, admin_password } = req.body || {};

  if (!tenant_name || !admin_email || !admin_name || !admin_password) {
    return res.status(400).json({
      ok: false,
      error: "missing_fields",
      required: ["tenant_name", "admin_email", "admin_name", "admin_password"],
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tenantIns = await client.query(
      `INSERT INTO public.tenants (name) VALUES ($1)
       RETURNING id, name, status, created_at`,
      [tenant_name]
    );
    const tenant = tenantIns.rows[0];

    const rounds = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);
    const password_hash = await bcrypt.hash(admin_password, rounds);

    const userIns = await client.query(
      `INSERT INTO public.users (tenant_id, email, name, password_hash, role)
       VALUES ($1, $2, $3, $4, 'admin')
       RETURNING id, tenant_id, email, name, role, created_at`,
      [tenant.id, admin_email, admin_name, password_hash]
    );
    const user = userIns.rows[0];

    await client.query(
      `INSERT INTO public.audit_log (tenant_id, user_id, action, meta)
       VALUES ($1, $2, 'bootstrap_created', $3::jsonb)`,
      [tenant.id, user.id, JSON.stringify({ tenant_name, admin_email })]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, tenant, user });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

/**
 * POST /auth/register
 * Crea un nuevo tenant + usuario admin
 * Genera username automáticamente y retorna token
 */
app.post("/auth/register", async (req, res) => {
  const { tenant_name, admin_email, admin_name, admin_password } = req.body || {};

  if (!tenant_name || !admin_email || !admin_name || !admin_password) {
    return res.status(400).json({
      ok: false,
      error: "missing_fields",
      required: ["tenant_name", "admin_email", "admin_name", "admin_password"],
    });
  }

  // Generar username automáticamente: nombre + ".admin"
  const admin_username = admin_name.toLowerCase().trim().replace(/\s+/g, '.') + '.admin';

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tenantIns = await client.query(
      `INSERT INTO public.tenants (name) VALUES ($1)
       RETURNING id, name, status, created_at`,
      [tenant_name]
    );
    const tenant = tenantIns.rows[0];

    const rounds = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);
    const password_hash = await bcrypt.hash(admin_password, rounds);

    const userIns = await client.query(
      `INSERT INTO public.users (tenant_id, username, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'admin')
       RETURNING id, tenant_id, username, name, email, role, created_at`,
      [tenant.id, admin_username, admin_name, admin_email, password_hash]
    );
    const user = userIns.rows[0];

    // Crear JWT token
    const payload = {
      user_id: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      username: user.username,
      name: user.name,
      email: user.email
    };
    
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

    await client.query(
      `INSERT INTO public.audit_log (tenant_id, user_id, action, meta)
       VALUES ($1, $2, 'user_registered', $3::jsonb)`,
      [tenant.id, user.id, JSON.stringify({ tenant_name, admin_username, admin_email, role: 'admin' })]
    );

    await client.query("COMMIT");
    return res.json({ 
      ok: true, 
      token, 
      user: payload,
      tenant 
    });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    
    // Manejar errores específicos
    if (e.code === '23505') {
      // Duplicate key
      return res.status(400).json({ ok: false, error: 'duplicate_key' });
    }
    
    console.error('Error en registro:', e);
    return res.status(500).json({ ok: false, error: 'register_failed' });
  } finally {
    client.release();
  }
});

app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  console.log('Login attempt - username:', username, 'password length:', password?.length);
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: "missing_username_or_password" });
  }

  try {
    // Buscar por email O username (el parámetro se llama username por compatibilidad)
    const r = await pool.query(
      `SELECT id, tenant_id, username, name, email, role, password_hash
       FROM public.users
       WHERE username = $1 OR email = $1
       LIMIT 1`,
      [username]
    );

    console.log('User found:', r.rowCount > 0 ? r.rows[0].username : 'none');
    if (r.rowCount === 0) return res.status(401).json({ ok: false, error: "invalid_credentials" });

    const u = r.rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    console.log('Password match:', ok);
    if (!ok) return res.status(401).json({ ok: false, error: "invalid_credentials" });

    const payload = {
      user_id: u.id,
      tenant_id: u.tenant_id,
      role: u.role,
      username: u.username,
      name: u.name,
      email: u.email,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

    return res.json({ ok: true, token, user: payload });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /auth/login - Login con username o email
app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "missing_username_or_password" });
    }

    // Buscar usuario por username o email
    const r = await pool.query(
      `SELECT id, tenant_id, role, email, name, username, password_hash
       FROM public.users
       WHERE username = $1 OR email = $1`,
      [username]
    );

    if (r.rowCount === 0) {
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }

    const u = r.rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "invalid_credentials" });
    }

    const payload = {
      user_id: u.id,
      tenant_id: u.tenant_id,
      role: u.role,
      email: u.email,
      name: u.name,
      username: u.username,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

    return res.json({ ok: true, token, user: payload });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/me", requireAuth, async (req, res) => {
  try {
    const t = await pool.query(
      `SELECT id, name, status, created_at
       FROM public.tenants
       WHERE id=$1`,
      [req.user.tenant_id]
    );
    return res.json({ ok: true, user: req.user, tenant: t.rows[0] || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Guarda/actualiza credenciales Twilio para el tenant actual.
 */
app.post("/tenant/twilio/config", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { account_sid, auth_token, default_from_number } = req.body || {};

  if (!account_sid || !auth_token) {
    return res.status(400).json({ ok: false, error: "missing_account_sid_or_auth_token" });
  }

  try {
    await pool.query(
      `INSERT INTO public.tenant_twilio_config (tenant_id, account_sid, auth_token, default_from_number)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         account_sid = EXCLUDED.account_sid,
         auth_token = EXCLUDED.auth_token,
         default_from_number = EXCLUDED.default_from_number,
         updated_at = now()`,
      [tenantId, account_sid, auth_token, default_from_number || null]
    );

    await pool.query(
      `INSERT INTO public.audit_log (tenant_id, user_id, action, meta)
       VALUES ($1, $2, 'twilio_config_upserted', $3::jsonb)`,
      [tenantId, req.user.user_id, JSON.stringify({ account_sid, has_default_from: !!default_from_number })]
    );

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------------------
// Twilio Client Token (Voice JS SDK / Softphone)
// ---------------------
app.post("/twilio/token", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;

    const cfg = await pool.query(
      `SELECT account_sid FROM public.tenant_twilio_config WHERE tenant_id=$1 LIMIT 1`,
      [tenantId]
    );
    if (cfg.rowCount === 0) {
      return res.status(400).json({ ok: false, error: "twilio_config_missing" });
    }

    const accountSid = cfg.rows[0].account_sid;

    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

    if (!apiKeySid || !apiKeySecret || !twimlAppSid) {
      return res.status(500).json({
        ok: false,
        error: "missing_server_twilio_api_keys",
        hint: "Set TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID on the server",
      });
    }

    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const identity = req.user.email || `user_${req.user.user_id}`;

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, { ttl: 3600, identity });

    const grant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
    });
    token.addGrant(grant);

    return res.json({ ok: true, token: token.toJwt(), identity, expires_in: 3600 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------------------
// Campaigns (MVP)
// ---------------------
app.post("/campaigns", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: "missing_name" });

  try {
    const r = await pool.query(
      `INSERT INTO public.campaigns (tenant_id, name, status, created_by)
       VALUES ($1, $2, 'draft', $3)
       RETURNING id, tenant_id, name, status, created_at`,
      [tenantId, name, req.user.user_id]
    );
    return res.json({ ok: true, campaign: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/campaigns", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  try {
    const r = await pool.query(
      `SELECT 
         c.id, 
         c.name, 
         c.description,
         c.status, 
         c.created_at,
         COUNT(DISTINCT dq.id) FILTER (WHERE dq.state IN ('queued', 'in_progress')) as pending,
         COUNT(DISTINCT dq.id) FILTER (WHERE dq.state = 'done') as contacted,
         COUNT(DISTINCT dq.id) as total_leads,
         CASE 
           WHEN COUNT(DISTINCT dq.id) FILTER (WHERE dq.state = 'done') > 0 
           THEN ROUND(100.0 * COUNT(DISTINCT dq.id) FILTER (WHERE dq.outcome = 'success') / COUNT(DISTINCT dq.id) FILTER (WHERE dq.state = 'done'), 0) || '%'
           ELSE '0%'
         END as success_rate
       FROM public.campaigns c
       LEFT JOIN public.dialer_queue dq ON dq.campaign_id = c.id
       WHERE c.tenant_id=$1
       GROUP BY c.id
       ORDER BY c.created_at DESC
       LIMIT 50`,
      [tenantId]
    );
    return res.json({ ok: true, campaigns: r.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Update campaign
app.put("/campaigns/:id", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  const { 
    name, 
    description, 
    status, 
    start_date, 
    end_date, 
    call_hours_start, 
    call_hours_end, 
    max_attempts, 
    retry_delay_minutes, 
    dialing_ratio, 
    script 
  } = req.body || {};

  try {
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }
    if (start_date !== undefined) {
      updates.push(`start_date = $${paramCount++}`);
      values.push(start_date || null);
    }
    if (end_date !== undefined) {
      updates.push(`end_date = $${paramCount++}`);
      values.push(end_date || null);
    }
    if (call_hours_start !== undefined) {
      updates.push(`call_hours_start = $${paramCount++}`);
      values.push(call_hours_start);
    }
    if (call_hours_end !== undefined) {
      updates.push(`call_hours_end = $${paramCount++}`);
      values.push(call_hours_end);
    }
    if (max_attempts !== undefined) {
      updates.push(`max_attempts = $${paramCount++}`);
      values.push(max_attempts);
    }
    if (retry_delay_minutes !== undefined) {
      updates.push(`retry_delay_minutes = $${paramCount++}`);
      values.push(retry_delay_minutes);
    }
    if (dialing_ratio !== undefined) {
      updates.push(`dialing_ratio = $${paramCount++}`);
      values.push(dialing_ratio);
    }
    if (script !== undefined) {
      updates.push(`script = $${paramCount++}`);
      values.push(script);
    }

    if (updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'no_fields_to_update' });
    }

    updates.push(`updated_at = now()`);
    values.push(id, tenantId);

    const query = `
      UPDATE public.campaigns 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount++} AND tenant_id = $${paramCount++}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'campaign_not_found' });
    }

    return res.json({ ok: true, campaign: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Delete campaign
app.delete("/campaigns/:id", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  
  try {
    // Delete campaign and related queue entries (cascade should handle this)
    const result = await pool.query(
      `DELETE FROM public.campaigns WHERE id=$1 AND tenant_id=$2 RETURNING id`,
      [id, tenantId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'campaign_not_found' });
    }
    
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------------------
// Leads (MVP)
// ---------------------
// Delete lead
app.delete("/leads/:id", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      `DELETE FROM public.leads WHERE id=$1 AND tenant_id=$2 RETURNING id`,
      [id, tenantId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'lead_not_found' });
    }
    
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Get all leads
app.get("/leads", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { status, campaign_id, limit = 100, offset = 0 } = req.query;

  try {
    let query = `
      SELECT l.id, l.full_name, l.phone_e164, l.email, l.status, l.source, l.created_at, l.updated_at,
             COUNT(DISTINCT dq.id) as campaign_count,
             MAX(cl.started_at) as last_call_at
      FROM public.leads l
      LEFT JOIN public.dialer_queue dq ON dq.lead_id = l.id
      LEFT JOIN public.call_log cl ON cl.lead_id = l.id
      WHERE l.tenant_id = $1
    `;
    
    const params = [tenantId];
    let paramIndex = 2;

    if (status) {
      query += ` AND l.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (campaign_id) {
      query += ` AND EXISTS (SELECT 1 FROM public.dialer_queue WHERE lead_id = l.id AND campaign_id = $${paramIndex})`;
      params.push(campaign_id);
      paramIndex++;
    }

    query += ` GROUP BY l.id ORDER BY l.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM public.leads WHERE tenant_id = $1`;
    const countParams = [tenantId];
    
    if (status) {
      countQuery += ` AND status = $2`;
      countParams.push(status);
    }

    const countResult = await pool.query(countQuery, countParams);

    return res.json({ 
      ok: true, 
      leads: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/leads", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { full_name, phone_e164, email, source, meta } = req.body || {};

  if (!phone_e164) return res.status(400).json({ ok: false, error: "missing_phone_e164" });

  try {
    const r = await pool.query(
      `INSERT INTO public.leads (tenant_id, full_name, phone_e164, email, source, meta)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::jsonb,'{}'::jsonb))
       ON CONFLICT (tenant_id, phone_e164)
       DO UPDATE SET
         full_name = EXCLUDED.full_name,
         email = EXCLUDED.email,
         source = EXCLUDED.source,
         meta = EXCLUDED.meta,
         updated_at = now()
       RETURNING id, tenant_id, full_name, phone_e164, email, status, created_at`,
      [tenantId, full_name || null, phone_e164, email || null, source || null, meta ? JSON.stringify(meta) : null]
    );

    return res.json({ ok: true, lead: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Upload leads from CSV/XLSX
app.post("/leads/upload", requireAuth, upload.single('file'), async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { campaign_id } = req.body;
  
  if (!req.file) {
    return res.status(400).json({ ok: false, error: "no_file_uploaded" });
  }
  
  if (!campaign_id) {
    return res.status(400).json({ ok: false, error: "missing_campaign_id" });
  }

  const filePath = req.file.path;
  const fileExt = path.extname(req.file.originalname).toLowerCase();
  const leads = [];
  let imported = 0;
  let errors = 0;

  try {
    // Procesar según el tipo de archivo
    if (fileExt === '.csv') {
      // Leer y procesar el archivo CSV
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (row) => {
            // Esperamos columnas: nombre, telefono_celular (o phone, name, etc.)
            const name = row.nombre || row.name || row.full_name || '';
            const phone = row.telefono_celular || row.phone || row.telefono || row.phone_number || '';
            const email = row.email || row.correo || '';
            
            if (phone && phone.trim()) {
              leads.push({ name: name.trim(), phone: phone.trim(), email: email.trim() });
            }
          })
          .on('end', resolve)
          .on('error', reject);
      });
    } else if (fileExt === '.xlsx' || fileExt === '.xls') {
      // Leer y procesar archivos Excel
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0]; // Primera hoja
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet);
      
      for (const row of rows) {
        const name = row.nombre || row.name || row.full_name || row.Nombre || row.Name || '';
        const phone = row.telefono_celular || row.phone || row.telefono || row.phone_number || 
                     row.Telefono || row.Phone || row['Teléfono'] || '';
        const email = row.email || row.correo || row.Email || row.Correo || '';
        
        if (phone && String(phone).trim()) {
          leads.push({ 
            name: String(name).trim(), 
            phone: String(phone).trim(), 
            email: String(email).trim() 
          });
        }
      }
    } else {
      throw new Error('Formato de archivo no soportado. Use CSV o Excel (.xlsx, .xls)');
    }

    if (leads.length === 0) {
      // Eliminar archivo temporal
      fs.unlinkSync(filePath);
      return res.status(400).json({ 
        ok: false, 
        error: "no_valid_leads", 
        message: "No se encontraron contactos válidos en el archivo. Asegúrate de que tenga columnas 'nombre' y 'telefono_celular' (o 'name' y 'phone')" 
      });
    }

    // Insertar leads en la base de datos
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const lead of leads) {
        try {
          // Asegurar formato E.164 para el teléfono
          let phoneE164 = lead.phone;
          if (!phoneE164.startsWith('+')) {
            phoneE164 = '+' + phoneE164.replace(/\D/g, '');
          }

          // Insertar lead
          const leadResult = await client.query(
            `INSERT INTO public.leads (tenant_id, full_name, phone_e164, email, status, source)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (tenant_id, phone_e164) DO UPDATE 
             SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, updated_at = now()
             RETURNING id`,
            [tenantId, lead.name, phoneE164, lead.email, 'new', fileExt === '.csv' ? 'csv_upload' : 'excel_upload']
          );

          const leadId = leadResult.rows[0].id;

          // Agregar a la cola de la campaña
          await client.query(
            `INSERT INTO public.dialer_queue (tenant_id, campaign_id, lead_id, state, position)
             VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(position), 0) + 1 FROM public.dialer_queue WHERE campaign_id = $2))
             ON CONFLICT (campaign_id, lead_id) DO NOTHING`,
            [tenantId, campaign_id, leadId, 'queued']
          );

          imported++;
        } catch (err) {
          console.error('Error importing lead:', lead, err.message);
          errors++;
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Eliminar archivo temporal
    fs.unlinkSync(filePath);

    return res.json({
      ok: true,
      imported,
      errors,
      total: leads.length,
      message: `${imported} contactos importados exitosamente${errors > 0 ? `, ${errors} errores` : ''}`
    });

  } catch (error) {
    console.error('Error uploading leads:', error);
    // Limpiar archivo temporal en caso de error
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return res.status(500).json({ ok: false, error: "upload_failed", details: error.message });
  }
});

// ---------------------
// Enqueue leads into campaign
// Body: { campaign_id, lead_ids: [uuid,...] }
// ---------------------
app.post("/dialer/enqueue", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { campaign_id, lead_ids } = req.body || {};

  if (!campaign_id || !Array.isArray(lead_ids) || lead_ids.length === 0) {
    return res.status(400).json({ ok: false, error: "missing_campaign_id_or_lead_ids" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const mx = await client.query(
      `SELECT COALESCE(MAX(position),0) AS max_pos
       FROM public.dialer_queue
       WHERE tenant_id=$1 AND campaign_id=$2`,
      [tenantId, campaign_id]
    );
    let pos = Number(mx.rows[0].max_pos || 0);

    let inserted = 0;

    for (const leadId of lead_ids) {
      pos += 1;
      const r = await client.query(
        `INSERT INTO public.dialer_queue (tenant_id, campaign_id, lead_id, position, state)
         VALUES ($1, $2, $3, $4, 'queued')
         ON CONFLICT (tenant_id, campaign_id, lead_id) DO NOTHING`,
        [tenantId, campaign_id, leadId, pos]
      );
      inserted += r.rowCount;
    }

    await client.query("COMMIT");
    return res.json({ ok: true, inserted });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// ---------------------
// Next lead (solo toma el siguiente queued y lo marca in_progress)
// ---------------------
app.post("/dialer/next", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { campaign_id } = req.body || {};
  if (!campaign_id) return res.status(400).json({ ok: false, error: "missing_campaign_id" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const q = await client.query(
      `SELECT dq.id AS queue_id, dq.campaign_id, dq.lead_id, dq.position, dq.state,
              l.full_name, l.phone_e164, l.email, l.status AS lead_status
       FROM public.dialer_queue dq
       JOIN public.leads l ON l.id = dq.lead_id
       WHERE dq.tenant_id=$1 AND dq.campaign_id=$2 AND dq.state='queued'
       ORDER BY dq.position ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [tenantId, campaign_id]
    );

    if (q.rowCount === 0) {
      await client.query("COMMIT");
      return res.json({ ok: true, next: null });
    }

    const row = q.rows[0];

    await client.query(
      `UPDATE public.dialer_queue
       SET state='in_progress', updated_at=now()
       WHERE id=$1`,
      [row.queue_id]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, next: row });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// ---------------------
// Next + Call (FIX: no double-release)
// ---------------------
app.post("/dialer/next_and_call", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { campaign_id } = req.body || {};
  if (!campaign_id) return res.status(400).json({ ok: false, error: "missing_campaign_id" });

  let row = null;

  // 1) Tomar el siguiente queued y marcarlo in_progress dentro de una transacción corta
  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const q = await db.query(
      `SELECT dq.id AS queue_id, dq.campaign_id, dq.lead_id, dq.position, dq.state,
              l.full_name, l.phone_e164
       FROM public.dialer_queue dq
       JOIN public.leads l ON l.id = dq.lead_id
       WHERE dq.tenant_id=$1 AND dq.campaign_id=$2 AND dq.state='queued'
       ORDER BY dq.position ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [tenantId, campaign_id]
    );

    if (q.rowCount === 0) {
      await db.query("COMMIT");
      return res.json({ ok: true, next: null });
    }

    row = q.rows[0];

    await db.query(
      `UPDATE public.dialer_queue
       SET state='in_progress', updated_at=now()
       WHERE id=$1`,
      [row.queue_id]
    );

    await db.query("COMMIT");
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    db.release();
  }

  // 2) Ya fuera de la transacción: disparar llamada Twilio
  try {
    const callSid = await startTwilioCall({
      tenantId,
      queueId: row.queue_id,
      toNumber: row.phone_e164,
    });

    await pool.query(
      `UPDATE public.dialer_queue
       SET call_sid=$2, updated_at=now()
       WHERE id=$1`,
      [row.queue_id, callSid]
    );

    return res.json({ ok: true, next: row, call_sid: callSid });
  } catch (e) {
    // si falla Twilio, marca outcome/state para no dejarlo colgado
    try {
      await pool.query(
        `UPDATE public.dialer_queue
         SET state='done', outcome='failed', updated_at=now()
         WHERE id=$1 AND tenant_id=$2`,
        [row.queue_id, tenantId]
      );
    } catch {}
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Helper: crea llamada Twilio para un item de la cola (modo power)
async function startTwilioCall({ tenantId, queueId, toNumber }) {
  const { client, default_from_number } = await getTwilioClientForTenant(tenantId);
  if (!default_from_number) throw new Error("twilio_default_from_missing");

  const base = process.env.PUBLIC_BASE_URL;
  if (!base) throw new Error("PUBLIC_BASE_URL_missing");

  const twimlUrl = `${base}/twilio/voice/twiml?queue_id=${encodeURIComponent(queueId)}`;
  const statusCallback = `${base}/twilio/voice/status?queue_id=${encodeURIComponent(queueId)}`;

  const call = await client.calls.create({
    to: toNumber,
    from: default_from_number,
    url: twimlUrl,
    method: "GET",
    statusCallback,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
  });

  return call.sid;
}

/**
 * TwiML (Power dialer con cola de espera)
 */
app.get("/twilio/voice/twiml", async (req, res) => {
  try {
    res.type("text/xml");
    const queueId = req.query.queue_id;
    const to = req.query.To || req.query.to || null;

    // Si es una llamada directa (no del dialer)
    if (to && !queueId) {
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>${to}</Dial>
</Response>`);
    }

    // Modo power dialer con cola: cuando el cliente contesta, va a la cola de espera
    if (queueId) {
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="es-ES" voice="Polly.Lupe">Hola, gracias por contestar. Un asesor te atenderá en un momento.</Say>
  <Enqueue waitUrl="/twilio/voice/wait-music">${queueId}</Enqueue>
</Response>`);
    }

    // Fallback
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="es-ES">Hola, te habla un asesor. Un momento por favor.</Say>
  <Pause length="1"/>
  <Say language="es-ES">Gracias. Te llamaremos más tarde.</Say>
  <Hangup/>
</Response>`);
  } catch (e) {
    res.type("text/xml");
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Hangup/></Response>`);
  }
});

/**
 * TwiML - Música de espera para la cola
 */
app.get("/twilio/voice/wait-music", async (req, res) => {
  res.type("text/xml");
  return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="es-ES" voice="Polly.Lupe">Por favor espera, un asesor te atenderá pronto.</Say>
  <Play loop="10">https://demo.twilio.com/docs/classic.mp3</Play>
</Response>`);
});

/**
 * Webhook de estado (Twilio) - actualiza dialer_queue
 */
app.post("/twilio/voice/status", async (req, res) => {
  try {
    const queueId = req.query.queue_id;
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus; // initiated|ringing|in-progress|completed|busy|failed|no-answer|canceled

    let outcome = null;
    if (callStatus === "completed") outcome = "completed";
    if (callStatus === "busy") outcome = "busy";
    if (callStatus === "failed") outcome = "failed";
    if (callStatus === "no-answer") outcome = "no-answer";
    if (callStatus === "canceled") outcome = "canceled";

    await pool.query(
      `UPDATE public.dialer_queue
       SET call_sid = COALESCE(call_sid, $2),
           updated_at = now(),
           started_at = COALESCE(started_at, CASE WHEN $3 IN ('answered','in-progress') THEN now() ELSE NULL END),
           completed_at = CASE WHEN $3 IN ('completed','busy','failed','no-answer','canceled') THEN now() ELSE completed_at END,
           outcome = COALESCE($4, outcome),
           state = CASE WHEN $3 IN ('completed','busy','failed','no-answer','canceled') THEN 'done' ELSE state END
       WHERE id=$1`,
      [queueId, callSid || null, callStatus || "", outcome]
    );

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Twilio necesita 200 sí o sí
    return res.status(200).json({ ok: false });
  }
});

/**
 * POST /dialer/reset-test-mode
 * Resetea todos los contactos de una campaña a 'queued' para pruebas
 */
app.post("/dialer/reset-test-mode", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { campaign_id } = req.body || {};
  
  if (!campaign_id) {
    return res.status(400).json({ ok: false, error: "missing_campaign_id" });
  }
  
  try {
    const result = await pool.query(
      `UPDATE public.dialer_queue
       SET state = 'queued', 
           call_sid = NULL,
           started_at = NULL,
           completed_at = NULL,
           outcome = NULL,
           updated_at = now()
       WHERE tenant_id = $1 
         AND campaign_id = $2 
         AND state = 'in_progress'
       RETURNING id`,
      [tenantId, campaign_id]
    );
    
    return res.json({ 
      ok: true, 
      reset_count: result.rowCount 
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /dialer/queue-status/:queue_name
 * Obtiene el estado de la cola de Twilio (cuántas personas esperando)
 */
app.get("/dialer/queue-status/:queue_name", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { queue_name } = req.params;
  
  try {
    const { client } = await getTwilioClientForTenant(tenantId);
    
    // Buscar la cola por nombre
    const queues = await client.queues.list({ limit: 100 });
    const queue = queues.find(q => q.friendlyName === queue_name);
    
    if (!queue) {
      return res.json({ 
        ok: true, 
        waiting: 0, 
        queue_exists: false 
      });
    }
    
    // Obtener miembros en espera
    const members = await client.queues(queue.sid).members.list();
    
    return res.json({ 
      ok: true, 
      queue_exists: true,
      queue_sid: queue.sid,
      waiting: members.length,
      members: members.map(m => ({
        call_sid: m.callSid,
        wait_time: m.waitTime,
        position: m.position
      }))
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /dialer/dequeue
 * El agente toma la siguiente llamada de la cola
 */
app.post("/dialer/dequeue", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { queue_name, agent_phone } = req.body || {};
  
  if (!queue_name) {
    return res.status(400).json({ ok: false, error: "missing_queue_name" });
  }
  
  try {
    const { client, default_from_number } = await getTwilioClientForTenant(tenantId);
    const base = process.env.PUBLIC_BASE_URL;
    
    // Buscar la cola
    const queues = await client.queues.list({ limit: 100 });
    const queue = queues.find(q => q.friendlyName === queue_name);
    
    if (!queue) {
      return res.status(404).json({ ok: false, error: "queue_not_found" });
    }
    
    // Verificar si hay alguien en espera
    const members = await client.queues(queue.sid).members.list({ limit: 1 });
    
    if (members.length === 0) {
      return res.json({ ok: true, dequeued: false, message: "No hay llamadas en espera" });
    }
    
    // Dequeue: sacar al primero de la cola y conectar con el agente
    const firstMember = members[0];
    
    // Actualizar el member para sacarlo de la cola y conectarlo
    await client.queues(queue.sid)
      .members(firstMember.callSid)
      .update({
        url: `${base}/twilio/voice/connect-agent`,
        method: 'POST'
      });
    
    return res.json({ 
      ok: true, 
      dequeued: true,
      call_sid: firstMember.callSid,
      wait_time: firstMember.waitTime
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * TwiML - Conectar cliente con agente
 */
app.post("/twilio/voice/connect-agent", async (req, res) => {
  res.type("text/xml");
  // Aquí conectamos al cliente que estaba en cola con el agente
  return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="es-ES" voice="Polly.Lupe">Te estamos conectando con un asesor.</Say>
  <Pause length="1"/>
  <Say language="es-ES" voice="Polly.Lupe">Por favor espera un momento.</Say>
  <Pause length="60"/>
</Response>`);
});

// ======================================================
// ============== TASKROUTER (PARALLEL MODE) =============
// ======================================================

/**
 * POST /taskrouter/tenant/bootstrap
 * Crea/reutiliza Workspace + Activities + TaskQueue + Workflow
 * y upsert en tenant_taskrouter_config
 */
app.post("/taskrouter/tenant/bootstrap", requireAuth, requireAdmin, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const baseUrl = process.env.PUBLIC_BASE_URL;

  if (!baseUrl?.startsWith("https://")) {
    return res.status(400).json({ ok: false, error: "PUBLIC_BASE_URL debe ser https (ngrok)" });
  }

  try {
    const { client: twClient } = await getTwilioClientForTenant(tenantId);

    const wsName = `tenant_${tenantId}_ws`;
    const tqName = `tenant_${tenantId}_queue`;
    const wfName = `tenant_${tenantId}_wf`;

    // 1) Workspace
    const workspaces = await twClient.taskrouter.v1.workspaces.list({ limit: 50 });
    let ws = workspaces.find((w) => w.friendlyName === wsName);
    if (!ws) ws = await twClient.taskrouter.v1.workspaces.create({ friendlyName: wsName });

    // 2) Activities estándar
    const desiredActs = ["Offline", "Available", "Reserved", "OnCall", "WrapUp"];
    const acts = await twClient.taskrouter.v1.workspaces(ws.sid).activities.list({ limit: 50 });
    const actByName = Object.fromEntries(acts.map((a) => [a.friendlyName, a]));

    for (const name of desiredActs) {
      if (!actByName[name]) {
        actByName[name] = await twClient.taskrouter.v1.workspaces(ws.sid).activities.create({ friendlyName: name });
      }
    }

    // 3) TaskQueue
    const tqs = await twClient.taskrouter.v1.workspaces(ws.sid).taskQueues.list({ limit: 50 });
    let tq = tqs.find((q) => q.friendlyName === tqName);
    if (!tq) {
      tq = await twClient.taskrouter.v1.workspaces(ws.sid).taskQueues.create({
        friendlyName: tqName,
        targetWorkers: `tenant_id == "${tenantId}" AND (is_available == true)`,
      });
    }

    // 4) Workflow
    const wfs = await twClient.taskrouter.v1.workspaces(ws.sid).workflows.list({ limit: 50 });
    let wf = wfs.find((x) => x.friendlyName === wfName);

    const configuration = {
      task_routing: {
        filters: [{ filter_friendly_name: "all", expression: "1==1", targets: [{ queue: tq.sid }] }],
        default_filter: { queue: tq.sid },
      },
    };

    if (!wf) {
      wf = await twClient.taskrouter.v1.workspaces(ws.sid).workflows.create({
        friendlyName: wfName,
        configuration: JSON.stringify(configuration),
        assignmentCallbackUrl: `${baseUrl}/taskrouter/assignment`,
        assignmentCallbackMethod: "POST",
      });
    } else {
      await twClient.taskrouter.v1.workspaces(ws.sid).workflows(wf.sid).update({
        configuration: JSON.stringify(configuration),
        assignmentCallbackUrl: `${baseUrl}/taskrouter/assignment`,
        assignmentCallbackMethod: "POST",
      });
    }

    // 5) Upsert en DB
    await pool.query(
      `INSERT INTO public.tenant_taskrouter_config(tenant_id, workspace_sid, workflow_sid, taskqueue_sid)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET
         workspace_sid=EXCLUDED.workspace_sid,
         workflow_sid=EXCLUDED.workflow_sid,
         taskqueue_sid=EXCLUDED.taskqueue_sid,
         updated_at=now()`,
      [tenantId, ws.sid, wf.sid, tq.sid]
    );

    return res.json({
      ok: true,
      tenant_id: tenantId,
      workspace_sid: ws.sid,
      workflow_sid: wf.sid,
      taskqueue_sid: tq.sid,
      activities: Object.fromEntries(Object.entries(actByName).map(([k, v]) => [k, v.sid])),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /agents/taskrouter/create
 * Body: { user_id, contact_uri, full_name? }
 */
app.post("/agents/taskrouter/create", requireAuth, requireAdmin, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const { user_id, contact_uri, full_name } = req.body || {};
  if (!user_id || !contact_uri) return res.status(400).json({ ok: false, error: "missing_user_id_or_contact_uri" });

  try {
    const cfg = await getTaskRouterCfg(tenantId);
    if (!cfg) return res.status(400).json({ ok: false, error: "TaskRouter no bootstrap para este tenant" });

    const { client: twClient } = await getTwilioClientForTenant(tenantId);
    const wsSid = cfg.workspace_sid;

    const offlineSid = await getActivitySidByName(twClient, wsSid, "Offline");

    const initialAttrs = {
      tenant_id: tenantId,
      contact_uri,
      is_available: false,
    };

    const worker = await twClient.taskrouter.v1.workspaces(wsSid).workers.create({
      friendlyName: full_name || `agent_${user_id}`,
      activitySid: offlineSid,
      attributes: JSON.stringify(initialAttrs),
    });

    await pool.query(
      `INSERT INTO public.taskrouter_workers(tenant_id, user_id, worker_sid, contact_uri, attributes)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET
         worker_sid=EXCLUDED.worker_sid,
         contact_uri=EXCLUDED.contact_uri,
         attributes=EXCLUDED.attributes,
         updated_at=now()`,
      [tenantId, user_id, worker.sid, contact_uri, JSON.stringify(initialAttrs)]
    );

    await pool.query(
      `INSERT INTO public.agent_presence(tenant_id, user_id, status)
       VALUES ($1,$2,'offline')
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET status='offline', updated_at=now(), last_seen_at=now()`,
      [tenantId, user_id]
    );

    return res.json({ ok: true, worker_sid: worker.sid });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * ✅ POST /agents/ready
 * - ahora preserva attrs existentes (contact_uri) usando setWorkerAvailability()
 * - por defecto: usuario logueado; admin puede pasar body.user_id
 */
app.post("/agents/ready", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const userId = req.user.role === "admin" && req.body?.user_id ? req.body.user_id : req.user.user_id;

  try {
    const cfg = await getTaskRouterCfg(tenantId);
    if (!cfg) return res.status(400).json({ ok: false, error: "TaskRouter no bootstrap" });

    const wrk = await pool.query(
      `SELECT worker_sid FROM public.taskrouter_workers WHERE tenant_id=$1 AND user_id=$2 LIMIT 1`,
      [tenantId, userId]
    );
    if (wrk.rowCount === 0) return res.status(400).json({ ok: false, error: "worker_missing_for_user" });

    const { client: twClient } = await getTwilioClientForTenant(tenantId);

    const workerSid = wrk.rows[0].worker_sid;

    const attrs = await setWorkerAvailability({
      trClient: twClient,
      wsSid: cfg.workspace_sid,
      workerSid,
      tenantId,
      makeAvailable: true,
    });

    await pool.query(
      `INSERT INTO public.agent_presence(tenant_id, user_id, status)
       VALUES ($1,$2,'ready')
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET status='ready', updated_at=now(), last_seen_at=now()`,
      [tenantId, userId]
    );

    return res.json({ ok: true, status: "ready", worker_sid: workerSid, attrs });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * ✅ POST /agents/offline
 * - ahora preserva attrs existentes (contact_uri) usando setWorkerAvailability()
 * - por defecto: usuario logueado; admin puede pasar body.user_id
 */
app.post("/agents/offline", requireAuth, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const userId = req.user.role === "admin" && req.body?.user_id ? req.body.user_id : req.user.user_id;

  try {
    const cfg = await getTaskRouterCfg(tenantId);
    if (!cfg) return res.status(400).json({ ok: false, error: "TaskRouter no bootstrap" });

    const wrk = await pool.query(
      `SELECT worker_sid FROM public.taskrouter_workers WHERE tenant_id=$1 AND user_id=$2 LIMIT 1`,
      [tenantId, userId]
    );
    if (wrk.rowCount === 0) return res.status(400).json({ ok: false, error: "worker_missing_for_user" });

    const { client: twClient } = await getTwilioClientForTenant(tenantId);

    const workerSid = wrk.rows[0].worker_sid;

    const attrs = await setWorkerAvailability({
      trClient: twClient,
      wsSid: cfg.workspace_sid,
      workerSid,
      tenantId,
      makeAvailable: false,
    });

    await pool.query(
      `INSERT INTO public.agent_presence(tenant_id, user_id, status)
       VALUES ($1,$2,'offline')
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET status='offline', updated_at=now(), last_seen_at=now()`,
      [tenantId, userId]
    );

    return res.json({ ok: true, status: "offline", worker_sid: workerSid, attrs });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /twilio/parallel/twiml?tenant_id=...&campaign_id=...&queue_id=...
 * Cuando el lead contesta, lo encola a TaskRouter (workflow) -> crea Task
 */
app.get("/twilio/parallel/twiml", async (req, res) => {
  const { tenant_id: tenantId, campaign_id: campaignId, queue_id: queueId } = req.query;

  try {
    const cfg = await getTaskRouterCfg(tenantId);
    if (!cfg) return res.status(400).send("TaskRouter not configured");

    const camp = await pool.query(
      `SELECT waiting_message FROM public.campaigns WHERE id=$1 AND tenant_id=$2`,
      [campaignId, tenantId]
    );

    const vr = new twilio.twiml.VoiceResponse();

    if (camp.rows[0]?.waiting_message) {
      vr.say({ language: "es-MX" }, camp.rows[0].waiting_message);
    }

    const taskAttrs = {
      tenant_id: tenantId,
      campaign_id: campaignId,
      queue_id: queueId,
      channel: "voice",
    };

    const enq = vr.enqueue({ workflowSid: cfg.workflow_sid });
    enq.task(JSON.stringify(taskAttrs));

    res.type("text/xml").send(vr.toString());
  } catch (e) {
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }
});

/**
 * POST /taskrouter/assignment
 * TaskRouter Assignment Callback:
 * - guarda TaskSid/ReservationSid/WorkerSid en dialer_queue
 * - responde JSON { instruction: "dequeue", from, post_work_activity_sid? }
 */
app.post("/taskrouter/assignment", async (req, res) => {
  const { TaskSid, ReservationSid, WorkerSid, TaskAttributes } = req.body || {};

  let attrs = {};
  try {
    attrs = JSON.parse(TaskAttributes || "{}");
  } catch {}

  const tenantId = attrs.tenant_id;
  const queueId = attrs.queue_id;
  const campaignId = attrs.campaign_id;

  try {
    if (tenantId && queueId) {
      await pool.query(
        `UPDATE public.dialer_queue
         SET task_sid=$1,
             reservation_sid=$2,
             worker_sid=$3,
             waiting_started_at=COALESCE(waiting_started_at, now()),
             updated_at=now()
         WHERE tenant_id=$4 AND campaign_id=$5 AND id=$6`,
        [TaskSid, ReservationSid, WorkerSid, tenantId, campaignId, queueId]
      );
    }

    // WrapUp (opcional)
    let wrapupSid = null;
    let fromNumber = process.env.TWILIO_CALLER_ID || null;

    if (tenantId) {
      const cfg = await getTaskRouterCfg(tenantId);
      const { client: twClient, default_from_number } = await getTwilioClientForTenant(tenantId);

      if (!fromNumber) fromNumber = default_from_number || null;

      if (cfg?.workspace_sid) {
        try {
          wrapupSid = await getActivitySidByName(twClient, cfg.workspace_sid, "WrapUp");
        } catch {}
      }
    }

    return res.json({
      instruction: "dequeue",
      ...(fromNumber ? { from: fromNumber } : {}),
      ...(wrapupSid ? { post_work_activity_sid: wrapupSid } : {}),
    });
  } catch (e) {
    // Siempre 200
    return res.status(200).json({ instruction: "reject" });
  }
});

/**
 * POST /dialer/parallel/start
 * Body: { campaign_id, concurrency? }
 * - crea dialer_parallel_runs
 * - lockea N items queued
 * - los marca in_progress + dial_mode='parallel' + parallel_run_id
 * - dispara N llamadas con TwiML /twilio/parallel/twiml
 */
app.post("/dialer/parallel/start", requireAuth, requireAdmin, async (req, res) => {
  const tenantId = req.user.tenant_id;
  const userId = req.user.user_id;
  const { campaign_id, concurrency } = req.body || {};

  if (!campaign_id) return res.status(400).json({ ok: false, error: "missing_campaign_id" });

  const base = process.env.PUBLIC_BASE_URL;
  if (!base?.startsWith("https://")) return res.status(400).json({ ok: false, error: "PUBLIC_BASE_URL_invalid" });

  let runId = null;
  let picked = [];

  // 1) lock y mark en transacción
  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const camp = await db.query(
      `SELECT id, parallel_concurrency, parallel_dial_ratio
       FROM public.campaigns
       WHERE id=$1 AND tenant_id=$2`,
      [campaign_id, tenantId]
    );
    if (camp.rowCount === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "campaign_not_found" });
    }

    const conc = Number(concurrency || camp.rows[0].parallel_concurrency || 10);
    const ratio = Number(camp.rows[0].parallel_dial_ratio || 1.0);
    const want = Math.max(1, Math.ceil(conc * ratio)); // ratio=1 => 10

    const run = await db.query(
      `INSERT INTO public.dialer_parallel_runs(tenant_id, campaign_id, concurrency, dial_ratio, status, started_by)
       VALUES ($1,$2,$3,$4,'running',$5)
       RETURNING id`,
      [tenantId, campaign_id, conc, ratio, userId]
    );
    runId = run.rows[0].id;

    const q = await db.query(
      `SELECT dq.id AS queue_id, l.phone_e164
       FROM public.dialer_queue dq
       JOIN public.leads l ON l.id = dq.lead_id
       WHERE dq.tenant_id=$1 AND dq.campaign_id=$2 AND dq.state='queued'
       ORDER BY dq.position ASC
       LIMIT $3
       FOR UPDATE SKIP LOCKED`,
      [tenantId, campaign_id, want]
    );

    picked = q.rows;

    for (const r of picked) {
      await db.query(
        `UPDATE public.dialer_queue
         SET state='in_progress',
             dial_mode='parallel',
             parallel_run_id=$2,
             attempts=attempts+1,
             updated_at=now()
         WHERE id=$1`,
        [r.queue_id, runId]
      );
    }

    await db.query("COMMIT");
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    db.release();
  }

  // 2) disparar llamadas fuera de transacción
  let launched = 0;
  const errors = [];

  let twClient, fromNumber;
  try {
    const tw = await getTwilioClientForTenant(tenantId);
    twClient = tw.client;
    fromNumber = tw.default_from_number;
    if (!fromNumber) throw new Error("twilio_default_from_missing");
  } catch (e) {
    // marca todos como failed
    for (const r of picked) {
      try {
        await pool.query(`UPDATE public.dialer_queue SET state='done', outcome='failed', updated_at=now() WHERE id=$1`, [r.queue_id]);
      } catch {}
    }
    return res.status(500).json({ ok: false, error: e.message });
  }

  for (const r of picked) {
    try {
      const twimlUrl =
        `${base}/twilio/parallel/twiml?tenant_id=${encodeURIComponent(tenantId)}` +
        `&campaign_id=${encodeURIComponent(campaign_id)}` +
        `&queue_id=${encodeURIComponent(r.queue_id)}`;

      const statusCallback = `${base}/twilio/voice/status?queue_id=${encodeURIComponent(r.queue_id)}`;

      const call = await twClient.calls.create({
        to: r.phone_e164,
        from: fromNumber,
        url: twimlUrl,
        method: "GET",
        statusCallback,
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        statusCallbackMethod: "POST",
      });

      await pool.query(`UPDATE public.dialer_queue SET call_sid=$2, updated_at=now() WHERE id=$1`, [r.queue_id, call.sid]);

      launched += 1;
    } catch (e) {
      errors.push({ queue_id: r.queue_id, error: e.message });
      try {
        await pool.query(`UPDATE public.dialer_queue SET state='done', outcome='failed', updated_at=now() WHERE id=$1`, [r.queue_id]);
      } catch {}
    }
  }

  return res.json({
    ok: true,
    run_id: runId,
    picked: picked.length,
    launched,
    errors,
  });
});

// ---------------------
// Middleware de manejo de errores para multer
// ---------------------
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        ok: false, 
        error: 'file_too_large', 
        message: 'El archivo es demasiado grande. El tamaño máximo es 10MB.' 
      });
    }
    return res.status(400).json({ 
      ok: false, 
      error: 'upload_error', 
      message: error.message 
    });
  }
  
  if (error.message && error.message.includes('Solo se permiten archivos')) {
    return res.status(400).json({ 
      ok: false, 
      error: 'invalid_file_type', 
      message: error.message 
    });
  }
  
  next(error);
});

// ---------------------
// Start server
// ---------------------
const port = process.env.PORT || 3001;
app.listen(port, () => console.log("API on http://localhost:" + port));