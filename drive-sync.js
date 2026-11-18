
/* AndriFIT · Google Drive como almacenamiento principal */

(() => {
  "use strict";

  const CLIENT_ID = "196091840894-q54goht1grsb0900o72d7egb7sm2186s.apps.googleusercontent.com";
  const FILE_NAME = "andrifit-data.json";
  const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
  const LOCAL_KEY = "fitplan-library-v1";

  const UPLOAD_DELAY = 700;
  const POLL_INTERVAL = 10000;

  let token = null;
  let fileId = null;
  let knownVersion = null;

  let ready = false;
  let syncing = false;
  let dirty = false;
  let pending = false;
  let conflict = false;

  // Cuenta los cambios para no perder ediciones durante una subida.
  let changeCounter = 0;

  let uploadTimer = null;
  let pollTimer = null;

  const byId = id => document.getElementById(id);

  function status(message, kind = "") {
    const el = byId("drive-sync-status");
    if (!el) return;

    el.textContent = message;
    el.dataset.status = kind;
  }

  function lockApp(locked) {
    document.body.classList.toggle("andrifit-drive-locked", locked);

    document.querySelectorAll(".tab").forEach(tab => {
      tab.disabled = locked;
    });
  }

  function updateButtons() {
    const connect = byId("drive-connect-btn");
    const sync = byId("drive-sync-btn");

    if (connect) {
      connect.textContent = token
        ? "Google Drive conectado"
        : "Conectar Google Drive";

      connect.disabled = Boolean(token) || syncing;
    }

    if (sync) {
      sync.disabled = !ready || syncing;
    }
  }

  function valid(data) {
    return data &&
      Array.isArray(data.exercises) &&
      Array.isArray(data.plans) &&
      Array.isArray(data.sessions);
  }

  function versionOf(file) {
    if (!file) return null;
    return String(file.version || file.modifiedTime || "");
  }

  function waitForGoogle() {
    return new Promise((resolve, reject) => {
      const started = Date.now();

      const interval = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - started > 15000) {
          clearInterval(interval);
          reject(new Error(
            "No se ha podido cargar Google. Recarga la página."
          ));
        }
      }, 150);
    });
  }

  async function requestToken() {
    await waitForGoogle();

    return new Promise((resolve, reject) => {
      try {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPE,

          callback: response => {
            if (response?.error || !response?.access_token) {
              reject(new Error(
                response?.error_description ||
                response?.error ||
                "No se pudo autorizar Google Drive."
              ));
              return;
            }

            token = response.access_token;
            resolve();
          },

          error_callback: error => {
            reject(new Error(
              error?.message || "Error de autorización de Google."
            ));
          }
        });

        client.requestAccessToken({ prompt: "" });

      } catch (error) {
        reject(error);
      }
    });
  }

  async function driveFetch(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    });

    if (response.status === 401) {
      token = null;
      ready = false;
      stopPolling();
      lockApp(true);
      updateButtons();

      throw new Error(
        "La autorización ha caducado. Vuelve a conectar Google Drive."
      );
    }

    if (!response.ok) {
      let detail = "";

      try {
        const data = await response.json();
        detail = data.error?.message || "";
      } catch (_) {}

      throw new Error(
        detail || `Error de Google Drive (${response.status}).`
      );
    }

    return response;
  }

  async function findFile() {
    const query = encodeURIComponent(
      `name='${FILE_NAME}' and trashed=false`
    );

    const url =
      `${API}/files?q=${query}` +
      `&spaces=appDataFolder` +
      `&fields=files(id,name,version,modifiedTime)` +
      `&pageSize=10`;

    const response = await driveFetch(url);
    const result = await response.json();
    const file = result.files?.[0] || null;

    fileId = file?.id || null;

    return file;
  }

  async function downloadCloud(id) {
    if (!id) {
      throw new Error("No se encuentra el archivo de AndriFIT en Drive.");
    }

    const response = await driveFetch(
      `${API}/files/${encodeURIComponent(id)}?alt=media`
    );

    const data = await response.json();

    if (!valid(data)) {
      throw new Error(
        "El archivo de Drive no contiene datos válidos."
      );
    }

    if (!Array.isArray(data.categories)) {
      data.categories = [];
    }

    return data;
  }

  // Subida reanudable para admitir archivos grandes con imágenes.
  async function uploadCloud(data) {
    if (!valid(data)) {
      throw new Error("No hay datos válidos para guardar.");
    }

    const json = JSON.stringify(data);

    const blob = new Blob([json], {
      type: "application/json"
    });

    const metadata = {
      name: FILE_NAME,
      mimeType: "application/json",
      ...(fileId ? {} : { parents: ["appDataFolder"] })
    };

    const endpoint = fileId
      ? `${UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=resumable&fields=id`
      : `${UPLOAD_API}/files?uploadType=resumable&fields=id`;

    const startResponse = await driveFetch(endpoint, {
      method: fileId ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/json",
        "X-Upload-Content-Length": String(blob.size)
      },
      body: JSON.stringify(metadata)
    });

    const uploadUrl = startResponse.headers.get("Location");

    if (!uploadUrl) {
      throw new Error(
        "Google Drive no ha proporcionado la dirección de subida."
      );
    }

    const uploadResponse = await driveFetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: blob
    });

    const result = await uploadResponse.json();

    if (!result.id) {
      throw new Error(
        "Google Drive no ha confirmado el guardado."
      );
    }

    fileId = result.id;

    // Comprobar que el archivo existe en Drive.
    const savedFile = await findFile();

    if (!savedFile) {
      throw new Error(
        "No se ha podido verificar el archivo guardado."
      );
    }

    // Descargarlo de nuevo y comparar el contenido.
    const verifiedData = await downloadCloud(savedFile.id);

    if (JSON.stringify(verifiedData) !== JSON.stringify(data)) {
      throw new Error(
        "La verificación del contenido no coincide."
      );
    }

    knownVersion = versionOf(savedFile);
    conflict = false;
  }

  async function pullFromDrive() {
    const file = await findFile();

    if (!file) {
      throw new Error(
        "No existe andrifit-data.json en Google Drive. " +
        "No se ha creado ni sobrescrito ninguna copia."
      );
    }

    const data = await downloadCloud(file.id);

    // Normalizar datos antiguos sin eliminar información.
    data.categories = Array.isArray(data.categories)
      ? data.categories
      : [];

    data.exercises = data.exercises.map(ex => ({
      ...ex,
      categories: Array.isArray(ex.categories)
        ? ex.categories
        : [],
      muscles: Array.isArray(ex.muscles)
        ? ex.muscles
        : (ex.muscle ? [ex.muscle] : [])
    }));

    // La copia descargada pasa a ser el estado activo.
    state = data;

    if (typeof render === "function") {
      render();
    }

    const verifiedFile = await findFile();

    if (!verifiedFile) {
      throw new Error(
        "No se ha podido verificar la copia de Drive."
      );
    }

    knownVersion = versionOf(verifiedFile);
    dirty = false;
    conflict = false;
    pending = false;
    ready = true;

    // Limpiar el almacenamiento antiguo solo después
    // de descargar y validar correctamente la copia de Drive.
    try {
      localStorage.removeItem(LOCAL_KEY);
    } catch (error) {
      console.warn(
        "AndriFIT: no se pudo limpiar el almacenamiento antiguo.",
        error
      );
    }

    lockApp(false);
    status("Datos cargados y verificados desde Google Drive", "ok");
    updateButtons();
  }

  async function pushToDrive() {
    if (!token || !ready) {
      throw new Error(
        "Conecta Google Drive y carga tus datos antes de guardar."
      );
    }

    // Guardar el número de cambios al comenzar esta subida.
    const uploadRevision = changeCounter;

    const data = JSON.parse(JSON.stringify(state));

    if (!valid(data)) {
      throw new Error("No se han encontrado datos válidos.");
    }

    const remote = await findFile();

    if (!remote) {
      conflict = true;
      throw new Error(
        "La copia de Drive ya no existe. Se ha detenido la subida."
      );
    }

    const remoteVersion = versionOf(remote);

    if (!knownVersion || remoteVersion !== knownVersion) {
      conflict = true;

      throw new Error(
        "Otro dispositivo ha cambiado los datos de Drive. " +
        "No se ha sobrescrito ninguna copia."
      );
    }

    await uploadCloud(data);

    // Si hubo cambios durante la subida, no marcarlos como guardados.
    if (changeCounter === uploadRevision) {
      dirty = false;
    } else {
      dirty = true;
      pending = true;
    }

    status(
      dirty
        ? "Guardando los cambios más recientes…"
        : "Sincronizado y verificado con Google Drive",
      "ok"
    );
  }

  function scheduleUpload() {
    if (!token || !ready || conflict) return;

    dirty = true;
    clearTimeout(uploadTimer);

    uploadTimer = setTimeout(() => {
      runUpload();
    }, UPLOAD_DELAY);
  }

  async function runUpload() {
    if (!token || !ready || conflict || !dirty) return;

    if (syncing) {
      pending = true;
      return;
    }

    syncing = true;
    updateButtons();
    status("Guardando cambios en Google Drive…");

    try {
      await pushToDrive();

    } catch (error) {
      status(
        error.message || "Error al guardar en Drive.",
        "error"
      );

    } finally {
      syncing = false;
      updateButtons();

      if (pending && !conflict && token && ready) {
        pending = false;
        scheduleUpload();
      }
    }
  }

  async function checkForRemoteChanges(force = false) {
    if (!token || !ready || (syncing && !force)) return;

    try {
      const remote = await findFile();

      if (!remote) {
        conflict = true;
        status(
          "No se encuentra la copia de Drive. Tus datos en memoria siguen intactos.",
          "error"
        );
        return;
      }

      const remoteVersion = versionOf(remote);

      if (remoteVersion === knownVersion) return;

      if (dirty) {
        conflict = true;
        clearTimeout(uploadTimer);

        status(
          "Hay cambios en este dispositivo y también en Drive. " +
          "Se ha detenido la sincronización para proteger ambas copias.",
          "error"
        );

        return;
      }

      status("Descargando cambios de Google Drive…");
      await pullFromDrive();

    } catch (error) {
      status(
        error.message || "No se han podido comprobar los cambios.",
        "error"
      );
    }
  }

  function startPolling() {
    stopPolling();

    pollTimer = setInterval(() => {
      checkForRemoteChanges();
    }, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function connectDrive() {
    if (token || syncing) return;

    syncing = true;
    updateButtons();
    status("Conectando con Google…");

    try {
      await requestToken();

      // No se crea un archivo nuevo automáticamente.
      const file = await findFile();

      if (!file) {
        ready = false;
        lockApp(true);

        throw new Error(
          "No se ha encontrado andrifit-data.json en Drive. " +
          "No se han modificado ni borrado tus datos."
        );
      }

      await pullFromDrive();
      startPolling();

    } catch (error) {
      status(
        error.message || "No se pudo conectar con Google Drive.",
        "error"
      );

    } finally {
      syncing = false;
      updateButtons();
    }
  }

  async function manualSync() {
    if (!token || !ready || syncing) return;

    syncing = true;
    updateButtons();

    try {
      if (conflict) {
        status(
          "Existe un conflicto entre dispositivos. " +
          "No se ha sobrescrito ninguna copia.",
          "error"
        );

      } else if (dirty) {
        await pushToDrive();

      } else {
        await checkForRemoteChanges(true);
      }

    } catch (error) {
      status(
        error.message || "No se pudo sincronizar.",
        "error"
      );

    } finally {
      syncing = false;
      updateButtons();

      // Si hubo nuevas ediciones durante la sincronización,
      // programar otra subida.
      if (dirty && !conflict && token && ready) {
        pending = false;
        scheduleUpload();
      }
    }
  }

  function installSaveHook() {
    window.AndriFITDriveSync = {
      notifyLocalSave: () => {
        if (!ready || !token) {
          status(
            "Conecta Google Drive antes de modificar tus datos.",
            "error"
          );
          return;
        }

        changeCounter++;
        dirty = true;

        status("Cambios detectados. Preparando sincronización…");
        scheduleUpload();
      },

      isReady: () => ready
    };
  }

  function addControls() {
    const topbar = document.querySelector(".topbar");

    if (!topbar || byId("drive-sync-controls")) return;

    const controls = document.createElement("div");
    controls.id = "drive-sync-controls";

    controls.innerHTML = `
      <span id="drive-sync-status" role="status">
        Conecta Google Drive para cargar tus datos
      </span>
      <button type="button" id="drive-connect-btn" class="btn ghost small">
        Conectar Google Drive
      </button>
      <button type="button" id="drive-sync-btn" class="btn small" disabled>
        Sincronizar
      </button>
    `;

    topbar.appendChild(controls);

    byId("drive-connect-btn").addEventListener(
      "click",
      connectDrive
    );

    byId("drive-sync-btn").addEventListener(
      "click",
      manualSync
    );

    updateButtons();
  }

  function addStyles() {
    if (byId("drive-sync-styles")) return;

    const style = document.createElement("style");
    style.id = "drive-sync-styles";

    style.textContent = `
      #drive-sync-controls {
        display:flex;
        align-items:center;
        justify-content:flex-end;
        gap:8px;
        flex-wrap:wrap;
        margin-left:auto;
      }

      #drive-sync-status {
        font-size:12px;
        color:var(--muted,#64748b);
      }

      #drive-sync-status[data-status="ok"] {
        color:#27834b;
      }

      #drive-sync-status[data-status="error"] {
        color:#b42318;
      }

      #drive-sync-controls button:disabled {
        opacity:.55;
        cursor:not-allowed;
      }

      body.andrifit-drive-locked #app-content {
        pointer-events:none;
        opacity:.45;
        user-select:none;
      }

      body.andrifit-drive-locked .tab {
        pointer-events:none;
        opacity:.5;
      }

      @media(max-width:700px) {
        .topbar {
          flex-wrap:wrap;
          gap:10px;
        }

        #drive-sync-controls {
          width:100%;
          justify-content:flex-start;
          margin-left:0;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function init() {
    lockApp(true);
    addStyles();
    addControls();
    installSaveHook();

    status("Conecta Google Drive para cargar tus datos.");
  }

  window.addEventListener("beforeunload", event => {
    if (dirty || syncing) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, {
      once: true
    });
  } else {
    init();
  }

})();
