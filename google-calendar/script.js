const CLIENT_ID_KEY = "gcal_client_id";
const SELECTED_CALENDARS_KEY = "gcal_selected_calendars";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
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
const reconnectBtn = document.getElementById("reconnectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const eventList = document.getElementById("eventList");
const calendarPicker = document.getElementById("calendarPicker");
const selectAllBtn = document.getElementById("selectAllBtn");
const selectNoneBtn = document.getElementById("selectNoneBtn");

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let events = []; // cached, sorted by start; refetched on an interval
let refreshTimer = null;
let lastSyncedAt = null;
let calendarList = []; // [{id, summary, color, primary}] from the user's calendarList
let selectedCalendarIds = new Set();

function loadClientId() {
  return localStorage.getItem(CLIENT_ID_KEY) || "";
}

function looksLikeClientId(value) {
  return /\.apps\.googleusercontent\.com$/.test(value.trim());
}

function loadSelectedCalendars() {
  try {
    const raw = localStorage.getItem(SELECTED_CALENDARS_KEY);
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveSelectedCalendars() {
  localStorage.setItem(SELECTED_CALENDARS_KEY, JSON.stringify([...selectedCalendarIds]));
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
  accountStatus.textContent = "Connected to Google Calendar";
  showCalendarPanel();
  fetchCalendarList().then(fetchEvents);
  startAutoRefresh();
}

// Never renews automatically: once the token expires, calls just fail until
// the user clicks Reconnect. Calendars rarely change, so stale data is fine
// in the meantime and it beats a surprise sign-in popup mid-session.
function ensureFreshToken() {
  if (!accessToken || Date.now() >= tokenExpiresAt) {
    return Promise.reject(new Error("Sign-in expired"));
  }
  return Promise.resolve(accessToken);
}

function isAuthError(err) {
  return err instanceof Error && err.message === "Sign-in expired";
}

connectBtn.addEventListener("click", () => {
  const clientId = loadClientId();
  if (!clientId) return;
  if (!tokenClient) initTokenClient(clientId);
  tokenClient.requestAccessToken({ prompt: "consent" });
});

reconnectBtn.addEventListener("click", () => {
  const clientId = loadClientId();
  if (!clientId) return;
  if (!tokenClient) initTokenClient(clientId);
  tokenClient.requestAccessToken({ prompt: "" });
});

disconnectBtn.addEventListener("click", () => {
  stopAutoRefresh();
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  events = [];
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

selectAllBtn.addEventListener("click", () => {
  selectedCalendarIds = new Set(calendarList.map((c) => c.id));
  saveSelectedCalendars();
  renderCalendarPicker();
  fetchEvents();
});

selectNoneBtn.addEventListener("click", () => {
  selectedCalendarIds = new Set();
  saveSelectedCalendars();
  renderCalendarPicker();
  fetchEvents();
});

// --- Calendar list & picker ---

async function fetchCalendarList() {
  try {
    const token = await ensureFreshToken();
    const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new Error("Sign-in expired");
    if (!res.ok) throw new Error(`calendarList returned ${res.status}`);
    const data = await res.json();

    calendarList = (data.items || []).map((item) => ({
      id: item.id,
      summary: item.summary || item.id,
      color: item.backgroundColor || "#5b8cff",
      primary: !!item.primary,
    }));

    const saved = loadSelectedCalendars();
    if (saved) {
      // Drop any saved ids for calendars that no longer exist/are shared with this account.
      selectedCalendarIds = new Set([...saved].filter((id) => calendarList.some((c) => c.id === id)));
    } else {
      // First run: default to whatever's checked in the user's own Google Calendar UI.
      selectedCalendarIds = new Set((data.items || []).filter((i) => i.selected !== false).map((i) => i.id));
      saveSelectedCalendars();
    }

    renderCalendarPicker();
  } catch (err) {
    console.error(err);
    setSyncInfo(isAuthError(err) ? "Signed out — click Reconnect to load your calendars." : "Couldn't load your calendar list.");
  }
}

function renderCalendarPicker() {
  calendarPicker.innerHTML = "";
  for (const cal of calendarList) {
    const label = document.createElement("label");
    label.className = "calendar-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedCalendarIds.has(cal.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedCalendarIds.add(cal.id);
      else selectedCalendarIds.delete(cal.id);
      saveSelectedCalendars();
      fetchEvents();
    });

    const swatch = document.createElement("span");
    swatch.className = "calendar-swatch";
    swatch.style.background = cal.color;

    const name = document.createElement("span");
    name.textContent = cal.summary;

    label.append(checkbox, swatch, name);
    calendarPicker.appendChild(label);
  }
}

// --- Fetching & rendering events ---

async function fetchEvents() {
  if (selectedCalendarIds.size === 0) {
    events = [];
    setSyncInfo("No calendars selected.");
    renderEventList();
    return;
  }

  try {
    const token = await ensureFreshToken();
    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setDate(timeMin.getDate() - 1); // include yesterday for overnight-spanning events
    const timeMax = new Date(now);
    timeMax.setDate(timeMax.getDate() + LOOKAHEAD_DAYS);

    const perCalendar = await Promise.all(
      [...selectedCalendarIds].map(async (calId) => {
        const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`);
        url.searchParams.set("timeMin", timeMin.toISOString());
        url.searchParams.set("timeMax", timeMax.toISOString());
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("orderBy", "startTime");
        url.searchParams.set("maxResults", "100");

        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) throw new Error("Sign-in expired");
        if (!res.ok) {
          console.error(`Calendar ${calId} returned ${res.status}`);
          return [];
        }
        const data = await res.json();
        const calMeta = calendarList.find((c) => c.id === calId);
        return (data.items || []).map((item) => toEvent(item, calMeta)).filter(Boolean);
      })
    );

    events = perCalendar.flat().sort((a, b) => a.start - b.start);

    lastSyncedAt = new Date();
    setSyncInfo("Last synced " + lastSyncedAt.toLocaleTimeString());
    renderEventList();
  } catch (err) {
    console.error(err);
    setSyncInfo(
      isAuthError(err)
        ? "Signed out of Google — click Reconnect to resume syncing (showing last known events)."
        : "Couldn't reach Google Calendar — showing last known events."
    );
  }
}

function toEvent(item, calMeta) {
  if (!item.start) return null;
  const allDay = !item.start.dateTime;
  const start = new Date(allDay ? item.start.date : item.start.dateTime);
  const end = new Date(allDay ? item.end.date : item.end.dateTime);
  if (isNaN(start) || isNaN(end)) return null;
  return {
    start,
    end,
    allDay,
    title: item.summary || "(untitled event)",
    calendarName: calMeta?.summary || "",
    color: calMeta?.color || "#5b8cff",
  };
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

    const dot = document.createElement("span");
    dot.className = "cal-dot";
    dot.style.background = event.color;
    dot.title = event.calendarName;

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

    li.append(dot, dayBadge, time, title);
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

  // No silent sign-in on load: token requests only ever happen from an explicit
  // click (Connect/Reconnect), so the app never pops a surprise Google prompt.
  showConnectPanel();

  statusText.textContent = "Not connected";
  tick();
  setInterval(tick, 1000);
})();
