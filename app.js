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

      saved.exercises = saved.exercises.map(ex => ({
        ...ex,
        categories: Array.isArray(ex.categories) ? ex.categories : [],
        muscles: Array.isArray(ex.muscles)
          ? ex.muscles
          : (ex.muscle ? [ex.muscle] : [])
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

function maxRecordedWeight(exerciseId) {
  return Math.max(0, ...state.sessions.flatMap(session =>
    (session.exercises || [])
      .filter(ex => ex.exerciseId === exerciseId)
      .map(ex => Number(ex.weight) || 0)
  ));
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    if (window.AndriFITDriveSync) {
      window.AndriFITDriveSync.notifyLocalSave();
    }

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
        <div class="exercise-categories muscle-tags">
          ${(ex.muscles || (ex.muscle ? [ex.muscle] : [])).map(m =>
            `<span class="pill">${escapeHTML(m)}</span>`).join("")}
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

// ---------- CATEGORÍAS ----------

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
        <span class="field-label">Grupos musculares</span>
        <p class="help">Puedes seleccionar más de un grupo muscular. Esto es independiente de las categorías o carpetas.</p>
        <div class="category-checkboxes muscle-checkboxes">
          ${["Pecho","Espalda","Hombros","Bíceps","Tríceps","Piernas","Glúteos","Abdominales","Cardio","General"].map(m => `
            <label class="category-check">
              <input type="checkbox" name="muscles" value="${m}"
                ${selectedMuscles.includes(m) ? "checked" : ""}>
              <span>${m}</span>
            </label>
          `).join("")}
        </div>
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
      return `<div class="plan-exercise-row">
        <img src="${escapeHTML(ex?.image || placeholder)}" alt="">
        <span>${escapeHTML(ex?.name || item.name || "Ejercicio eliminado")}
          <small>${item.sets} × ${escapeHTML(item.reps)} · ${item.weight ? `${escapeHTML(item.weight)} kg` : "Peso por definir"}</small>
        </span>
      </div>`;
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
  const orderedExercises = [
    ...(plan.items || []).map(item => state.exercises.find(ex => ex.id === item.exerciseId)).filter(Boolean),
    ...state.exercises.filter(ex => !(plan.items || []).some(item => item.exerciseId === ex.id))
  ];

  openModal(`
    <h2>${plan.id ? "Editar plan" : "Crear plan"}</h2>
    <form id="plan-form" data-id="${plan.id || ""}">
      <div class="field">
        <label for="plan-name">Nombre del plan *</label>
        <input id="plan-name" name="name" required maxlength="70"
          value="${escapeHTML(plan.name || "")}" placeholder="Ej. Día A · Pecho y tríceps">
      </div>
      <div class="field">
        <span class="field-label">Selecciona y ordena los ejercicios</span>
        <p class="help">Marca los ejercicios que quieras incluir. Usa las flechas para cambiar su orden. La imagen es la que guardaste en Ejercicios.</p>
        <div class="exercise-picker" id="plan-exercise-picker">
          ${orderedExercises.map(ex => {
            const item = existing.get(ex.id);
            const maxWeight = maxRecordedWeight(ex.id);
            const suggestedWeight = maxWeight ? String(maxWeight) : (item?.weight || "");
            return `<div class="picker-row" data-exercise-row="${ex.id}">
              <input type="checkbox" name="exercise" value="${ex.id}" ${item ? "checked" : ""}>
              <img src="${escapeHTML(ex.image || placeholder)}" alt="">
              <div>
                <strong>${escapeHTML(ex.name)}</strong>
                <div class="picker-config">
                  <input type="number" min="1" max="30" name="sets-${ex.id}" value="${item?.sets ?? 3}" placeholder="Series" aria-label="Series">
                  <input type="text" name="reps-${ex.id}" value="${escapeHTML(item?.reps ?? "10")}" placeholder="Reps" aria-label="Repeticiones">
                  <input type="number" min="0" step="0.5" name="weight-${ex.id}" value="${escapeHTML(suggestedWeight)}" placeholder="${maxWeight ? `Máx. ${maxWeight} kg` : "Kg"}" aria-label="Peso en kg">
                </div>
                <div class="picker-order">
                  <button type="button" class="btn ghost small" data-move="up" aria-label="Subir ${escapeHTML(ex.name)}">↑</button>
                  <button type="button" class="btn ghost small" data-move="down" aria-label="Bajar ${escapeHTML(ex.name)}">↓</button>
                  <small>${maxWeight ? `Máximo registrado: ${maxWeight} kg` : "Sin pesos registrados todavía"}</small>
                </div>
              </div>
            </div>`;
          }).join("")}
        </div>
        <p class="help">El peso sugerido se obtiene del máximo registrado para ese ejercicio en tus sesiones. Puedes cambiarlo para este plan.</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-action="close-modal">Cancelar</button>
        <button class="btn" type="submit">Guardar plan</button>
      </div>
    </form>
  `);

  $$("#plan-exercise-picker [data-move]").forEach(button => {
    button.addEventListener("click", () => {
      const row = button.closest(".picker-row");
      if (!row) return;
      if (button.dataset.move === "up" && row.previousElementSibling) {
        row.parentElement.insertBefore(row, row.previousElementSibling);
      } else if (button.dataset.move === "down" && row.nextElementSibling) {
        row.parentElement.insertBefore(row.nextElementSibling, row);
      }
    });
  });
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
    rows = state.exercises.map(ex => {
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
  handleAction(button.dataset.action, button.dataset.id, button.dataset.date);
});

$("#modal-content").addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  handleAction(button.dataset.action, button.dataset.id, button.dataset.date);
});

function handleAction(action, id, date) {
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
    case "new-category":
      categoryForm();
      break;
    case "new-category-from-exercise":
      categoryForm();
      break;
    case "edit-category": {
      const cat = state.categories.find(c => c.id === id);
      if (cat) categoryForm(cat);
      break;
    }
    case "manage-categories":
      manageCategories();
      break;
    case "delete-category":
      if (confirm("¿Eliminar esta categoría? Los ejercicios no se borrarán, solo perderán esta asignación.")) {
        state.categories = state.categories.filter(c => c.id !== id);
        state.exercises.forEach(ex => {
          ex.categories = (ex.categories || []).filter(catId => catId !== id);
        });
        if (selectedCategory === id) selectedCategory = "";
        saveState();
        manageCategories();
        notify("Categoría eliminada.");
      }
      break;
    case "new-plan": planForm(); break;
    case "edit-plan": {
      const plan = state.plans.find(x => x.id === id);
      if (plan) planForm(plan);
      break;
    }
    case "delete-plan":
      if (confirm("¿Eliminar este plan? Las sesiones ya registradas se conservarán.")) {
        state.plans = state.plans.filter(x => x.id !== id);
        saveState(); render(); notify("Plan eliminado.");
      }
      break;
    case "start-plan": sessionForm(id, today()); break;
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

  if (form.id === "category-form") {
    const name = String(data.get("name") || "").trim();
    if (!name) return;

    const duplicate = state.categories.some(c =>
      c.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es") &&
      c.id !== form.dataset.id
    );
    if (duplicate) return notify("Ya existe una categoría con ese nombre.");

    const existing = state.categories.find(c => c.id === form.dataset.id);
    if (existing) existing.name = name;
    else state.categories.push({ id: uid(), name });

    saveState();

    if (form.dataset.returnToExercise === "true") {
      closeModal();
      exerciseForm();
    } else {
      closeModal();
      if (currentView === "exercises") render();
      notify("Categoría guardada.");
    }
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
      muscle: muscles[0] || "General",
      categories: data.getAll("categories").map(String),
      image: selectedImage || ""
    };

    if (existing) Object.assign(existing, exercise);
    else state.exercises.push(exercise);

    saveState(); closeModal(); render(); notify("Ejercicio guardado.");
  }

  if (form.id === "plan-form") {
    const name = String(data.get("name") || "").trim();
    if (!name) return;

    const items = [...form.querySelectorAll('input[name="exercise"]:checked')].map(input => {
      const exercise = state.exercises.find(x => x.id === input.value);
      return {
        exerciseId: input.value,
        name: exercise?.name || "Ejercicio",
        sets: Math.max(1, Number(data.get(`sets-${input.value}`)) || 3),
        reps: String(data.get(`reps-${input.value}`) || "10"),
        weight: String(data.get(`weight-${input.value}`) || "")
      };
    });

    const existing = state.plans.find(x => x.id === form.dataset.id);
    const plan = { id: existing?.id || uid(), name, items };

    if (existing) Object.assign(existing, plan);
    else state.plans.push(plan);

    saveState(); closeModal(); render(); notify("Plan guardado.");
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

// ---------- INICIO ----------

render();
