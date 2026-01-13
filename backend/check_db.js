require("dotenv").config();
const { Pool } = require("pg");

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL });

  const a = await p.query(
    "select current_database() db, inet_server_addr() ip, inet_server_port() port, current_user usr"
  );
  console.log("DB_INFO:", a.rows[0]);

  const b = await p.query("select to_regclass('public.tenant_taskrouter_config') as tr");
  console.log("TO_REGCLASS:", b.rows[0]);

  const c = await p.query(`
    select table_schema, table_name
    from information_schema.tables
    where table_name ilike '%taskrouter%'
    order by table_schema, table_name
  `);
  console.log("TASKROUTER_TABLES:", c.rows);

  await p.end();
})().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});