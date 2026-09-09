const CLIENT_ID_KEY = "gcal_client_id";
const WAS_CONNECTED_KEY = "gcal_connected";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const CALENDAR_ID = "primary";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // re-fetch the event list every 5 minutes
const LOOKAHEAD_DAYS = 14; // how far ahead to fetch, so "soonest" can find something

const statusText = document.getElementById("statusText");
const syncInfo = document.getElementById("syncInfo");
const connectPanel = document.getElementById("connectPanel");
const calendarPanel = document.getElementById("calendarPanel");
const clientIdInput = document.getElementById("clientIdInput");
const saveClientIdBtn = document.getElementById("saveClientIdBtn");
const connectBtn = document.getElementById("connectBtn");
const accountStatus = document.getElementById("accountStatus");
const refreshBtn = document.getElementById("refreshBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const eventList = document.getElementById("eventList");

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let events = []; // cached, sorted by start; refetched on an interval
let refreshTimer = null;
let lastSyncedAt = null;

function loadClientId() {
  return localStorage.getItem(CLIENT_ID_KEY) || "";
}

function looksLikeClientId(value) {
  return /\.apps\.googleusercontent\.com$/.test(value.trim());
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function setSyncInfo(text) {
  syncInfo.textContent = text;
}

function showConnectPanel() {
  connectPanel.classList.remove("hidden");
  calendarPanel.classList.add("hidden");
}

function showCalendarPanel() {
  connectPanel.classList.add("hidden");
  calendarPanel.classList.remove("hidden");
}

// --- Auth ---

function initTokenClient(clientId) {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: onToken,
    error_callback: (err) => {
      setSyncInfo("Sign-in failed or was cancelled.");
      console.error(err);
    },
  });
}

function onToken(response) {
  if (response.error) {
    setSyncInfo("Sign-in failed: " + response.error);
    return;
  }
  accessToken = response.access_token;
  tokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
  localStorage.setItem(WAS_CONNECTED_KEY, "1");
  accountStatus.textContent = "Connected to Google Calendar";
  showCalendarPanel();
  fetchEvents();
  startAutoRefresh();
}

function ensureFreshToken(promptIfNeeded) {
  return new Promise((resolve, reject) => {
    if (accessToken && Date.now() < tokenExpiresAt - 30000) {
      resolve(accessToken);
      return;
    }
    if (!tokenClient) {
      reject(new Error("Not connected"));
      return;
    }
    const originalCallback = tokenClient.callback;
    tokenClient.callback = (response) => {
      tokenClient.callback = originalCallback;
      onToken(response);
      if (response.error) reject(new Error(response.error));
      else resolve(response.access_token);
    };
    tokenClient.requestAccessToken({ prompt: promptIfNeeded ? "consent" : "" });
  });
}

connectBtn.addEventListener("click", () => {
  const clientId = loadClientId();
  if (!clientId) return;
  if (!tokenClient) initTokenClient(clientId);
  tokenClient.requestAccessToken({ prompt: "consent" });
});

disconnectBtn.addEventListener("click", () => {
  stopAutoRefresh();
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  events = [];
  localStorage.removeItem(WAS_CONNECTED_KEY);
  setSyncInfo("");
  statusText.textContent = "Not connected";
  document.title = "Browser Schedule Timer";
  showConnectPanel();
});

saveClientIdBtn.addEventListener("click", () => {
  const value = clientIdInput.value.trim();
  if (!looksLikeClientId(value)) {
    alert("That doesn't look like a Google OAuth Client ID (should end in .apps.googleusercontent.com).");
    return;
  }
  localStorage.setItem(CLIENT_ID_KEY, value);
  connectBtn.disabled = false;
  tokenClient = null; // rebuild with the new client id on next connect
});

refreshBtn.addEventListener("click", () => fetchEvents());

// --- Fetching & rendering ---

async function fetchEvents() {
  try {
    const token = await ensureFreshToken(false);
    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setDate(timeMin.getDate() - 1); // include yesterday for overnight-spanning events
    const timeMax = new Date(now);
    timeMax.setDate(timeMax.getDate() + LOOKAHEAD_DAYS);

    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`);
    url.searchParams.set("timeMin", timeMin.toISOString());
    url.searchParams.set("timeMax", timeMax.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "100");

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Google Calendar API returned ${res.status}`);
    const data = await res.json();

    events = (data.items || [])
      .map(toEvent)
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);

    lastSyncedAt = new Date();
    setSyncInfo("Last synced " + lastSyncedAt.toLocaleTimeString());
    renderEventList();
  } catch (err) {
    console.error(err);
    setSyncInfo("Couldn't reach Google Calendar — showing last known events.");
  }
}

function toEvent(item) {
  if (!item.start) return null;
  const allDay = !item.start.dateTime;
  const start = new Date(allDay ? item.start.date : item.start.dateTime);
  const end = new Date(allDay ? item.end.date : item.end.dateTime);
  if (isNaN(start) || isNaN(end)) return null;
  return { start, end, allDay, title: item.summary || "(untitled event)" };
}

function computeStatus(now) {
  for (const event of events) {
    if (!event.allDay && event.start <= now && now < event.end) {
      return { text: `${formatDuration(event.end - now)} - ${event.title} ends` };
    }
  }

  const upcoming = events.find((e) => !e.allDay && e.start > now);
  if (upcoming) {
    return { text: `${formatDuration(upcoming.start - now)} until ${upcoming.title}` };
  }

  return { text: "No upcoming events" };
}

function tick() {
  if (!accessToken) return;
  const now = new Date();
  const { text } = computeStatus(now);
  statusText.textContent = text;
  document.title = text;
}

function renderEventList() {
  eventList.innerHTML = "";
  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + 2);

  const upcoming = events.filter((e) => e.end > now && e.start < windowEnd);

  if (upcoming.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No events in the next couple of days.";
    eventList.appendChild(li);
    return;
  }

  for (const event of upcoming) {
    const li = document.createElement("li");
    const active = !event.allDay && event.start <= now && now < event.end;
    li.classList.toggle("active", active);

    const dayBadge = document.createElement("span");
    dayBadge.className = "day-badge";
    dayBadge.textContent = event.start.toLocaleDateString(undefined, { weekday: "short" });

    const time = document.createElement("span");
    time.className = "time";
    time.textContent = event.allDay
      ? "All day"
      : `${event.start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}–${event.end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = event.title;

    li.append(dayBadge, time, title);
    eventList.appendChild(li);
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(fetchEvents, REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

// --- Boot ---

(function init() {
  const clientId = loadClientId();
  clientIdInput.value = clientId;
  connectBtn.disabled = !clientId;

  const wasConnected = localStorage.getItem(WAS_CONNECTED_KEY) === "1";
  if (clientId && wasConnected) {
    // Google Identity Services loads asynchronously; wait for it before attempting silent sign-in.
    const waitForGoogle = setInterval(() => {
      if (!window.google?.accounts?.oauth2) return;
      clearInterval(waitForGoogle);
      initTokenClient(clientId);
      tokenClient.requestAccessToken({ prompt: "" });
    }, 100);
  } else {
    showConnectPanel();
  }

  statusText.textContent = "Not connected";
  tick();
  setInterval(tick, 1000);
})();
