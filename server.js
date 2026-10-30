const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { DatabaseSync } = require("node:sqlite");

const scrypt = promisify(crypto.scrypt);

const PUERTO = process.env.PORT || 3000;
const DIAS_SESION = 7;
const CARPETA_PUBLICA = path.join(__dirname, "public");

const db = new DatabaseSync(path.join(__dirname, "datos.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre        TEXT NOT NULL,
    nombre_lower  TEXT NOT NULL UNIQUE,
    sal           TEXT NOT NULL,
    hash          TEXT NOT NULL,
    creado        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sesiones (
    token_hash  TEXT PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira      INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS resenas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    pelicula_id  INTEGER NOT NULL,
    usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    puntaje      INTEGER NOT NULL CHECK (puntaje BETWEEN 1 AND 5),
    texto        TEXT NOT NULL,
    creado       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_resenas_pelicula ON resenas(pelicula_id);
`);
db.prepare("DELETE FROM sesiones WHERE expira < ?").run(Date.now());

const sha256 = (texto) => crypto.createHash("sha256").update(texto).digest("hex");

async function hashearClave(clave, sal) {
  const derivada = await scrypt(clave, sal, 64);
  return derivada.toString("hex");
}

async function claveCorrecta(clave, sal, hashGuardado) {
  const calculado = Buffer.from(await hashearClave(clave, sal), "hex");
  const guardado = Buffer.from(hashGuardado, "hex");
  return calculado.length === guardado.length && crypto.timingSafeEqual(calculado, guardado);
}

function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie || "").split(";")) {
    const [clave, ...resto] = parte.trim().split("=");
    if (clave === nombre) return decodeURIComponent(resto.join("="));
  }
  return null;
}

const COOKIE_BASE = "HttpOnly; SameSite=Lax; Path=/";

function crearSesion(res, usuarioId) {
  const token = crypto.randomBytes(32).toString("hex");
  const duracion = DIAS_SESION * 24 * 60 * 60;
  db.prepare("INSERT INTO sesiones (token_hash, usuario_id, expira) VALUES (?, ?, ?)")
    .run(sha256(token), usuarioId, Date.now() + duracion * 1000);
  res.setHeader("Set-Cookie", `sesion=${token}; ${COOKIE_BASE}; Max-Age=${duracion}`);
}

function usuarioDeLaSesion(req) {
  const token = leerCookie(req, "sesion");
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.nombre FROM sesiones s
    JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ? AND s.expira > ?`).get(sha256(token), Date.now()) || null;
}

const intentos = new Map();
function excedioIntentos(ip) {
  const ahora = Date.now();
  const recientes = (intentos.get(ip) || []).filter((t) => ahora - t < 15 * 60 * 1000);
  recientes.push(ahora);
  intentos.set(ip, recientes);
  return recientes.length > 20;
}

function responder(res, estado, datos) {
  res.writeHead(estado, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(datos));
}

function leerJSON(req) {
  return new Promise((resolve, reject) => {
    let cuerpo = "";
    req.on("data", (trozo) => {
      cuerpo += trozo;
      if (cuerpo.length > 10_000) {
        reject(new Error("Pedido demasiado grande"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!cuerpo) return resolve({});
      try {
        resolve(JSON.parse(cuerpo));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function servirArchivo(req, res, rutaUrl) {
  const pedido = rutaUrl === "/" ? "/index.html" : rutaUrl;
  const archivo = path.join(CARPETA_PUBLICA, decodeURIComponent(pedido));

  if (!archivo.startsWith(CARPETA_PUBLICA + path.sep)) {
    res.writeHead(403);
    return res.end("Prohibido");
  }
  fs.readFile(archivo, (error, contenido) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("No encontrado");
    }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo)] || "application/octet-stream" });
    res.end(contenido);
  });
}

const REGEX_USUARIO = /^[A-Za-z0-9_]{3,20}$/;

function validarCredenciales(usuario, clave) {
  if (typeof usuario !== "string" || !REGEX_USUARIO.test(usuario)) {
    return "El usuario debe tener 3 a 20 caracteres: letras, números o _.";
  }
  if (typeof clave !== "string" || clave.length < 6 || clave.length > 72) {
    return "La contraseña debe tener entre 6 y 72 caracteres.";
  }
  return null;
}

async function manejarAPI(req, res, ruta, busqueda) {
  const usuario = usuarioDeLaSesion(req);
  const ip = req.socket.remoteAddress;

  if (req.method !== "GET" && req.headers.origin) {
    let origenOk = false;
    try { origenOk = new URL(req.headers.origin).host === req.headers.host; } catch {}
    if (!origenOk) return responder(res, 403, { error: "Origen no permitido." });
  }

  if (req.method === "GET" && ruta === "/api/yo") {
    return responder(res, 200, { usuario: usuario ? usuario.nombre : null });
  }

  if (req.method === "POST" && ruta === "/api/registro") {
    if (excedioIntentos(ip)) return responder(res, 429, { error: "Demasiados intentos. Esperá unos minutos." });
    const { usuario: nombre, clave } = await leerJSON(req);
    const error = validarCredenciales(nombre, clave);
    if (error) return responder(res, 400, { error });

    const existe = db.prepare("SELECT 1 AS x FROM usuarios WHERE nombre_lower = ?").get(nombre.toLowerCase());
    if (existe) return responder(res, 409, { error: "Ese usuario ya existe. Probá con otro." });

    const sal = crypto.randomBytes(16).toString("hex");
    const hash = await hashearClave(clave, sal);
    const info = db.prepare("INSERT INTO usuarios (nombre, nombre_lower, sal, hash) VALUES (?, ?, ?, ?)")
      .run(nombre, nombre.toLowerCase(), sal, hash);
    crearSesion(res, info.lastInsertRowid);
    return responder(res, 201, { usuario: nombre });
  }

  if (req.method === "POST" && ruta === "/api/login") {
    if (excedioIntentos(ip)) return responder(res, 429, { error: "Demasiados intentos. Esperá unos minutos." });
    const { usuario: nombre, clave } = await leerJSON(req);
    if (typeof nombre !== "string" || typeof clave !== "string") {
      return responder(res, 400, { error: "Faltan datos." });
    }
    const fila = db.prepare("SELECT id, nombre, sal, hash FROM usuarios WHERE nombre_lower = ?")
      .get(nombre.toLowerCase());

    const sal = fila ? fila.sal : "00".repeat(16);
    const hashGuardado = fila ? fila.hash : "00".repeat(64);
    const coincide = await claveCorrecta(clave, sal, hashGuardado);

    if (!fila || !coincide) return responder(res, 401, { error: "Usuario o contraseña incorrectos." });
    crearSesion(res, fila.id);
    return responder(res, 200, { usuario: fila.nombre });
  }

  if (req.method === "POST" && ruta === "/api/logout") {
    const token = leerCookie(req, "sesion");
    if (token) db.prepare("DELETE FROM sesiones WHERE token_hash = ?").run(sha256(token));
    res.setHeader("Set-Cookie", `sesion=; ${COOKIE_BASE}; Max-Age=0`);
    return responder(res, 200, { ok: true });
  }

  if (req.method === "GET" && ruta === "/api/promedios") {
    const ids = (busqueda.get("ids") || "")
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 50);
    if (ids.length === 0) return responder(res, 200, {});

    const filas = db.prepare(`
      SELECT pelicula_id, ROUND(AVG(puntaje), 1) AS promedio, COUNT(*) AS cantidad
      FROM resenas
      WHERE pelicula_id IN (${ids.map(() => "?").join(",")})
      GROUP BY pelicula_id`).all(...ids);

    const resultado = {};
    for (const f of filas) resultado[f.pelicula_id] = { promedio: f.promedio, cantidad: f.cantidad };
    return responder(res, 200, resultado);
  }

  const coincideUsuario = ruta.match(/^\/api\/usuarios\/([A-Za-z0-9_]{3,20})\/resenas$/);
  if (req.method === "GET" && coincideUsuario) {
    const perfil = db.prepare("SELECT id, nombre FROM usuarios WHERE nombre_lower = ?")
      .get(coincideUsuario[1].toLowerCase());
    if (!perfil) return responder(res, 404, { error: "Usuario no encontrado." });

    const filas = db.prepare(`
      SELECT id, pelicula_id, puntaje, texto, creado
      FROM resenas WHERE usuario_id = ? ORDER BY id DESC LIMIT 100`).all(perfil.id);

    return responder(res, 200, {
      usuario: perfil.nombre,
      resenas: filas.map((f) => ({
        id: f.id,
        peliculaId: f.pelicula_id,
        puntaje: f.puntaje,
        texto: f.texto,
        fecha: f.creado,
        mia: usuario !== null && usuario.id === perfil.id,
      })),
    });
  }

  const coincideResenas = ruta.match(/^\/api\/resenas\/(\d+)$/);
  if (coincideResenas) {
    const numero = Number(coincideResenas[1]);

    if (req.method === "GET") {
      const filas = db.prepare(`
        SELECT r.id, r.puntaje, r.texto, r.creado, r.usuario_id, u.nombre AS autor
        FROM resenas r JOIN usuarios u ON u.id = r.usuario_id
        WHERE r.pelicula_id = ? ORDER BY r.id DESC`).all(numero);
      return responder(res, 200, filas.map((f) => ({
        id: f.id,
        autor: f.autor,
        puntaje: f.puntaje,
        texto: f.texto,
        fecha: f.creado,
        mia: usuario !== null && f.usuario_id === usuario.id,
      })));
    }

    if (req.method === "POST") {
      if (!usuario) return responder(res, 401, { error: "Tenés que iniciar sesión." });
      const { puntaje, texto } = await leerJSON(req);
      const textoLimpio = typeof texto === "string" ? texto.trim() : "";
      if (!Number.isInteger(puntaje) || puntaje < 1 || puntaje > 5) {
        return responder(res, 400, { error: "El puntaje debe ser de 1 a 5." });
      }
      if (textoLimpio.length < 1 || textoLimpio.length > 1000) {
        return responder(res, 400, { error: "La reseña debe tener entre 1 y 1000 caracteres." });
      }
      const info = db.prepare("INSERT INTO resenas (pelicula_id, usuario_id, puntaje, texto) VALUES (?, ?, ?, ?)")
        .run(numero, usuario.id, puntaje, textoLimpio);
      return responder(res, 201, { id: Number(info.lastInsertRowid) });
    }

    if (req.method === "DELETE") {
      if (!usuario) return responder(res, 401, { error: "Tenés que iniciar sesión." });
      const info = db.prepare("DELETE FROM resenas WHERE id = ? AND usuario_id = ?").run(numero, usuario.id);
      if (info.changes === 0) return responder(res, 404, { error: "No se encontró tu reseña." });
      return responder(res, 200, { ok: true });
    }
  }

  return responder(res, 404, { error: "Ruta no encontrada." });
}

const servidor = http.createServer(async (req, res) => {
  try {
    const { pathname, searchParams } = new URL(req.url, "http://localhost");
    if (pathname.startsWith("/api/")) {
      await manejarAPI(req, res, pathname, searchParams);
    } else if (req.method === "GET") {
      servirArchivo(req, res, pathname);
    } else {
      res.writeHead(405);
      res.end();
    }
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) responder(res, 400, { error: "Pedido inválido." });
  }
});

servidor.listen(PUERTO, () => {
  console.log(`CineReseñas funcionando en http://localhost:${PUERTO}`);
});