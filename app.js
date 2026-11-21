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

const BANDS = [
  { max: 50, name: "Good", color: "#2e9e4f", message: "Air is clean today. Enjoy the outdoors — days like this are precious in smog season." },
  { max: 100, name: "Moderate", color: "#d9a400", message: "Air is acceptable for most people. Sensitive family members should keep outdoor time easy and watch for symptoms." },
  { max: 150, name: "Unhealthy for sensitive groups", color: "#e07b24", message: "Children, elders and anyone with asthma should cut back on long or heavy outdoor activity today." },
  { max: 200, name: "Unhealthy", color: "#cf2e2e", message: "Everyone may feel the effects today. Keep outdoor time short, wear a well-fitting N95 outside, and keep the purifier running." },
  { max: 300, name: "Very unhealthy", color: "#7d3c98", message: "Health alert territory. Avoid outdoor exertion, keep windows closed outside the clean window, and run the purifier on high in the bedroom." },
  { max: 9999, name: "Hazardous", color: "#7e0023", message: "Emergency-level air. Stay indoors with the purifier running, seal the room, and go out only if essential — with an N95." },
];

function bandFor(aqi) {
  return BANDS.find((b) => aqi <= b.max) || BANDS[BANDS.length - 1];
}

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
  $("aqiNumber").style.color = band.color;
  const cat = $("aqiCategory");
  cat.textContent = band.name;
  cat.style.background = band.color;
  $("pm25Value").textContent = state.pm25 != null ? Math.round(state.pm25) : "—";
  $("pm10Value").textContent = state.pm10 != null ? Math.round(state.pm10) : "—";
  $("maskAdvice").textContent = maskAdvice(state.aqi, false);

  computeBestWindow(cur.time);
  $("bestWindow").textContent = state.bestWindowText;
  drawChart(cur.time);
  renderPlan();
}

function hourIndex(times, isoTime) {
  const hourPrefix = (isoTime || "").slice(0, 13);
  for (let i = 0; i < times.length; i++) {
    if (times[i].slice(0, 13) === hourPrefix) return i;
  }
  return 0;
}

function fmtHour(iso) {
  const h = parseInt(iso.slice(11, 13), 10);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + " " + suffix;
}

function dayLabel(iso, refIso) {
  if (!iso || !refIso) return "";
  if (iso.slice(0, 10) === refIso.slice(0, 10)) return "Today";
  const ref = new Date(refIso.slice(0, 10) + "T00:00:00");
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  const diff = Math.round((d - ref) / 86400000);
  return diff === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short" });
}

function computeBestWindow(nowIso) {
  const h = state.hourly;
  if (!h || !h.us_aqi) { state.bestWindowText = "—"; return; }
  const start = hourIndex(h.time, nowIso);
  let best = null;
  for (let i = start; i + 2 < h.us_aqi.length && i < start + 40; i++) {
    const hr = parseInt(h.time[i].slice(11, 13), 10);
    if (hr < 5 || hr > 18) continue;
    const vals = [h.us_aqi[i], h.us_aqi[i + 1], h.us_aqi[i + 2]];
    if (vals.some((v) => v == null)) continue;
    const avg = (vals[0] + vals[1] + vals[2]) / 3;
    if (!best || avg < best.avg) best = { i, avg };
  }
  if (!best) { state.bestWindowText = "No clear window in the next 40 hours"; state.bestWindowHours = []; return; }
  state.bestWindowHours = [best.i, best.i + 1, best.i + 2];
  state.bestWindowText = dayLabel(h.time[best.i], nowIso) + " " + fmtHour(h.time[best.i]) + " – " +
    fmtHour(h.time[best.i + 2]) + " (avg AQI " + Math.round(best.avg) + ")";
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

function maskAdvice(aqi, sensitive) {
  if (aqi <= 100) return sensitive ? "Mask optional outdoors" : "No mask needed for most people";
  if (aqi <= 150) return sensitive ? "Wear a mask outdoors today" : "Sensitive members: wear a mask";
  if (aqi <= 200) return "N95 for everyone outdoors";
  if (aqi <= 300) return "N95 outdoors; keep trips short";
  return "Avoid going out; N95 if essential";
}

function renderPlan() {
  const list = $("planList");
  list.innerHTML = "";
  if (state.aqi == null) {
    list.innerHTML = "<li>Load your city above and your personalised plan will appear here.</li>";
    return;
  }
  const aqi = state.aqi;
  const p = state.profile;
  const items = [];

  if (aqi <= 50) items.push("A full normal day: walks, play and exercise outdoors are all fine. Ventilate the home freely.");
  if (aqi > 50 && aqi <= 100) items.push("A near-normal day. Keep the windows routine as usual, and let sensitive members take it easy outdoors.");
  if (aqi > 100 && aqi <= 150) items.push("Move heavy outdoor activity into the clean window: " + state.bestWindowText + ". Ventilate only during that window.");
  if (aqi > 150 && aqi <= 200) items.push("Shift walks and play to the clean window: " + state.bestWindowText + ". Keep windows closed the rest of the day and run the purifier in the bedroom.");
  if (aqi > 200) items.push("Indoor day. Cancel outdoor plans, keep windows closed except a short flush during the clean window (" + state.bestWindowText + "), and run the purifier on high.");

  if (p.has("children")) {
    items.push(aqi > 150
      ? "Children: no outdoor play or sports today; if the school run is unavoidable, an N95/KN95 that seals well, and no waiting outdoors."
      : aqi > 100
        ? "Children: keep outdoor play under an hour and inside the clean window; watch for coughing or eye irritation."
        : "Children: outdoor play is fine today.");
  }
  if (p.has("elderly")) {
    items.push(aqi > 150
      ? "Elders: skip the morning walk — winter mornings are the worst air of the day. A gentle indoor walk or stretching instead; a short outing only in the clean window, with an N95."
      : "Elders: take the walk inside the clean window (" + state.bestWindowText + ") rather than early morning.");
  }
  if (p.has("asthma")) {
    items.push("Asthma/allergy: keep the reliever inhaler within reach today, run the purifier in the bedroom from evening itself, and treat a night-time cough as a signal to stay in tomorrow too.");
  }
  if (p.has("pregnancy")) {
    items.push(aqi > 100
      ? "Pregnancy: prefer indoor time today; if you step out, an N95 and the shortest route away from main roads."
      : "Pregnancy: a normal day is fine; the clean window is still the nicest time for a walk.");
  }
  if (p.has("outdoor")) {
    items.push(aqi > 150
      ? "Outdoor work/commute: a properly fitted N95 (no gaps at the nose), sunglasses against dust irritation, and a change of clothes after coming home so the day’s dust stays out of the bedroom."
      : "Outdoor work/commute: a normal day; a mask is a good habit in traffic even today.");
  }
  if (p.has("fitness")) {
    items.push(aqi > 150
      ? "Workout: move it indoors today — breathing hard outdoors at this AQI undoes the benefit. Or use the clean window at an easy pace."
      : aqi > 100
        ? "Workout: keep it inside the clean window and at moderate intensity; skip roadside routes."
        : "Workout: outdoors is fine — the clean window (" + state.bestWindowText + ") is the best slot.");
  }
  if (!p.size) items.push("Tip: tick who is in your family above and this plan becomes personal — mask, school-run and walk advice for each member.");

  items.forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    list.appendChild(li);
  });
}

function calculatePurifier() {
  const L = parseFloat($("roomLength").value) || 0;
  const W = parseFloat($("roomWidth").value) || 0;
  const H = parseFloat($("roomHeight").value) || 0;
  const box = $("calcResult");
  if (!L || !W || !H) { box.textContent = "Please enter all three room measurements."; return; }
  const volumeM3 = L * W * H * 0.0283168;
  const cadrSmog = Math.ceil((volumeM3 * 5) / 10) * 10;
  const cadrNormal = Math.ceil((volumeM3 * 3) / 10) * 10;
  const cfm = Math.round(cadrSmog * 0.5886);
  box.innerHTML = "Your room is about <strong>" + Math.round(volumeM3) + " m³</strong>. " +
    "For smog season, choose a purifier with <strong>CADR of at least " + cadrSmog + " m³/h</strong> (about " + cfm + " CFM) — that cleans the room's air roughly 5 times an hour. " +
    "On moderate days, CADR " + cadrNormal + " m³/h is enough. If your current purifier's CADR is lower, run it on turbo in this one room with the door closed rather than on low in an open hall.";
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
  const q = qRaw.toLowerCase();
  const aqi = state.aqi;
  const city = state.cityName || "your city";
  if (aqi == null) return "First load your city above so I can answer from its live air quality.";
  const band = state.category;
  const windowText = state.bestWindowText;

  if (/(mask|n95|kn95)/.test(q)) {
    return "For " + city + " right now (AQI " + aqi + ", " + band + "): " + maskAdvice(aqi, state.profile.has("asthma") || state.profile.has("children")) +
      ". A mask only works if it seals — press the nose strip and check there are no gaps at the cheeks. Cloth and surgical masks stop dust, not PM2.5; for that you need an N95/KN95.";
  }
  if (/(walk|run|exercise|yoga|jog|workout|cycle|cycling|play)/.test(q)) {
    if (aqi > 200) return "Not today — at AQI " + aqi + " in " + city + ", outdoor exercise does more harm than good. Move it indoors, or wait for the clean window (" + windowText + ") and keep it gentle.";
    if (aqi > 150) return "Keep it inside the clean window (" + windowText + ") and at an easy pace, away from main roads. If anyone at home has asthma, indoors is the safer call today.";
    if (aqi > 100) return "Yes, but time it inside the clean window (" + windowText + ") and keep the intensity moderate. Early morning is usually the dirtiest slot in winter — avoid it.";
    return "Yes — AQI " + aqi + " (" + band + ") in " + city + " is fine for outdoor exercise. The nicest slot is " + windowText + ".";
  }
  if (/(window|ventilat|open|fresh air)/.test(q)) {
    return "Open the windows only during the clean window: " + windowText + ". Give the home 20–30 minutes of cross-ventilation then, and keep windows closed the rest of the day" + (aqi > 150 ? " — at AQI " + aqi + ", every open hour pulls smog in." : ".");
  }
  if (/(school|child|kid|son|daughter|baby)/.test(q)) {
    if (aqi > 200) return "At AQI " + aqi + ", keep children indoors if you can. If school is on, use a well-fitting N95/KN95 for the trip, ask for indoor assembly and no outdoor PT, and run the purifier in their room tonight.";
    if (aqi > 150) return "School is fine with precautions at AQI " + aqi + ": a well-fitting mask for the commute, no outdoor sports, and indoor play after school.";
    return "No special worry today — AQI " + aqi + " (" + band + ") is okay for school and outdoor play. The clean window (" + windowText + ") is the best playtime.";
  }
  if (/(purifier|filter|hepa|cadr)/.test(q)) {
    return "Size it to the bedroom first: you need CADR of roughly 5× the room's volume in m³ per hour during smog season — use the calculator on this page. Run it with the door closed, placed near the bed and a little away from the wall. A true HEPA filter is what traps PM2.5; replace or clean filters as the maker advises, because a choked filter quietly stops helping.";
  }
  if (/(asthma|inhaler|allerg|cough|breath)/.test(q)) {
    return "With AQI " + aqi + " (" + band + ") in " + city + ": keep the reliever inhaler handy, prefer indoor time" + (aqi > 150 ? ", run the purifier in the bedroom from evening, and wear an N95 for any trip out" : "") + ". If breathing trouble, chest tightness or a night cough that keeps returning appears, please see a doctor rather than waiting it out.";
  }
  if (/(father|mother|parent|elder|grand|old)/.test(q)) {
    return "For elders today in " + city + " (AQI " + aqi + "): " + (aqi > 150 ? "skip the early-morning walk entirely; a short outing only in the clean window (" + windowText + ") with an N95, or gentle indoor movement instead." : "the walk is fine inside the clean window (" + windowText + ") — that is kinder than the early-morning slot in winter.");
  }
  if (/(commute|office|drive|car|traffic)/.test(q)) {
    return "For the commute in " + city + " today (AQI " + aqi + "): keep car windows up with the AC on recirculate, wear an N95 on two-wheelers or in autos, and if you can shift the trip into the clean window (" + windowText + "), both traffic fumes and smog will be lower.";
  }
  if (/(aqi|air|today|now|status|quality)/.test(q)) {
    return "Right now in " + city + ": AQI " + aqi + " (" + band + "), PM2.5 " + Math.round(state.pm25) + " µg/m³, PM10 " + Math.round(state.pm10) + " µg/m³. The cleanest stretch ahead is " + windowText + ". " + bandFor(aqi).message;
  }
  return "Here is what I can say from today's data for " + city + " (AQI " + aqi + ", " + band + "): the clean window is " + windowText + ", and mask advice is — " + maskAdvice(aqi, false) + ". Ask me about walks, school, windows, purifiers or the commute and I will answer for your family specifically.";
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
  if (term.length < 2) { box.hidden = true; box.innerHTML = ""; return; }
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
          $("cityInput").value = r.name;
          loadCity(r.name + (r.admin1 ? ", " + r.admin1 : ""), r.latitude, r.longitude);
        });
        box.appendChild(b);
      });
      box.hidden = !(data.results && data.results.length);
    } catch (err) {
      box.hidden = true;
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
