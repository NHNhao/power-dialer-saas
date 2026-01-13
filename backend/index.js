// index.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const twilio = require("twilio");

const app = express();
app.use(cors());
app.use(express.json());
// Twilio manda webhooks como application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));

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
 * Crea un nuevo tenant + usuario (admin o agent)
 */
app.post("/auth/register", async (req, res) => {
  const { tenant_name, admin_email, admin_name, admin_password, role } = req.body || {};

  if (!tenant_name || !admin_email || !admin_name || !admin_password) {
    return res.status(400).json({
      ok: false,
      error: "missing_fields",
      required: ["tenant_name", "admin_email", "admin_name", "admin_password"],
    });
  }

  // Validar rol
  const userRole = role && (role === 'admin' || role === 'agent') ? role : 'admin';

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
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, email, name, role, created_at`,
      [tenant.id, admin_email, admin_name, password_hash, userRole]
    );
    const user = userIns.rows[0];

    await client.query(
      `INSERT INTO public.audit_log (tenant_id, user_id, action, meta)
       VALUES ($1, $2, 'user_registered', $3::jsonb)`,
      [tenant.id, user.id, JSON.stringify({ tenant_name, admin_email, role: userRole })]
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

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "missing_email_or_password" });
  }

  try {
    const r = await pool.query(
      `SELECT id, tenant_id, email, name, role, password_hash
       FROM public.users
       WHERE email = $1
       LIMIT 1`,
      [email]
    );

    if (r.rowCount === 0) return res.status(401).json({ ok: false, error: "invalid_credentials" });

    const u = r.rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: "invalid_credentials" });

    const payload = {
      user_id: u.id,
      tenant_id: u.tenant_id,
      role: u.role,
      email: u.email,
      name: u.name,
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
      `SELECT id, name, status, created_at
       FROM public.campaigns
       WHERE tenant_id=$1
       ORDER BY created_at DESC
       LIMIT 50`,
      [tenantId]
    );
    return res.json({ ok: true, campaigns: r.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------------------
// Leads (MVP)
// ---------------------
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
       SET state='in_progress', updated_at=now(), attempts = attempts + 1
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
       SET state='in_progress', updated_at=now(), attempts = attempts + 1
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
 * TwiML (Power dialer básico)
 */
app.get("/twilio/voice/twiml", async (req, res) => {
  try {
    res.type("text/xml");
    const to = req.query.To || req.query.to || null;

    if (to) {
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>${to}</Dial>
</Response>`);
    }

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
           ended_at = CASE WHEN $3 IN ('completed','busy','failed','no-answer','canceled') THEN now() ELSE ended_at END,
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
// Start server
// ---------------------
const port = process.env.PORT || 3001;
app.listen(port, () => console.log("API on http://localhost:" + port));