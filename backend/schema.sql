-- Power Dialer Database Schema

-- Tenants (multi-tenant support)
CREATE TABLE IF NOT EXISTS public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Users
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  password_hash TEXT NOT NULL,
  role VARCHAR(50) DEFAULT 'agent', -- admin, manager, agent
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(tenant_id, email)
);

-- Campaigns
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'draft', -- draft, active, paused, completed
  start_date DATE,
  end_date DATE,
  call_hours_start TIME DEFAULT '09:00',
  call_hours_end TIME DEFAULT '18:00',
  max_attempts INTEGER DEFAULT 3,
  retry_delay_minutes INTEGER DEFAULT 60,
  dialing_ratio DECIMAL(3,1) DEFAULT 1.0,
  script TEXT,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Leads
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name VARCHAR(255),
  phone_e164 VARCHAR(20) NOT NULL,
  email VARCHAR(255),
  status VARCHAR(50) DEFAULT 'new', -- new, contacted, no_answer, invalid, dnc
  source VARCHAR(100),
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(tenant_id, phone_e164)
);

-- Queue (leads assigned to campaigns)
CREATE TABLE IF NOT EXISTS public.queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending', -- pending, calling, completed, failed
  attempts INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMP,
  next_attempt_at TIMESTAMP DEFAULT now(),
  disposition VARCHAR(100), -- contacted, no_answer, voicemail, invalid, callback
  notes TEXT,
  assigned_to UUID REFERENCES public.users(id),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(campaign_id, lead_id)
);

-- Call Log
CREATE TABLE IF NOT EXISTS public.call_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  queue_id UUID REFERENCES public.queue(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  call_sid VARCHAR(100),
  phone_number VARCHAR(20),
  direction VARCHAR(20), -- inbound, outbound
  status VARCHAR(50), -- initiated, ringing, answered, completed, failed, busy, no-answer
  duration_seconds INTEGER,
  recording_url TEXT,
  disposition VARCHAR(100),
  notes TEXT,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

-- Audit Log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  meta JSONB DEFAULT '{}'::jsonb,
  ip_address VARCHAR(50),
  created_at TIMESTAMP DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_tenant ON public.users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON public.campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON public.campaigns(status);
CREATE INDEX IF NOT EXISTS idx_leads_tenant ON public.leads(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.leads(phone_e164);
CREATE INDEX IF NOT EXISTS idx_queue_campaign ON public.queue(campaign_id);
CREATE INDEX IF NOT EXISTS idx_queue_status ON public.queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_next_attempt ON public.queue(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_call_log_tenant ON public.call_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_call_log_agent ON public.call_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_call_log_campaign ON public.call_log(campaign_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON public.audit_log(tenant_id);
