// Quadrata - Metas: painel de metas da equipe da Quadrata Seguros.
// Três telas no mesmo endereço: #vendedoras, #master e #monitor.
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const store = require("./store");

const PORT = process.env.PORT || 3000;
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || "";
const PINS = {
  dyovanna: process.env.PIN_DYOVANNA || "",
  anaclara: process.env.PIN_ANACLARA || "",
  alana: process.env.PIN_ALANA || "",
  fabricio: process.env.PIN_FABRICIO || "",
};
const MONITOR_KEY = process.env.MONITOR_KEY || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const COOKIE = "arena_sessao";
const MAX_AGE_DAYS = 180;

if (!MASTER_PASSWORD || Object.values(PINS).some((p) => !p)) {
  console.warn("Aviso: defina MASTER_PASSWORD, PIN_DYOVANNA, PIN_ANACLARA, PIN_ALANA e PIN_FABRICIO nas variáveis de ambiente.");
}

// Percentual, comissão e nome do cliente são sigilosos: só o master recebe.
const SIGILO = ["cliente", "percentual", "comissao"];
const publica = (v) => { const o = { ...v }; for (const k of SIGILO) delete o[k]; return o; };

const VENDEDORAS = ["dyovanna", "anaclara", "alana", "fabricio"];
const PRODUTOS = ["auto", "resid", "vida", "empre", "outros", "financ", "consorcio"];
const SO_PORTO = ["financ", "consorcio"];
const SEGURADORAS = ["PORTO", "AZUL", "ITAÚ", "ALLIANZ", "TOKIO MARINE", "BRADESCO", "YELLUM", "HDI", "SUHAI", "ZURICH", "MITSUI", "ALIRO", "OUTRA"];

/* ---------- sessão em cookie assinado ---------- */
const sign = (v) => crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("base64url");
function makeToken(role, vendedora) {
  const body = Buffer.from(JSON.stringify({ role, vendedora, exp: Date.now() + MAX_AGE_DAYS * 864e5 })).toString("base64url");
  return body + "." + sign(body);
}
function readToken(tok) {
  if (!tok || !tok.includes(".")) return null;
  const [body, sig] = tok.split(".");
  const good = sign(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const d = JSON.parse(Buffer.from(body, "base64url").toString());
    return d.exp > Date.now() ? { role: d.role, vendedora: d.vendedora || null } : null;
  } catch { return null; }
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}
function setSession(res, role, vendedora) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${makeToken(role, vendedora)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_DAYS * 86400}${secure}`);
}
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "200kb" }));
app.use((req, _res, next) => {
  const t = readToken(cookies(req)[COOKIE]);
  req.role = t ? t.role : null;
  req.vendedora = t ? t.vendedora : null;
  next();
});

const need = (...roles) => (req, res, next) =>
  roles.includes(req.role) ? next() : res.status(req.role ? 403 : 401).json({ erro: req.role ? "Sem permissão para esta ação." : "Faça login." });

/* ---------- login ---------- */
const tries = new Map(); // limite simples contra chute de senha
function tooMany(ip) {
  const now = Date.now(), t = (tries.get(ip) || []).filter((x) => now - x < 10 * 60e3);
  tries.set(ip, t);
  return t.length >= 10;
}
app.post("/api/login", (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ erro: "Muitas tentativas. Espere alguns minutos." });
  const { tipo, senha, vendedora } = req.body || {};
  if (tipo === "master" && MASTER_PASSWORD && same(senha, MASTER_PASSWORD)) { setSession(res, "master"); return res.json({ role: "master" }); }
  if (tipo === "equipe" && VENDEDORAS.includes(vendedora) && PINS[vendedora] && same(senha, PINS[vendedora])) {
    setSession(res, "equipe", vendedora);
    return res.json({ role: "equipe", vendedora });
  }
  tries.get(req.ip).push(Date.now());
  res.status(401).json({ erro: "Senha incorreta." });
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});
// Link fixo para a TV: /tv?k=CHAVE entra como monitor (só leitura) e abre a tela do monitor.
app.get("/tv", (req, res) => {
  if (MONITOR_KEY && same(req.query.k || "", MONITOR_KEY)) { setSession(res, "monitor"); return res.redirect("/#monitor"); }
  res.status(401).send("Link do monitor inválido.");
});
app.get("/api/eu", (req, res) => res.json({ role: req.role || null, vendedora: req.vendedora || null }));

/* ---------- dados ---------- */
// Premiação do mês: premioPct% da comissão gerada pelo que passou do mesmo mês do ano anterior.
// A comissão fica só no servidor; o painel recebe apenas o valor da premiação.
function premiacoes(e) {
  const r = e.regras || {}, pct = +(r.premioPct ?? 10), gr = 1 + (+(r.crescimento ?? 18)) / 100;
  const meses = {};
  for (const v of e.vendas || []) (meses[v.data.slice(0, 7)] ??= []).push(v);
  const out = {};
  for (const [chave, lista] of Object.entries(meses)) {
    const tot = lista.reduce((a, v) => a + (+v.valor || 0), 0);
    const base = Object.values(((e.historico || {})[(+chave.slice(0, 4) - 1) + chave.slice(4)] || {}).valores || {})
      .reduce((a, prods) => a + Object.values(prods).reduce((b, x) => b + (+x || 0), 0), 0);
    const comp = lista.filter((v) => v.comissao != null);
    const prem = comp.reduce((a, v) => a + (+v.valor || 0), 0), com = comp.reduce((a, v) => a + (+v.comissao || 0), 0);
    let pool = 0;
    if (base > 0 && tot > base && prem > 0 && !(r.premioSoNaMeta && tot < base * gr)) pool = (tot - base) * (com / prem) * pct / 100;
    out[chave] = Math.round(pool * 100) / 100;
  }
  return out;
}
const READ = need("master", "equipe", "monitor");
app.get("/api/estado", READ, async (req, res, next) => {
  try {
    const e = await store.estado();
    const premiacao = premiacoes(e);
    res.json(req.role === "master" ? { ...e, premiacao } : { ...e, vendas: (e.vendas || []).map(publica), premiacao });
  } catch (e) { next(e); }
});

app.post("/api/vendas", need("master", "equipe"), async (req, res, next) => {
  try {
    const b = req.body || {};
    const produto = String(b.produto || "");
    const seguradora = SO_PORTO.includes(produto) ? "PORTO" : String(b.seguradora || "");
    const data = String(b.data || "");
    // Vendedora só lança no próprio nome; o master pode lançar por qualquer uma.
    const vendedora = req.role === "equipe" ? req.vendedora : b.vendedora;
    if (!VENDEDORAS.includes(vendedora)) return res.status(400).json({ erro: "Vendedora inválida." });
    if (!PRODUTOS.includes(produto)) return res.status(400).json({ erro: "Produto inválido." });
    if (!SEGURADORAS.includes(seguradora)) return res.status(400).json({ erro: "Seguradora inválida." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ erro: "Data inválida." });
    const tipo = String(b.tipo || "");
    if (!["novo", "renovacao"].includes(tipo)) return res.status(400).json({ erro: "Informe se é novo seguro ou renovação." });
    const cliente = String(b.cliente || "").trim().slice(0, 80);
    if (!cliente) return res.status(400).json({ erro: "Informe o nome do cliente." });
    const percentual = Number(String(b.percentual ?? "").replace(",", "."));
    if (!(percentual > 0 && percentual <= 100)) return res.status(400).json({ erro: "Informe o percentual de comissão (entre 0 e 100)." });
    const valor = Math.max(0, Math.min(1e9, +b.valor || 0));
    if (!(valor > 0)) return res.status(400).json({ erro: "Informe o prêmio líquido." });
    const venda = await store.addVenda({
      vendedora, produto, seguradora, data, valor, tipo,
      obs: "", ts: Date.now(),
      cliente, percentual, comissao: Math.round(valor * percentual) / 100,
    });
    broadcast({ tipo: "venda", venda: publica(venda) });
    res.json(req.role === "master" ? venda : publica(venda));
  } catch (e) { next(e); }
});

app.delete("/api/vendas/:id", need("master"), async (req, res, next) => {
  try { await store.delVenda(req.params.id); broadcast({ tipo: "mudou" }); res.json({ ok: true }); } catch (e) { next(e); }
});

app.put("/api/historico/:chave", need("master"), async (req, res, next) => {
  try {
    if (!/^\d{4}-\d{2}$/.test(req.params.chave)) return res.status(400).json({ erro: "Mês inválido." });
    const valores = {};
    for (const [sg, prods] of Object.entries((req.body || {}).valores || {})) {
      if (!SEGURADORAS.includes(sg) || typeof prods !== "object") continue;
      for (const [p, v] of Object.entries(prods)) {
        if (!PRODUTOS.includes(p) || (SO_PORTO.includes(p) && sg !== "PORTO")) continue;
        const n = Math.max(0, +v || 0);
        if (n) (valores[sg] ??= {})[p] = n;
      }
    }
    await store.setHistorico(req.params.chave, valores);
    broadcast({ tipo: "mudou" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.put("/api/regras", need("master"), async (req, res, next) => {
  try {
    const r = req.body || {};
    if (!Array.isArray(r.produtos) || !Array.isArray(r.niveis)) return res.status(400).json({ erro: "Regras inválidas." });
    if (JSON.stringify(r).length > 20000) return res.status(400).json({ erro: "Regras grandes demais." });
    await store.setRegras(r);
    broadcast({ tipo: "mudou" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------- tempo real (Server-Sent Events) ---------- */
const clients = new Set();
app.get("/api/ao-vivo", READ, (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 5000\n\n");
  clients.add(res);
  req.on("close", () => clients.delete(res));
});
function broadcast(msg) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const c of clients) c.write(line);
}
setInterval(() => { for (const c of clients) c.write(": ping\n\n"); }, 25e3);

/* ---------- páginas ---------- */
app.get("/healthz", (_req, res) => res.send("ok"));
app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/", (req, res) => (req.role ? res.sendFile(path.join(__dirname, "public", "index.html")) : res.redirect("/login")));
app.use(express.static(path.join(__dirname, "public"), { index: false }));

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ erro: "Erro no servidor. Tente de novo." }); });

store.init().then(() => app.listen(PORT, () => console.log(`Quadrata - Metas no ar na porta ${PORT} (${store.tipo})`)));
