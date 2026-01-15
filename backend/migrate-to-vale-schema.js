require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Iniciando migración al schema de Vale...\n');
    
    await client.query('BEGIN');
    
    // 1. Crear tabla email_verifications (para cambios de email en admin settings)
    console.log('📧 Creando tabla email_verifications...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.email_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        new_email VARCHAR(255) NOT NULL,
        verification_code VARCHAR(10) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT now(),
        UNIQUE(user_id)
      );
    `);
    console.log('✅ Tabla email_verifications creada\n');
    
    // 2. Agregar columnas faltantes a campaigns
    console.log('📋 Actualizando tabla campaigns...');
    
    await client.query(`
      ALTER TABLE public.campaigns 
      ADD COLUMN IF NOT EXISTS call_hours_start TIME DEFAULT '09:00';
    `);
    
    await client.query(`
      ALTER TABLE public.campaigns 
      ADD COLUMN IF NOT EXISTS call_hours_end TIME DEFAULT '18:00';
    `);
    
    await client.query(`
      ALTER TABLE public.campaigns 
      ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 3;
    `);
    
    await client.query(`
      ALTER TABLE public.campaigns 
      ADD COLUMN IF NOT EXISTS retry_delay_minutes INTEGER DEFAULT 60;
    `);
    
    await client.query(`
      ALTER TABLE public.campaigns 
      ADD COLUMN IF NOT EXISTS dialing_ratio DECIMAL(3,1) DEFAULT 1.0;
    `);
    
    console.log('✅ Tabla campaigns actualizada\n');
    
    // 3. Actualizar tabla users - agregar status si no existe
    console.log('👤 Actualizando tabla users...');
    
    await client.query(`
      ALTER TABLE public.users 
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
    `);
    
    // Actualizar usuarios existentes
    await client.query(`
      UPDATE public.users 
      SET status = 'active' 
      WHERE status IS NULL;
    `);
    
    console.log('✅ Tabla users actualizada\n');
    
    // 4. Crear índices adicionales para performance
    console.log('🔍 Creando índices...');
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_campaigns_status ON public.campaigns(status);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.leads(phone_e164);
    `);
    
    console.log('✅ Índices creados\n');
    
    await client.query('COMMIT');
    
    console.log('🎉 Migración completada exitosamente!\n');
    
    // Mostrar resumen de tablas
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log('📊 Tablas en la base de datos:');
    tables.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error en migración:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
