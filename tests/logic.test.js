"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  bandFor,
  fmtHour,
  dayLabel,
  hourIndex,
  maskAdvice,
  findBestWindow,
  purifierCadrs,
  buildPlanItems,
  localAnswerFor,
} = require("../logic.js");

const WINDOW = "Today 10 am – 12 pm (avg AQI 45)";

test("bandFor returns the right band at every boundary", () => {
  const cases = [
    [0, "Good"], [50, "Good"],
    [51, "Moderate"], [100, "Moderate"],
    [101, "Unhealthy for sensitive groups"], [150, "Unhealthy for sensitive groups"],
    [151, "Unhealthy"], [200, "Unhealthy"],
    [201, "Very unhealthy"], [300, "Very unhealthy"],
    [301, "Hazardous"], [500, "Hazardous"],
  ];
  for (const [aqi, name] of cases) {
    assert.equal(bandFor(aqi).name, name, `AQI ${aqi}`);
  }
});

test("bandFor carries a message and colours for every band", () => {
  for (const aqi of [25, 75, 125, 175, 250, 400]) {
    const b = bandFor(aqi);
    assert.ok(b.message.length > 10);
    assert.match(b.color, /^#[0-9a-f]{6}$/);
    assert.match(b.text, /^#[0-9a-f]{6}$/);
    assert.match(b.numberColor, /^#[0-9a-f]{6}$/);
  }
});

test("fmtHour formats 12-hour times", () => {
  assert.equal(fmtHour("2026-11-27T00:00"), "12 am");
  assert.equal(fmtHour("2026-11-27T05:00"), "5 am");
  assert.equal(fmtHour("2026-11-27T11:00"), "11 am");
  assert.equal(fmtHour("2026-11-27T12:00"), "12 pm");
  assert.equal(fmtHour("2026-11-27T13:00"), "1 pm");
  assert.equal(fmtHour("2026-11-27T18:00"), "6 pm");
  assert.equal(fmtHour("2026-11-27T23:00"), "11 pm");
});

test("dayLabel names today, tomorrow and other days", () => {
  assert.equal(dayLabel("2026-11-27T10:00", "2026-11-27T06:00"), "Today");
  assert.equal(dayLabel("2026-11-28T10:00", "2026-11-27T06:00"), "Tomorrow");
  assert.match(dayLabel("2026-11-29T10:00", "2026-11-27T06:00"), /^[A-Za-z]{3}$/);
  assert.equal(dayLabel("", "2026-11-27T06:00"), "");
});

test("hourIndex finds the current hour or falls back to 0", () => {
  const times = ["2026-11-27T04:00", "2026-11-27T05:00", "2026-11-27T06:00"];
  assert.equal(hourIndex(times, "2026-11-27T05:30"), 1);
  assert.equal(hourIndex(times, "2026-11-27T09:00"), 0);
});

test("maskAdvice follows the AQI bands, sensitive or not", () => {
  assert.equal(maskAdvice(50, false), "No mask needed for most people");
  assert.equal(maskAdvice(50, true), "Mask optional outdoors");
  assert.equal(maskAdvice(100, true), "Mask optional outdoors");
  assert.equal(maskAdvice(101, false), "Sensitive members: wear a mask");
  assert.equal(maskAdvice(101, true), "Wear a mask outdoors today");
  assert.equal(maskAdvice(150, true), "Wear a mask outdoors today");
  assert.equal(maskAdvice(151, false), "N95 for everyone outdoors");
  assert.equal(maskAdvice(200, false), "N95 for everyone outdoors");
  assert.equal(maskAdvice(201, false), "N95 outdoors; keep trips short");
  assert.equal(maskAdvice(300, true), "N95 outdoors; keep trips short");
  assert.equal(maskAdvice(301, false), "Avoid going out; N95 if essential");
});

function makeTimes(fromIso, count) {
  const [datePart, timePart] = fromIso.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const h = Number(timePart.slice(0, 2));
  const base = Date.UTC(y, m - 1, d, h);
  return Array.from({ length: count }, (_, k) => {
    const t = new Date(base + k * 3600000);
    const p = (n) => String(n).padStart(2, "0");
    return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:00`;
  });
}

test("findBestWindow picks the cleanest daytime 3-hour stretch", () => {
  const values = new Array(72).fill(300);
  values[10] = 40; values[11] = 45; values[12] = 50;
  const hourly = { time: makeTimes("2026-11-27T00:00", 72), us_aqi: values };
  const found = findBestWindow(hourly, "2026-11-27T06:00");
  assert.equal(found.index, 10);
  assert.deepEqual(found.hours, [10, 11, 12]);
  assert.equal(found.text, "Today 10 am – 12 pm (avg AQI 45)");
});

test("findBestWindow keeps the earliest window on a tie", () => {
  const values = new Array(72).fill(300);
  values[8] = 60; values[9] = 60; values[10] = 60;
  values[14] = 60; values[15] = 60; values[16] = 60;
  const hourly = { time: makeTimes("2026-11-27T00:00", 72), us_aqi: values };
  const found = findBestWindow(hourly, "2026-11-27T06:00");
  assert.equal(found.index, 8);
});

test("findBestWindow skips windows with missing readings", () => {
  const values = new Array(72).fill(300);
  values[10] = null;
  const hourly = { time: makeTimes("2026-11-27T00:00", 72), us_aqi: values };
  const found = findBestWindow(hourly, "2026-11-27T06:00");
  assert.equal(found.index, 6);
});

test("findBestWindow returns null when no daytime window exists", () => {
  const values = new Array(8).fill(100);
  const hourly = { time: makeTimes("2026-11-27T20:00", 8), us_aqi: values };
  assert.equal(findBestWindow(hourly, "2026-11-27T20:00"), null);
  assert.equal(findBestWindow(null, "2026-11-27T20:00"), null);
  assert.equal(findBestWindow({ time: [], us_aqi: [] }, "2026-11-27T20:00"), null);
});

test("purifierCadrs sizes a 12x10x10 ft bedroom", () => {
  const r = purifierCadrs(12, 10, 10);
  assert.ok(Math.abs(r.volumeM3 - 33.98016) < 1e-9);
  assert.equal(r.cadrSmog, 170);
  assert.equal(r.cadrNormal, 110);
  assert.equal(r.cfm, 100);
});

test("purifierCadrs rounds CADR up to the next 10", () => {
  const r = purifierCadrs(10, 10, 8);
  assert.equal(r.cadrSmog, 120);
  assert.equal(r.cadrNormal, 70);
});

test("purifierCadrs rejects missing or invalid dimensions", () => {
  assert.equal(purifierCadrs(0, 10, 10), null);
  assert.equal(purifierCadrs("", 10, 10), null);
  assert.equal(purifierCadrs(-12, 10, 10), null);
  assert.equal(purifierCadrs(12, 10, null), null);
});

test("buildPlanItems gives a normal day plus a tip when no profile is set", () => {
  const items = buildPlanItems(45, new Set(), WINDOW);
  assert.equal(items.length, 2);
  assert.match(items[0], /full normal day/);
  assert.match(items[1], /tick who is in your family/);
});

test("buildPlanItems switches the base advice at each AQI boundary", () => {
  assert.match(buildPlanItems(50, new Set(), WINDOW)[0], /full normal day/);
  assert.match(buildPlanItems(51, new Set(), WINDOW)[0], /near-normal day/);
  assert.match(buildPlanItems(101, new Set(), WINDOW)[0], /Move heavy outdoor activity into the clean window/);
  assert.match(buildPlanItems(151, new Set(), WINDOW)[0], /Shift walks and play to the clean window/);
  assert.match(buildPlanItems(201, new Set(), WINDOW)[0], /Indoor day/);
});

test("buildPlanItems personalises every member on a severe day", () => {
  const profile = new Set(["children", "elderly", "asthma", "pregnancy", "outdoor", "fitness"]);
  const items = buildPlanItems(320, profile, WINDOW);
  assert.equal(items.length, 7);
  assert.match(items[0], /Indoor day/);
  assert.match(items[1], /no outdoor play or sports today/);
  assert.match(items[2], /skip the morning walk/);
  assert.match(items[3], /reliever inhaler within reach/);
  assert.match(items[4], /prefer indoor time today/);
  assert.match(items[5], /properly fitted N95/);
  assert.match(items[6], /move it indoors today/);
});

test("buildPlanItems changes the children advice at 100 and 150", () => {
  const children = new Set(["children"]);
  assert.match(buildPlanItems(100, children, WINDOW)[1], /outdoor play is fine today/);
  assert.match(buildPlanItems(101, children, WINDOW)[1], /keep outdoor play under an hour/);
  assert.match(buildPlanItems(150, children, WINDOW)[1], /keep outdoor play under an hour/);
  assert.match(buildPlanItems(151, children, WINDOW)[1], /no outdoor play or sports today/);
});

function answerCtx(aqi, profile, extra = {}) {
  return {
    aqi,
    category: aqi == null ? null : bandFor(aqi).name,
    city: "Kanpur",
    bestWindowText: WINDOW,
    profile: new Set(profile || []),
    pm25: 180,
    pm10: 240,
    ...extra,
  };
}

test("localAnswerFor asks for the city first when no AQI is loaded", () => {
  assert.equal(
    localAnswerFor("should I wear a mask?", answerCtx(null, [])),
    "First load your city above so I can answer from its live air quality."
  );
});

test("localAnswerFor answers mask, walk and window questions from the AQI", () => {
  const severe = answerCtx(250, ["asthma"]);
  assert.match(localAnswerFor("should I wear a mask?", severe), /N95 outdoors; keep trips short/);
  assert.match(localAnswerFor("should I wear a mask?", severe), /mask only works if it seals/);
  assert.match(localAnswerFor("can I go for a morning walk?", severe), /Not today/);
  assert.match(localAnswerFor("can I go for a run?", answerCtx(120, [])), /inside the clean window/);
  assert.match(localAnswerFor("can I go for a run?", answerCtx(40, [])), /fine for outdoor exercise/);
  assert.match(localAnswerFor("when should I open the windows?", answerCtx(180, [])), /Open the windows only during the clean window/);
  assert.match(localAnswerFor("when should I open the windows?", answerCtx(180, [])), /every open hour pulls smog in/);
});

test("localAnswerFor covers school, purifier, AQI and fallback questions", () => {
  assert.match(localAnswerFor("is school safe for my son?", answerCtx(250, [])), /keep children indoors if you can/);
  assert.match(localAnswerFor("which purifier should I buy?", answerCtx(180, [])), /5× the room's volume/);
  assert.match(localAnswerFor("what is the air quality today?", answerCtx(90, [])), /AQI 90 \(Moderate\), PM2\.5 180/);
  const fallback = localAnswerFor("tell me something", answerCtx(90, []));
  assert.match(fallback, /clean window is/);
  assert.match(fallback, /No mask needed for most people/);
});
