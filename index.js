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
// Twilio manda webhooks como x-www-form-urlencoded
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
    try { await client.query("ROLLBACK"); } catch {}
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
    try { await client.query("ROLLBACK"); } catch {}
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
    try { await client.query("ROLLBACK"); } catch {}
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const q = await client.query(
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
      await client.query("COMMIT");
      return res.json({ ok: true, next: null });
    }

    row = q.rows[0];

    await client.query(
      `UPDATE public.dialer_queue
       SET state='in_progress', updated_at=now(), attempts = attempts + 1
       WHERE id=$1`,
      [row.queue_id]
    );

    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    return res.status(500).json({ ok: false, error: e.message });
  } finally {
    client.release();
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

// Helper: crea llamada Twilio para un item de la cola
async function startTwilioCall({ tenantId, queueId, toNumber }) {
  const cfg = await pool.query(
    `SELECT account_sid, auth_token, default_from_number
     FROM public.tenant_twilio_config
     WHERE tenant_id=$1
     LIMIT 1`,
    [tenantId]
  );
  if (cfg.rowCount === 0) throw new Error("twilio_config_missing");

  const { account_sid, auth_token, default_from_number } = cfg.rows[0];
  if (!default_from_number) throw new Error("twilio_default_from_missing");

  const base = process.env.PUBLIC_BASE_URL;
  if (!base) throw new Error("PUBLIC_BASE_URL_missing");

  const twimlUrl = `${base}/twilio/voice/twiml?queue_id=${encodeURIComponent(queueId)}`;
  const statusCallback = `${base}/twilio/voice/status?queue_id=${encodeURIComponent(queueId)}`;

  const client = twilio(account_sid, auth_token);

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
 * TwiML
 */
app.get("/twilio/voice/twiml", async (req, res) => {
  res.type("text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="es-ES">Hola, te habla un asesor. Un momento por favor.</Say>
  <Pause length="1"/>
  <Say language="es-ES">Gracias. Te llamaremos más tarde.</Say>
  <Hangup/>
</Response>`);
});

/**
 * Webhook de estado (Twilio)
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

const port = process.env.PORT || 3001;
app.listen(port, () => console.log("API on http://localhost:" + port));