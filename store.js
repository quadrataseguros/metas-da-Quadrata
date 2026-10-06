// Onde os dados ficam: Postgres quando DATABASE_URL existe (Render), senão um arquivo JSON local (testes).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const url = process.env.DATABASE_URL;

if (url) {
  const { Pool } = require("pg");
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
  const q = (sql, args) => pool.query(sql, args);

  module.exports = {
    tipo: "postgres",
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS vendas (
        id TEXT PRIMARY KEY, vendedora TEXT NOT NULL, produto TEXT NOT NULL, seguradora TEXT NOT NULL,
        valor NUMERIC NOT NULL DEFAULT 0, data DATE NOT NULL, obs TEXT NOT NULL DEFAULT '', ts BIGINT NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q(`ALTER TABLE vendas ADD COLUMN IF NOT EXISTS cliente TEXT NOT NULL DEFAULT ''`);
      await q(`ALTER TABLE vendas ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'novo'`);
      await q(`ALTER TABLE vendas ADD COLUMN IF NOT EXISTS credito NUMERIC`);
      await q(`ALTER TABLE vendas ADD COLUMN IF NOT EXISTS percentual NUMERIC`);
      await q(`ALTER TABLE vendas ADD COLUMN IF NOT EXISTS comissao NUMERIC`);
      await q(`CREATE INDEX IF NOT EXISTS vendas_data ON vendas (data)`);
      await q(`CREATE TABLE IF NOT EXISTS historico (chave TEXT PRIMARY KEY, valores JSONB NOT NULL, atualizado TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS config (id TEXT PRIMARY KEY, dados JSONB NOT NULL)`);
    },
    async estado() {
      const [v, h, c] = await Promise.all([
        q(`SELECT id, vendedora, produto, seguradora, valor::float AS valor, to_char(data,'YYYY-MM-DD') AS data, obs, ts,
                tipo, cliente, percentual::float AS percentual, comissao::float AS comissao, credito::float AS credito
           FROM vendas WHERE data >= (current_date - interval '400 days') ORDER BY data DESC, ts DESC`),
        q(`SELECT chave, valores FROM historico`),
        q(`SELECT dados FROM config WHERE id = 'regras'`),
      ]);
      const ts = (r) => ({ ...r, ts: Number(r.ts) });
      return {
        vendas: v.rows.map(ts),
        historico: Object.fromEntries(h.rows.map((r) => [r.chave, { valores: r.valores }])),
        regras: c.rows[0] ? c.rows[0].dados : null,
      };
    },
    async addVenda(v) {
      const id = crypto.randomUUID();
      await q(`INSERT INTO vendas (id, vendedora, produto, seguradora, valor, data, obs, ts, cliente, percentual, comissao, tipo, credito) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, v.vendedora, v.produto, v.seguradora, v.valor, v.data, v.obs, v.ts, v.cliente, v.percentual, v.comissao, v.tipo, v.credito]);
      return { id, ...v };
    },
    delVenda: (id) => q(`DELETE FROM vendas WHERE id = $1`, [id]),
    zerarVendas: () => q(`DELETE FROM vendas`),
    setHistorico: (chave, valores) => q(
      `INSERT INTO historico (chave, valores) VALUES ($1, $2) ON CONFLICT (chave) DO UPDATE SET valores = $2, atualizado = now()`,
      [chave, JSON.stringify(valores)]),
    setRegras: (r) => q(`INSERT INTO config (id, dados) VALUES ('regras', $1) ON CONFLICT (id) DO UPDATE SET dados = $1`, [JSON.stringify(r)]),
  };
} else {
  const file = process.env.DATA_FILE || path.join(__dirname, "dados-local.json");
  let db = { vendas: [], historico: {}, regras: null };
  const save = () => fs.writeFileSync(file, JSON.stringify(db, null, 2));
  module.exports = {
    tipo: "arquivo local " + file,
    async init() { if (fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, "utf8")); },
    async estado() { return db; },
    async addVenda(v) { const venda = { id: crypto.randomUUID(), ...v }; db.vendas.unshift(venda); save(); return venda; },
    async delVenda(id) { db.vendas = db.vendas.filter((v) => v.id !== id); save(); },
    async zerarVendas() { db.vendas = []; save(); },
    async setHistorico(chave, valores) { db.historico[chave] = { valores }; save(); },
    async setRegras(r) { db.regras = r; save(); },
  };
}
