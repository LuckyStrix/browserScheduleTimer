// Indexed to match Date#getDay() (0 = Sunday ... 6 = Saturday) — used for date math.
const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday"
];

// Display/UI order, Monday-first.
const WEEK_ORDER = [
  "Monday", "Tuesday", "Wednesday", "Thursday",
  "Friday", "Saturday", "Sunday"
];

const STORAGE_KEY = "schedule";

let schedule = loadSchedule();
let selectedDay = DAY_NAMES[new Date().getDay()];

const statusText = document.getElementById("statusText");
const dayTabs = document.getElementById("dayTabs");
const blockList = document.getElementById("blockList");
const addForm = document.getElementById("addForm");
const startInput = document.getElementById("startInput");
const endInput = document.getElementById("endInput");
const labelInput = document.getElementById("labelInput");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");

function loadSchedule() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSchedule() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule));
  } catch (err) {
    alert("Could not save schedule (storage may be full or disabled). Your last change may be lost on reload.");
  }
}

function blocksFor(day) {
  return schedule[day] || [];
}

function sortBlocks(day) {
  blocksFor(day).sort((a, b) => a.start.localeCompare(b.start));
}

function renderTabs() {
  dayTabs.innerHTML = "";
  for (const day of WEEK_ORDER) {
    const btn = document.createElement("button");
    btn.textContent = day.slice(0, 3);
    btn.classList.toggle("active", day === selectedDay);
    btn.addEventListener("click", () => {
      selectedDay = day;
      renderTabs();
      renderBlocks();
    });
    dayTabs.appendChild(btn);
  }
}

function renderBlocks() {
  blockList.innerHTML = "";
  const blocks = blocksFor(selectedDay);
  if (blocks.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No blocks yet for " + selectedDay + ".";
    blockList.appendChild(li);
    return;
  }
  blocks.forEach((block, index) => {
    const li = document.createElement("li");

    const time = document.createElement("span");
    time.className = "time";
    time.textContent = `${block.start}–${block.end}`;

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = block.label;

    const copySelect = buildCopySelect(block);

    const del = document.createElement("button");
    del.className = "delete-btn";
    del.textContent = "✕";
    del.title = "Delete";
    del.addEventListener("click", () => {
      blocksFor(selectedDay).splice(index, 1);
      saveSchedule();
      renderBlocks();
    });

    li.append(time, label, copySelect, del);
    blockList.appendChild(li);
  });
}

function buildCopySelect(block) {
  const select = document.createElement("select");
  select.className = "copy-select";
  select.title = "Copy this event to another day";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Copy to…";
  select.appendChild(placeholder);

  for (const day of WEEK_ORDER) {
    if (day === selectedDay) continue;
    const option = document.createElement("option");
    option.value = day;
    option.textContent = day;
    select.appendChild(option);
  }

  select.addEventListener("change", () => {
    const day = select.value;
    if (!day) return;
    if (!schedule[day]) schedule[day] = [];
    schedule[day].push({ ...block });
    sortBlocks(day);
    saveSchedule();
    select.value = "";
  });

  return select;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidSchedule(data) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  for (const [day, blocks] of Object.entries(data)) {
    if (!DAY_NAMES.includes(day)) return false;
    if (!Array.isArray(blocks)) return false;
    for (const block of blocks) {
      if (typeof block !== "object" || block === null) return false;
      if (!TIME_RE.test(block.start) || !TIME_RE.test(block.end)) return false;
      if (typeof block.label !== "string" || !block.label.trim()) return false;
    }
  }
  return true;
}

exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(schedule, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `schedule-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

importBtn.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  importFile.value = "";
  if (!file) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    alert("That file isn't valid JSON.");
    return;
  }

  if (!isValidSchedule(data)) {
    alert("That file doesn't look like a valid schedule export.");
    return;
  }

  if (!confirm("Import this schedule? This will replace your current schedule.")) return;

  schedule = data;
  for (const day of DAY_NAMES) sortBlocks(day);
  saveSchedule();
  renderBlocks();
});

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const start = startInput.value;
  const end = endInput.value;
  const label = labelInput.value.trim();
  if (!start || !end || !label) return;
  if (start === end) {
    alert("Start and end time can't be the same.");
    return;
  }

  if (!schedule[selectedDay]) schedule[selectedDay] = [];
  schedule[selectedDay].push({ start, end, label });
  sortBlocks(selectedDay);
  saveSchedule();
  renderBlocks();

  addForm.reset();
  startInput.focus();
});

function timeToDate(baseDate, hhmm, dayOffset = 0) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(baseDate);
  if (dayOffset) d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
}

// Blocks where end <= start (e.g. 23:00-07:00) span midnight and end the next day.
function blockRange(block, baseDate) {
  const start = timeToDate(baseDate, block.start);
  let end = timeToDate(baseDate, block.end);
  if (end <= start) end = timeToDate(baseDate, block.end, 1);
  return { start, end };
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function computeStatus(now) {
  const todayIdx = now.getDay();
  const todayName = DAY_NAMES[todayIdx];
  const todayBlocks = [...blocksFor(todayName)].sort((a, b) => a.start.localeCompare(b.start));

  // A block that started yesterday and spans midnight (e.g. 23:00-07:00) may still be active.
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayBlocks = blocksFor(DAY_NAMES[yesterday.getDay()]);
  for (const block of yesterdayBlocks) {
    const { start, end } = blockRange(block, yesterday);
    if (start <= now && now < end) {
      return { text: `${formatDuration(end - now)} - ${block.label} ends` };
    }
  }

  for (const block of todayBlocks) {
    const { start, end } = blockRange(block, now);
    if (start <= now && now < end) {
      return { text: `${formatDuration(end - now)} - ${block.label} ends` };
    }
  }

  let soonest = null;
  for (const block of todayBlocks) {
    const start = timeToDate(now, block.start);
    if (start > now && (!soonest || start < soonest.start)) {
      soonest = { start, label: block.label };
    }
  }

  if (!soonest) {
    for (let offset = 1; offset <= 7; offset++) {
      const futureDate = new Date(now);
      futureDate.setDate(futureDate.getDate() + offset);
      const futureDay = DAY_NAMES[futureDate.getDay()];
      const futureBlocks = [...blocksFor(futureDay)].sort((a, b) => a.start.localeCompare(b.start));
      if (futureBlocks.length > 0) {
        const first = futureBlocks[0];
        soonest = { start: timeToDate(futureDate, first.start), label: first.label };
        break;
      }
    }
  }

  if (!soonest) {
    return { text: "No schedule set" };
  }

  return { text: `${formatDuration(soonest.start - now)} until ${soonest.label}` };
}

function tick() {
  const now = new Date();
  const { text } = computeStatus(now);
  statusText.textContent = text;
  document.title = text;
}

renderTabs();
renderBlocks();
tick();
setInterval(tick, 1000);
