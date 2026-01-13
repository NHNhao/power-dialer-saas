require('dotenv').config();
const { Pool } = require('pg');

async function testConnection() {
  console.log('DATABASE_URL:', process.env.DATABASE_URL);
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const result = await pool.query('SELECT NOW() as now, version() as version');
    console.log('✅ Conexión exitosa!');
    console.log('Hora:', result.rows[0].now);
    console.log('Versión:', result.rows[0].version);
    await pool.end();
  } catch (error) {
    console.error('❌ Error de conexión:', error.message);
    process.exit(1);
  }
}

testConnection();
