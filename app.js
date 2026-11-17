const STORAGE_KEY = "fit-plan-workouts-v1";
const $ = (id) => document.getElementById(id);
let workouts = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
let editingId = null;

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workouts));
  $("saveStatus").textContent = "Guardado en este dispositivo";
  render();
}
function dateLabel(value) {
  if (!value) return "Sin fecha";
  return new Date(value + "T12:00:00").toLocaleDateString("es-ES", {day:"numeric", month:"long", year:"numeric"});
}
function render() {
  const query = $("searchInput").value.trim().toLowerCase();
  const filtered = workouts.filter(w => w.name.toLowerCase().includes(query));
  $("totalDays").textContent = workouts.length;
  $("totalExercises").textContent = workouts.reduce((n,w) => n + (w.exercises || []).length, 0);
  $("completedDays").textContent = workouts.filter(w => w.done).length;
  $("emptyState").hidden = filtered.length > 0;
  $("workoutList").innerHTML = filtered.map(w => `
    <article class="workout-card">
      <div><h3>${escapeHtml(w.name)}</h3><div class="workout-meta">${dateLabel(w.date)}</div><span class="pill ${w.done ? "done" : ""}">${w.done ? "Completado" : "Pendiente"}</span></div>
      <div class="card-actions">
        <button class="icon-button" title="Marcar realizado" aria-label="Marcar realizado" data-action="toggle" data-id="${w.id}">${w.done ? "↶" : "✓"}</button>
        <button class="icon-button" title="Editar" aria-label="Editar" data-action="edit" data-id="${w.id}">✎</button>
        <button class="icon-button" title="Eliminar" aria-label="Eliminar" data-action="delete" data-id="${w.id}">×</button>
      </div>
    </article>`).join("");
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function openDialog(workout) {
  editingId = workout?.id || null;
  $("dialogTitle").textContent = workout ? "Editar entrenamiento" : "Crear entrenamiento";
  $("workoutName").value = workout?.name || "";
  $("workoutDate").value = workout?.date || new Date().toISOString().slice(0,10);
  $("workoutDone").checked = workout?.done || false;
  $("workoutDialog").showModal();
}
function closeDialog() { $("workoutDialog").close(); }
$("newDayBtn").addEventListener("click", () => openDialog());
$("emptyNewBtn").addEventListener("click", () => openDialog());
$("closeDialog").addEventListener("click", closeDialog);
$("cancelDialog").addEventListener("click", closeDialog);
$("searchInput").addEventListener("input", render);
$("workoutForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = {name:$("workoutName").value.trim(), date:$("workoutDate").value, done:$("workoutDone").checked};
  if (!data.name || !data.date) return;
  if (editingId) workouts = workouts.map(w => w.id === editingId ? {...w, ...data} : w);
  else workouts.unshift({id:crypto.randomUUID(), ...data, exercises:[]});
  closeDialog(); save();
});
$("workoutList").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const workout = workouts.find(w => w.id === button.dataset.id);
  if (!workout) return;
  if (button.dataset.action === "toggle") workout.done = !workout.done;
  if (button.dataset.action === "edit") return openDialog(workout);
  if (button.dataset.action === "delete") {
    if (!confirm(`¿Eliminar "${workout.name}"?`)) return;
    workouts = workouts.filter(w => w.id !== workout.id);
  }
  save();
});
render();
