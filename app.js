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

const DEFAULT_MUSCLES = [
  "Pecho", "Espalda", "Hombros", "Bíceps", "Tríceps",
  "Piernas", "Glúteos", "Abdominales", "Cardio", "General"
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

// Texto sin tildes y en minúsculas para las búsquedas.
const normalizeText = value => String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLocaleLowerCase("es").trim();

const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es", { sensitivity: "base" });

const clone = value => JSON.parse(JSON.stringify(value));

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const placeholder = "https://placehold.co/600x400/e9ece9/526b58?text=Ejercicio";

// Configuración común para categorías y grupos musculares (se gestionan igual).
const TAXONOMIES = {
  category: {
    key: "categories",
    icon: "📁",
    newTitle: "Nueva categoría",
    editTitle: "Editar categoría",
    label: "Nombre de la categoría *",
    placeholder: "Ej. Fuerza tren superior",
    save: "Guardar categoría",
    saved: "Categoría guardada.",
    duplicate: "Ya existe una categoría con ese nombre.",
    manageTitle: "Gestionar categorías",
    manageHelp: "Puedes cambiar el nombre o eliminar las carpetas que ya no necesites.",
    emptyList: "Todavía no hay categorías.",
    newButton: "+ Nueva categoría",
    confirmDelete: "¿Eliminar esta categoría? Los ejercicios no se borrarán, solo perderán esta asignación.",
    deleted: "Categoría eliminada.",
    manageAction: "manage-categories",
    editAction: "edit-category",
    deleteAction: "delete-category",
    newAction: "new-category"
  },
  muscle: {
    key: "muscleGroups",
    icon: "💪",
    newTitle: "Nuevo grupo muscular",
    editTitle: "Editar grupo muscular",
    label: "Nombre del grupo muscular *",
    placeholder: "Ej. Pecho",
    save: "Guardar grupo muscular",
    saved: "Grupo muscular guardado.",
    duplicate: "Ya existe un grupo muscular con ese nombre.",
    manageTitle: "Gestionar grupos musculares",
    manageHelp: "Puedes cambiar el nombre o eliminar los grupos musculares. Los cambios se aplican a todos los ejercicios.",
    emptyList: "Todavía no hay grupos musculares.",
    newButton: "+ Nuevo grupo muscular",
    confirmDelete: "¿Eliminar este grupo muscular? Los ejercicios no se borrarán, solo perderán este grupo.",
    deleted: "Grupo muscular eliminado.",
    manageAction: "manage-muscles",
    editAction: "edit-muscle",
    deleteAction: "delete-muscle",
    newAction: "new-muscle"
  }
};

// Completa los datos antiguos sin borrar nada.
function normalizeState(data) {
  const s = data || {};
  s.exercises = Array.isArray(s.exercises) ? s.exercises : [];
  s.plans = Array.isArray(s.plans) ? s.plans : [];
  s.sessions = Array.isArray(s.sessions) ? s.sessions : [];
  s.categories = Array.isArray(s.categories)
    ? s.categories
    : DEFAULT_CATEGORIES.map(name => ({ id: uid(), name }));

  s.exercises.forEach(ex => {
    ex.categories = Array.isArray(ex.categories) ? ex.categories : [];
    ex.muscles = Array.isArray(ex.muscles) ? ex.muscles : (ex.muscle ? [ex.muscle] : []);
  });

  if (!Array.isArray(s.muscleGroups)) {
    s.muscleGroups = DEFAULT_MUSCLES.map(name => ({ id: uid(), name }));
  }

  // Si algún ejercicio usa un grupo que no está en la lista, se añade.
  const known = new Set(s.muscleGroups.map(m => normalizeText(m.name)));
  s.exercises.forEach(ex => ex.muscles.forEach(name => {
    if (name && !known.has(normalizeText(name))) {
      s.muscleGroups.push({ id: uid(), name });
      known.add(normalizeText(name));
    }
  }));

  s.plans.forEach(plan => {
    plan.items = Array.isArray(plan.items) ? plan.items : [];
    if (typeof plan.image !== "string") plan.image = "";
  });

  return s;
}

let state = normalizeState({ exercises: [], plans: [], sessions: [] });
let currentView = "exercises";
let calendarDate = new Date();
let selectedImage = "";
let selectedCategory = "";
let toastTimer;

// Planes
let selectedPlanId = "";
let planEditing = false;
let planDraft = null;
let planSearch = { text: "", category: "", muscle: "" };
let planFormItems = [];

// Borrador del ejercicio mientras se crea una categoría/grupo desde su formulario.
let exerciseDraft = null;

function loadState() {
  return normalizeState({ exercises: [], plans: [], sessions: [] });
}

function maxRecordedWeight(exerciseId) {
  return Math.max(0, ...state.sessions.flatMap(session =>
    (session.exercises || [])
      .filter(ex => ex.exerciseId === exerciseId)
      .map(ex => Number(ex.weight) || 0)
  ));
}

function saveState() {
  console.log("AndriFIT: cambios realizados en memoria.");

  if (window.AndriFITDriveSync) {
    window.AndriFITDriveSync.notifyLocalSave();
  } else {
    console.error("AndriFIT: Drive Sync no está disponible.");
    notify("No se ha podido conectar con Google Drive.");
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
  if (!$("#modal").open) $("#modal").showModal();
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

function stopPlanEditing() {
  planEditing = false;
  planDraft = null;
  planSearch = { text: "", category: "", muscle: "" };
}

function confirmDiscardPlan() {
  if (!planEditing) return true;
  if (confirm("Tienes cambios sin guardar en este plan. ¿Quieres descartarlos?")) {
    stopPlanEditing();
    return true;
  }
  return false;
}

function setView(view) {
  if (!confirmDiscardPlan()) return false;
  selectedPlanId = "";
  currentView = view;
  $$(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.view === view));
  render();
  return true;
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

function scrollToContent() {
  const top = $("#app-content").getBoundingClientRect().top + window.scrollY - 12;
  if (window.scrollY > top) window.scrollTo({ top, behavior: "smooth" });
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

function muscleCount(name) {
  return state.exercises.filter(ex => (ex.muscles || []).includes(name)).length;
}

function renderExercises() {
  const categories = state.categories.map(category => `
    <button class="folder-card ${selectedCategory === category.id ? "selected" : ""}"
      data-action="open-category" data-id="${category.id}">
      <span class="folder-icon">📁</span>
      <span class="folder-name">${escapeHTML(category.name)}</span>
      <span class="folder-count">${plural(categoryCount(category.id), "ejercicio", "ejercicios")}</span>
    </button>
  `).join("");

  const muscles = state.muscleGroups.map(group => `
    <button class="muscle-chip ${selectedCategory === `muscle:${group.id}` ? "selected" : ""}"
      data-action="open-category" data-id="muscle:${group.id}">
      <span>${escapeHTML(group.name)}</span>
      <small>${muscleCount(group.name)}</small>
    </button>
  `).join("");

  const unassigned = state.exercises.filter(ex => !ex.categories?.length);
  const isUnassigned = selectedCategory === "unassigned";
  const isMuscle = selectedCategory.startsWith("muscle:");
  const currentCategory = !isMuscle ? state.categories.find(c => c.id === selectedCategory) : null;
  const currentMuscle = isMuscle ? state.muscleGroups.find(m => `muscle:${m.id}` === selectedCategory) : null;

  // Si la carpeta seleccionada ya no existe, volver a la vista general.
  if (selectedCategory && !isUnassigned && !currentCategory && !currentMuscle) selectedCategory = "";

  let visibleExercises = [];
  if (isUnassigned) visibleExercises = unassigned;
  else if (currentCategory) {
    visibleExercises = state.exercises.filter(ex => (ex.categories || []).includes(currentCategory.id));
  } else if (currentMuscle) {
    visibleExercises = state.exercises.filter(ex => (ex.muscles || []).includes(currentMuscle.name));
  }

  visibleExercises = [...visibleExercises].sort(byName);

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
        <div class="exercise-categories muscle-tags">
          ${(ex.muscles || []).map(m => `<span class="pill">${escapeHTML(m)}</span>`).join("")}
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
    <div class="folder-toolbar">
      <h3>Grupos musculares</h3>
      <button class="btn ghost small" data-action="manage-muscles">Gestionar grupos</button>
    </div>
    <div class="muscle-grid">
      ${muscles}
      <button class="muscle-chip add-chip" data-action="new-muscle">＋ Nuevo grupo</button>
    </div>
  `;

  if (!selectedCategory) return folderView;

  const title = isUnassigned ? "Sin categoría"
    : currentCategory ? currentCategory.name
    : currentMuscle?.name || "Categoría";

  const subtitle = currentMuscle
    ? `Grupo muscular · ${plural(visibleExercises.length, "ejercicio", "ejercicios")} · Orden alfabético`
    : `${plural(visibleExercises.length, "ejercicio", "ejercicios")} · Orden alfabético`;

  const editButton = currentCategory
    ? `<button class="btn ghost small" data-action="edit-category" data-id="${currentCategory.id}">Editar carpeta</button>`
    : currentMuscle
      ? `<button class="btn ghost small" data-action="edit-muscle" data-id="${currentMuscle.id}">Editar grupo</button>`
      : "";

  const empty = currentMuscle
    ? emptyState("💪", "Ningún ejercicio tiene este grupo muscular",
        "Edita un ejercicio para asignarle este grupo muscular.",
        `<button class="btn" data-action="new-exercise">Añadir ejercicio</button>`)
    : emptyState("📂", "Esta carpeta está vacía",
        "Añade ejercicios o edita uno existente para asignarlo a esta categoría.",
        `<button class="btn" data-action="new-exercise">Añadir ejercicio</button>`);

  return `
    ${folderView}
    <div class="category-content">
      <div class="section-head category-heading">
        <div>
          <button class="back-link" data-action="back-folders">← Todas las carpetas</button>
          <h2>${currentMuscle ? "💪 " : ""}${escapeHTML(title)}</h2>
          <p class="muted">${subtitle}</p>
        </div>
        ${editButton}
      </div>
      ${cards ? `<div class="card-grid">${cards}</div>` : empty}
    </div>
  `;
}

// ---------- CATEGORÍAS Y GRUPOS MUSCULARES ----------

function taxonomyForm(type, item = {}, returnTo = "") {
  const cfg = TAXONOMIES[type];
  const cancelAction = returnTo === "exercise" ? "back-to-exercise"
    : returnTo === "manage" ? cfg.manageAction
    : "close-modal";

  openModal(`
    <h2>${item.id ? cfg.editTitle : cfg.newTitle}</h2>
    <form id="taxonomy-form" data-type="${type}" data-id="${item.id || ""}" data-return-to="${returnTo}">
      <div class="field">
        <label for="taxonomy-name">${cfg.label}</label>
        <input id="taxonomy-name" name="name" required maxlength="60"
          value="${escapeHTML(item.name || "")}" placeholder="${cfg.placeholder}">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="${cancelAction}">Cancelar</button>
        <button class="btn" type="submit">${cfg.save}</button>
      </div>
    </form>
  `);
}

function manageTaxonomy(type) {
  const cfg = TAXONOMIES[type];
  const rows = state[cfg.key].map(item => `
    <div class="category-manage-row">
      <span>${cfg.icon} ${escapeHTML(item.name)}</span>
      <span class="category-manage-actions">
        <button class="btn ghost small" data-action="${cfg.editAction}" data-id="${item.id}" data-from="manage">Editar</button>
        <button class="btn danger small" data-action="${cfg.deleteAction}" data-id="${item.id}">Eliminar</button>
      </span>
    </div>
  `).join("");

  openModal(`
    <h2>${cfg.manageTitle}</h2>
    <p class="muted">${cfg.manageHelp}</p>
    ${rows || `<p class="muted">${cfg.emptyList}</p>`}
    <div class="modal-actions">
      <button class="btn ghost" data-action="close-modal">Cerrar</button>
      <button class="btn" data-action="${cfg.newAction}" data-from="manage">${cfg.newButton}</button>
    </div>
  `);
}

function deleteTaxonomy(type, id) {
  const cfg = TAXONOMIES[type];
  const item = state[cfg.key].find(x => x.id === id);
  if (!item || !confirm(cfg.confirmDelete)) return;

  state[cfg.key] = state[cfg.key].filter(x => x.id !== id);

  if (type === "category") {
    state.exercises.forEach(ex => {
      ex.categories = (ex.categories || []).filter(catId => catId !== id);
    });
    if (selectedCategory === id) selectedCategory = "";
  } else {
    state.exercises.forEach(ex => {
      ex.muscles = (ex.muscles || []).filter(name => name !== item.name);
      ex.muscle = ex.muscles[0] || "";
    });
    if (selectedCategory === `muscle:${id}`) selectedCategory = "";
  }

  saveState();
  render();
  manageTaxonomy(type);
  notify(cfg.deleted);
}

function saveTaxonomy(form, data) {
  const type = form.dataset.type;
  const cfg = TAXONOMIES[type];
  if (!cfg) return;

  const name = String(data.get("name") || "").trim();
  if (!name) return;

  const list = state[cfg.key];
  const duplicate = list.some(x =>
    x.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es") &&
    x.id !== form.dataset.id
  );
  if (duplicate) return notify(cfg.duplicate);

  const existing = list.find(x => x.id === form.dataset.id);
  let created = null;

  if (existing) {
    // Renombrar un grupo muscular actualiza todos los ejercicios que lo usan.
    if (type === "muscle" && existing.name !== name) {
      const oldName = existing.name;
      state.exercises.forEach(ex => {
        ex.muscles = (ex.muscles || []).map(m => m === oldName ? name : m);
        ex.muscle = ex.muscles[0] || "";
      });
      if (exerciseDraft) {
        exerciseDraft.muscles = exerciseDraft.muscles.map(m => m === oldName ? name : m);
      }
    }
    existing.name = name;
  } else {
    created = { id: uid(), name };
    list.push(created);
  }

  saveState();
  render();

  const returnTo = form.dataset.returnTo;
  if (returnTo === "exercise" && exerciseDraft) {
    const draft = exerciseDraft;
    exerciseDraft = null;
    if (created) {
      if (type === "category") draft.categories.push(created.id);
      else draft.muscles.push(created.name);
    }
    exerciseForm(draft);
  } else if (returnTo === "manage") {
    manageTaxonomy(type);
  } else {
    closeModal();
  }

  notify(cfg.saved);
}

// ---------- EJERCICIOS ----------

function captureExerciseDraft() {
  const form = $("#exercise-form");
  if (!form) return null;
  const data = new FormData(form);
  return {
    id: form.dataset.id || "",
    name: String(data.get("name") || ""),
    categories: data.getAll("categories").map(String),
    muscles: data.getAll("muscles").map(String),
    image: selectedImage || ""
  };
}

function exerciseForm(ex = {}) {
  selectedImage = ex.image || "";
  const selected = ex.categories || [];
  const selectedMuscles = Array.isArray(ex.muscles)
    ? ex.muscles
    : (ex.muscle ? [ex.muscle] : []);

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
        ${state.categories.length ? `<div class="category-checkboxes">
          ${state.categories.map(cat => `
            <label class="category-check">
              <input type="checkbox" name="categories" value="${cat.id}"
                ${selected.includes(cat.id) ? "checked" : ""}>
              <span>${escapeHTML(cat.name)}</span>
            </label>
          `).join("")}
        </div>` : `<p class="help">Todavía no hay categorías.</p>`}
        <button type="button" class="btn ghost small field-inline-btn" data-action="new-category-from-exercise">
          + Crear categoría
        </button>
      </div>

      <div class="field">
        <span class="field-label">Grupos musculares</span>
        <p class="help">Puedes seleccionar más de un grupo muscular. Esto es independiente de las categorías o carpetas.</p>
        ${state.muscleGroups.length ? `<div class="category-checkboxes muscle-checkboxes">
          ${state.muscleGroups.map(group => `
            <label class="category-check">
              <input type="checkbox" name="muscles" value="${escapeHTML(group.name)}"
                ${selectedMuscles.includes(group.name) ? "checked" : ""}>
              <span>${escapeHTML(group.name)}</span>
            </label>
          `).join("")}
        </div>` : `<p class="help">Todavía no hay grupos musculares.</p>`}
        <button type="button" class="btn ghost small field-inline-btn" data-action="new-muscle-from-exercise">
          + Crear grupo muscular
        </button>
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
  $("#suggest-images").addEventListener("click", () =>
    searchImages($("#ex-name").value.trim(), "exercise", "Escribe primero el nombre del ejercicio."));
}

function updateSelectedImage(url) {
  selectedImage = url;
  const input = $("#image-value");
  if (input) input.value = url;
  const preview = $("#image-preview");
  if (preview) preview.src = url || placeholder;

  // Vista previa de la portada de un plan.
  const cover = $("#plan-cover-preview");
  if (cover) cover.innerHTML = planCoverHTML({ image: url, items: planFormItems }, "plan-cover-preview");
  const mode = $("#plan-cover-mode");
  if (mode) mode.textContent = coverModeText();

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

async function searchImages(query, suffix = "exercise", emptyMessage = "Escribe primero un nombre.") {
  if (!query) return notify(emptyMessage);

  const results = $("#image-results");
  results.innerHTML = `<p class="help">Buscando imágenes...</p>`;

  try {
    const url = "https://commons.wikimedia.org/w/api.php?action=query&generator=search"
      + "&gsrsearch=" + encodeURIComponent(`${query} ${suffix}`.trim())
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
        <button type="button" class="image-choice ${img.url === selectedImage ? "selected" : ""}" data-image="${escapeHTML(img.url)}"
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

// Portada del plan: imagen propia/sugerida o collage automático de sus ejercicios.
function planCoverHTML(plan, extraClass = "") {
  const cls = `plan-cover ${extraClass}`.trim();
  const fallback = `onerror="this.src='${placeholder}'"`;

  if (plan.image) {
    return `<div class="${cls}"><img src="${escapeHTML(plan.image)}" alt="" ${fallback}></div>`;
  }

  const items = plan.items || [];
  const images = items
    .map(item => state.exercises.find(e => e.id === item.exerciseId)?.image)
    .filter(Boolean)
    .slice(0, 4);

  if (!images.length) {
    return `<div class="${cls} plan-cover-empty">
      <span>▤</span>
      <small>${items.length ? "Collage sin imágenes" : "Sin ejercicios todavía"}</small>
    </div>`;
  }

  return `<div class="${cls} collage collage-${images.length}">
    ${images.map(src => `<img src="${escapeHTML(src)}" alt="" ${fallback}>`).join("")}
  </div>`;
}

function coverModeText() {
  return selectedImage
    ? "Portada: imagen personalizada."
    : "Portada: collage automático con los ejercicios del plan.";
}

function renderPlans() {
  if (selectedPlanId) {
    const plan = state.plans.find(p => p.id === selectedPlanId);
    if (plan) return renderPlanDetail(plan);
    selectedPlanId = "";
    stopPlanEditing();
  }

  const cards = state.plans.map(plan => `
    <article class="card plan-tile" role="button" tabindex="0"
      data-action="open-plan" data-id="${plan.id}" aria-label="Abrir ${escapeHTML(plan.name)}">
      ${planCoverHTML(plan)}
      <div class="plan-tile-body">
        <h3 class="plan-tile-name">${escapeHTML(plan.name)}</h3>
        <span class="pill">${plural(plan.items.length, "ejercicio", "ejercicios")}</span>
      </div>
    </article>
  `).join("");

  return `
    <div class="section-head">
      <div><h2>Mis planes</h2>
      <p class="muted">Toca un plan para ver sus ejercicios, editarlo o entrenar.</p></div>
      <button class="btn" data-action="new-plan">+ Crear plan</button>
    </div>
    ${cards ? `<div class="card-grid">${cards}</div>` :
      emptyState("▤", "Todavía no tienes planes",
        "Crea un plan y añade ejercicios de tu biblioteca.",
        `<button class="btn" data-action="new-plan">Crear primer plan</button>`)}
  `;
}

function planSubtitle(plan, items) {
  return `${plural(items.length, "ejercicio", "ejercicios")} · ${plan.image ? "Portada personalizada" : "Portada: collage de ejercicios"}`;
}

function renderPlanDetail(plan) {
  const editing = planEditing && planDraft?.id === plan.id;
  const items = editing ? planDraft.items : plan.items;

  const actions = editing
    ? `<button class="btn ghost" data-action="cancel-plan-edit">Cancelar</button>
       <button class="btn" data-action="save-plan-exercises">Guardar cambios</button>`
    : `<button class="btn" data-action="start-plan" data-id="${plan.id}">Entrenar</button>
       <button class="btn secondary" data-action="edit-plan-exercises" data-id="${plan.id}">Editar ejercicios</button>
       <button class="btn ghost" data-action="edit-plan" data-id="${plan.id}">Nombre y portada</button>
       <button class="btn danger" data-action="delete-plan" data-id="${plan.id}">Eliminar</button>`;

  return `
    <button class="back-link" data-action="back-plans">← Todos los planes</button>
    <div class="plan-detail-head">
      <div id="plan-detail-cover-wrap">${planCoverHTML({ ...plan, items }, "plan-detail-cover")}</div>
      <div class="plan-detail-title">
        <h2>${escapeHTML(plan.name)}</h2>
        <p class="muted" id="plan-detail-count">${planSubtitle(plan, items)}</p>
        <div class="plan-detail-actions">${actions}</div>
      </div>
    </div>
    ${editing ? renderPlanEditor() : renderPlanTable(plan)}
  `;
}

function renderPlanTable(plan) {
  if (!plan.items.length) {
    return emptyState("▤", "Este plan no tiene ejercicios",
      "Pulsa en «Editar ejercicios» para buscarlos y añadirlos.",
      `<button class="btn" data-action="edit-plan-exercises" data-id="${plan.id}">Añadir ejercicios</button>`);
  }

  const rows = plan.items.map((item, index) => {
    const ex = state.exercises.find(e => e.id === item.exerciseId);
    return `<tr>
      <td class="col-num">${index + 1}</td>
      <td class="col-ex">
        <div class="plan-table-ex">
          <img src="${escapeHTML(ex?.image || placeholder)}" alt="" onerror="this.src='${placeholder}'">
          <span>${escapeHTML(ex?.name || item.name || "Ejercicio eliminado")}</span>
        </div>
      </td>
      <td>${escapeHTML(item.sets)}</td>
      <td>${escapeHTML(item.reps)}</td>
      <td>${item.weight ? `${escapeHTML(item.weight)} kg` : `<span class="muted-cell">Por definir</span>`}</td>
    </tr>`;
  }).join("");

  return `
    <div class="card table-card">
      <div class="table-scroll">
        <table class="plan-table">
          <thead>
            <tr><th class="col-num">#</th><th>Ejercicio</th><th>Series</th><th>Reps</th><th>Peso</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function planEditorTableHTML() {
  const items = planDraft?.items || [];
  if (!items.length) {
    return `<div class="empty"><div class="empty-icon">▤</div>
      <h3>Todavía no hay ejercicios en el plan</h3>
      <p>Búscalos arriba y pulsa «+ Añadir».</p></div>`;
  }

  const rows = items.map((item, i) => {
    const ex = state.exercises.find(e => e.id === item.exerciseId);
    const max = maxRecordedWeight(item.exerciseId);
    return `<tr>
      <td class="col-order">
        <div class="order-buttons">
          <button type="button" class="btn ghost small" data-action="move-plan-item" data-id="${i}" data-dir="up"
            ${i === 0 ? "disabled" : ""} aria-label="Subir">↑</button>
          <button type="button" class="btn ghost small" data-action="move-plan-item" data-id="${i}" data-dir="down"
            ${i === items.length - 1 ? "disabled" : ""} aria-label="Bajar">↓</button>
        </div>
      </td>
      <td class="col-ex">
        <div class="plan-table-ex">
          <img src="${escapeHTML(ex?.image || placeholder)}" alt="" onerror="this.src='${placeholder}'">
          <span>${i + 1}. ${escapeHTML(ex?.name || item.name || "Ejercicio eliminado")}
            <small>${max ? `Máximo registrado: ${max} kg` : "Sin pesos registrados todavía"}</small>
          </span>
        </div>
      </td>
      <td data-label="Series">
        <input class="table-input" type="number" min="1" max="30" inputmode="numeric"
          value="${escapeHTML(item.sets)}" data-index="${i}" data-field="sets" aria-label="Series">
      </td>
      <td data-label="Reps">
        <input class="table-input" type="text" value="${escapeHTML(item.reps)}"
          data-index="${i}" data-field="reps" aria-label="Repeticiones">
      </td>
      <td data-label="Peso (kg)">
        <input class="table-input" type="number" min="0" step="0.5" inputmode="decimal"
          value="${escapeHTML(item.weight)}" placeholder="${max ? `Máx. ${max}` : "Kg"}"
          data-index="${i}" data-field="weight" aria-label="Peso en kg">
      </td>
      <td class="col-remove">
        <button type="button" class="btn danger small" data-action="remove-plan-item" data-id="${i}"
          aria-label="Quitar del plan">✕</button>
      </td>
    </tr>`;
  }).join("");

  return `
    <div class="card table-card">
      <div class="table-scroll">
        <table class="plan-table editable">
          <thead>
            <tr><th>Orden</th><th>Ejercicio</th><th>Series</th><th>Reps</th><th>Peso (kg)</th><th></th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPlanEditor() {
  const categoryOptions = [...state.categories].sort(byName).map(c =>
    `<option value="${c.id}" ${planSearch.category === c.id ? "selected" : ""}>${escapeHTML(c.name)}</option>`
  ).join("");

  const muscleOptions = [...state.muscleGroups].sort(byName).map(m =>
    `<option value="${escapeHTML(m.name)}" ${planSearch.muscle === m.name ? "selected" : ""}>${escapeHTML(m.name)}</option>`
  ).join("");

  return `
    <div class="card plan-search-card">
      <h3>Añadir ejercicios</h3>
      <p class="help">Busca por nombre de ejercicio, categoría o grupo muscular. Los resultados salen en orden alfabético.</p>
      <div class="plan-search-bar">
        <input id="plan-search-text" type="search" autocomplete="off"
          placeholder="Buscar ejercicio, categoría o grupo…" value="${escapeHTML(planSearch.text)}">
        <select id="plan-search-category" aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          ${categoryOptions}
        </select>
        <select id="plan-search-muscle" aria-label="Filtrar por grupo muscular">
          <option value="">Todos los grupos musculares</option>
          ${muscleOptions}
        </select>
        <button type="button" class="btn ghost" data-action="clear-plan-search">Limpiar</button>
      </div>
      <div id="plan-search-results">${planSearchResultsHTML()}</div>
    </div>

    <h3 class="editor-section-title">Ejercicios del plan</h3>
    <p class="help editor-section-help">Usa las flechas para cambiar el orden y ajusta series, repeticiones y peso.</p>
    <div id="plan-editor-table">${planEditorTableHTML()}</div>

    <div class="modal-actions">
      <button class="btn ghost" data-action="cancel-plan-edit">Cancelar</button>
      <button class="btn" data-action="save-plan-exercises">Guardar cambios</button>
    </div>
  `;
}

function planSearchResultsHTML() {
  if (!state.exercises.length) {
    return `<p class="help">Todavía no tienes ejercicios en tu biblioteca.
      <button type="button" class="link-button" data-action="go-exercises">Ir a Ejercicios</button></p>`;
  }

  const text = normalizeText(planSearch.text);
  if (!text && !planSearch.category && !planSearch.muscle) {
    return `<p class="help search-hint">Escribe algo o elige una categoría o grupo muscular para ver ejercicios.</p>`;
  }

  const added = new Set((planDraft?.items || []).map(i => i.exerciseId));
  const categoryNames = ex => (ex.categories || [])
    .map(id => state.categories.find(c => c.id === id)?.name)
    .filter(Boolean);

  const results = state.exercises.filter(ex => {
    if (planSearch.category && !(ex.categories || []).includes(planSearch.category)) return false;
    if (planSearch.muscle && !(ex.muscles || []).includes(planSearch.muscle)) return false;
    if (!text) return true;
    return [ex.name, ...categoryNames(ex), ...(ex.muscles || [])]
      .some(value => normalizeText(value).includes(text));
  }).sort(byName);

  if (!results.length) return `<p class="help search-hint">No hay ejercicios que coincidan con la búsqueda.</p>`;

  return `<p class="help">${plural(results.length, "resultado", "resultados")} · Orden alfabético</p>
    <div class="search-results">
      ${results.map(ex => {
        const isAdded = added.has(ex.id);
        const tags = [...(ex.muscles || []), ...categoryNames(ex)].join(" · ");
        return `<div class="search-result">
          <img src="${escapeHTML(ex.image || placeholder)}" alt="" onerror="this.src='${placeholder}'">
          <div class="search-result-info">
            <strong>${escapeHTML(ex.name)}</strong>
            <small>${escapeHTML(tags || "Sin categoría")}</small>
          </div>
          ${resultButtonHTML(ex.id, isAdded)}
        </div>`;
      }).join("")}
    </div>`;
}

function resultButtonHTML(exerciseId, isAdded) {
  return `<button type="button" class="btn ${isAdded ? "ghost" : "secondary"} small"
    data-action="add-plan-exercise" data-id="${exerciseId}" ${isAdded ? "disabled" : ""}>
    ${isAdded ? "Añadido ✓" : "+ Añadir"}</button>`;
}

function setResultButtonState(exerciseId, isAdded) {
  const button = $(`#plan-search-results [data-action="add-plan-exercise"][data-id="${exerciseId}"]`);
  if (button) button.outerHTML = resultButtonHTML(exerciseId, isAdded);
}

function refreshPlanSearch() {
  const box = $("#plan-search-results");
  if (box) box.innerHTML = planSearchResultsHTML();
}

// Actualiza solo la tabla y la portada, sin perder la búsqueda ni el scroll.
function refreshPlanEditor() {
  const plan = state.plans.find(p => p.id === selectedPlanId);
  if (!plan || !planDraft) return render();
  const table = $("#plan-editor-table");
  if (table) table.innerHTML = planEditorTableHTML();
  const cover = $("#plan-detail-cover-wrap");
  if (cover) cover.innerHTML = planCoverHTML({ ...plan, items: planDraft.items }, "plan-detail-cover");
  const count = $("#plan-detail-count");
  if (count) count.textContent = planSubtitle(plan, planDraft.items);
}

function startPlanEditing(planId) {
  const plan = state.plans.find(p => p.id === planId);
  if (!plan) return;
  selectedPlanId = plan.id;
  planDraft = clone(plan);
  planEditing = true;
  planSearch = { text: "", category: "", muscle: "" };
  render();
  setTimeout(() => $("#plan-search-text")?.focus({ preventScroll: true }), 50);
}

function addExerciseToDraft(exerciseId) {
  if (!planDraft || planDraft.items.some(i => i.exerciseId === exerciseId)) return;
  const ex = state.exercises.find(e => e.id === exerciseId);
  if (!ex) return;
  const max = maxRecordedWeight(ex.id);
  planDraft.items.push({
    exerciseId: ex.id,
    name: ex.name,
    sets: 3,
    reps: "10",
    weight: max ? String(max) : ""
  });
  setResultButtonState(ex.id, true);
  refreshPlanEditor();
  notify(`${ex.name} añadido al plan.`);
}

function savePlanDraft() {
  const plan = state.plans.find(p => p.id === planDraft?.id);
  if (!plan) {
    stopPlanEditing();
    return render();
  }

  plan.items = planDraft.items.map(item => ({
    exerciseId: item.exerciseId,
    name: state.exercises.find(e => e.id === item.exerciseId)?.name || item.name || "Ejercicio",
    sets: Math.max(1, Number(item.sets) || 3),
    reps: String(item.reps ?? "").trim() || "10",
    weight: String(item.weight ?? "").trim()
  }));

  stopPlanEditing();
  saveState();
  render();
  notify("Plan guardado.");
}

// Crear un plan o cambiar su nombre y portada.
function planForm(plan = {}) {
  selectedImage = plan.image || "";
  planFormItems = plan.items || [];

  openModal(`
    <h2>${plan.id ? "Nombre y portada del plan" : "Crear plan"}</h2>
    ${plan.id ? "" : `<p class="muted">Después podrás buscar y añadir los ejercicios del plan.</p>`}
    <form id="plan-form" data-id="${plan.id || ""}">
      <div class="field">
        <label for="plan-name">Nombre del plan *</label>
        <input id="plan-name" name="name" required maxlength="70"
          value="${escapeHTML(plan.name || "")}" placeholder="Ej. Día A · Pecho y tríceps">
      </div>
      <div class="field">
        <span class="field-label">Portada del plan</span>
        <div id="plan-cover-preview">${planCoverHTML({ image: selectedImage, items: planFormItems }, "plan-cover-preview")}</div>
        <p class="help" id="plan-cover-mode">${coverModeText()}</p>
        <input type="hidden" name="image" id="image-value" value="${escapeHTML(selectedImage)}">
        <div class="cover-options">
          <button type="button" class="btn secondary" data-action="use-collage">Usar collage de ejercicios</button>
          <label class="btn secondary" for="image-upload">Subir imagen desde mi dispositivo</label>
          <input id="image-upload" type="file" accept="image/*" hidden>
          <button type="button" class="btn ghost" id="suggest-images">Buscar imágenes sugeridas</button>
        </div>
        <p class="help">El collage se crea solo con las imágenes de los primeros ejercicios del plan. Las imágenes sugeridas se buscan por el nombre del plan.</p>
        <div id="image-results"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancelar</button>
        <button class="btn" type="submit">${plan.id ? "Guardar" : "Crear y añadir ejercicios"}</button>
      </div>
    </form>
  `);

  $("#image-upload").addEventListener("change", handleImageUpload);
  $("#suggest-images").addEventListener("click", () =>
    searchImages($("#plan-name").value.trim(), "workout", "Escribe primero el nombre del plan."));
}

// ---------- SESIONES ----------

function sessionForm(planId, date) {
  const plan = planId ? state.plans.find(p => p.id === planId) : null;
  if (planId && !plan) return notify("No se encuentra ese plan.");

  let rows = "";
  if (plan) {
    rows = plan.items.map(item => {
      const ex = state.exercises.find(e => e.id === item.exerciseId);
      return `<div class="session-row session-exercise">
        <img class="session-exercise-image" src="${escapeHTML(ex?.image || placeholder)}" alt="">
        <div class="session-exercise-content">
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
                value="${escapeHTML(item.weight || (maxRecordedWeight(item.exerciseId) || ""))}" placeholder="Ej. 40">
            </div>
          </div>
        </div>
      </div>`;
    }).join("");
  } else {
    rows = [...state.exercises].sort(byName).map(ex => {
      const maxWeight = maxRecordedWeight(ex.id);
      return `<div class="picker-row free-exercise-row">
        <input type="checkbox" name="free-exercise" value="${ex.id}">
        <img src="${escapeHTML(ex.image || placeholder)}" alt="">
        <div>
          <strong>${escapeHTML(ex.name)}</strong>
          <div class="picker-config">
            <input type="number" min="0" name="sets-${ex.id}" value="3" placeholder="Series" aria-label="Series">
            <input name="reps-${ex.id}" value="10" placeholder="Reps" aria-label="Repeticiones">
            <input type="number" min="0" step="0.5" name="weight-${ex.id}"
              value="${maxWeight || ""}" placeholder="${maxWeight ? `Máx. ${maxWeight} kg` : "Kg"}" aria-label="Peso en kg">
          </div>
          <small class="help">${maxWeight ? `Máximo registrado: ${maxWeight} kg` : "Sin pesos registrados todavía"}</small>
        </div>
      </div>`;
    }).join("");
  }

  openModal(`
    <h2>${plan ? "Registrar entrenamiento" : "Entrenamiento libre"}</h2>
    <p class="muted">${plan ? `${escapeHTML(plan.name)} · ` : ""}${formatDate(date)}</p>
    <form id="session-form" data-plan="${plan?.id || ""}" data-date="${date}" data-free="${plan ? "false" : "true"}">
      ${plan
        ? rows
        : `<div class="field">
            <span class="field-label">Elige los ejercicios que has realizado</span>
            <p class="help">Puedes seleccionar tantos ejercicios como quieras. Se mostrarán sus imágenes de la biblioteca.</p>
            <div class="exercise-picker">${rows || `<p class="muted">Todavía no tienes ejercicios. Añádelos primero en Ejercicios.</p>`}</div>
          </div>`}
      <div class="field">
        <label>Notas de la sesión (opcional)</label>
        <textarea name="notes" rows="2" placeholder="Sensaciones, observaciones..."></textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancelar</button>
        <button class="btn" type="submit">Guardar sesión</button>
      </div>
    </form>
  `);
}

function viewSession(id) {
  const session = state.sessions.find(s => s.id === id);
  if (!session) return;

  openModal(`
    <h2>${escapeHTML(session.planName)}</h2>
    <p class="muted">${formatDate(session.date)}</p>
    ${session.exercises.map(ex => `
      <div class="session-row session-exercise">
        <img class="session-exercise-image" src="${escapeHTML(ex.image || placeholder)}" alt="">
        <div class="session-exercise-content">
        <strong>${escapeHTML(ex.name)}</strong>
        <p class="muted">${ex.sets} series × ${escapeHTML(ex.reps)} repeticiones
        · ${ex.weight ? `${escapeHTML(ex.weight)} kg` : "Sin peso registrado"}</p>
        </div>
      </div>`).join("")}
    ${session.notes ? `<p class="muted" style="margin-top:14px">Notas: ${escapeHTML(session.notes)}</p>` : ""}
    <div class="modal-actions">
      <button class="btn ghost" data-action="close-modal">Cerrar</button>
      <button class="btn danger" data-action="delete-session" data-id="${session.id}">Eliminar sesión</button>
    </div>
  `);
}

// ---------- CALENDARIO Y PROGRESO ----------

function monthName(date) {
  return date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

function formatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("es-ES", {
    day: "numeric", month: "long", year: "numeric"
  });
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);
  const weekdays = ["L", "M", "X", "J", "V", "S", "D"];

  let days = weekdays.map(d => `<div class="calendar-weekday">${d}</div>`).join("");

  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
    const sessions = state.sessions.filter(s => s.date === key);
    const classes = [
      "day",
      date.getMonth() !== month ? "outside" : "",
      key === today() ? "today" : "",
      sessions.length ? "has-session" : ""
    ].filter(Boolean).join(" ");

    days += `<button class="${classes}" data-action="calendar-day" data-date="${key}">
      <span class="day-number">${date.getDate()}</span>
      ${sessions.map(s => `<span class="day-event">${escapeHTML(s.planName)}</span>`).join("")}
    </button>`;
  }

  const upcoming = [...state.sessions].sort((a,b) => b.date.localeCompare(a.date))
    .slice(0, 8).map(s => `
      <div class="session-row">
        <strong>${escapeHTML(s.planName)}</strong>
        <p class="muted">${formatDate(s.date)} · ${s.exercises.length} ejercicios</p>
        <button class="btn ghost small" data-action="view-session" data-id="${s.id}">Ver sesión</button>
      </div>`).join("");

  return `
    <div class="section-head">
      <div><h2>Calendario</h2>
      <p class="muted">Selecciona un día para registrar tu entrenamiento.</p></div>
      <button class="btn" data-action="calendar-today">Hoy</button>
    </div>
    <div class="card" style="padding:16px">
      <div class="calendar-head">
        <button class="btn ghost small" data-action="prev-month">←</button>
        <h3 style="text-transform:capitalize">${monthName(calendarDate)}</h3>
        <button class="btn ghost small" data-action="next-month">→</button>
      </div>
      <div class="calendar-grid">${days}</div>
    </div>
    <div class="session-list">
      <h2>Últimas sesiones</h2>
      ${upcoming || `<p class="muted">Todavía no has registrado sesiones.</p>`}
    </div>
  `;
}

function renderProgress() {
  const sessions = [...state.sessions].sort((a,b) => b.date.localeCompare(a.date));
  const exerciseCount = new Set(sessions.flatMap(s => s.exercises.map(e => e.exerciseId))).size;
  const totalExercises = sessions.reduce((sum, s) => sum + s.exercises.length, 0);

  const progress = {};
  sessions.forEach(session => {
    session.exercises.forEach(ex => {
      if (!progress[ex.exerciseId]) progress[ex.exerciseId] = { name: ex.name, records: [] };
      progress[ex.exerciseId].records.push({
        date: session.date,
        weight: Number(ex.weight) || 0,
        reps: ex.reps,
        sets: ex.sets
      });
    });
  });

  const rows = Object.values(progress).map(item => {
    const records = item.records;
    const best = Math.max(0, ...records.map(r => r.weight));
    const latest = records[0];
    return `<div class="progress-item">
      <strong>${escapeHTML(item.name)}</strong>
      <p>Último registro: ${latest.weight || "Sin peso"}${latest.weight ? " kg" : ""}
      · ${latest.sets} series × ${latest.reps} repeticiones</p>
      <p>Mejor peso registrado: ${best ? `${best} kg` : "Sin datos de peso"} · ${records.length} registros</p>
    </div>`;
  }).join("");

  return `
    <div class="section-head">
      <div><h2>Tu progreso</h2>
      <p class="muted">Resumen de tus entrenamientos registrados.</p></div>
    </div>
    <div class="stat-grid">
      <div class="stat"><strong>${sessions.length}</strong><span>Sesiones</span></div>
      <div class="stat"><strong>${exerciseCount}</strong><span>Ejercicios trabajados</span></div>
      <div class="stat"><strong>${totalExercises}</strong><span>Registros de ejercicio</span></div>
    </div>
    <div class="card" style="padding:18px">
      <h3>Evolución por ejercicio</h3>
      ${rows || `<p class="muted">Cuando registres tus primeras sesiones, aquí aparecerá tu evolución.</p>`}
    </div>
  `;
}

// ---------- ACCIONES DE LA INTERFAZ ----------

$("#app-content").addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  handleAction(button.dataset.action, button.dataset.id, button.dataset.date, button);
});

$("#modal-content").addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  handleAction(button.dataset.action, button.dataset.id, button.dataset.date, button);
});

// Las tarjetas de plan se pueden abrir también con el teclado.
$("#app-content").addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") &&
      event.target.matches('[role="button"][data-action]')) {
    event.preventDefault();
    event.target.click();
  }
});

// Búsqueda de ejercicios y edición de la tabla del plan.
$("#app-content").addEventListener("input", event => {
  const target = event.target;
  if (target.id === "plan-search-text") {
    planSearch.text = target.value;
    refreshPlanSearch();
    return;
  }
  if (target.dataset.field && planDraft) {
    const item = planDraft.items[Number(target.dataset.index)];
    if (item) item[target.dataset.field] = target.value;
  }
});

$("#app-content").addEventListener("change", event => {
  const target = event.target;
  if (target.id === "plan-search-category") {
    planSearch.category = target.value;
    refreshPlanSearch();
  }
  if (target.id === "plan-search-muscle") {
    planSearch.muscle = target.value;
    refreshPlanSearch();
  }
});

function handleAction(action, id, date, button = null) {
  const fromManage = button?.dataset.from === "manage";

  switch (action) {
    case "new-exercise": exerciseForm(); break;
    case "edit-exercise": {
      const ex = state.exercises.find(x => x.id === id);
      if (ex) exerciseForm(ex);
      break;
    }
    case "delete-exercise": {
      const used = state.plans.some(p => p.items.some(i => i.exerciseId === id));
      if (used) return notify("Este ejercicio está incluido en un plan. Elimínalo primero de los planes.");
      if (confirm("¿Eliminar este ejercicio de tu biblioteca?")) {
        state.exercises = state.exercises.filter(x => x.id !== id);
        saveState(); render(); notify("Ejercicio eliminado.");
      }
      break;
    }
    case "open-category":
      selectedCategory = id;
      render();
      break;
    case "back-folders":
      selectedCategory = "";
      render();
      break;

    // Categorías
    case "new-category":
      taxonomyForm("category", {}, fromManage ? "manage" : "");
      break;
    case "new-category-from-exercise":
      exerciseDraft = captureExerciseDraft();
      taxonomyForm("category", {}, "exercise");
      break;
    case "edit-category": {
      const cat = state.categories.find(c => c.id === id);
      if (cat) taxonomyForm("category", cat, fromManage ? "manage" : "");
      break;
    }
    case "manage-categories":
      manageTaxonomy("category");
      break;
    case "delete-category":
      deleteTaxonomy("category", id);
      break;

    // Grupos musculares
    case "new-muscle":
      taxonomyForm("muscle", {}, fromManage ? "manage" : "");
      break;
    case "new-muscle-from-exercise":
      exerciseDraft = captureExerciseDraft();
      taxonomyForm("muscle", {}, "exercise");
      break;
    case "edit-muscle": {
      const group = state.muscleGroups.find(m => m.id === id);
      if (group) taxonomyForm("muscle", group, fromManage ? "manage" : "");
      break;
    }
    case "manage-muscles":
      manageTaxonomy("muscle");
      break;
    case "delete-muscle":
      deleteTaxonomy("muscle", id);
      break;

    case "back-to-exercise": {
      const draft = exerciseDraft;
      exerciseDraft = null;
      if (draft) exerciseForm(draft);
      else closeModal();
      break;
    }

    // Planes
    case "new-plan": planForm(); break;
    case "open-plan":
      stopPlanEditing();
      selectedPlanId = id;
      render();
      scrollToContent();
      break;
    case "back-plans":
      if (!confirmDiscardPlan()) return;
      selectedPlanId = "";
      render();
      break;
    case "edit-plan": {
      const plan = state.plans.find(x => x.id === id);
      if (plan) planForm(plan);
      break;
    }
    case "edit-plan-exercises":
      startPlanEditing(id);
      break;
    case "cancel-plan-edit":
      stopPlanEditing();
      render();
      break;
    case "save-plan-exercises":
      savePlanDraft();
      break;
    case "add-plan-exercise":
      addExerciseToDraft(id);
      break;
    case "remove-plan-item": {
      if (!planDraft) return;
      const [removed] = planDraft.items.splice(Number(id), 1);
      if (removed) setResultButtonState(removed.exerciseId, false);
      refreshPlanEditor();
      break;
    }
    case "move-plan-item": {
      if (!planDraft) return;
      const from = Number(id);
      const to = button?.dataset.dir === "up" ? from - 1 : from + 1;
      if (to < 0 || to >= planDraft.items.length) return;
      const items = planDraft.items;
      [items[from], items[to]] = [items[to], items[from]];
      refreshPlanEditor();
      break;
    }
    case "clear-plan-search":
      planSearch = { text: "", category: "", muscle: "" };
      $("#plan-search-text").value = "";
      $("#plan-search-category").value = "";
      $("#plan-search-muscle").value = "";
      refreshPlanSearch();
      break;
    case "use-collage":
      updateSelectedImage("");
      break;
    case "delete-plan":
      if (confirm("¿Eliminar este plan? Las sesiones ya registradas se conservarán.")) {
        state.plans = state.plans.filter(x => x.id !== id);
        if (selectedPlanId === id) {
          selectedPlanId = "";
          stopPlanEditing();
        }
        saveState(); render(); notify("Plan eliminado.");
      }
      break;
    case "start-plan": {
      const plan = state.plans.find(p => p.id === id);
      if (plan && !plan.items.length) return notify("Este plan todavía no tiene ejercicios.");
      sessionForm(id, today());
      break;
    }

    case "calendar-day": openDay(date); break;
    case "free-workout": sessionForm("", date); break;
    case "prev-month":
      calendarDate.setMonth(calendarDate.getMonth() - 1); render(); break;
    case "next-month":
      calendarDate.setMonth(calendarDate.getMonth() + 1); render(); break;
    case "calendar-today":
      calendarDate = new Date(); render(); break;
    case "view-session": viewSession(id); break;
    case "delete-session":
      if (confirm("¿Eliminar esta sesión del historial?")) {
        state.sessions = state.sessions.filter(s => s.id !== id);
        saveState(); closeModal(); render(); notify("Sesión eliminada.");
      }
      break;
    case "close-modal": closeModal(); break;
    case "go-exercises": closeModal(); setView("exercises"); break;
    case "go-plans": closeModal(); setView("plans"); break;
  }
}

// ---------- CALENDARIO: SELECCIÓN DE PLAN ----------

function openDay(date) {
  openModal(`
    <h2>Entrenar el ${formatDate(date)}</h2>
    <p class="muted">Elige un plan o registra un entrenamiento libre.</p>
    ${state.plans.length ? `
      <div class="field">
        <label for="choose-plan">Plan de entrenamiento</label>
        <select id="choose-plan">
          ${state.plans.map(p => `<option value="${p.id}">${escapeHTML(p.name)}</option>`).join("")}
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn ghost" data-action="close-modal">Cancelar</button>
        <button class="btn" id="confirm-plan" data-date="${date}">Entrenar con este plan</button>
      </div>
      <div class="modal-actions">
        <button class="btn secondary" data-action="free-workout" data-date="${date}">＋ Entrenamiento libre</button>
      </div>
    ` : `
      <p class="muted">Todavía no tienes planes. Puedes empezar igualmente con los ejercicios de tu biblioteca.</p>
      <div class="modal-actions">
        <button class="btn ghost" data-action="close-modal">Cancelar</button>
        <button class="btn" data-action="free-workout" data-date="${date}">＋ Empezar entrenamiento libre</button>
      </div>
    `}
  `);

  const confirmButton = $("#confirm-plan");
  if (confirmButton) {
    confirmButton.addEventListener("click", () => {
      const planId = $("#choose-plan").value;
      sessionForm(planId, date);
    });
  }
}

// ---------- GUARDADO DE FORMULARIOS ----------

$("#modal-content").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);

  if (form.id === "taxonomy-form") {
    saveTaxonomy(form, data);
  }

  if (form.id === "exercise-form") {
    const name = String(data.get("name") || "").trim();
    if (!name) return;

    const existing = state.exercises.find(x => x.id === form.dataset.id);
    const muscles = data.getAll("muscles").map(String);

    const exercise = {
      id: existing?.id || uid(),
      name,
      muscles,
      muscle: muscles[0] || "",
      categories: data.getAll("categories").map(String),
      image: selectedImage || ""
    };

    if (existing) Object.assign(existing, exercise);
    else state.exercises.push(exercise);

    // Mantener actualizado el nombre guardado en los planes.
    state.plans.forEach(plan => plan.items.forEach(item => {
      if (item.exerciseId === exercise.id) item.name = exercise.name;
    }));

    saveState(); closeModal(); render(); notify("Ejercicio guardado.");
  }

  if (form.id === "plan-form") {
    const name = String(data.get("name") || "").trim();
    if (!name) return;

    const image = selectedImage || "";
    const existing = state.plans.find(x => x.id === form.dataset.id);

    if (existing) {
      existing.name = name;
      existing.image = image;
      saveState(); closeModal(); render(); notify("Plan actualizado.");
    } else {
      const plan = { id: uid(), name, image, items: [] };
      state.plans.push(plan);
      saveState();
      closeModal();
      startPlanEditing(plan.id);
      notify("Plan creado. Ahora busca y añade sus ejercicios.");
    }
  }

  if (form.id === "session-form") {
    const plan = state.plans.find(p => p.id === form.dataset.plan);
    const isFree = form.dataset.free === "true";

    if (!isFree && !plan) return notify("No se encuentra el plan.");

    const selectedIds = isFree
      ? [...form.querySelectorAll('input[name="free-exercise"]:checked')].map(input => input.value)
      : plan.items.map(item => item.exerciseId);

    if (!selectedIds.length) return notify("Selecciona al menos un ejercicio para guardar la sesión.");

    const exercises = selectedIds.map(exerciseId => {
      const item = plan?.items.find(i => i.exerciseId === exerciseId);
      const exercise = state.exercises.find(x => x.id === exerciseId);
      return {
        exerciseId,
        name: exercise?.name || item?.name || "Ejercicio",
        image: exercise?.image || "",
        sets: Math.max(0, Number(data.get(`sets-${exerciseId}`)) || 0),
        reps: String(data.get(`reps-${exerciseId}`) || ""),
        weight: String(data.get(`weight-${exerciseId}`) || "")
      };
    });

    state.sessions.push({
      id: uid(),
      date: form.dataset.date,
      planId: plan?.id || null,
      planName: plan?.name || "Entrenamiento libre",
      exercises,
      notes: String(data.get("notes") || "")
    });

    saveState(); closeModal(); setView("calendar"); notify("Sesión guardada en tu historial.");
  }
});

// ---------- MODO CLARO / OSCURO ----------

const THEME_KEY = "andrifit-theme";
const systemDark = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;

function savedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch (_) { return null; }
}

function applyTheme(theme, save = false) {
  document.documentElement.dataset.theme = theme;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#11161d" : "#f5f6f8";

  const button = $("#theme-toggle");
  if (button) {
    const label = theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
    button.setAttribute("aria-label", label);
    button.title = label;
  }

  if (save) {
    try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
  }
}

$("#theme-toggle")?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next, true);
});

// Si no ha elegido un tema, seguir el del dispositivo.
systemDark?.addEventListener?.("change", event => {
  const stored = savedTheme();
  if (stored !== "light" && stored !== "dark") applyTheme(event.matches ? "dark" : "light");
});

applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");

// ---------- INICIO ----------

render();
