const API_URL = "https://api.themoviedb.org/3";
const IMG_URL = "https://image.tmdb.org/t/p/w342";
const FOTO_URL = "https://image.tmdb.org/t/p/w185";
const SIN_POSTER = "https://placehold.co/342x513/2a2533/8d84a0?text=Sin+poster";

const listaPeliculas = document.getElementById("lista-peliculas");
const tituloLista = document.getElementById("titulo-lista");
const formBusqueda = document.getElementById("form-busqueda");
const inputBusqueda = document.getElementById("input-busqueda");
const modal = document.getElementById("modal");
const detalle = document.getElementById("detalle");
const listaResenas = document.getElementById("lista-resenas");
const formResena = document.getElementById("form-resena");

let peliculaActualId = null;
let usuarioLogueado = null;

function limpiarTexto(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}

async function pedirATMDB(ruta, parametros = {}) {
  const url = new URL(API_URL + ruta);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("language", "es-ES");
  for (const clave in parametros) {
    url.searchParams.set(clave, parametros[clave]);
  }

  const respuesta = await fetch(url);
  if (!respuesta.ok) {
    throw new Error("Error de TMDB: " + respuesta.status);
  }
  return respuesta.json();
}

async function api(ruta, { metodo = "GET", cuerpo } = {}) {
  const respuesta = await fetch("/api" + ruta, {
    method: metodo,
    headers: cuerpo ? { "Content-Type": "application/json" } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.error || "Error del servidor");
  }
  return datos;
}

const filtroGenero = document.getElementById("filtro-genero");
const filtroOrden = document.getElementById("filtro-orden");
const botonMas = document.getElementById("cargar-mas");

const TITULOS_ORDEN = {
  "popularity.desc": "Películas populares",
  "vote_average.desc": "Mejor puntuadas",
  "primary_release_date.desc": "Estrenos recientes",
};

const estado = { modo: "explorar", texto: "", pagina: 1, totalPaginas: 1 };
let numeroCarga = 0;

function crearTarjeta(peli) {
  const anio = peli.release_date ? peli.release_date.slice(0, 4) : "s/f";
  const poster = peli.poster_path ? IMG_URL + peli.poster_path : SIN_POSTER;

  const tarjeta = document.createElement("article");
  tarjeta.className = "pelicula";
  tarjeta.innerHTML = `
    <img src="${poster}" alt="Póster de ${limpiarTexto(peli.title)}">
    <div class="info">
      <h3>${limpiarTexto(peli.title)}</h3>
      <span>${anio} · <span class="nota">★</span> ${peli.vote_average.toFixed(1)}</span>
      <div class="usuarios" data-id="${peli.id}"></div>
    </div>
  `;
  tarjeta.addEventListener("click", () => abrirDetalle(peli.id));
  return tarjeta;
}

function mostrarPeliculas(peliculas, anexar) {
  if (!anexar) listaPeliculas.innerHTML = "";

  if (peliculas.length === 0 && !anexar) {
    listaPeliculas.innerHTML = "<p class='suave'>No se encontraron películas.</p>";
    return;
  }

  peliculas.forEach((peli) => listaPeliculas.appendChild(crearTarjeta(peli)));
  cargarPromedios(peliculas.map((p) => p.id));
}

async function cargarPromedios(ids) {
  if (ids.length === 0) return;
  try {
    const promedios = await api("/promedios?ids=" + ids.join(","));
    for (const id of ids) {
      const dato = promedios[id];
      const texto = dato ? `Filmeasta: ★ ${dato.promedio.toFixed(1)} (${dato.cantidad})` : "";
      listaPeliculas
        .querySelectorAll(`.usuarios[data-id="${id}"]`)
        .forEach((caja) => (caja.textContent = texto));
    }
  } catch (error) {
    console.error(error);
  }
}

async function cargarLista(anexar = false) {
  const miCarga = ++numeroCarga;
  botonMas.disabled = true;

  if (!anexar) {
    estado.pagina = 1;
    listaPeliculas.innerHTML = "<p class='suave'>Cargando...</p>";
    botonMas.classList.add("oculto");
  }

  if (estado.modo === "buscar") {
    tituloLista.textContent = `Resultados para "${estado.texto}"`;
  } else {
    const genero = filtroGenero.value ? filtroGenero.selectedOptions[0].textContent : "";
    tituloLista.textContent = TITULOS_ORDEN[filtroOrden.value] + (genero ? " · " + genero : "");
  }

  try {
    let datos;
    if (estado.modo === "buscar") {
      datos = await pedirATMDB("/search/movie", { query: estado.texto, page: estado.pagina });
    } else {
      const orden = filtroOrden.value;
      const parametros = { sort_by: orden, page: estado.pagina, include_adult: "false" };
      if (filtroGenero.value) parametros.with_genres = filtroGenero.value;
      if (orden === "vote_average.desc") {
        parametros["vote_count.gte"] = 500;
      }
      if (orden === "primary_release_date.desc") {
        parametros["primary_release_date.lte"] = new Date().toISOString().slice(0, 10);
        parametros["vote_count.gte"] = 20;
      }
      datos = await pedirATMDB("/discover/movie", parametros);
    }
    if (miCarga !== numeroCarga) return;

    estado.totalPaginas = Math.min(datos.total_pages, 500);
    mostrarPeliculas(datos.results, anexar);
  } catch (error) {
    if (miCarga !== numeroCarga) return;
    if (anexar) {
      estado.pagina--;
      alert("No se pudieron cargar más películas. Probá de nuevo.");
    } else {
      listaPeliculas.innerHTML =
        "<p>No se pudieron cargar las películas. ¿Pusiste tu API key en public/config.js?</p>";
    }
    console.error(error);
  } finally {
    if (miCarga === numeroCarga) {
      botonMas.disabled = false;
      botonMas.classList.toggle("oculto", estado.pagina >= estado.totalPaginas);
    }
  }
}

async function cargarGeneros() {
  try {
    const datos = await pedirATMDB("/genre/movie/list");
    filtroGenero.innerHTML =
      '<option value="">Todos</option>' +
      datos.genres.map((g) => `<option value="${g.id}">${limpiarTexto(g.name)}</option>`).join("");
  } catch (error) {
    console.error(error);
  }
}

function alCambiarFiltro() {
  inputBusqueda.value = "";
  estado.modo = "explorar";
  cargarLista(false);
}
filtroGenero.addEventListener("change", alCambiarFiltro);
filtroOrden.addEventListener("change", alCambiarFiltro);

formBusqueda.addEventListener("submit", (evento) => {
  evento.preventDefault();
  const texto = inputBusqueda.value.trim();
  if (!texto) return;

  filtroGenero.value = "";
  filtroOrden.value = "popularity.desc";
  estado.modo = "buscar";
  estado.texto = texto;
  cargarLista(false);
});

botonMas.addEventListener("click", () => {
  estado.pagina++;
  cargarLista(true);
});

function crearReparto(creditos) {
  const actores = (creditos && creditos.cast ? creditos.cast : []).slice(0, 12);
  if (actores.length === 0) return "";

  const tarjetas = actores
    .map((a) => {
      const foto = a.profile_path
        ? `<img src="${FOTO_URL + a.profile_path}" alt="${limpiarTexto(a.name)}" loading="lazy">`
        : `<div class="sin-foto">${limpiarTexto(a.name.charAt(0))}</div>`;
      return `
        <div class="actor">
          ${foto}
          <strong>${limpiarTexto(a.name)}</strong>
          <span>${limpiarTexto(a.character || "")}</span>
        </div>`;
    })
    .join("");

  return `<h3>Reparto</h3><div class="reparto">${tarjetas}</div>`;
}

function elegirTrailer(videos) {
  const candidatos = (videos && videos.results ? videos.results : []).filter(
    (v) =>
      v.site === "YouTube" &&
      /^[\w-]{6,15}$/.test(v.key) &&
      (v.type === "Trailer" || v.type === "Teaser")
  );
  const puntos = (v) =>
    (v.type === "Trailer" ? 10 : 0) + (v.iso_639_1 === "es" ? 5 : 0) + (v.official ? 1 : 0);
  candidatos.sort((a, b) => puntos(b) - puntos(a));
  return candidatos[0] || null;
}

detalle.addEventListener("click", (evento) => {
  const boton = evento.target.closest(".ver-trailer");
  if (!boton) return;
  const clave = boton.dataset.clave;
  if (!/^[\w-]{6,15}$/.test(clave)) return;
  boton.closest(".trailer").innerHTML = `
    <iframe src="https://www.youtube-nocookie.com/embed/${clave}?autoplay=1"
      title="Tráiler" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`;
});

async function abrirDetalle(id) {
  peliculaActualId = id;
  detalle.innerHTML = "<p>Cargando...</p>";
  listaResenas.innerHTML = "";
  document.getElementById("resumen-resenas").textContent = "";
  modal.classList.remove("oculto");

  mostrarResenas();

  try {
    const peli = await pedirATMDB("/movie/" + id, {
      append_to_response: "credits,videos",
      include_video_language: "es,en",
    });
    if (peliculaActualId !== id) return;
    const poster = peli.poster_path ? IMG_URL + peli.poster_path : SIN_POSTER;
    const generos = peli.genres.map((g) => g.name).join(", ");
    const anio = peli.release_date ? peli.release_date.slice(0, 4) : "s/f";
    const trailer = elegirTrailer(peli.videos);

    detalle.innerHTML = `
      <div class="detalle-cabecera">
        <img src="${poster}" alt="Póster de ${limpiarTexto(peli.title)}">
        <div>
          <h2>${limpiarTexto(peli.title)} <span class="suave">(${anio})</span></h2>
          <p class="suave">${limpiarTexto(generos)} · ${peli.runtime} min</p>
          <p><span class="nota">★</span> ${peli.vote_average.toFixed(1)} en TMDB</p>
          <p>${limpiarTexto(peli.overview || "Sin sinopsis disponible.")}</p>
        </div>
      </div>
      ${
        trailer
          ? `<div class="trailer"><button class="ver-trailer boton-secundario" data-clave="${trailer.key}">▶ Ver tráiler</button></div>`
          : ""
      }
      ${crearReparto(peli.credits)}
    `;
  } catch (error) {
    detalle.innerHTML = "<p>No se pudo cargar el detalle.</p>";
    console.error(error);
  }
}

function cerrarModal() {
  const idCerrado = peliculaActualId;
  modal.classList.add("oculto");
  detalle.innerHTML = "";
  peliculaActualId = null;
  if (idCerrado !== null) cargarPromedios([idCerrado]);
}

document.getElementById("cerrar-modal").addEventListener("click", cerrarModal);
modal.addEventListener("click", (evento) => {
  if (evento.target === modal) cerrarModal();
});

async function mostrarResenas() {
  const id = peliculaActualId;

  formResena.classList.toggle("oculto", !usuarioLogueado);
  document.getElementById("aviso-login").classList.toggle("oculto", !!usuarioLogueado);

  try {
    const resenas = await api("/resenas/" + id);
    if (peliculaActualId !== id) return;

    const resumen = document.getElementById("resumen-resenas");
    if (resenas.length === 0) {
      resumen.textContent = "";
      listaResenas.innerHTML = "<p class='suave'>Todavía no hay reseñas. ¡Sé el primero!</p>";
      return;
    }
    const promedio = resenas.reduce((suma, r) => suma + r.puntaje, 0) / resenas.length;
    resumen.textContent = `· ★ ${promedio.toFixed(1)} de 5 (${resenas.length} ${resenas.length === 1 ? "reseña" : "reseñas"})`;

    listaResenas.innerHTML = resenas
      .map(
        (r) => `
        <div class="resena">
          <div class="resena-cabecera">
            <div>
              <a href="#" class="autor" data-usuario="${limpiarTexto(r.autor)}"><strong>${limpiarTexto(r.autor)}</strong></a>
              <span class="estrellas">${"★".repeat(r.puntaje)}${"☆".repeat(5 - r.puntaje)}</span>
            </div>
            ${r.mia ? `<button class="borrar" data-id="${r.id}">Borrar</button>` : ""}
          </div>
          <p>${limpiarTexto(r.texto)}</p>
          <small class="suave">${new Date(r.fecha.replace(" ", "T") + "Z").toLocaleDateString("es-AR")}</small>
        </div>`
      )
      .join("");
  } catch (error) {
    listaResenas.innerHTML = "<p>No se pudieron cargar las reseñas. ¿Está corriendo el servidor?</p>";
    console.error(error);
  }
}

listaResenas.addEventListener("click", async (evento) => {
  const boton = evento.target.closest(".borrar");
  if (!boton) return;
  try {
    await api("/resenas/" + boton.dataset.id, { metodo: "DELETE" });
    mostrarResenas();
  } catch (error) {
    alert(error.message);
  }
});

formResena.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  try {
    await api("/resenas/" + peliculaActualId, {
      metodo: "POST",
      cuerpo: {
        puntaje: Number(document.getElementById("resena-puntaje").value),
        texto: document.getElementById("resena-texto").value,
      },
    });
    formResena.reset();
    mostrarResenas();
  } catch (error) {
    alert(error.message);
  }
});

const modalUsuario = document.getElementById("modal-usuario");
const usuarioTitulo = document.getElementById("usuario-titulo");
const usuarioResumen = document.getElementById("usuario-resumen");
const usuarioResenas = document.getElementById("usuario-resenas");
const cachePeliculas = new Map();
let usuarioMostrado = null;

function datosPelicula(id) {
  if (!cachePeliculas.has(id)) {
    cachePeliculas.set(id, pedirATMDB("/movie/" + id).catch(() => null));
  }
  return cachePeliculas.get(id);
}

async function abrirUsuario(nombre) {
  usuarioMostrado = nombre;
  usuarioTitulo.textContent = "Reseñas de " + nombre;
  usuarioResumen.textContent = "";
  usuarioResenas.innerHTML = "<p class='suave'>Cargando...</p>";
  modalUsuario.classList.remove("oculto");
  await mostrarResenasUsuario();
}

function cerrarUsuario() {
  modalUsuario.classList.add("oculto");
  usuarioMostrado = null;
}

async function mostrarResenasUsuario() {
  const nombre = usuarioMostrado;
  try {
    const datos = await api("/usuarios/" + encodeURIComponent(nombre) + "/resenas");
    if (usuarioMostrado !== nombre) return;
    usuarioTitulo.textContent = "Reseñas de " + datos.usuario;

    const total = datos.resenas.length;
    if (total === 0) {
      usuarioResumen.textContent = "";
      usuarioResenas.innerHTML = "<p class='suave'>Todavía no escribió reseñas.</p>";
      return;
    }

    const promedio = datos.resenas.reduce((suma, r) => suma + r.puntaje, 0) / total;
    usuarioResumen.textContent = `${total} ${total === 1 ? "reseña" : "reseñas"} · promedio ★ ${promedio.toFixed(1)}`;

    const peliculas = await Promise.all(datos.resenas.map((r) => datosPelicula(r.peliculaId)));
    if (usuarioMostrado !== nombre) return;

    usuarioResenas.innerHTML = datos.resenas
      .map((r, i) => {
        const peli = peliculas[i];
        const titulo = peli ? limpiarTexto(peli.title) : "Película " + r.peliculaId;
        const poster = peli && peli.poster_path ? IMG_URL + peli.poster_path : SIN_POSTER;
        return `
          <div class="resena resena-usuario">
            <img class="mini-poster" src="${poster}" alt="">
            <div class="resena-cuerpo">
              <div class="resena-cabecera">
                <a href="#" class="ver-pelicula" data-id="${r.peliculaId}"><strong>${titulo}</strong></a>
                ${r.mia ? `<button class="borrar" data-id="${r.id}" data-pelicula="${r.peliculaId}">Borrar</button>` : ""}
              </div>
              <span class="estrellas">${"★".repeat(r.puntaje)}${"☆".repeat(5 - r.puntaje)}</span>
              <p>${limpiarTexto(r.texto)}</p>
              <small class="suave">${new Date(r.fecha.replace(" ", "T") + "Z").toLocaleDateString("es-AR")}</small>
            </div>
          </div>`;
      })
      .join("");
  } catch (error) {
    if (usuarioMostrado !== nombre) return;
    usuarioResenas.innerHTML = "<p>No se pudieron cargar las reseñas de este usuario.</p>";
    console.error(error);
  }
}

listaResenas.addEventListener("click", (evento) => {
  const enlace = evento.target.closest(".autor");
  if (!enlace) return;
  evento.preventDefault();
  abrirUsuario(enlace.dataset.usuario);
});

usuarioResenas.addEventListener("click", async (evento) => {
  const enlace = evento.target.closest(".ver-pelicula");
  if (enlace) {
    evento.preventDefault();
    cerrarUsuario();
    abrirDetalle(Number(enlace.dataset.id));
    return;
  }

  const boton = evento.target.closest(".borrar");
  if (!boton) return;
  try {
    await api("/resenas/" + boton.dataset.id, { metodo: "DELETE" });
    await mostrarResenasUsuario();
    const peliculaId = Number(boton.dataset.pelicula);
    cargarPromedios([peliculaId]);
    if (peliculaActualId === peliculaId) mostrarResenas();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById("cerrar-usuario").addEventListener("click", cerrarUsuario);
modalUsuario.addEventListener("click", (evento) => {
  if (evento.target === modalUsuario) cerrarUsuario();
});

const zonaUsuario = document.getElementById("zona-usuario");
const modalAuth = document.getElementById("modal-auth");
const formAuth = document.getElementById("form-auth");
const authTitulo = document.getElementById("auth-titulo");
const authBoton = document.getElementById("auth-boton");
const authError = document.getElementById("auth-error");
const authCambio = document.getElementById("auth-cambio");
const authCambioTexto = document.getElementById("auth-cambio-texto");

let modoRegistro = false;

function mostrarZonaUsuario() {
  if (usuarioLogueado) {
    zonaUsuario.innerHTML = `
      <span class="saludo">Hola, <strong>${limpiarTexto(usuarioLogueado)}</strong></span>
      <button id="boton-mis-resenas" class="boton-secundario">Mis reseñas</button>
      <button id="boton-salir" class="boton-secundario">Salir</button>`;
    document.getElementById("boton-mis-resenas").addEventListener("click", () => abrirUsuario(usuarioLogueado));
    document.getElementById("boton-salir").addEventListener("click", cerrarSesion);
  } else {
    zonaUsuario.innerHTML = `<button id="boton-entrar">Iniciar sesión</button>`;
    document.getElementById("boton-entrar").addEventListener("click", () => abrirAuth(false));
  }
}

function abrirAuth(registro) {
  modoRegistro = registro;
  authTitulo.textContent = registro ? "Crear cuenta" : "Iniciar sesión";
  authBoton.textContent = registro ? "Registrarme" : "Entrar";
  authCambioTexto.textContent = registro ? "¿Ya tenés cuenta?" : "¿No tenés cuenta?";
  authCambio.textContent = registro ? "Iniciá sesión" : "Registrate";
  document.getElementById("auth-clave").autocomplete = registro ? "new-password" : "current-password";
  authError.classList.add("oculto");
  formAuth.reset();
  modalAuth.classList.remove("oculto");
}

function cerrarAuth() {
  modalAuth.classList.add("oculto");
}

function mostrarErrorAuth(mensaje) {
  authError.textContent = mensaje;
  authError.classList.remove("oculto");
}

async function cerrarSesion() {
  try {
    await api("/logout", { metodo: "POST" });
  } catch (error) {
    console.error(error);
  }
  usuarioLogueado = null;
  mostrarZonaUsuario();
  if (peliculaActualId !== null) mostrarResenas();
  if (usuarioMostrado !== null) mostrarResenasUsuario();
}

authCambio.addEventListener("click", (evento) => {
  evento.preventDefault();
  abrirAuth(!modoRegistro);
});

document.getElementById("cerrar-auth").addEventListener("click", cerrarAuth);
modalAuth.addEventListener("click", (evento) => {
  if (evento.target === modalAuth) cerrarAuth();
});

document.getElementById("link-login").addEventListener("click", (evento) => {
  evento.preventDefault();
  abrirAuth(false);
});

formAuth.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const usuario = document.getElementById("auth-usuario").value.trim();
  const clave = document.getElementById("auth-clave").value;

  try {
    const datos = await api(modoRegistro ? "/registro" : "/login", {
      metodo: "POST",
      cuerpo: { usuario, clave },
    });
    usuarioLogueado = datos.usuario;
  } catch (error) {
    mostrarErrorAuth(error.message);
    return;
  }

  cerrarAuth();
  mostrarZonaUsuario();
  if (peliculaActualId !== null) mostrarResenas();
  if (usuarioMostrado !== null) mostrarResenasUsuario();
});

async function iniciar() {
  try {
    const datos = await api("/yo");
    usuarioLogueado = datos.usuario;
  } catch (error) {
    console.error(error);
  }
  mostrarZonaUsuario();
  cargarGeneros();
  cargarLista();
}

iniciar();