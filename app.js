"use strict";

const state = {
  cityName: "",
  lat: null,
  lon: null,
  aqi: null,
  pm25: null,
  pm10: null,
  category: null,
  bestWindowText: "",
  bestWindowHours: [],
  hourly: null,
  profile: new Set(),
};

function $(id) { return document.getElementById(id); }

function setStatus(text, isError) {
  const el = $("statusLine");
  el.textContent = text || "";
  el.className = "status-line" + (isError ? " error" : "");
}

async function loadCity(name, lat, lon) {
  state.cityName = name;
  state.lat = lat;
  state.lon = lon;
  setStatus("Loading live air quality for " + name + "…");
  try {
    const url = "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" + lat +
      "&longitude=" + lon + "&current=pm2_5,pm10,us_aqi&hourly=pm2_5,pm10,us_aqi&forecast_days=3&timezone=auto";
    const res = await fetch(url);
    if (!res.ok) throw new Error("API " + res.status);
    const data = await res.json();
    renderNow(data);
    setStatus("");
  } catch (err) {
    setStatus("Could not load air quality data. Please check your connection and try again.", true);
  }
}

function renderNow(data) {
  const cur = data.current || {};
  state.aqi = Math.round(cur.us_aqi);
  state.pm25 = cur.pm2_5;
  state.pm10 = cur.pm10;
  state.hourly = data.hourly;
  const band = bandFor(state.aqi);
  state.category = band.name;

  $("nowCard").hidden = false;
  $("nowCity").textContent = state.cityName;
  const when = (cur.time || "").replace("T", " ");
  $("nowUpdated").textContent = "Updated " + when + " (local time) · Source: Copernicus / Open-Meteo";
  $("nowMessage").textContent = band.message;
  $("aqiNumber").textContent = state.aqi;
  $("aqiNumber").style.color = band.numberColor;
  const cat = $("aqiCategory");
  cat.textContent = band.name;
  cat.style.background = band.color;
  cat.style.color = band.text;
  $("pm25Value").textContent = state.pm25 != null ? Math.round(state.pm25) : "—";
  $("pm10Value").textContent = state.pm10 != null ? Math.round(state.pm10) : "—";
  $("maskAdvice").textContent = maskAdvice(state.aqi, false);

  computeBestWindow(cur.time);
  $("bestWindow").textContent = state.bestWindowText;
  drawChart(cur.time);
  renderPlan();
}

function computeBestWindow(nowIso) {
  const h = state.hourly;
  if (!h || !h.us_aqi) { state.bestWindowText = "—"; return; }
  const found = findBestWindow(h, nowIso);
  if (!found) { state.bestWindowText = "No clear window in the next 40 hours"; state.bestWindowHours = []; return; }
  state.bestWindowHours = found.hours;
  state.bestWindowText = found.text;
}

function drawChart(nowIso) {
  const h = state.hourly;
  const canvas = $("aqiChart");
  if (!h || !canvas) return;
  const start = hourIndex(h.time, nowIso);
  const count = 24;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 800;
  const cssHeight = 140;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const values = [];
  let max = 100;
  for (let k = 0; k < count; k++) {
    const v = h.us_aqi[start + k];
    values.push(v == null ? 0 : v);
    if (v != null && v > max) max = v;
  }
  max = Math.ceil(max / 100) * 100;
  const padBottom = 18, padTop = 8;
  const plotH = cssHeight - padBottom - padTop;
  const gap = 3;
  const barW = (cssWidth - gap * (count - 1)) / count;

  values.forEach((v, k) => {
    const x = k * (barW + gap);
    const bh = Math.max(2, (v / max) * plotH);
    const y = padTop + plotH - bh;
    ctx.fillStyle = bandFor(v).color;
    ctx.fillRect(x, y, barW, bh);
    if (state.bestWindowHours.includes(start + k)) {
      ctx.strokeStyle = "#0d6e5f";
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 1, y - 2, barW + 2, bh + 2);
    }
    if (k % 4 === 0) {
      ctx.fillStyle = "#5b6b7a";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(fmtHour(h.time[start + k]), x + barW / 2, cssHeight - 4);
    }
  });
}

function renderPlan() {
  const list = $("planList");
  list.innerHTML = "";
  if (state.aqi == null) {
    list.innerHTML = "<li>Load your city above and your personalised plan will appear here.</li>";
    return;
  }
  buildPlanItems(state.aqi, state.profile, state.bestWindowText).forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    list.appendChild(li);
  });
}

function calculatePurifier() {
  const box = $("calcResult");
  const result = purifierCadrs($("roomLength").value, $("roomWidth").value, $("roomHeight").value);
  if (!result) { box.textContent = "Please enter all three room measurements."; return; }
  box.innerHTML = "Your room is about <strong>" + Math.round(result.volumeM3) + " m³</strong>. " +
    "For smog season, choose a purifier with <strong>CADR of at least " + result.cadrSmog + " m³/h</strong> (about " + result.cfm + " CFM) — that cleans the room's air roughly 5 times an hour. " +
    "On moderate days, CADR " + result.cadrNormal + " m³/h is enough. If your current purifier's CADR is lower, run it on turbo in this one room with the door closed rather than on low in an open hall.";
}

function addMsg(text, who) {
  const log = $("chatLog");
  const div = document.createElement("div");
  div.className = "msg " + (who === "user" ? "msg-user" : "msg-bot");
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function localAnswer(qRaw) {
  return localAnswerFor(qRaw, {
    aqi: state.aqi,
    category: state.category,
    city: state.cityName,
    bestWindowText: state.bestWindowText,
    profile: state.profile,
    pm25: state.pm25,
    pm10: state.pm10,
  });
}

async function geminiAnswer(q) {
  const key = localStorage.getItem("saafhawa_gemini_key");
  if (!key) return null;
  const context = "You are SaafHawa, a friendly air-quality assistant for Indian families in winter smog season. " +
    "Live data: city " + state.cityName + ", US AQI " + state.aqi + " (" + state.category + "), PM2.5 " + Math.round(state.pm25) +
    " µg/m³, PM10 " + Math.round(state.pm10) + " µg/m³, cleanest window " + state.bestWindowText +
    ". Family profile flags: " + (Array.from(state.profile).join(", ") || "none specified") +
    ". Answer briefly, practically and warmly. No medical diagnosis; suggest a doctor for symptoms.";
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + encodeURIComponent(key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: context + "\n\nQuestion: " + q }] }] }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;
    return text || null;
  } catch (err) {
    return null;
  }
}

async function handleChatSubmit(ev) {
  ev.preventDefault();
  const input = $("chatInput");
  const q = input.value.trim();
  if (!q) return;
  input.value = "";
  addMsg(q, "user");
  const viaGemini = await geminiAnswer(q);
  addMsg(viaGemini || localAnswer(q), "bot");
}

let searchTimer = null;
async function handleSearchInput() {
  const term = $("cityInput").value.trim();
  const box = $("suggestions");
  if (term.length < 2) { box.hidden = true; box.innerHTML = ""; $("cityInput").setAttribute("aria-expanded", "false"); return; }
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    try {
      const res = await fetch("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(term) + "&count=6&language=en&format=json");
      const data = await res.json();
      box.innerHTML = "";
      (data.results || []).forEach((r) => {
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = "";
        b.textContent = r.name;
        const sub = document.createElement("span");
        sub.className = "sug-sub";
        sub.textContent = " — " + [r.admin1, r.country].filter(Boolean).join(", ");
        b.appendChild(sub);
        b.addEventListener("click", () => {
          box.hidden = true;
          $("cityInput").setAttribute("aria-expanded", "false");
          $("cityInput").value = r.name;
          loadCity(r.name + (r.admin1 ? ", " + r.admin1 : ""), r.latitude, r.longitude);
        });
        box.appendChild(b);
      });
      box.hidden = !(data.results && data.results.length);
      $("cityInput").setAttribute("aria-expanded", String(!box.hidden));
    } catch (err) {
      box.hidden = true;
      $("cityInput").setAttribute("aria-expanded", "false");
    }
  }, 250);
}

function handleLocate() {
  if (!navigator.geolocation) { setStatus("Location is not available in this browser.", true); return; }
  setStatus("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => loadCity("Your location", pos.coords.latitude.toFixed(4), pos.coords.longitude.toFixed(4)),
    () => setStatus("Could not get your location. Please search for your city instead.", true),
    { timeout: 10000 }
  );
}

function init() {
  $("cityInput").addEventListener("input", handleSearchInput);
  $("cityInput").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $("suggestions").hidden = true;
      $("cityInput").setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-field")) $("suggestions").hidden = true;
  });
  $("locateBtn").addEventListener("click", handleLocate);
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $("cityInput").value = chip.dataset.city;
      loadCity(chip.dataset.city, parseFloat(chip.dataset.lat), parseFloat(chip.dataset.lon));
    });
  });
  document.querySelectorAll("#profileGrid input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.profile.add(cb.value); else state.profile.delete(cb.value);
      renderPlan();
    });
  });
  $("calcBtn").addEventListener("click", calculatePurifier);
  $("chatForm").addEventListener("submit", handleChatSubmit);
  const savedKey = localStorage.getItem("saafhawa_gemini_key");
  if (savedKey) $("geminiKey").value = savedKey;
  $("saveKeyBtn").addEventListener("click", () => {
    const v = $("geminiKey").value.trim();
    if (v) { localStorage.setItem("saafhawa_gemini_key", v); addMsg("Gemini key saved in this browser. Your questions will now be answered by Gemini, with the built-in advisor as backup.", "bot"); }
  });
  renderPlan();
  loadCity("Kanpur, Uttar Pradesh", 26.4652, 80.3497);
}

document.addEventListener("DOMContentLoaded", init);
