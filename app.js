
const KEY = "fit-plan-v2";

const $ = id => document.getElementById(id);

let data = JSON.parse(localStorage.getItem(KEY) ||
  '{"templates":[],"sessions":[]}');

let editingId = null;
let selectedDate = isoToday();
let shownMonth = new Date();

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

function persist() {
  localStorage.setItem(KEY, JSON.stringify(data));
  $("saveStatus").textContent = "Guardado en este dispositivo";
  renderAll();
}

function fmtDate(s) {
  return new Date(s + "T12:00:00").toLocaleDateString("es-ES", {
    day:"numeric", month:"long", year:"numeric"
  });
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );

  $("templatesPanel").hidden = tab !== "templates";
  $("calendarPanel").hidden = tab !== "calendar";

  if (tab === "calendar") renderCalendar();
}

document.querySelectorAll(".tab").forEach(b =>
  b.addEventListener("click", () => switchTab(b.dataset.tab))
);

function renderTemplates() {
  $("templateCount").textContent = data.templates.length;

  $("exerciseCount").textContent =
    data.templates.reduce((n,t) => n + t.exercises.length, 0);

  $("sessionCount").textContent = data.sessions.length;

  $("templateEmpty").hidden = data.templates.length > 0;

  $("templateList").innerHTML = data.templates.map(t => `
    <article class="template-card">
      <div class="template-top">
        <div>
          <h3>${esc(t.name)}</h3>
          <div class="template-meta">${t.exercises.length} ejercicio(s)</div>
        </div>
        <div class="card-actions">
          <button class="icon-button" data-edit="${t.id}" title="Editar">✎</button>
          <button class="icon-button" data-delete="${t.id}" title="Eliminar">×</button>
        </div>
      </div>
      <div class="exercise-preview">
        ${t.exercises.length
          ? t.exercises.map(e =>
            `${esc(e.name)} · ${esc(e.sets)} series × ${esc(e.reps)} reps`
          ).join("<br>")
          : "Todavía no has añadido ejercicios."}
      </div>
    </article>
  `).join("");
}

function exerciseRow(e = {name:"",sets:"3",reps:"10"}) {
  return `
    <div class="exercise-row">
      <label>Ejercicio
        <input class="ex-name" required placeholder="Ej. Press banca" value="${esc(e.name)}">
      </label>
      <label>Series
        <input class="ex-sets" type="number" min="1" value="${esc(e.sets)}">
      </label>
      <label>Reps
        <input class="ex-reps" placeholder="10-12" value="${esc(e.reps)}">
      </label>
      <button type="button" class="icon-button remove">×</button>
    </div>
  `;
}

function openTemplate(t = null) {
  editingId = t?.id || null;

  $("templateDialogTitle").textContent =
    t ? "Editar plantilla" : "Nueva plantilla";

  $("templateName").value = t?.name || "";

  const exercises = t?.exercises?.length
    ? t.exercises
    : [{name:"",sets:"3",reps:"10"}];

  $("exerciseEditor").innerHTML = exercises.map(exerciseRow).join("");

  $("templateDialog").showModal();
}

$("newTemplate").onclick = () => openTemplate();
$("emptyNew").onclick = () => openTemplate();

$("addExercise").onclick = () => {
  $("exerciseEditor").insertAdjacentHTML(
    "beforeend",
    exerciseRow()
  );
};

$("exerciseEditor").addEventListener("click", e => {
  if (e.target.closest(".remove")) {
    e.target.closest(".exercise-row").remove();
  }
});

$("templateList").addEventListener("click", e => {
  const edit = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-delete]");

  if (edit) {
    const t = data.templates.find(x => x.id === edit.dataset.edit);
    openTemplate(t);
  }

  if (del) {
    const id = del.dataset.delete;

    if (confirm("¿Eliminar esta plantilla? Las sesiones ya registradas se conservarán.")) {
      data.templates = data.templates.filter(t => t.id !== id);
      persist();
    }
  }
});

$("templateForm").addEventListener("submit", e => {
  e.preventDefault();

  const exercises = [
    ...$("exerciseEditor").querySelectorAll(".exercise-row")
  ].map(r => ({
    name: r.querySelector(".ex-name").value.trim(),
    sets: r.querySelector(".ex-sets").value,
    reps: r.querySelector(".ex-reps").value.trim(),
    weight: ""
  })).filter(x => x.name);

  const item = {
    id: editingId || crypto.randomUUID(),
    name: $("templateName").value.trim(),
    exercises
  };

  if (editingId) {
    data.templates = data.templates.map(t =>
      t.id === editingId ? item : t
    );
  } else {
    data.templates.push(item);
  }

  $("templateDialog").close();
  persist();
});

document.querySelectorAll("[data-close]").forEach(b => {
  b.onclick = () => $(b.dataset.close).close();
});

function renderCalendar() {
  const y = shownMonth.getFullYear();
  const m = shownMonth.getMonth();

  $("monthTitle").textContent =
    shownMonth.toLocaleDateString("es-ES", {
      month:"long", year:"numeric"
    });

  const first = (new Date(y,m,1).getDay()+6)%7;
  const days = new Date(y,m+1,0).getDate();
  const prevDays = new Date(y,m,0).getDate();

  let html = ["L","M","X","J","V","S","D"]
    .map(x => `<div class="weekday">${x}</div>`).join("");

  for (let i=0; i<42; i++) {
    let n = i-first+1;
    let dt, muted = false;

    if (n < 1) {
      dt = new Date(y,m-1,prevDays+n);
      muted = true;
    } else if (n > days) {
      dt = new Date(y,m+1,n-days);
      muted = true;
    } else {
      dt = new Date(y,m,n);
    }

    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    const has = data.sessions.some(s => s.date === key);

    html += `
      <button class="cal-day ${muted?"muted":""}
        ${key===selectedDate?"selected":""}
        ${has?"has-session":""}" data-date="${key}">
        ${dt.getDate()}
      </button>
    `;
  }

  $("calendarGrid").innerHTML = html;

  $("calendarGrid").querySelectorAll("[data-date]").forEach(b => {
    b.onclick = () => {
      selectedDate = b.dataset.date;
      renderCalendar();
    };
  });

  $("selectedDateLabel").textContent = fmtDate(selectedDate);

  const sessions = data.sessions.filter(s => s.date === selectedDate);

  $("daySessions").innerHTML = sessions.length
    ? sessions.map(s => `
      <div class="session-chip">
        <span>${esc(s.templateName)}</span>
        <button data-remove-session="${s.id}" title="Eliminar registro">×</button>
      </div>
    `).join("")
    : '<p class="no-session">No hay entrenamientos registrados este día.</p>';

  $("daySessions").querySelectorAll("[data-remove-session]").forEach(b => {
    b.onclick = () => {
      if (confirm("¿Eliminar este registro del calendario?")) {
        data.sessions = data.sessions.filter(
          s => s.id !== b.dataset.removeSession
        );
        persist();
      }
    };
  });

  $("addSession").disabled = data.templates.length === 0;

  $("addSession").textContent = data.templates.length
    ? "＋ Registrar entrenamiento"
    : "Crea primero una plantilla";

  $("historyList").innerHTML = [...data.sessions]
    .sort((a,b) => b.date.localeCompare(a.date))
    .map(s => `
      <div class="history-row">
        <strong>${esc(s.templateName)}</strong>
        <span>${fmtDate(s.date)}</span>
      </div>
    `).join("") || '<p class="hint">Todavía no has registrado sesiones.</p>';
}

$("prevMonth").onclick = () => {
  shownMonth = new Date(
    shownMonth.getFullYear(),
    shownMonth.getMonth()-1, 1
  );
  renderCalendar();
};

$("nextMonth").onclick = () => {
  shownMonth = new Date(
    shownMonth.getFullYear(),
    shownMonth.getMonth()+1, 1
  );
  renderCalendar();
};

$("addSession").onclick = () => {
  if (!data.templates.length) return;

  $("sessionDateLabel").textContent = fmtDate(selectedDate);

  $("sessionTemplate").innerHTML = data.templates.map(t =>
    `<option value="${t.id}">${esc(t.name)}</option>`
  ).join("");

  $("sessionDialog").showModal();
};

$("sessionForm").addEventListener("submit", e => {
  e.preventDefault();

  const t = data.templates.find(
    x => x.id === $("sessionTemplate").value
  );

  if (!t) return;

  data.sessions.push({
    id: crypto.randomUUID(),
    date: selectedDate,
    templateId: t.id,
    templateName: t.name,
    exercises: structuredClone(t.exercises)
  });

  $("sessionDialog").close();
  persist();
});

function renderAll() {
  renderTemplates();

  if (!$("calendarPanel").hidden) {
    renderCalendar();
  }
}

renderAll();
