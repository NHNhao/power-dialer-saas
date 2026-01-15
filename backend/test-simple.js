require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");

console.log("1. Iniciando...");

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

console.log("2. Pool creado");

app.get("/", (req, res) => {
  console.log("3. GET /");
  res.send("OK");
});

app.get("/health", async (req, res) => {
  console.log("4. GET /health - intentando query");
  try {
    const r = await pool.query("select 1");
    console.log("5. Query OK");
    res.json({ ok: true });
  } catch (e) {
    console.log("5. Query ERROR:", e.message);
    res.json({ ok: false, error: e.message });
  }
});

const port = 3001;
const server = app.listen(port, () => {
  console.log(`6. Server on http://localhost:${port}`);
});

// Timeout de 5 segundos para salir si no responde
setTimeout(() => {
  console.log("TIMEOUT - saliendo");
  process.exit(1);
}, 5000);
