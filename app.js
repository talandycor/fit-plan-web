
const STORAGE_KEY = "fitplan-library-v1";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const DEFAULT_CATEGORIES = [
  "Fuerza tren superior",
  "Fuerza tren inferior",
  "Fuerza cuerpo completo",
  "Movilidad tren superior",
  "Movilidad tren inferior",
  "Movilidad cuerpo completo",
  "Core y abdominales",
  "Cardio",
  "Estiramientos",
  "Rehabilitación y prevención"
];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

const uid = () => crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[c]));

const placeholder = "https://placehold.co/600x400/e9ece9/526b58?text=Ejercicio";

let state = loadState();
let currentView = "exercises";
let calendarDate = new Date();
let selectedImage = "";
let selectedCategory = "";
let toastTimer;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.exercises) &&
        Array.isArray(saved.plans) && Array.isArray(saved.sessions)) {
      saved.categories = Array.isArray(saved.categories)
        ? saved.categories
        : DEFAULT_CATEGORIES.map(name => ({ id: uid(), name }));

      // Migración segura: los ejercicios antiguos quedan sin categoría.
      saved.exercises = saved.exercises.map(ex => ({
        ...ex,
        categories: Array.isArray(ex.categories) ? ex.categories : []
      }));

      return saved;
    }
  } catch (e) {}
  return {
    exercises: [],
    plans: [],
    sessions: [],
    categories: DEFAULT_CATEGORIES.map(name => ({ id: uid(), name }))
  };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    notify("No hay espacio suficiente para guardar. Prueba con una imagen más pequeña.");
  }
}

function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function openModal(html) {
  $("#modal-content").innerHTML = html;
  $("#modal").showModal();
}

function closeModal() {
  $("#modal").close();
  $("#modal-content").innerHTML = "";
  selectedImage = "";
}

$("#modal-close").addEventListener("click", closeModal);
$("#modal").addEventListener("click", e => {
  if (e.target === $("#modal")) closeModal();
});

function setView(view) {
  currentView = view;
  $$(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.view === view));
  render();
}

$$(".tab").forEach(tab => {
  tab.addEventListener("click", () => setView(tab.dataset.view));
});

function render() {
  const root = $("#app-content");
  if (currentView === "exercises") root.innerHTML = renderExercises();
  if (currentView === "plans") root.innerHTML = renderPlans();
  if (currentView === "calendar") root.innerHTML = renderCalendar();
  if (currentView === "progress") root.innerHTML = renderProgress();
}

function emptyState(icon, title, message, button = "") {
  return `<div class="empty">
    <div class="empty-icon">${icon}</div>
    <h3>${title}</h3>
    <p>${message}</p>
    ${button}
  </div>`;
}

// ---------- BIBLIOTECA Y CARPETAS ----------

function categoryCount(categoryId) {
  return state.exercises.filter(ex => (ex.categories || []).includes(categoryId)).length;
}

function renderExercises() {
  const categories = state.categories.map(category => `
    <button class="folder-card ${selectedCategory === category.id ? "selected" : ""}"
      data-action="open-category" data-id="${category.id}">
      <span class="folder-icon">📁</span>
      <span class="folder-name">${escapeHTML(category.name)}</span>
      <span class="folder-count">${categoryCount(category.id)} ejercicios</span>
    </button>
  `).join("");

  const unassigned = state.exercises.filter(ex => !ex.categories?.length);
  const isUnassigned = selectedCategory === "unassigned";
  const current = state.categories.find(c => c.id === selectedCategory);

  let visibleExercises = [];
  if (isUnassigned) visibleExercises = unassigned;
  else if (current) {
    visibleExercises = state.exercises.filter(ex => (ex.categories || []).includes(current.id));
  }

  visibleExercises.sort((a,b) => a.name.localeCompare(b.name, "es", { sensitivity:"base" }));

  const cards = visibleExercises.map(ex => `
    <article class="card">
      <img class="exercise-image" src="${escapeHTML(ex.image || placeholder)}"
        alt="${escapeHTML(ex.name)}" onerror="this.src='${placeholder}'">
      <div class="card-body">
        <div class="card-title-row">
          <h3>${escapeHTML(ex.name)}</h3>
        </div>
        <div class="exercise-categories">
          ${(ex.categories || []).map(id => {
            const cat = state.categories.find(c => c.id === id);
            return cat ? `<span class="pill">${escapeHTML(cat.name)}</span>` : "";
          }).join("")}
          ${!ex.categories?.length ? `<span class="pill">Sin categoría</span>` : ""}
        </div>
        <div class="card-actions">
          <button class="btn ghost small" data-action="edit-exercise" data-id="${ex.id}">Editar</button>
          <button class="btn ghost small" data-action="delete-exercise" data-id="${ex.id}">Eliminar</button>
        </div>
      </div>
    </article>
  `).join("");

  const folderView = `
    <div class="section-head">
      <div>
        <h2>Biblioteca de ejercicios</h2>
        <p class="muted">Organiza tus ejercicios en carpetas. Un ejercicio puede estar en varias.</p>
      </div>
      <button class="btn" data-action="new-exercise">+ Añadir</button>
    </div>
    <div class="folder-toolbar">
      <h3>Mis categorías</h3>
      <button class="btn ghost small" data-action="manage-categories">Gestionar categorías</button>
    </div>
    <div class="folder-grid">
      ${categories}
      <button class="folder-card add-folder" data-action="new-category">
        <span class="folder-icon">＋</span>
        <span class="folder-name">Nueva categoría</span>
        <span class="folder-count">Crear carpeta</span>
      </button>
    </div>
    <button class="unassigned-link ${isUnassigned ? "active" : ""}"
      data-action="open-category" data-id="unassigned">
      Sin categoría <span>${unassigned.length}</span>
    </button>
  `;

  if (!selectedCategory) return folderView;

  const title = isUnassigned ? "Sin categoría" : current?.name || "Categoría";
  return `
    ${folderView}
    <div class="category-content">
      <div class="section-head category-heading">
        <div>
          <button class="back-link" data-action="back-folders">← Todas las carpetas</button>
          <h2>${escapeHTML(title)}</h2>
          <p class="muted">${visibleExercises.length} ejercicios · Orden alfabético</p>
        </div>
        ${current ? `<button class="btn ghost small" data-action="edit-category" data-id="${current.id}">Editar carpeta</button>` : ""}
      </div>
      ${cards ? `<div class="card-grid">${cards}</div>` :
        emptyState("📂", "Esta carpeta está vacía",
          "Añade ejercicios o edita uno existente para asignarlo a esta categoría.",
          `<button class="btn" data-action="new-exercise">Añadir ejercicio</button>`)}
    </div>
  `;
}

function categoryForm(category = {}) {
  openModal(`
    <h2>${category.id ? "Editar categoría" : "Nueva categoría"}</h2>
    <form id="category-form" data-id="${category.id || ""}">
      <div class="field">
        <label for="category-name">Nombre de la categoría *</label>
        <input id="category-name" name="name" required maxlength="60"
          value="${escapeHTML(category.name || "")}" placeholder="Ej. Fuerza tren superior">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancelar</button>
        <button class="btn" type="submit">Guardar categoría</button>
      </div>
    </form>
  `);
}

function manageCategories() {
  const rows = state.categories.map(cat => `
    <div class="category-manage-row">
      <span>📁 ${escapeHTML(cat.name)}</span>
      <span class="category-manage-actions">
        <button class="btn ghost small" data-action="edit-category" data-id="${cat.id}">Editar</button>
        <button class="btn danger small" data-action="delete-category" data-id="${cat.id}">Eliminar</button>
      </span>
    </div>
  `).join("");

  openModal(`
    <h2>Gestionar categorías</h2>
    <p class="muted">Puedes cambiar el nombre o eliminar las carpetas que ya no necesites.</p>
    ${rows || `<p class="muted">Todavía no hay categorías.</p>`}
    <div class="modal-actions">
      <button class="btn ghost" data-action="close-modal">Cerrar</button>
      <button class="btn" data-action="new-category">+ Nueva categoría</button>
    </div>
  `);
}

// ---------- EJERCICIOS ----------

function exerciseForm(ex = {}) {
  selectedImage = ex.image || "";
  const selected = ex.categories || [];

  openModal(`
    <h2>${ex.id ? "Editar ejercicio" : "Nuevo ejercicio"}</h2>
    <p class="muted">La ficha del ejercicio se podrá reutilizar en distintos planes y categorías.</p>
    <form id="exercise-form" data-id="${ex.id || ""}">
      <div class="field">
        <label for="ex-name">Nombre del ejercicio *</label>
        <input id="ex-name" name="name" required maxlength="70"
          value="${escapeHTML(ex.name || "")}" placeholder="Ej. Press banca">
      </div>

      <div class="field">
        <span class="field-label">Categorías</span>
        <p class="help">Puedes seleccionar varias. El ejercicio aparecerá en todas las carpetas elegidas.</p>
        <div class="category-checkboxes">
          ${state.categories.map(cat => `
            <label class="category-check">
              <input type="checkbox" name="categories" value="${cat.id}"
                ${selected.includes(cat.id) ? "checked" : ""}>
              <span>${escapeHTML(cat.name)}</span>
            </label>
          `).join("")}
        </div>
        <button type="button" class="btn ghost small" data-action="new-category-from-exercise">
          + Crear categoría
        </button>
      </div>

      <div class="field">
        <label for="ex-muscle">Grupo muscular (dato descriptivo)</label>
        <select id="ex-muscle" name="muscle">
          ${["Pecho","Espalda","Hombros","Bíceps","Tríceps","Piernas","Glúteos","Abdominales","Cardio","General"].map(m =>
            `<option ${ex.muscle === m ? "selected" : ""}>${m}</option>`).join("")}
        </select>
      </div>

      <div class="field">
        <label>Imagen de portada</label>
        <img id="image-preview" class="image-preview" src="${escapeHTML(selectedImage || placeholder)}" alt="Vista previa">
        <input type="hidden" name="image" id="image-value" value="${escapeHTML(selectedImage)}">
        <label class="btn secondary" for="image-upload">Subir imagen desde mi dispositivo</label>
        <input id="image-upload" type="file" accept="image/*" hidden>
        <p class="help">También puedes buscar imágenes sugeridas por el nombre del ejercicio.</p>
        <button type="button" class="btn ghost" id="suggest-images">Buscar imágenes sugeridas</button>
        <div id="image-results"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancelar</button>
        <button class="btn" type="submit">Guardar ejercicio</button>
      </div>
    </form>
  `);

  $("#image-upload").addEventListener("change", handleImageUpload);
  $("#suggest-images").addEventListener("click", searchImages);
}

function updateSelectedImage(url) {
  selectedImage = url;
  $("#image-value").value = url;
  $("#image-preview").src = url || placeholder;
  $$(".image-choice").forEach(btn => btn.classList.toggle("selected", btn.dataset.image === url));
}

function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) return notify("Selecciona un archivo de imagen.");
  if (file.size > 1.5 * 1024 * 1024) {
    return notify("La imagen pesa demasiado. Elige una de menos de 1,5 MB.");
  }
  const reader = new FileReader();
  reader.onload = () => updateSelectedImage(reader.result);
  reader.readAsDataURL(file);
}

async function searchImages() {
  const query = $("#ex-name").value.trim();
  if (!query) return notify("Escribe primero el nombre del ejercicio.");

  const results = $("#image-results");
  results.innerHTML = `<p class="help">Buscando imágenes...</p>`;

  try {
    const url = "https://commons.wikimedia.org/w/api.php?action=query&generator=search"
      + "&gsrsearch=" + encodeURIComponent(query + " exercise")
      + "&gsrnamespace=6&gsrlimit=9&prop=imageinfo&iiprop=url"
      + "&iiurlwidth=300&format=json&origin=*";

    const response = await fetch(url);
    if (!response.ok) throw new Error("Error en la búsqueda");
    const data = await response.json();
    const pages = Object.values(data.query?.pages || {});
    const images = pages.map(p => ({
      title: p.title,
      url: p.imageinfo?.[0]?.thumburl || p.imageinfo?.[0]?.url
    })).filter(x => x.url && /\.(jpg|jpeg|png|webp)(\?|$)/i.test(x.url));

    if (!images.length) {
      results.innerHTML = `<p class="help">No se encontraron imágenes. Puedes subir una desde tu dispositivo.</p>`;
      return;
    }

    results.innerHTML = `<p class="help">Elige una imagen para utilizarla como portada:</p>
      <div class="image-results">${images.map(img => `
        <button type="button" class="image-choice" data-image="${escapeHTML(img.url)}"
          title="${escapeHTML(img.title)}">
          <img src="${escapeHTML(img.url)}" alt="${escapeHTML(img.title)}">
        </button>`).join("")}</div>
      <p class="help">Las imágenes sugeridas proceden de Wikimedia Commons. Comprueba sus condiciones de uso y atribución antes de utilizarlas.</p>`;

    $$(".image-choice", results).forEach(btn => {
      btn.addEventListener("click", () => updateSelectedImage(btn.dataset.image));
    });
  } catch (error) {
    results.innerHTML = `<p class="help">No se pudo buscar ahora. Comprueba tu conexión o sube una imagen propia.</p>`;
  }
}

// ---------- PLANES ----------

function renderPlans() {
  const cards = state.plans.map(plan => {
    const names = plan.items.map(item => {
      const ex = state.exercises.find(e => e.id === item.exerciseId);
      return `<span>• ${escapeHTML(ex?.name || item.name || "Ejercicio eliminado")} — ${item.sets} × ${item.reps}</span>`;
    }).join("");

    return `<article class="card plan-card">
      <div class="card-title-row">
        <h3>${escapeHTML(plan.name)}</h3>
        <span class="pill">${plan.items.length} ejercicios</span>
      </div>
      <div class="plan-exercises">${names || "Sin ejercicios todavía"}</div>
      <div class="card-actions">
        <button class="btn ghost small" data-action="edit-plan" data-id="${plan.id}">Editar</button>
        <button class="btn ghost small" data-action="start-plan" data-id="${plan.id}">Entrenar</button>
        <button class="btn danger small" data-action="delete-plan" data-id="${plan.id}">Eliminar</button>
      </div>
    </article>`;
  }).join("");

  return `
    <div class="section-head">
      <div><h2>Mis planes</h2>
      <p class="muted">Combina tus ejercicios y configura cada rutina.</p></div>
      <button class="btn" data-action="new-plan">+ Crear plan</button>
    </div>
    ${cards ? `<div class="card-grid">${cards}</div>` :
      emptyState("▤", "Todavía no tienes planes",
        "Crea un plan y añade ejercicios de tu biblioteca.",
        `<button class="btn" data-action="new-plan">Crear primer plan</button>`)}
  `;
}

function planForm(plan = {}) {
  if (!state.exercises.length) {
    openModal(`<h2>Primero añade ejercicios</h2>
      <p class="muted">Crea algunos ejercicios en tu biblioteca. Después podrás combinarlos en tus planes.</p>
      <div class="modal-actions">
        <button class="btn ghost" data-action="close-modal">Cerrar</button>
        <button class="btn" data-action="go-exercises">Ir a ejercicios</button>
      </div>`);
    return;
  }

  const existing = new Map((plan.items || []).map(i => [i.exerciseId, i]));

  openModal(`
    <h2>${plan.id ? "Editar plan" : "Crear plan"}</h2>
    <form id="plan-form" data-id="${plan.id || ""}">
      <div class="field">
        <label for="plan-name">Nombre del plan *</label>
        <input id="plan-name" name="name" required maxlength="70"
          value="${escapeHTML(plan.name || "")}" placeholder="Ej. Día A · Pecho y tríceps">
      </div>
      <div class="field">
        <span class="field-label">Selecciona los ejercicios</span>
        <p class="help">Puedes añadir el mismo ejercicio a tantos planes como quieras. Las series, repeticiones y peso se configuran por separado.</p>
        <div class="exercise-picker">
          ${state.exercises.map(ex => {
            const item = existing.get(ex.id);
            return `<div class="picker-row">
              <input type="checkbox" name="exercise" value="${ex.id}" ${item ? "checked" : ""}>
              <img src="${escapeHTML(ex.image || placeholder)}" alt="">
              <div>
                <strong>${escapeHTML(ex.name)}</strong>
                <div class="picker-config">
                  <input type="number" min="1" max="30" name="sets-${ex.id}" value="${item?.sets ?? 3}" placeholder="Series" aria-label="Series">
                  <input type="text" name="reps-${ex.id}" value="${escapeHTML(item?.reps ?? "10")}" placeholder="Reps" aria-label="Repeticiones">
                  <input type="number" min="0" step="0.5" name="weight-${ex.id}" value="${escapeHTML(item?.weight ?? "")}" placeholder="Kg" aria-label="Peso en kg">
                </div>
              </div>
            </div>`;
          }).join("")}
        </div>
        <p class="help">Podrás registrar el peso real al entrenar.</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancelar</button>
        <button class="btn" type="submit">Guardar plan</button>
      </div>
    </form>
  `);
}

// ---------- SESIONES ----------

function sessionForm(planId, date) {
  const plan = state.plans.find(p => p.id === planId);
  if (!plan) return notify("No se encuentra ese plan.");

  const rows = plan.items.map(item => {
    const ex = state.exercises.find(e => e.id === item.exerciseId);
    return `<div class="session-row">
      <strong>${escapeHTML(ex?.name || item.name || "Ejercicio")}</strong>
      <div class="form-grid" style="margin-top:10px">
        <div class="field">
          <label>Series realizadas</label>
          <input type="number" min="0" name="sets-${item.exerciseId}" value="${item.sets}">
        </div>
        <div class="field">
          <label>Repeticiones</label>
          <input name="reps-${item.exerciseId}" value="${escapeHTML(item.reps)}">
        </div>
        <div class="field full">
          <label>Peso utilizado (kg)</label>
          <input type="number" min="0" step="0.5" name="weight-${item.exerciseId}"
            value="${escapeHTML(item.weight || "")}" placeholder="Ej. 40">
        </div>
      </div>
    </div>`;
  }).join("");

  openModal(`
    <h2>Registrar entrenamiento</h2>
    <p class="muted">${escapeHTML(plan.name)} · ${formatDate(date)}</p>
    <form id="session-form" data-plan="${plan.id}" data-date="${date}">
      ${rows}
      <div class="field">
        <label>Notas de la sesión (opcional)</label>
        <textarea name="notes" rows="2" placeholder="Sensaciones, observaciones..."></textarea>
      </div>
      <div class="modal
