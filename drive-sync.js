
/* AndriFIT · Sincronización automática con Google Drive */

(() => {
  "use strict";

  const CLIENT_ID = "196091840894-q54goht1grsb0900o72d7egb7sm2186s.apps.googleusercontent.com";
  const FILE_NAME = "andrifit-data.json";
  const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
  const LOCAL_KEY = "fitplan-library-v1";

  const UPLOAD_DELAY = 500;
  const POLL_INTERVAL = 8000;

  let token = null;
  let fileId = null;
  let knownVersion = null;

  let syncing = false;
  let dirty = false;
  let pending = false;
  let conflict = false;

  let uploadTimer = null;
  let pollTimer = null;
  let originalSave = null;

  const byId = id => document.getElementById(id);

  function status(message, kind = "") {
    const el = byId("drive-sync-status");
    if (!el) return;

    el.textContent = message;
    el.dataset.status = kind;
  }

  function updateButtons() {
    const connected = Boolean(token);

    const connect = byId("drive-connect-btn");
    const sync = byId("drive-sync-btn");

    if (connect) {
      connect.textContent = connected
        ? "Google Drive conectado"
        : "Conectar Google Drive";

      connect.disabled = connected;
    }

    if (sync) {
      sync.disabled = !connected || syncing;
    }
  }

  function valid(data) {
    return data &&
      Array.isArray(data.exercises) &&
      Array.isArray(data.plans) &&
      Array.isArray(data.sessions);
  }

  function localData() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    } catch (_) {
      return null;
    }
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
          reject(new Error("No se ha podido cargar Google. Recarga la página."));
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
      stopPolling();
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

  async function downloadCloud() {
    if (!fileId) {
      throw new Error("No se encuentra el archivo de AndriFIT en Drive.");
    }

    const response = await driveFetch(
      `${API}/files/${encodeURIComponent(fileId)}?alt=media`
    );

    const data = await response.json();

    if (!valid(data)) {
      throw new Error("El archivo de Drive no contiene datos válidos.");
    }

    return data;
  }

  async function uploadCloud(data) {
    if (!valid(data)) {
      throw new Error("No hay datos válidos para guardar.");
    }

    const boundary = "andrifit_boundary_" + Date.now();

    const metadata = {
      name: FILE_NAME,
      mimeType: "application/json",
      ...(fileId ? {} : { parents: ["appDataFolder"] })
    };

    const body = new Blob([
      `--${boundary}\r\n`,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\n`,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(data),
      `\r\n--${boundary}--`
    ], {
      type: `multipart/related; boundary=${boundary}`
    });

    const endpoint = fileId
      ? `${UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id`
      : `${UPLOAD_API}/files?uploadType=multipart&fields=id`;

    const response = await driveFetch(endpoint, {
      method: fileId ? "PATCH" : "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    });

    const result = await response.json();

    if (!result.id) {
      throw new Error("Google Drive no ha confirmado el guardado.");
    }

    fileId = result.id;

    const savedFile = await findFile();

    if (!savedFile) {
      throw new Error("No se ha podido verificar el archivo guardado.");
    }

    knownVersion = versionOf(savedFile);
    conflict = false;
  }

  async function pullFromDrive() {
    const data = await downloadCloud();

    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
    state = data;

    if (typeof render === "function") {
      render();
    }

    const file = await findFile();

    knownVersion = versionOf(file);
    dirty = false;
    conflict = false;
    pending = false;

    status("Datos actualizados desde Google Drive", "ok");
  }

  async function pushToDrive() {
    if (!token) return;

    const data = localData() || state;

    if (!valid(data)) {
      throw new Error("No se han encontrado datos locales válidos.");
    }

    const remote = await findFile();

    if (remote) {
      const remoteVersion = versionOf(remote);

      if (!knownVersion || remoteVersion !== knownVersion) {
        conflict = true;

        throw new Error(
          "Otro dispositivo ha cambiado los datos de Drive. " +
          "No se ha sobrescrito ninguna copia. Revisa la sincronización."
        );
      }

    } else if (knownVersion) {
      conflict = true;

      throw new Error(
        "La copia de Drive ya no existe. Se ha detenido la subida."
      );
    }

    await uploadCloud(data);

    dirty = false;
    status("Sincronizado con Google Drive", "ok");
  }

  function scheduleUpload() {
    if (!token || conflict) return;

    dirty = true;
    clearTimeout(uploadTimer);

    uploadTimer = setTimeout(() => {
      runUpload();
    }, UPLOAD_DELAY);
  }

  async function runUpload() {
    if (!token || conflict || !dirty) return;

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
      status(error.message || "Error al guardar en Drive.", "error");

    } finally {
      syncing = false;
      updateButtons();

      if (pending && !conflict && token) {
        pending = false;
        scheduleUpload();
      }
    }
  }

  async function checkForRemoteChanges() {
    if (!token || syncing) return;

    try {
      const remote = await findFile();

      if (!remote) {
        if (knownVersion) {
          conflict = true;
          status(
            "No se encuentra la copia de Drive. No se han modificado tus datos locales.",
            "error"
          );
        }
        return;
      }

      const remoteVersion = versionOf(remote);

      if (remoteVersion === knownVersion) return;

      if (dirty) {
        conflict = true;

        clearTimeout(uploadTimer);

        status(
          "Hay cambios pendientes en este dispositivo y cambios nuevos en Drive. Se ha detenido la sincronización para proteger tus datos.",
          "error"
        );

        return;
      }

      status("Descargando cambios de otro dispositivo…");

      await pullFromDrive();

    } catch (error) {
      status(error.message || "No se han podido comprobar los cambios.", "error");
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

    status("Conectando con Google…");

    try {
      await requestToken();

      const file = await findFile();

      if (file) {
        knownVersion = versionOf(file);

        // Drive es la fuente principal al conectar.
        await pullFromDrive();

      } else {
        // Primera conexión: crea la copia inicial.
        knownVersion = null;
        await uploadCloud(localData() || state);

        dirty = false;
        status("Copia inicial guardada en Google Drive", "ok");
      }

      startPolling();

    } catch (error) {
      status(error.message || "No se pudo conectar con Google Drive.", "error");

    } finally {
      updateButtons();
    }
  }

  async function manualSync() {
    if (!token || syncing) return;

    syncing = true;
    updateButtons();

    try {
      if (conflict) {
        status(
          "Hay un conflicto entre dispositivos. Tus datos locales no se han sobrescrito. Para resolverlo, vuelve a conectar tras decidir qué dispositivo conservar.",
          "error"
        );

      } else if (dirty) {
        await pushToDrive();

      } else {
        await checkForRemoteChanges();
      }

    } catch (error) {
      status(error.message || "No se pudo sincronizar.", "error");

    } finally {
      syncing = false;
      updateButtons();
    }
  }
  
function installSaveHook() {
  window.AndriFITDriveSync = {
    notifyLocalSave: () => {
      if (!token) {
        status("Conecta Google Drive para guardar los cambios.");
        return;
      }

      dirty = true;

      status("Cambios detectados. Preparando sincronización…");

      scheduleUpload();
    }
  };
}
  function addControls() {
    const topbar = document.querySelector(".topbar");

    if (!topbar || byId("drive-sync-controls")) return;

    const controls = document.createElement("div");
    controls.id = "drive-sync-controls";

    controls.innerHTML = `
      <span id="drive-sync-status" role="status">
        Conecta Google Drive para sincronizar
      </span>
      <button type="button" id="drive-connect-btn" class="btn ghost small">
        Conectar Google Drive
      </button>
      <button type="button" id="drive-sync-btn" class="btn small" disabled>
        Sincronizar
      </button>
    `;

    topbar.appendChild(controls);

    byId("drive-connect-btn").addEventListener("click", connectDrive);
    byId("drive-sync-btn").addEventListener("click", manualSync);

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
    addStyles();
    addControls();
    installSaveHook();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

})();
