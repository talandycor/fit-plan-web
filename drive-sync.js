
/* AndriFIT · Sincronización privada con Google Drive */

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
  let syncTimer = null;
  let syncing = false;
  let pendingUpload = false;
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

  function updateButtons(connected = Boolean(accessToken)) {
    const connect = connectBtn();
    const sync = syncBtn();

    if (connect) {
      connect.textContent = connected
        ? "Google Drive conectado"
        : "Conectar Google Drive";
      connect.disabled = connected;
    }

    if (sync) sync.disabled = !connected || syncing;
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
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: DRIVE_SCOPE,

          callback: response => {
            if (response?.error) {
              reject(new Error(response.error_description || response.error));
              return;
            }

            accessToken = response.access_token;
            resolve(accessToken);
          },

          error_callback: error => {
            reject(new Error(error?.message || "No se pudo autorizar Google Drive."));
          }
        });

        tokenClient.requestAccessToken({ prompt: "consent" });

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

  async function findDriveFile() {
    const query = encodeURIComponent(
      `name='${DRIVE_FILE_NAME}' and trashed=false`
    );

    const url =
      `${API}/files?q=${query}&spaces=appDataFolder` +
      `&fields=files(id,name,modifiedTime)&pageSize=10`;

    const response = await driveFetch(url);
    const data = await response.json();

    const file = data.files?.[0] || null;
    driveFileId = file?.id || null;

    return file;
  }

  function currentLocalState() {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
  }

  function validateState(data) {
    return data &&
      Array.isArray(data.exercises) &&
      Array.isArray(data.plans) &&
      Array.isArray(data.sessions);
  }

  function downloadBackup() {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return;

    const blob = new Blob([raw], {
      type: "application/json"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download =
      `AndriFIT-copia-local-${new Date().toISOString().slice(0, 10)}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
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
      ? `${UPLOAD_API}/files/${encodeURIComponent(driveFileId)}?uploadType=resumable&fields=id,name`
      : `${UPLOAD_API}/files?uploadType=resumable&fields=id,name`;

    const start = await driveFetch(endpoint, {
      method: driveFileId ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/json",
        "X-Upload-Content-Length": String(blob.size)
      },
      body: JSON.stringify(metadata)
    });

    const uploadUrl = start.headers.get("Location");

    if (!uploadUrl) {
      throw new Error("Google Drive no ha devuelto la dirección de subida.");
    }

    const result = await driveFetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: blob
    });

    const saved = await result.json();
    driveFileId = saved.id || driveFileId;
  }

  async function uploadLocalState() {
    const data = currentLocalState() || state;

    if (!validateState(data)) {
      throw new Error("No hay datos locales válidos para sincronizar.");
    }

    await uploadState(data);
    status("Sincronizado con Google Drive", "ok");
  }

  async function restoreCloudState() {
    const cloudState = await downloadCloudState();

    downloadBackup();

    localStorage.setItem(LOCAL_KEY, JSON.stringify(cloudState));
    state = cloudState;

    if (typeof render === "function") render();

    status("Datos recuperados de Google Drive", "ok");

    if (typeof notify === "function") {
      notify("Datos recuperados. Se descargó una copia local de seguridad.");
    }
  }

  async function connectDrive() {
    if (accessToken) return;

    status("Conectando con Google…");
    updateButtons(false);

    try {
      await requestToken();
      const file = await findDriveFile();

      if (!file) {
        await uploadLocalState();
        status("Conectado · copia inicial guardada en Drive", "ok");

      } else {
        const choice = confirm(
          "Ya existe una copia de AndriFIT en Google Drive.\n\n" +
          "Aceptar: recuperar la copia de Drive en este dispositivo " +
          "(antes se descargará una copia local de seguridad).\n\n" +
          "Cancelar: conservar los datos de este dispositivo y sustituir " +
          "la copia de Drive."
        );

        if (choice) {
          await restoreCloudState();
        } else {
          await uploadLocalState();
        }
      }

      updateButtons(true);

    } catch (error) {
      accessToken = null;
      status(error.message || "No se pudo conectar con Google Drive.", "error");
      updateButtons(false);
    }
  }

  async function syncManually() {
    if (!accessToken || syncing) return;

    const pull = confirm(
      "¿Qué quieres hacer?\n\n" +
      "Aceptar: descargar los datos de Google Drive a este dispositivo " +
      "(se guardará antes una copia local).\n\n" +
      "Cancelar: subir los datos de este dispositivo a Google Drive."
    );

    syncing = true;
    updateButtons(true);
    status("Sincronizando…");

    try {
      if (pull) {
        await findDriveFile();

        if (!driveFileId) {
          throw new Error("Todavía no hay una copia en Google Drive.");
        }

        await restoreCloudState();

      } else {
        await uploadLocalState();
      }

    } catch (error) {
      status(error.message || "No se pudo sincronizar.", "error");

    } finally {
      syncing = false;
      updateButtons(true);
    }
  }

  function scheduleAutomaticUpload() {
    if (!accessToken) return;

    clearTimeout(syncTimer);

    syncTimer = setTimeout(async () => {
      if (syncing) {
        pendingUpload = true;
        return;
      }

      syncing = true;
      updateButtons(true);
      status("Guardando cambios en Drive…");

      try {
        await uploadLocalState();

      } catch (error) {
        status(`Error al sincronizar: ${error.message}`, "error");

      } finally {
        syncing = false;
        updateButtons(true);

        if (pendingUpload) {
          pendingUpload = false;
          scheduleAutomaticUpload();
        }
      }
    }, 1800);
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
        Solo en este dispositivo
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

    updateButtons(false);
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
