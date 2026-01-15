require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function addUsernameColumn() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Agregando columna username a la tabla users...');
    
    // Agregar columna username (permitir NULL temporalmente)
    await client.query(`
      ALTER TABLE public.users 
      ADD COLUMN IF NOT EXISTS username VARCHAR(100);
    `);
    
    console.log('✅ Columna username agregada');
    
    // Actualizar usuarios existentes: generar username a partir del email
    console.log('🔄 Actualizando usuarios existentes...');
    
    await client.query(`
      UPDATE public.users 
      SET username = LOWER(SPLIT_PART(email, '@', 1))
      WHERE username IS NULL;
    `);
    
    console.log('✅ Usuarios actualizados con username basado en email');
    
    // Crear índice único en username
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_username_tenant_unique 
      ON public.users (tenant_id, username);
    `);
    
    console.log('✅ Índice único creado');
    
    // Ahora hacer la columna NOT NULL
    await client.query(`
      ALTER TABLE public.users 
      ALTER COLUMN username SET NOT NULL;
    `);
    
    console.log('✅ Columna username configurada como NOT NULL');
    
    console.log('\n🎉 Migración completada exitosamente!');
    console.log('\nUsuarios actualizados:');
    
    const result = await client.query(`
      SELECT id, username, email, role 
      FROM public.users 
      ORDER BY created_at
    `);
    
    console.table(result.rows);
    
  } catch (error) {
    console.error('❌ Error en migración:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

addUsernameColumn()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
