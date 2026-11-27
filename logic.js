"use strict";

// Pure logic for SaafHawa: AQI bands, time helpers, the clean-window scan,
// the purifier calculator, the family plan builder and the local advisor.
// No DOM access here, so this file can be tested in plain Node.

const BANDS = [
  { max: 50, name: "Good", color: "#2e9e4f", text: "#10222e", numberColor: "#2e9e4f", message: "Air is clean today. Enjoy the outdoors — days like this are precious in smog season." },
  { max: 100, name: "Moderate", color: "#d9a400", text: "#10222e", numberColor: "#8a6d00", message: "Air is acceptable for most people. Sensitive family members should keep outdoor time easy and watch for symptoms." },
  { max: 150, name: "Unhealthy for sensitive groups", color: "#e07b24", text: "#10222e", numberColor: "#9c4a00", message: "Children, elders and anyone with asthma should cut back on long or heavy outdoor activity today." },
  { max: 200, name: "Unhealthy", color: "#cf2e2e", text: "#ffffff", numberColor: "#cf2e2e", message: "Everyone may feel the effects today. Keep outdoor time short, wear a well-fitting N95 outside, and keep the purifier running." },
  { max: 300, name: "Very unhealthy", color: "#7d3c98", text: "#ffffff", numberColor: "#7d3c98", message: "Health alert territory. Avoid outdoor exertion, keep windows closed outside the clean window, and run the purifier on high in the bedroom." },
  { max: 9999, name: "Hazardous", color: "#7e0023", text: "#ffffff", numberColor: "#7e0023", message: "Emergency-level air. Stay indoors with the purifier running, seal the room, and go out only if essential — with an N95." },
];

function bandFor(aqi) {
  return BANDS.find((b) => aqi <= b.max) || BANDS[BANDS.length - 1];
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

function hourIndex(times, isoTime) {
  const hourPrefix = (isoTime || "").slice(0, 13);
  for (let i = 0; i < times.length; i++) {
    if (times[i].slice(0, 13) === hourPrefix) return i;
  }
  return 0;
}

function maskAdvice(aqi, sensitive) {
  if (aqi <= 100) return sensitive ? "Mask optional outdoors" : "No mask needed for most people";
  if (aqi <= 150) return sensitive ? "Wear a mask outdoors today" : "Sensitive members: wear a mask";
  if (aqi <= 200) return "N95 for everyone outdoors";
  if (aqi <= 300) return "N95 outdoors; keep trips short";
  return "Avoid going out; N95 if essential";
}

// Scans the next 40 hours for the cleanest daytime 3-hour stretch.
// Returns { index, avg, hours, text } or null when no daytime window exists.
function findBestWindow(hourly, nowIso) {
  if (!hourly || !hourly.us_aqi) return null;
  const start = hourIndex(hourly.time, nowIso);
  let best = null;
  for (let i = start; i + 2 < hourly.us_aqi.length && i < start + 40; i++) {
    const hr = parseInt(hourly.time[i].slice(11, 13), 10);
    if (hr < 5 || hr > 18) continue;
    const vals = [hourly.us_aqi[i], hourly.us_aqi[i + 1], hourly.us_aqi[i + 2]];
    if (vals.some((v) => v == null)) continue;
    const avg = (vals[0] + vals[1] + vals[2]) / 3;
    if (!best || avg < best.avg) best = { i, avg };
  }
  if (!best) return null;
  return {
    index: best.i,
    avg: best.avg,
    hours: [best.i, best.i + 1, best.i + 2],
    text: dayLabel(hourly.time[best.i], nowIso) + " " + fmtHour(hourly.time[best.i]) + " – " +
      fmtHour(hourly.time[best.i + 2]) + " (avg AQI " + Math.round(best.avg) + ")",
  };
}

// Room dimensions in feet (strings or numbers). Returns CADR figures in m³/h, or null for invalid input.
function purifierCadrs(lengthFt, widthFt, heightFt) {
  const L = parseFloat(lengthFt), W = parseFloat(widthFt), H = parseFloat(heightFt);
  if (!L || !W || !H || L <= 0 || W <= 0 || H <= 0) return null;
  const volumeM3 = L * W * H * 0.0283168;
  const cadrSmog = Math.ceil((volumeM3 * 5) / 10) * 10;
  const cadrNormal = Math.ceil((volumeM3 * 3) / 10) * 10;
  return { volumeM3, cadrSmog, cadrNormal, cfm: Math.round(cadrSmog * 0.5886) };
}

function buildPlanItems(aqi, profile, bestWindowText) {
  const p = profile instanceof Set ? profile : new Set(profile || []);
  const items = [];
  if (aqi <= 50) items.push("A full normal day: walks, play and exercise outdoors are all fine. Ventilate the home freely.");
  else if (aqi <= 100) items.push("A near-normal day. Keep the windows routine as usual, and let sensitive members take it easy outdoors.");
  else if (aqi <= 150) items.push("Move heavy outdoor activity into the clean window: " + bestWindowText + ". Ventilate only during that window.");
  else if (aqi <= 200) items.push("Shift walks and play to the clean window: " + bestWindowText + ". Keep windows closed the rest of the day and run the purifier in the bedroom.");
  else items.push("Indoor day. Cancel outdoor plans, keep windows closed except a short flush during the clean window (" + bestWindowText + "), and run the purifier on high.");
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
      : "Elders: take the walk inside the clean window (" + bestWindowText + ") rather than early morning.");
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
        : "Workout: outdoors is fine — the clean window (" + bestWindowText + ") is the best slot.");
  }
  if (!p.size) items.push("Tip: tick who is in your family above and this plan becomes personal — mask, school-run and walk advice for each member.");
  return items;
}

// Pure form of the built-in advisor. ctx: { aqi, category, city, bestWindowText, profile, pm25, pm10 }.
function localAnswerFor(qRaw, ctx) {
  const q = qRaw.toLowerCase();
  const aqi = ctx.aqi;
  const city = ctx.city || "your city";
  if (aqi == null) return "First load your city above so I can answer from its live air quality.";
  const band = ctx.category;
  const windowText = ctx.bestWindowText;
  const profile = ctx.profile instanceof Set ? ctx.profile : new Set(ctx.profile || []);
  if (/(mask|n95|kn95)/.test(q)) {
    return "For " + city + " right now (AQI " + aqi + ", " + band + "): " + maskAdvice(aqi, profile.has("asthma") || profile.has("children")) +
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
    return "Right now in " + city + ": AQI " + aqi + " (" + band + "), PM2.5 " + Math.round(ctx.pm25) + " µg/m³, PM10 " + Math.round(ctx.pm10) + " µg/m³. The cleanest stretch ahead is " + windowText + ". " + bandFor(aqi).message;
  }
  return "Here is what I can say from today's data for " + city + " (AQI " + aqi + ", " + band + "): the clean window is " + windowText + ", and mask advice is — " + maskAdvice(aqi, false) + ". Ask me about walks, school, windows, purifiers or the commute and I will answer for your family specifically.";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { BANDS, bandFor, fmtHour, dayLabel, hourIndex, maskAdvice, findBestWindow, purifierCadrs, buildPlanItems, localAnswerFor };
}
