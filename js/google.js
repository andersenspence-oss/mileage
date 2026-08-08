// Google sign-in using Google Identity Services (token model).
// Each phone connects its own Google account once; tokens are re-issued
// silently while the account stays signed into Google in the browser.
window.GAuth = (() => {
  const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file email";
  let tokenClient = null;
  let accessToken = null;
  let expiresAt = 0;

  function connectedEmail() {
    return localStorage.getItem("googleEmail") || "";
  }

  function isConnected() {
    return !!localStorage.getItem("googleConnected");
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Couldn't load Google sign-in (offline?)"));
      document.head.appendChild(s);
    });
  }

  async function ensureClient() {
    const clientId = CONFIG.googleClientId;
    if (!clientId || clientId.startsWith("PASTE_")) {
      throw new Error("No Google client ID configured yet — paste it into js/config.js (README step 2).");
    }
    await loadScript("https://accounts.google.com/gsi/client");
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: () => {},
      });
    }
  }

  // interactive=true may show Google's account chooser (needs a user tap);
  // interactive=false only succeeds silently or fails quietly.
  function requestToken(interactive) {
    return new Promise((resolve, reject) => {
      tokenClient.callback = (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        accessToken = response.access_token;
        expiresAt = Date.now() + (response.expires_in - 60) * 1000;
        localStorage.setItem("googleConnected", "1");
        fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: "Bearer " + accessToken },
        })
          .then(r => r.json())
          .then(info => { if (info.email) localStorage.setItem("googleEmail", info.email); })
          .catch(() => {})
          .finally(() => resolve(accessToken));
      };
      tokenClient.error_callback = (err) => {
        reject(new Error(err && err.message ? err.message : "Sign-in was cancelled or blocked."));
      };
      tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
    });
  }

  // Valid access token, silently refreshed when possible.
  async function getToken(interactive) {
    if (accessToken && Date.now() < expiresAt) return accessToken;
    await ensureClient();
    try {
      return await requestToken(false);
    } catch (e) {
      if (interactive) return await requestToken(true);
      throw new Error("Google sign-in needed — open Settings and tap Connect.");
    }
  }

  async function connect() {
    await ensureClient();
    return await requestToken(true);
  }

  function disconnect() {
    accessToken = null;
    expiresAt = 0;
    localStorage.removeItem("googleConnected");
    localStorage.removeItem("googleEmail");
  }

  return { connect, disconnect, getToken, isConnected, connectedEmail };
})();
