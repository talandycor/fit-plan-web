
/* AndriFIT · Sincronización segura con Google Drive */

(() => {
  "use strict";

  const CLIENT_ID = "196091840894-q54goht1grsb0900o72d7egb7sm2186s.apps.googleusercontent.com";
  const DRIVE_FILE_NAME = "andrifit-data.json";
  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
  const LOCAL_KEY = "fitplan-library-v1";

  let accessToken = null;
  let driveFileId = null;
  let knownVersion = null;
  let syncTimer = null;
  let syncing = false;
  let pendingUpload = false;
  let conflictDetected = false;
  let originalSaveState = null;

  const statusEl = () => document.getElementById("drive-sync-status");
  const connectBtn = () => document.getElementById("drive-connect-btn");
  const syncBtn = () => document.getElementById("drive-sync-btn");

  function status(message, kind = "") {
    const el = statusEl();
    if (!el) return;
    el.textContent = message;
    el.dataset.status = kind;
  }

  function updateButtons() {
    const connected = Boolean(accessToken);

    if (connectBtn()) {
      connectBtn().textContent = connected
        ? "Google Drive conectado"
        : "Conectar Google Drive";
      connectBtn().disabled = connected;
    }

    if (syncBtn()) {
      syncBtn().disabled = !connected || syncing;
    }
  }

  function waitForGoogleIdentity() {
    return new Promise((resolve, reject) => {
      const started = Date.now();

      const timer = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > 12000) {
          clearInterval(timer);
          reject(new Error("No se ha podido cargar Google. Recarga la página."));
        }
      }, 150);
    });
  }

  async function requestToken() {
    await waitForGoogleIdentity();

    return new Promise((resolve, reject) => {
      try {
        const tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: DRIVE_SCOPE,

          callback: response => {
            if (response?.error || !response?.access_token) {
              reject(new Error(
                response?.error_description ||
                response?.error ||
                "No se pudo autorizar Google Drive."
              ));
              return;
            }

            accessToken = response.access_token;
            resolve(accessToken);
          },

          error_callback: error => {
            reject(new Error(
              error?.message || "No se pudo autorizar Google Drive."
            ));
          }
        });

        // No fuerza el consentimiento si ya se concedió anteriormente.
        tokenClient.requestAccessToken({ prompt: "" });

      } catch (error) {
        reject(error);
      }
    });
  }

  async function driveFetch(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {})
      }
    });

    if (response.status === 401) {
      accessToken = null;
      updateButtons();
      throw new Error("La autorización ha caducado. Vuelve a conectar Google Drive.");
    }

    if (!response.ok) {
      let detail = "";

      try {
        const body = await response.json();
        detail = body.error?.message || "";
      } catch (_) {}

      throw new Error(detail || `Error de Google Drive (${response.status}).`);
    }

    return response;
  }

  function fileVersion(file) {
    return String(file?.version || file?.modifiedTime || "");
  }

  async function findDriveFile() {
    const query = encodeURIComponent(
      `name='${DRIVE_FILE_NAME}' and trashed=false`
    );

    const url =
      `${API}/files?q=${query}&spaces=appDataFolder` +
      `&fields=files(id,name,version,modifiedTime)&pageSize=10`;

    const response = await driveFetch(url);
    const data = await response.json();
    const file = data.files?.[0] || null;

    driveFileId = file?.id || null;
    return file;
  }

  function currentLocalState() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function validateState(data) {
    return data &&
      Array.isArray(data.exercises) &&
      Array.isArray(data.plans) &&
      Array.isArray(data.sessions);
  }

  async function downloadCloudState() {
    if (!driveFileId) {
      throw new Error("No se encuentra el archivo de AndriFIT en Drive.");
    }

    const response = await driveFetch(
      `${API}/files/${encodeURIComponent(driveFileId)}?alt=media`
    );

    const data = await response.json();

    if (!validateState(data)) {
      throw new Error("El archivo de Drive no contiene datos válidos.");
    }

    return data;
  }

  async function uploadState(data) {
    const blob = new Blob(
      [JSON.stringify(data)],
      { type: "application/json" }
    );

    const metadata = {
      name: DRIVE_FILE_NAME,
      mimeType: "application/json",
      ...(driveFileId ? {} : { parents: ["appDataFolder"] })
    };

    const endpoint = driveFileId
      ? `${UPLOAD_API}/files/${encodeURIComponent(driveFileId)}?uploadType=multipart&fields=id`
      : `${UPLOAD_API}/files?uploadType=multipart&fields=id`;

    const body = new FormData();

    body.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], {
        type: "application/json"
      })
    );

    body.append("file", blob);

    const response = await driveFetch(endpoint, {
      method: driveFileId ? "PATCH" : "POST",
      body
    });

    const saved = await response.json();

    if (!saved.id) {
      throw new Error("Google Drive no ha confirmado el guardado.");
    }

    driveFileId = saved.id;

    const updatedFile = await findDriveFile();

    if (!updatedFile) {
      throw new Error("No se ha podido verificar el archivo guardado.");
    }

    knownVersion = fileVersion(updatedFile);
    conflictDetected = false;
  }

  async function restoreCloudState() {
    const cloudState = await downloadCloudState();

    // Actualiza los datos de la aplicación y su caché local.
    localStorage.setItem(LOCAL_KEY, JSON.stringify(cloudState));
    state = cloudState;

    if (typeof render === "function") {
      render();
    }

    const file = await findDriveFile();
    knownVersion = fileVersion(file);
    conflictDetected = false;

    status("Datos actualizados desde Google Drive", "ok");
  }

  async function uploadLocalState(force = false) {
    const data = currentLocalState() || state;

    if (!validateState(data)) {
      throw new Error("No hay datos válidos para sincronizar.");
    }

    const remoteFile = await findDriveFile();

    if (remoteFile && !force) {
      const remoteVersion = fileVersion(remoteFile);

      if (!knownVersion || remoteVersion !== knownVersion) {
        conflictDetected = true;

        throw new Error(
          "Drive ha cambiado desde la última sincronización. " +
          "No se han sobrescrito los datos. Pulsa Sincronizar para resolverlo."
        );
      }
    }

    if (!remoteFile && knownVersion && !force) {
      conflictDetected = true;

      throw new Error(
        "El archivo de Drive ya no existe. No se han subido los datos locales."
      );
    }

    await uploadState(data);
    status("Sincronizado con Google Drive", "ok");
  }

  async function connectDrive() {
    if (accessToken || syncing) return;

    status("Conectando con Google…");

    try {
      await requestToken();

      const file = await findDriveFile();

      if (file) {
        // Drive tiene prioridad al conectar un dispositivo.
        knownVersion = fileVersion(file);
        await restoreCloudState();

        status("Conectado · datos de Drive cargados", "ok");

      } else {
        // Solo crea la primera copia si todavía no existe en Drive.
        knownVersion = null;
        await uploadLocalState(true);

        status("Conectado · copia inicial guardada en Drive", "ok");
      }

      updateButtons();

    } catch (error) {
      status(error.message || "No se pudo conectar con Google Drive.", "error");
      updateButtons();
    }
  }

  async function syncManually() {
    if (!accessToken || syncing) return;

    syncing = true;
    updateButtons();
    status("Comprobando cambios…");

    try {
      if (conflictDetected) {
        const useCloud = confirm(
          "Se han detectado cambios realizados desde otro dispositivo.\n\n" +
          "Aceptar: descargar la versión de Drive y sustituir los datos de este dispositivo.\n\n" +
          "Cancelar: conservar los datos de este dispositivo y decidir si quieres subirlos a Drive."
        );

        if (useCloud) {
          const file = await findDriveFile();

          if (!file) {
            throw new Error("No se encuentra el archivo de Drive.");
          }

          knownVersion = fileVersion(file);
          await restoreCloudState();

        } else {
          const overwrite = confirm(
            "¿Confirmas que quieres sustituir la versión de Google Drive " +
            "por los datos de este dispositivo?\n\n" +
            "Esta acción puede descartar cambios hechos en otro dispositivo."
          );

          if (overwrite) {
            await uploadLocalState(true);
          } else {
            status("No se han modificado los datos.", "ok");
          }
        }

      } else {
        await uploadLocalState();
      }

    } catch (error) {
      status(error.message || "No se pudo sincronizar.", "error");

    } finally {
      syncing = false;
      updateButtons();

      if (pendingUpload && !conflictDetected && accessToken) {
        pendingUpload = false;
        scheduleAutomaticUpload();
      }
    }
  }

  function scheduleAutomaticUpload() {
    if (!accessToken || conflictDetected) return;

    clearTimeout(syncTimer);

    syncTimer = setTimeout(async () => {
      if (syncing) {
        pendingUpload = true;
        return;
      }

      syncing = true;
      updateButtons();
      status("Guardando cambios en Drive…");

      try {
        await uploadLocalState();

      } catch (error) {
        status(error.message || "Error al sincronizar.", "error");

      } finally {
        syncing = false;
        updateButtons();

        if (pendingUpload && !conflictDetected && accessToken) {
          pendingUpload = false;
          scheduleAutomaticUpload();
        }
      }
    }, 1500);
  }

  function addDriveControls() {
    const topbar = document.querySelector(".topbar");

    if (!topbar || document.getElementById("drive-sync-controls")) {
      return;
    }

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

    connectBtn().addEventListener("click", connectDrive);
    syncBtn().addEventListener("click", syncManually);

    updateButtons();
  }

  function installSaveHook() {
    if (typeof saveState !== "function" || originalSaveState) return;

    originalSaveState = saveState;

    saveState = function () {
      originalSaveState();
      scheduleAutomaticUpload();
    };
  }

  function addStyles() {
    if (document.getElementById("drive-sync-styles")) return;

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
    addDriveControls();
    installSaveHook();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

})();
