import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Home as HomeIcon,
  Clock,
  BarChart3,
  CircleDot,
  User,
  Plus,
  X,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Moon,
  Briefcase,
  Dumbbell,
  Users,
  Heart,
  BookOpen,
  Film,
  Bus,
  Smartphone,
  MoreHorizontal,
  Sparkles,
  ArrowRight,
  Info,
  RotateCcw,
} from "lucide-react";


/* -------------------------------------------------------------------------
   Local persistence (browser localStorage) — this app runs standalone,
   outside the Claude artifact host, so it uses the browser's own storage
   instead of the artifact "window.storage" API. Same async signature.
   ------------------------------------------------------------------------- */
async function storageGet(key) {
  try {
    const v = window.localStorage.getItem("lih:" + key);
    return v == null ? null : { key, value: v };
  } catch (e) {
    return null;
  }
}
async function storageSet(key, value) {
  try {
    window.localStorage.setItem("lih:" + key, value);
    return { key, value };
  } catch (e) {
    return null;
  }
}

/* =========================================================================
   LIFE IN HOURS
   "Your life is made of hours. See where yours are going."
   ========================================================================= */

/* -------------------------------------------------------------------------
   1. DESIGN TOKENS
   ------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------
   2. CATEGORIES
   ------------------------------------------------------------------------- */
const CATEGORIES = {
  sleep: { label: "Sleep", color: "var(--sleep)", icon: Moon },
  work: { label: "Work", color: "var(--work)", icon: Briefcase },
  commute: { label: "Commute", color: "var(--commute)", icon: Bus },
  exercise: { label: "Exercise", color: "var(--exercise)", icon: Dumbbell },
  family: { label: "Family", color: "var(--family)", icon: Heart },
  friends: { label: "Friends", color: "var(--friends)", icon: Users },
  learning: { label: "Learning", color: "var(--learning)", icon: BookOpen },
  entertainment: { label: "Entertainment", color: "var(--entertainment)", icon: Film },
  screen: { label: "Screen time", color: "var(--screen)", icon: Smartphone },
  other: { label: "Other", color: "var(--other)", icon: MoreHorizontal },
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);

/* -------------------------------------------------------------------------
   3. TIME / CALCULATION UTILITIES
   ------------------------------------------------------------------------- */
const DAY_MS = 86400000;

function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}
function startOfWeek(d) {
  const copy = new Date(d);
  const day = copy.getDay(); // 0 = Sunday
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function durationHours(start, end) {
  let mins = timeToMinutes(end) - timeToMinutes(start);
  if (mins <= 0) mins += 24 * 60; // crosses midnight
  return mins / 60;
}
function fmtHours(h) {
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}
function fmtBigNumber(n) {
  return Math.round(n).toLocaleString("en-US");
}

/** Age breakdown from a birth date to now, in years/months/days */
function ageBreakdown(birthDate) {
  const now = new Date();
  let years = now.getFullYear() - birthDate.getFullYear();
  let months = now.getMonth() - birthDate.getMonth();
  let days = now.getDate() - birthDate.getDate();
  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    days += prevMonth.getDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

/** Total hours lived since birth, to the hour */
function hoursLived(birthDate) {
  return (Date.now() - birthDate.getTime()) / 36e5;
}

/** Estimated hours remaining given a life-expectancy assumption (years) */
function hoursRemaining(birthDate, lifeExpectancyYears) {
  const expectedEnd = new Date(birthDate);
  expectedEnd.setFullYear(expectedEnd.getFullYear() + lifeExpectancyYears);
  return Math.max(0, (expectedEnd.getTime() - Date.now()) / 36e5);
}

function percentOfLife(birthDate, lifeExpectancyYears) {
  const lived = hoursLived(birthDate);
  const total = lifeExpectancyYears * 365.25 * 24;
  return Math.min(100, (lived / total) * 100);
}

/** Sum hours per category for a list of activities */
function categoryTotals(activities) {
  const totals = {};
  CATEGORY_KEYS.forEach((k) => (totals[k] = 0));
  activities.forEach((a) => {
    totals[a.category] = (totals[a.category] || 0) + durationHours(a.start, a.end);
  });
  return totals;
}

function totalHours(activities) {
  return activities.reduce((sum, a) => sum + durationHours(a.start, a.end), 0);
}

/**
 * Average hours/day per category, blending the activity log with the
 * profile's stated assumptions. Sleep, work, commute, and screen time are
 * taken directly from the profile (the person told us these explicitly),
 * so editing them on the Profile page immediately moves every projection
 * that depends on this function. Every other category comes from logged
 * activity, since there's no standing assumption for it.
 */
function effectiveDailyHours(activities, profile) {
  const totals = categoryTotals(activities);
  const days = new Set(activities.map((a) => a.date)).size || 1;
  const perDay = {};
  CATEGORY_KEYS.forEach((k) => (perDay[k] = totals[k] / days));
  if (profile) {
    if (Number.isFinite(profile.avgSleep)) perDay.sleep = profile.avgSleep;
    if (Number.isFinite(profile.avgWork)) perDay.work = profile.avgWork;
    if (Number.isFinite(profile.avgCommute)) perDay.commute = profile.avgCommute;
    if (Number.isFinite(profile.avgScreenTime)) perDay.screen = profile.avgScreenTime;
  }
  return perDay;
}

/** Project annual averages (hours/week from profile+recent log) out across N years -> {hours, days, years} */
function projectYears(hoursPerYear, years) {
  const hours = hoursPerYear * years;
  return { hours, days: hours / 24, years: hours / (24 * 365.25) };
}

/** What-if: a daily delta in hours, compounded over a horizon */
function whatIf(deltaHoursPerDay, horizonYears) {
  const perYear = deltaHoursPerDay * 365.25;
  const perHorizon = perYear * horizonYears;
  return {
    perYearHours: perYear,
    perYearDays: perYear / 24,
    perHorizonDays: perHorizon / 24,
    perHorizonHours: perHorizon,
  };
}

/* -------------------------------------------------------------------------
   4. MOCK DATA GENERATION (seeded, deterministic, realistic-ish)
   ------------------------------------------------------------------------- */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDaySchedule(rand, dateObj, profile) {
  const dow = dateObj.getDay(); // 0 sun .. 6 sat
  const isWeekend = dow === 0 || dow === 6;
  const acts = [];
  const jitter = (base, spread) => base + (rand() - 0.5) * spread;

  let cursor = 0; // minutes from 00:00, we build sequentially through the day
  const push = (category, startMin, durMin, label, note) => {
    const s = Math.max(0, Math.round(startMin));
    let e = Math.round(startMin + durMin);
    if (e > 24 * 60) e = 24 * 60 - 1;
    if (e <= s) return;
    const toClock = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(
      m % 60
    ).padStart(2, "0")}`;
    acts.push({ category, start: toClock(s), end: toClock(e), label, note: note || "" });
  };

  // wake time
  const wake = isWeekend ? jitter(8 * 60, 60) : jitter(6.75 * 60, 30);
  // sleep the night before spills to 00:00 (we only log same-day 00:00->wake as "Sleep")
  push("sleep", 0, wake, "Sleep");
  cursor = wake;
  push("other", cursor, jitter(35, 15), "Morning routine");
  cursor += 35;

  if (!isWeekend) {
    push("commute", cursor, jitter(35, 15), "Commute");
    cursor += 40;
    const workStart = cursor;
    const workBlock1 = jitter(230, 30);
    push("work", workStart, workBlock1, "Work");
    cursor = workStart + workBlock1;
    push("other", cursor, 45, "Lunch");
    cursor += 45;
    const workBlock2 = jitter(240, 30);
    push("work", cursor, workBlock2, "Work");
    cursor += workBlock2;
    push("commute", cursor, jitter(35, 15), "Commute");
    cursor += 40;
    const doExercise = rand() < 0.55;
    if (doExercise) {
      push("exercise", cursor, jitter(50, 20), "Exercise");
      cursor += 55;
    }
    const doFriends = rand() < 0.25;
    if (doFriends) {
      push("friends", cursor, jitter(90, 30), "Friends");
      cursor += 95;
    } else {
      const doFamily = rand() < 0.5;
      if (doFamily) {
        push("family", cursor, jitter(60, 20), "Family time");
        cursor += 65;
      }
    }
    push("other", cursor, jitter(45, 10), "Dinner");
    cursor += 45;
    const learn = rand() < 0.35;
    if (learn) {
      push("learning", cursor, jitter(50, 20), "Learning");
      cursor += 55;
    }
    const screen = jitter(95, 40);
    push("screen", cursor, screen, "Screen time");
    cursor += screen;
    const ent = jitter(55, 30);
    if (ent > 10) {
      push("entertainment", cursor, ent, "Entertainment");
      cursor += ent;
    }
  } else {
    const doFamily = rand() < 0.6;
    if (doFamily) {
      push("family", cursor, jitter(120, 40), "Family time");
      cursor += 125;
    }
    const doExercise = rand() < 0.65;
    if (doExercise) {
      push("exercise", cursor, jitter(70, 25), "Exercise");
      cursor += 75;
    }
    const doFriends = rand() < 0.5;
    if (doFriends) {
      push("friends", cursor, jitter(150, 40), "Friends");
      cursor += 155;
    }
    const doErrands = rand() < 0.5;
    if (doErrands) {
      push("other", cursor, jitter(60, 30), "Errands");
      cursor += 65;
    }
    push("other", cursor, jitter(40, 10), "Dinner");
    cursor += 40;
    const screen = jitter(120, 50);
    push("screen", cursor, screen, "Screen time");
    cursor += screen;
    const ent = jitter(90, 40);
    if (ent > 10) {
      push("entertainment", cursor, ent, "Entertainment");
      cursor += ent;
    }
    const learn = rand() < 0.3;
    if (learn) {
      push("learning", cursor, jitter(60, 20), "Learning");
      cursor += 65;
    }
  }

  const bedtime = Math.min(23 * 60 + 55, Math.max(cursor, 21 * 60));
  if (bedtime > cursor) {
    push("other", cursor, bedtime - cursor, "Wind down");
  }
  push("sleep", bedtime, 24 * 60 - bedtime, "Sleep");

  return acts
    .filter((a) => a.start !== a.end)
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
}

function generateMockActivities(profile, days = 84) {
  const rand = mulberry32(20260831);
  const activities = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let id = 1;
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const dateISO = toISODate(d);
    const schedule = buildDaySchedule(rand, d, profile);
    schedule.forEach((a) => {
      activities.push({ id: `a${id++}`, date: dateISO, ...a });
    });
  }
  return activities;
}

const DEFAULT_PROFILE = {
  birthDate: "1999-05-14",
  occupation: "Employee",
  avgSleep: 7.5,
  avgWork: 8,
  avgCommute: 0.75,
  avgScreenTime: 2.5,
  lifeExpectancy: 83,
  onboarded: true,
};

/* -------------------------------------------------------------------------
   5. SMALL UI PRIMITIVES
   ------------------------------------------------------------------------- */
function SectionHeader({ eyebrow, title, sub, right }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-5 flex-wrap">
      <div>
        {eyebrow && (
          <div style={{ color: "var(--sand)" }} className="text-xs font-medium mb-1.5">
            {eyebrow}
          </div>
        )}
        <h2 className="lih-serif" style={{ fontSize: 24, fontWeight: 560, letterSpacing: "-0.01em" }}>
          {title}
        </h2>
        {sub && (
          <p style={{ color: "var(--ink-soft)" }} className="text-sm mt-1 max-w-md">
            {sub}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

function CategoryPill({ cat }) {
  const c = CATEGORIES[cat];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-soft)" }}>
      <span className="lih-swatch" style={{ background: c.color }} />
      {c.label}
    </span>
  );
}

function StatBlock({ value, label, sub, accent }) {
  return (
    <div>
      <div
        className="lih-serif lih-num"
        style={{ fontSize: 34, lineHeight: 1, fontWeight: 500, color: accent ? "var(--sand)" : "var(--ink)" }}
      >
        {value}
      </div>
      <div className="text-xs mt-2" style={{ color: "var(--ink-soft)" }}>
        {label}
      </div>
      {sub && (
        <div className="text-xs mt-0.5" style={{ color: "var(--ink-faint)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
   6. ACTIVITY MODAL (Add / Edit)
   ------------------------------------------------------------------------- */
function ActivityModal({ initial, defaultDate, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(
    initial || {
      label: "",
      category: "other",
      start: "09:00",
      end: "10:00",
      date: defaultDate,
      note: "",
    }
  );
  const isEdit = !!initial;
  const firstRef = useRef(null);
  useEffect(() => {
    firstRef.current && firstRef.current.focus();
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const quickFill = (key) => {
    setForm((f) => ({
      ...f,
      category: key,
      label: f.label && !isEdit ? f.label : CATEGORIES[key].label,
    }));
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.label.trim()) return;
    onSave({ ...form, id: initial ? initial.id : undefined });
  };

  return (
    <div className="lih-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        onSubmit={submit}
        className="lih-card lih-modal-card"
        style={{ width: 420, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", padding: 22 }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="lih-serif" style={{ fontSize: 19 }}>
            {isEdit ? "Edit activity" : "Add activity"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="lih-btn lih-focus"
            style={{ background: "transparent", padding: 4, color: "var(--ink-soft)" }}
          >
            <X size={18} />
          </button>
        </div>

        {!isEdit && (
          <div className="mb-4">
            <div className="text-xs mb-2" style={{ color: "var(--ink-soft)" }}>
              Quick add
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_KEYS.map((k) => {
                const c = CATEGORIES[k];
                const Icon = c.icon;
                return (
                  <button
                    type="button"
                    key={k}
                    onClick={() => quickFill(k)}
                    className="lih-btn lih-focus"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: `1px solid ${form.category === k ? "transparent" : "var(--hairline)"}`,
                      background: form.category === k ? c.color : "var(--paper)",
                      color: form.category === k ? "#fff" : "var(--ink-soft)",
                    }}
                  >
                    <Icon size={12} />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs" style={{ color: "var(--ink-soft)" }}>
              Activity
            </label>
            <input
              ref={firstRef}
              className="lih-input mt-1"
              value={form.label}
              onChange={set("label")}
              placeholder="e.g. Evening run"
              required
            />
          </div>

          <div>
            <label className="text-xs" style={{ color: "var(--ink-soft)" }}>
              Category
            </label>
            <select className="lih-input mt-1" value={form.category} onChange={set("category")}>
              {CATEGORY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {CATEGORIES[k].label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs" style={{ color: "var(--ink-soft)" }}>
                Start
              </label>
              <input type="time" className="lih-input mt-1" value={form.start} onChange={set("start")} required />
            </div>
            <div>
              <label className="text-xs" style={{ color: "var(--ink-soft)" }}>
                End
              </label>
              <input type="time" className="lih-input mt-1" value={form.end} onChange={set("end")} required />
            </div>
          </div>

          <div>
            <label className="text-xs" style={{ color: "var(--ink-soft)" }}>
              Date
            </label>
            <input type="date" className="lih-input mt-1" value={form.date} onChange={set("date")} required />
          </div>

          <div>
            <label className="text-xs" style={{ color: "var(--ink-soft)" }}>
              Note <span style={{ color: "var(--ink-faint)" }}>(optional)</span>
            </label>
            <textarea className="lih-input mt-1" rows={2} value={form.note} onChange={set("note")} />
          </div>
        </div>

        <div className="flex items-center justify-between mt-5">
          <div>
            {isEdit && (
              <button
                type="button"
                onClick={() => onDelete(initial.id)}
                className="lih-btn lih-focus flex items-center gap-1.5 text-xs"
                style={{ background: "transparent", color: "var(--screen)", padding: "8px 4px" }}
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="lih-btn lih-focus text-sm"
              style={{ padding: "9px 16px", borderRadius: 999, background: "transparent", color: "var(--ink-soft)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="lih-btn lih-focus text-sm"
              style={{ padding: "9px 18px", borderRadius: 999, background: "var(--ink)", color: "var(--paper)" }}
            >
              {isEdit ? "Save changes" : "Add activity"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------
   7. LIFE PROGRESS HERO  (weeks-of-life grid + big stats)
   ------------------------------------------------------------------------- */
function WeeksGrid({ birthDate, lifeExpectancy, compact }) {
  const totalWeeks = Math.round(lifeExpectancy * 52.18);
  const weeksLived = Math.floor((Date.now() - birthDate.getTime()) / (7 * DAY_MS));
  const cols = 52;
  const rows = Math.ceil(totalWeeks / cols);
  const cell = compact ? 5 : 6.4;
  const gap = compact ? 1.4 : 1.8;
  const w = cols * (cell + gap);
  const h = rows * (cell + gap);

  const [hover, setHover] = useState(null);

  const cells = [];
  for (let i = 0; i < totalWeeks; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const lived = i < weeksLived;
    cells.push(
      <rect
        key={i}
        className="lih-week-cell"
        x={col * (cell + gap)}
        y={row * (cell + gap)}
        width={cell}
        height={cell}
        rx={1}
        fill={lived ? "var(--ink)" : "none"}
        stroke={lived ? "none" : "var(--hairline)"}
        strokeWidth={0.7}
        opacity={lived ? 0.85 : 1}
        onMouseEnter={() => setHover({ i, row, lived })}
        onMouseLeave={() => setHover(null)}
      />
    );
  }

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxWidth: w * 1.4, display: "block" }}>
        {cells}
      </svg>
      <div className="flex items-center justify-between mt-2 text-xs" style={{ color: "var(--ink-faint)" }}>
        <span>Each square is one week. {compact ? "" : `${rows} rows of 52.`}</span>
        <span>{hover ? `Year ${hover.row + 1}${hover.lived ? " · lived" : " · ahead"}` : `${weeksLived.toLocaleString()} lived`}</span>
      </div>
    </div>
  );
}

function LifeProgressHero({ profile }) {
  const birthDate = useMemo(() => parseISODate(profile.birthDate), [profile.birthDate]);
  const age = ageBreakdown(birthDate);
  const lived = hoursLived(birthDate);
  const remaining = hoursRemaining(birthDate, profile.lifeExpectancy);
  const pct = percentOfLife(birthDate, profile.lifeExpectancy);

  return (
    <div className="lih-card lih-enter" style={{ padding: "32px 30px" }}>
      <div className="grid lih-hero-grid">
        <div>
          <div style={{ color: "var(--sand)" }} className="text-xs font-medium mb-2">
            Your life
          </div>
          <div className="lih-serif" style={{ fontSize: 15, letterSpacing: "0.01em", color: "var(--ink-soft)", marginBottom: 6 }}>
            {age.years} years · {age.months} months · {age.days} days
          </div>
          <div className="lih-serif lih-num" style={{ fontSize: 46, lineHeight: 1.05, fontWeight: 500, letterSpacing: "-0.015em" }}>
            {fmtBigNumber(lived)} hours lived
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="lih-num" style={{ fontSize: 15, color: "var(--ink-soft)" }}>
              ~{fmtBigNumber(remaining)} hours remaining
            </span>
            <span className="text-xs" style={{ color: "var(--ink-faint)" }}>
              estimate
            </span>
          </div>

          <div className="mt-6" style={{ maxWidth: 360 }}>
            <div className="flex justify-between text-xs mb-1.5" style={{ color: "var(--ink-soft)" }}>
              <span>{pct.toFixed(1)}% lived, by this estimate</span>
              <span>{100 - pct < 0.1 ? "0" : (100 - pct).toFixed(1)}% ahead</span>
            </div>
            <div style={{ height: 6, borderRadius: 4, background: "var(--hairline)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "var(--sand)", borderRadius: 4 }} />
            </div>
          </div>

          <p className="text-xs mt-4" style={{ color: "var(--ink-faint)", maxWidth: 340 }}>
            Based on a life-expectancy assumption of {profile.lifeExpectancy} years, set in your profile.
            This is not a medical prediction — just a way to make the scale of a life visible.
          </p>
        </div>

        <div className="flex items-center">
          <WeeksGrid birthDate={birthDate} lifeExpectancy={profile.lifeExpectancy} />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   8. TODAY TIMELINE
   ------------------------------------------------------------------------- */
function TodayTimeline({ activities, date, onAdd, onEdit }) {
  const dayActs = activities
    .filter((a) => a.date === date)
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  const isToday = date === toISODate(new Date());

  return (
    <div className="lih-card lih-enter" style={{ padding: "26px 26px 18px" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="lih-serif" style={{ fontSize: 19 }}>
            {isToday ? "Today" : new Date(date + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-faint)" }}>
            {dayActs.length} activities logged
          </p>
        </div>
        <button
          onClick={onAdd}
          className="lih-btn lih-focus flex items-center gap-1.5 text-xs"
          style={{ padding: "8px 13px", borderRadius: 999, background: "var(--ink)", color: "var(--paper)" }}
        >
          <Plus size={13} /> Add
        </button>
      </div>

      <div style={{ maxHeight: 420, overflowY: "auto" }} className="lih-scrollhide">
        {dayActs.length === 0 && (
          <div className="text-sm py-8 text-center" style={{ color: "var(--ink-faint)" }}>
            Nothing logged yet — add your first activity.
          </div>
        )}
        {dayActs.map((a) => {
          const c = CATEGORIES[a.category];
          const Icon = c.icon;
          return (
            <button
              key={a.id}
              onClick={() => onEdit(a)}
              className="lih-btn lih-focus w-full text-left"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 6px",
                borderBottom: "1px solid var(--hairline)",
                background: "transparent",
              }}
            >
              <div style={{ width: 78, fontSize: 12, color: "var(--ink-faint)", flexShrink: 0 }}>
                {a.start}
              </div>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  background: c.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon size={13} color="#fff" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5 }}>{a.label}</div>
                <div className="text-xs" style={{ color: "var(--ink-faint)" }}>
                  {c.label} · {fmtHours(durationHours(a.start, a.end))}
                </div>
              </div>
              <ChevronRight size={14} color="var(--ink-faint)" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   9. TIME BREAKDOWN (horizontal bars, percentage of total)
   ------------------------------------------------------------------------- */
function TimeBreakdown({ activities, title, sub }) {
  const totals = categoryTotals(activities);
  const grand = totalHours(activities) || 1;
  const sorted = CATEGORY_KEYS.map((k) => ({ key: k, hours: totals[k] })).sort(
    (a, b) => b.hours - a.hours
  );
  const max = Math.max(...sorted.map((s) => s.hours), 1);

  return (
    <div className="lih-card lih-enter" style={{ padding: "26px" }}>
      <h3 className="lih-serif" style={{ fontSize: 19, marginBottom: 2 }}>
        {title || "Where is your time going?"}
      </h3>
      {sub && (
        <p className="text-xs mb-5" style={{ color: "var(--ink-faint)" }}>
          {sub}
        </p>
      )}
      <div className={sub ? "mt-1" : "mt-5"} style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        {sorted.map(({ key, hours }) => {
          const c = CATEGORIES[key];
          const pct = (hours / grand) * 100;
          return (
            <div key={key}>
              <div className="flex justify-between items-baseline mb-1">
                <CategoryPill cat={key} />
                <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                  {fmtHours(hours)} <span style={{ color: "var(--ink-faint)" }}>· {pct.toFixed(1)}%</span>
                </span>
              </div>
              <div style={{ height: 7, borderRadius: 4, background: "var(--paper)", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${(hours / max) * 100}%`,
                    background: c.color,
                    borderRadius: 4,
                    transition: "width .4s ease",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   10. WEEK PATTERNS (stacked mini bars per day)
   ------------------------------------------------------------------------- */
function WeekPatterns({ activities, weekStart }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
  const perDay = days.map((d) => {
    const iso = toISODate(d);
    const dayActs = activities.filter((a) => a.date === iso);
    return { iso, totals: categoryTotals(dayActs), total: totalHours(dayActs) };
  });
  const maxTotal = Math.max(...perDay.map((d) => d.total), 1);
  const barH = 160;

  return (
    <div className="lih-card lih-enter" style={{ padding: 26 }}>
      <h3 className="lih-serif" style={{ fontSize: 19, marginBottom: 2 }}>
        This week's patterns
      </h3>
      <p className="text-xs mb-6" style={{ color: "var(--ink-faint)" }}>
        Each column is a day, stacked by category.
      </p>
      <div className="flex items-end justify-between gap-3" style={{ height: barH }}>
        {perDay.map((d, i) => (
          <div key={d.iso} className="flex flex-col items-center" style={{ flex: 1, height: "100%" }}>
            <div
              className="flex flex-col-reverse"
              style={{
                width: "100%",
                maxWidth: 34,
                height: (d.total / maxTotal) * (barH - 26),
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              {CATEGORY_KEYS.filter((k) => d.totals[k] > 0).map((k) => (
                <div
                  key={k}
                  style={{
                    height: `${(d.totals[k] / (d.total || 1)) * 100}%`,
                    background: CATEGORIES[k].color,
                  }}
                  title={`${CATEGORIES[k].label}: ${fmtHours(d.totals[k])}`}
                />
              ))}
            </div>
            <div className="text-xs mt-2" style={{ color: "var(--ink-faint)" }}>
              {dayLabels[i]}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   11. TIME BUDGET
   ------------------------------------------------------------------------- */
const DISCRETIONARY_CATS = ["family", "friends", "exercise", "learning", "hobbies", "entertainment"];
function TimeBudget({ activities, weekStart }) {
  const days = Array.from({ length: 7 }, (_, i) => toISODate(addDays(weekStart, i)));
  const weekActs = activities.filter((a) => days.includes(a.date));
  const totals = categoryTotals(weekActs);
  const discretionaryKeys = ["family", "friends", "exercise", "learning", "entertainment"];
  const spent = discretionaryKeys.reduce((s, k) => s + totals[k], 0);
  const unplanned = Math.max(0, 42 - spent);
  const budget = Math.round(spent + unplanned);

  return (
    <div className="lih-card lih-enter" style={{ padding: 26 }}>
      <h3 className="lih-serif" style={{ fontSize: 19, marginBottom: 2 }}>
        Your time budget
      </h3>
      <p className="text-xs mb-5" style={{ color: "var(--ink-faint)" }}>
        Roughly {budget}h of discretionary time this week — hours left after sleep, work, and commute.
      </p>
      <div className="flex flex-col gap-3">
        {discretionaryKeys.map((k) => {
          const c = CATEGORIES[k];
          const h = totals[k];
          return (
            <div key={k} className="flex items-center gap-3">
              <div style={{ width: 96 }}>
                <CategoryPill cat={k} />
              </div>
              <div style={{ flex: 1, height: 6, background: "var(--paper)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, (h / budget) * 100)}%`, height: "100%", background: c.color }} />
              </div>
              <div style={{ width: 40, textAlign: "right", fontSize: 12.5, color: "var(--ink-soft)" }}>
                {fmtHours(h)}
              </div>
            </div>
          );
        })}
        <div className="flex items-center gap-3">
          <div style={{ width: 96, fontSize: 12, color: "var(--ink-faint)" }}>Unplanned</div>
          <div style={{ flex: 1, height: 6, background: "var(--paper)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, (unplanned / budget) * 100)}%`, height: "100%", background: "var(--hairline)" }} />
          </div>
          <div style={{ width: 40, textAlign: "right", fontSize: 12.5, color: "var(--ink-soft)" }}>
            {fmtHours(unplanned)}
          </div>
        </div>
      </div>
      <p className="text-xs mt-5" style={{ color: "var(--ink-faint)" }}>
        Time is the one resource you can't earn back. This is just a mirror, not a scoreboard.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------
   12. WHAT IF? SIMULATOR
   ------------------------------------------------------------------------- */
const WHAT_IF_PRESETS = [
  { key: "screen-1", label: "Screen time −1 hour/day", delta: -1, cat: "screen" },
  { key: "sleep+30", label: "Sleep +30 min/day", delta: 0.5, cat: "sleep" },
  { key: "exercise+30", label: "Exercise +30 min/day", delta: 0.5, cat: "exercise" },
  { key: "learning+1", label: "Learning +1 hour/day", delta: 1, cat: "learning" },
  { key: "work-1", label: "Work −1 hour/day", delta: -1, cat: "work" },
  { key: "commute-30", label: "Commute −30 min/day", delta: -0.5, cat: "commute" },
];

function WhatIfSimulator() {
  const [active, setActive] = useState(WHAT_IF_PRESETS[0]);
  const [customDelta, setCustomDelta] = useState(active.delta);
  const [horizon, setHorizon] = useState(20);

  useEffect(() => {
    setCustomDelta(active.delta);
  }, [active]);

  const result = whatIf(customDelta, horizon);
  const c = CATEGORIES[active.cat];

  return (
    <div className="lih-card lih-enter" style={{ padding: 26 }}>
      <h3 className="lih-serif" style={{ fontSize: 19, marginBottom: 2 }}>
        What if?
      </h3>
      <p className="text-xs mb-5" style={{ color: "var(--ink-faint)" }}>
        Small daily changes compound. Try one on for size.
      </p>

      <div className="flex flex-wrap gap-1.5 mb-5">
        {WHAT_IF_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setActive(p)}
            className={`lih-tab lih-focus ${active.key === p.key ? "active" : ""}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <span className="lih-swatch" style={{ background: c.color, width: 10, height: 10 }} />
        <input
          type="range"
          min={-3}
          max={3}
          step={0.25}
          value={customDelta}
          onChange={(e) => setCustomDelta(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: "var(--sand)" }}
        />
        <span style={{ width: 92, textAlign: "right", fontSize: 13, color: "var(--ink-soft)" }}>
          {customDelta > 0 ? "+" : ""}
          {customDelta}h / day
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <StatBlock value={`${result.perYearHours > 0 ? "+" : ""}${fmtBigNumber(result.perYearHours)}`} label="hours / year" accent />
        <StatBlock value={`${result.perYearDays > 0 ? "+" : ""}${result.perYearDays.toFixed(0)}`} label="days / year" />
        <StatBlock
          value={`${result.perHorizonDays > 0 ? "+" : ""}${fmtBigNumber(result.perHorizonDays)}`}
          label={`days over ${horizon} years`}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs" style={{ color: "var(--ink-faint)" }}>
          Horizon
        </span>
        {[5, 10, 20, 30].map((y) => (
          <button
            key={y}
            onClick={() => setHorizon(y)}
            className={`lih-tab lih-focus ${horizon === y ? "active" : ""}`}
            style={{ padding: "4px 11px" }}
          >
            {y}y
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   13. FUTURE PROJECTION ("If nothing changes...")
   ------------------------------------------------------------------------- */
function ProjectionSection({ activities, profile }) {
  const [years, setYears] = useState(30);
  const hoursPerDay = effectiveDailyHours(activities, profile);

  const projected = CATEGORY_KEYS.map((k) => ({
    key: k,
    ...projectYears(hoursPerDay[k] * 365.25, years),
  })).sort((a, b) => b.years - a.years);

  return (
    <div className="lih-card lih-enter" style={{ padding: 26 }}>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <h3 className="lih-serif" style={{ fontSize: 19, marginBottom: 2 }}>
            If nothing changes…
          </h3>
          <p className="text-xs" style={{ color: "var(--ink-faint)", maxWidth: 420 }}>
            A projection, not a prediction — sleep, work, commute, and screen time follow your profile
            assumptions; everything else follows your recent logs.
          </p>
        </div>
        <div className="flex gap-1.5">
          {[10, 20, 30].map((y) => (
            <button
              key={y}
              onClick={() => setYears(y)}
              className={`lih-tab lih-focus ${years === y ? "active" : ""}`}
            >
              {y} years
            </button>
          ))}
        </div>
      </div>

      <div className="grid lih-grid-stats gap-x-6 gap-y-5">
        {projected.slice(0, 6).map((p) => {
          const c = CATEGORIES[p.key];
          return (
            <div key={p.key}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="lih-swatch" style={{ background: c.color }} />
                <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                  {c.label}
                </span>
              </div>
              <div className="lih-serif" style={{ fontSize: 26, fontWeight: 500 }}>
                {p.years >= 1 ? `${p.years.toFixed(1)}y` : `${Math.round(p.days)}d`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   14. LIFE WRAPPED
   ------------------------------------------------------------------------- */
function LifeWrapped({ activities, profile }) {
  const year = new Date().getFullYear();
  const perDay = effectiveDailyHours(activities, profile);
  const annualize = (key) => perDay[key] * 365.25;

  const dayTotals = {};
  activities.forEach((a) => {
    const dow = new Date(a.date + "T00:00").getDay();
    dayTotals[dow] = (dayTotals[dow] || 0) + durationHours(a.start, a.end);
  });
  const dowNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const mostActiveDow = Object.entries(dayTotals).sort((a, b) => b[1] - a[1])[0];

  const lateNight = activities.filter((a) => timeToMinutes(a.start) >= 22 * 60 || timeToMinutes(a.start) < 3 * 60);
  const lateNightTotals = categoryTotals(lateNight);
  const mostCommonLate = Object.entries(lateNightTotals).sort((a, b) => b[1] - a[1])[0];

  const insights = [
    mostActiveDow && `Your most active day tends to be ${dowNames[mostActiveDow[0]]}.`,
    mostCommonLate && mostCommonLate[1] > 0 && `Your most common activity after 10 PM is ${CATEGORIES[mostCommonLate[0]].label.toLowerCase()}.`,
    `You're on pace to spend about ${fmtHours(annualize("exercise"))} exercising this year.`,
    `Screen time is running near ${fmtHours(annualize("screen"))} for the year, based on your profile assumption.`,
  ].filter(Boolean);

  const wrappedCats = ["sleep", "work", "screen", "exercise", "commute", "learning"];
  const peopleCats = ["family", "friends"];
  const withPeople = peopleCats.reduce((s, k) => s + annualize(k), 0);

  return (
    <div
      className="lih-card lih-enter"
      style={{
        padding: "32px 30px",
        background: "radial-gradient(circle at 15% -20%, #3a4a3f 0%, transparent 55%), linear-gradient(160deg, #2c2e26 0%, #1c1d17 60%, #17180f 100%)",
        color: "var(--paper)",
        border: "none",
        boxShadow: "0 1px 2px rgba(20,20,15,0.2), 0 20px 44px -20px rgba(20,20,15,0.55)",
      }}
    >
      <div style={{ color: "var(--sand-soft)" }} className="text-xs font-medium mb-2">
        Life Wrapped
      </div>
      <h3 className="lih-serif" style={{ fontSize: 30, marginBottom: 4 }}>
        Your {year}
      </h3>
      <p className="text-sm mb-6" style={{ color: "rgba(242,239,231,0.65)" }}>
        {fmtBigNumber(8760)} hours in the year. Here's the shape of yours, projected from your current pace.
      </p>

      <div className="grid lih-grid-stats gap-x-6 gap-y-5 mb-7">
        {wrappedCats.map((k) => (
          <div key={k}>
            <div className="text-xs mb-1" style={{ color: "rgba(242,239,231,0.55)" }}>
              {CATEGORIES[k].label.toLowerCase()}
            </div>
            <div className="lih-serif lih-num" style={{ fontSize: 24 }}>
              {fmtBigNumber(annualize(k))}h
            </div>
          </div>
        ))}
        <div>
          <div className="text-xs mb-1" style={{ color: "rgba(242,239,231,0.55)" }}>
            with people you love
          </div>
          <div className="lih-serif lih-num" style={{ fontSize: 24, color: "var(--sand-soft)" }}>
            {fmtBigNumber(withPeople)}h
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5" style={{ borderTop: "1px solid rgba(242,239,231,0.15)", paddingTop: 18 }}>
        {insights.map((line, i) => (
          <div key={i} className="text-sm flex items-start gap-2">
            <Sparkles size={14} style={{ marginTop: 2, flexShrink: 0, color: "var(--sand-soft)" }} />
            <span style={{ color: "rgba(242,239,231,0.9)" }}>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   15. LIFE CLOCK (zoomable visualization)
   ------------------------------------------------------------------------- */
const ZOOM_LEVELS = ["Life", "Year", "Month", "Week", "Day", "Hour"];

function LifeClockLife({ profile }) {
  const birthDate = parseISODate(profile.birthDate);
  return (
    <div>
      <p className="text-sm mb-5" style={{ color: "var(--ink-soft)", maxWidth: 480 }}>
        {profile.lifeExpectancy * 52} weeks, by assumption. Each filled square is one you've lived.
      </p>
      <WeeksGrid birthDate={birthDate} lifeExpectancy={profile.lifeExpectancy} />
    </div>
  );
}

function LifeClockYear({ activities }) {
  const year = new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, m) => {
    const monthActs = activities.filter((a) => {
      const d = parseISODate(a.date);
      return d.getFullYear() === year && d.getMonth() === m;
    });
    return { m, totals: categoryTotals(monthActs), total: totalHours(monthActs) };
  });
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const maxTotal = Math.max(...months.map((m) => m.total), 1);

  return (
    <div>
      <p className="text-sm mb-5" style={{ color: "var(--ink-soft)" }}>
        {year}, month by month. Bar height reflects logged hours; color shows the mix.
      </p>
      <div className="flex items-end gap-2.5" style={{ height: 180 }}>
        {months.map((mo) => (
          <div key={mo.m} className="flex flex-col items-center" style={{ flex: 1, height: "100%" }}>
            <div
              className="flex flex-col-reverse w-full"
              style={{
                height: mo.total ? (mo.total / maxTotal) * 150 : 2,
                borderRadius: 3,
                overflow: "hidden",
                background: mo.total ? "transparent" : "var(--hairline)",
              }}
            >
              {CATEGORY_KEYS.filter((k) => mo.totals[k] > 0).map((k) => (
                <div key={k} style={{ height: `${(mo.totals[k] / (mo.total || 1)) * 100}%`, background: CATEGORIES[k].color }} />
              ))}
            </div>
            <div className="text-xs mt-2" style={{ color: "var(--ink-faint)" }}>
              {monthNames[mo.m]}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LifeClockMonth({ activities, monthDate }) {
  const y = monthDate.getFullYear();
  const m = monthDate.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const firstDow = new Date(y, m, 1).getDay();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const dominantCategory = (dateISO) => {
    const dayActs = activities.filter((a) => a.date === dateISO);
    if (!dayActs.length) return null;
    const totals = categoryTotals(dayActs);
    return Object.entries(totals)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
  };

  return (
    <div>
      <p className="text-sm mb-5" style={{ color: "var(--ink-soft)" }}>
        {monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })} — each day tinted by its dominant activity.
      </p>
      <div className="grid grid-cols-7 gap-2">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-xs text-center" style={{ color: "var(--ink-faint)" }}>
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const iso = toISODate(new Date(y, m, d));
          const dom = dominantCategory(iso);
          return (
            <div
              key={i}
              title={dom ? CATEGORIES[dom].label : "No data"}
              style={{
                aspectRatio: "1",
                borderRadius: 6,
                background: dom ? CATEGORIES[dom].color : "var(--hairline)",
                opacity: dom ? 0.85 : 0.5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                color: dom ? "#fff" : "var(--ink-faint)",
              }}
            >
              {d}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LifeClockWeek({ activities, weekStart }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div>
      <p className="text-sm mb-5" style={{ color: "var(--ink-soft)" }}>
        Week of {weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} — each column is 24 hours, top to bottom.
      </p>
      <div className="flex gap-2" style={{ height: 340 }}>
        {days.map((d) => {
          const iso = toISODate(d);
          const dayActs = activities.filter((a) => a.date === iso).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
          return (
            <div key={iso} className="flex flex-col items-center" style={{ flex: 1, height: "100%" }}>
              <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 5, overflow: "hidden", background: "var(--paper)" }}>
                {dayActs.map((a) => {
                  const top = (timeToMinutes(a.start) / 1440) * 100;
                  const h = (durationHours(a.start, a.end) / 24) * 100;
                  return (
                    <div
                      key={a.id}
                      title={`${a.label} (${a.start}-${a.end})`}
                      style={{
                        position: "absolute",
                        top: `${top}%`,
                        height: `${h}%`,
                        width: "100%",
                        background: CATEGORIES[a.category].color,
                        opacity: 0.9,
                      }}
                    />
                  );
                })}
              </div>
              <div className="text-xs mt-2" style={{ color: "var(--ink-faint)" }}>
                {d.toLocaleDateString(undefined, { weekday: "narrow" })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LifeClockDay({ activities, date }) {
  const dayActs = activities.filter((a) => a.date === date).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  const size = 300;
  const cx = size / 2,
    cy = size / 2,
    rOuter = size / 2 - 6,
    rInner = rOuter - 34;

  const arcPath = (startMin, endMin) => {
    const a1 = (startMin / 1440) * 2 * Math.PI - Math.PI / 2;
    const a2 = (endMin / 1440) * 2 * Math.PI - Math.PI / 2;
    const large = endMin - startMin > 720 ? 1 : 0;
    const p1o = [cx + rOuter * Math.cos(a1), cy + rOuter * Math.sin(a1)];
    const p2o = [cx + rOuter * Math.cos(a2), cy + rOuter * Math.sin(a2)];
    const p1i = [cx + rInner * Math.cos(a2), cy + rInner * Math.sin(a2)];
    const p2i = [cx + rInner * Math.cos(a1), cy + rInner * Math.sin(a1)];
    return `M ${p1o[0]} ${p1o[1]} A ${rOuter} ${rOuter} 0 ${large} 1 ${p2o[0]} ${p2o[1]} L ${p1i[0]} ${p1i[1]} A ${rInner} ${rInner} 0 ${large} 0 ${p2i[0]} ${p2i[1]} Z`;
  };

  return (
    <div>
      <p className="text-sm mb-5" style={{ color: "var(--ink-soft)" }}>
        24 hours as a clock face, starting at midnight.
      </p>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="var(--hairline)" strokeWidth={1} />
        {dayActs.map((a) => (
          <path key={a.id} d={arcPath(timeToMinutes(a.start), timeToMinutes(a.end) || 1440)} fill={CATEGORIES[a.category].color} opacity={0.9} />
        ))}
        {[0, 6, 12, 18].map((h) => {
          const a = (h / 24) * 2 * Math.PI - Math.PI / 2;
          const x = cx + (rOuter + 14) * Math.cos(a);
          const y = cy + (rOuter + 14) * Math.sin(a);
          return (
            <text key={h} x={x} y={y} fontSize={10} fill="var(--ink-faint)" textAnchor="middle" dominantBaseline="middle">
              {h === 0 ? "12am" : h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function LifeClockHour({ activities, date }) {
  const dayActs = activities.filter((a) => a.date === date).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  const [hour, setHour] = useState(dayActs.length ? Math.floor(timeToMinutes(dayActs[0].start) / 60) : 9);
  const hourStart = hour * 60,
    hourEnd = hourStart + 60;
  const segments = dayActs
    .map((a) => ({
      ...a,
      s: Math.max(timeToMinutes(a.start), hourStart),
      e: Math.min(timeToMinutes(a.end) || 1440, hourEnd),
    }))
    .filter((a) => a.e > a.s);

  return (
    <div>
      <p className="text-sm mb-4" style={{ color: "var(--ink-soft)" }}>
        Zooming into a single hour of {date}.
      </p>
      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => setHour((h) => Math.max(0, h - 1))} className="lih-btn lih-focus" style={{ background: "var(--paper)", padding: 6, borderRadius: 8 }}>
          <ChevronLeft size={14} />
        </button>
        <div className="lih-serif" style={{ fontSize: 20, width: 90, textAlign: "center" }}>
          {String(hour).padStart(2, "0")}:00
        </div>
        <button onClick={() => setHour((h) => Math.min(23, h + 1))} className="lih-btn lih-focus" style={{ background: "var(--paper)", padding: 6, borderRadius: 8 }}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div style={{ height: 46, borderRadius: 8, overflow: "hidden", display: "flex", background: "var(--paper)" }}>
        {segments.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--ink-faint)" }}>
            No logged activity this hour
          </div>
        )}
        {segments.map((s) => (
          <div
            key={s.id}
            title={s.label}
            style={{ width: `${((s.e - s.s) / 60) * 100}%`, background: CATEGORIES[s.category].color }}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs mt-1.5" style={{ color: "var(--ink-faint)" }}>
        <span>:00</span>
        <span>:15</span>
        <span>:30</span>
        <span>:45</span>
        <span>:60</span>
      </div>
    </div>
  );
}

function LifeClockPage({ profile, activities }) {
  const [zoom, setZoom] = useState("Day");
  const today = toISODate(new Date());
  const weekStart = startOfWeek(new Date());

  return (
    <div className="lih-enter">
      <SectionHeader eyebrow="Life Clock" title="Zoom through time" sub="From a whole life down to a single hour — the same hours, at different scales." />
      <div className="flex flex-wrap gap-1.5 mb-6">
        {ZOOM_LEVELS.map((z) => (
          <button key={z} onClick={() => setZoom(z)} className={`lih-tab lih-focus ${zoom === z ? "active" : ""}`}>
            {z}
          </button>
        ))}
      </div>
      <div className="lih-card" style={{ padding: 28 }}>
        {zoom === "Life" && <LifeClockLife profile={profile} />}
        {zoom === "Year" && <LifeClockYear activities={activities} />}
        {zoom === "Month" && <LifeClockMonth activities={activities} monthDate={new Date()} />}
        {zoom === "Week" && <LifeClockWeek activities={activities} weekStart={weekStart} />}
        {zoom === "Day" && <LifeClockDay activities={activities} date={today} />}
        {zoom === "Hour" && <LifeClockHour activities={activities} date={today} />}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-5">
        {CATEGORY_KEYS.map((k) => (
          <CategoryPill key={k} cat={k} />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   16. PAGES: HOME
   ------------------------------------------------------------------------- */
function timeOfDayGreeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

function HomePage({ profile, activities, openAdd, openEdit }) {
  const today = toISODate(new Date());
  const recentActs = useMemo(() => {
    const cutoff = toISODate(addDays(new Date(), -28));
    return activities.filter((a) => a.date >= cutoff);
  }, [activities]);

  return (
    <div className="flex flex-col gap-6">
      <div className="lih-enter flex items-baseline justify-between flex-wrap gap-2" style={{ marginBottom: 4 }}>
        <div>
          <h1 className="lih-serif" style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.01em" }}>
            {timeOfDayGreeting()}
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--ink-soft)" }}>
            Your life, measured in hours.
          </p>
        </div>
        <div className="text-xs" style={{ color: "var(--ink-faint)" }}>
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        </div>
      </div>

      <LifeProgressHero profile={profile} />

      <div className="grid gap-6 lih-grid-2">
        <TodayTimeline activities={activities} date={today} onAdd={() => openAdd(today)} onEdit={openEdit} />
        <TimeBreakdown activities={recentActs} sub="Last 28 days of logged activity." />
      </div>

      <div className="grid gap-6 lih-grid-2">
        <WeekPatterns activities={activities} weekStart={startOfWeek(new Date())} />
        <TimeBudget activities={activities} weekStart={startOfWeek(new Date())} />
      </div>

      <WhatIfSimulator />
      <ProjectionSection activities={recentActs} profile={profile} />
    </div>
  );
}

/* -------------------------------------------------------------------------
   17. PAGES: TIMELINE (Today / Week / Month / Year / Life)
   ------------------------------------------------------------------------- */
function TimelineWeekView({ activities, weekStart, setWeekStart, openAdd, openEdit }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="lih-enter">
      <div className="flex items-center justify-between mb-5">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="lih-btn lih-focus" style={{ background: "var(--paper-raised)", border: "1px solid var(--hairline)", padding: 8, borderRadius: 8 }}>
          <ChevronLeft size={14} />
        </button>
        <div className="text-sm" style={{ color: "var(--ink-soft)" }}>
          {weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {addDays(weekStart, 6).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </div>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="lih-btn lih-focus" style={{ background: "var(--paper-raised)", border: "1px solid var(--hairline)", padding: 8, borderRadius: 8 }}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid gap-6 mb-6 lih-grid-2">
        <WeekPatterns activities={activities} weekStart={weekStart} />
        <TimeBreakdown activities={activities.filter((a) => days.map(toISODate).includes(a.date))} title="Category totals" sub="For this week." />
      </div>
      {days.map((d) => (
        <div key={toISODate(d)} className="mb-4">
          <TodayTimeline activities={activities} date={toISODate(d)} onAdd={() => openAdd(toISODate(d))} onEdit={openEdit} />
        </div>
      ))}
    </div>
  );
}

function TimelineMonthView({ activities, monthDate, setMonthDate }) {
  const monthActs = activities.filter((a) => {
    const d = parseISODate(a.date);
    return d.getFullYear() === monthDate.getFullYear() && d.getMonth() === monthDate.getMonth();
  });
  return (
    <div className="lih-enter">
      <div className="flex items-center justify-between mb-5">
        <button onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))} className="lih-btn lih-focus" style={{ background: "var(--paper-raised)", border: "1px solid var(--hairline)", padding: 8, borderRadius: 8 }}>
          <ChevronLeft size={14} />
        </button>
        <div className="text-sm" style={{ color: "var(--ink-soft)" }}>
          {monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </div>
        <button onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))} className="lih-btn lih-focus" style={{ background: "var(--paper-raised)", border: "1px solid var(--hairline)", padding: 8, borderRadius: 8 }}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid gap-6 lih-grid-2">
        <div className="lih-card" style={{ padding: 26 }}>
          <LifeClockMonth activities={activities} monthDate={monthDate} />
        </div>
        <TimeBreakdown activities={monthActs} title="What patterns are emerging?" sub={`${monthActs.length} activities logged this month.`} />
      </div>
    </div>
  );
}

function TimelineYearView({ activities }) {
  const year = new Date().getFullYear();
  const yearActs = activities.filter((a) => parseISODate(a.date).getFullYear() === year);
  return (
    <div className="lih-enter grid gap-6 lih-grid-2">
      <div className="lih-card" style={{ padding: 26 }}>
        <h3 className="lih-serif" style={{ fontSize: 19, marginBottom: 2 }}>
          What did you actually do with {year}?
        </h3>
        <p className="text-xs mb-5" style={{ color: "var(--ink-faint)" }}>
          Month-by-month, colored by category.
        </p>
        <LifeClockYear activities={activities} />
      </div>
      <TimeBreakdown activities={yearActs} title="Year totals" sub={`Based on ${yearActs.length} logged activities so far.`} />
    </div>
  );
}

function TimelineLifeView({ profile, activities }) {
  return (
    <div className="lih-enter grid gap-6 lih-grid-2">
      <LifeProgressHero profile={profile} />
      <ProjectionSection activities={activities} profile={profile} />
    </div>
  );
}

function TimelinePage({ profile, activities, openAdd, openEdit }) {
  const [tab, setTab] = useState("Today");
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));
  const [monthDate, setMonthDate] = useState(new Date());
  const today = toISODate(new Date());

  return (
    <div>
      <SectionHeader
        eyebrow="Timeline"
        title="How did your time go?"
        sub="Today, this week, this month, this year — or your whole life."
      />
      <div className="flex gap-1.5 mb-6">
        {["Today", "Week", "Month", "Year", "Life"].map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`lih-tab lih-focus ${tab === t ? "active" : ""}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Today" && (
        <div className="lih-enter" style={{ maxWidth: 560 }}>
          <TodayTimeline activities={activities} date={today} onAdd={() => openAdd(today)} onEdit={openEdit} />
        </div>
      )}
      {tab === "Week" && (
        <TimelineWeekView activities={activities} weekStart={weekStart} setWeekStart={setWeekStart} openAdd={openAdd} openEdit={openEdit} />
      )}
      {tab === "Month" && <TimelineMonthView activities={activities} monthDate={monthDate} setMonthDate={setMonthDate} />}
      {tab === "Year" && <TimelineYearView activities={activities} />}
      {tab === "Life" && <TimelineLifeView profile={profile} activities={activities} />}
    </div>
  );
}

/* -------------------------------------------------------------------------
   18. PAGES: INSIGHTS
   ------------------------------------------------------------------------- */
function InsightsPage({ profile, activities }) {
  const recentActs = useMemo(() => {
    const cutoff = toISODate(addDays(new Date(), -84));
    return activities.filter((a) => a.date >= cutoff);
  }, [activities]);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader eyebrow="Insights" title="Awareness, not obsession" sub="What your recent patterns say, and what small changes could mean over time." />
      <LifeWrapped activities={recentActs} profile={profile} />
      <div className="grid gap-6 lih-grid-2">
        <TimeBreakdown activities={recentActs} sub="Last 12 weeks." />
        <WhatIfSimulator />
      </div>
      <ProjectionSection activities={recentActs} profile={profile} />
    </div>
  );
}

/* -------------------------------------------------------------------------
   19. PAGES: PROFILE
   ------------------------------------------------------------------------- */
function ProfilePage({ profile, setProfile, showToast }) {
  const [form, setForm] = useState(profile);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Fall back to the previous saved value for any field that's empty or
  // not a valid number, rather than writing NaN into the profile.
  const numOr = (value, fallback) => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const save = (e) => {
    e.preventDefault();
    if (!form.birthDate) return;
    const next = {
      ...form,
      avgSleep: numOr(form.avgSleep, profile.avgSleep),
      avgWork: numOr(form.avgWork, profile.avgWork),
      avgCommute: numOr(form.avgCommute, profile.avgCommute),
      avgScreenTime: numOr(form.avgScreenTime, profile.avgScreenTime),
      lifeExpectancy: Math.round(numOr(form.lifeExpectancy, profile.lifeExpectancy)),
    };
    setForm(next);
    setProfile(next);
    showToast("Profile updated — your dashboard now reflects these numbers.");
  };

  return (
    <div className="lih-enter" style={{ maxWidth: 520 }}>
      <SectionHeader eyebrow="Profile" title="Your assumptions" sub="Every estimate in Life in Hours is built on these. Edit them any time." />
      <form onSubmit={save} className="lih-card flex flex-col gap-4" style={{ padding: 26 }}>
        <div>
          <label className="text-xs" style={{ color: "var(--ink-soft)" }}>
            When were you born?
          </label>
          <input type="date" className="lih-input mt-1" value={form.birthDate} onChange={set("birthDate")} />
        </div>

        <div>
          <label className="text-xs" style={{ color: "var(--ink-soft)" }}>
            What do you currently do?
          </label>
          <select className="lih-input mt-1" value={form.occupation} onChange={set("occupation")}>
            <option>Student</option>
            <option>Employee</option>
            <option>Business</option>
            <option>Other</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs" style={{ color: "var(--ink-soft)" }}>
              Average sleep / night (h)
            </label>
            <input type="number" step="0.25" className="lih-input mt-1" value={form.avgSleep} onChange={set("avgSleep")} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "var(--ink-soft)" }}>
              Average work / day (h)
            </label>
            <input type="number" step="0.25" className="lih-input mt-1" value={form.avgWork} onChange={set("avgWork")} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "var(--ink-soft)" }}>
              Average commute / day (h)
            </label>
            <input type="number" step="0.25" className="lih-input mt-1" value={form.avgCommute} onChange={set("avgCommute")} />
          </div>
          <div>
            <label className="text-xs" style={{ color: "var(--ink-soft)" }}>
              Average screen time / day (h)
            </label>
            <input type="number" step="0.25" className="lih-input mt-1" value={form.avgScreenTime} onChange={set("avgScreenTime")} />
          </div>
        </div>

        <div>
          <label className="text-xs flex items-center gap-1.5" style={{ color: "var(--ink-soft)" }}>
            Life expectancy assumption (years) <Info size={12} />
          </label>
          <input type="number" className="lih-input mt-1" value={form.lifeExpectancy} onChange={set("lifeExpectancy")} />
          <p className="text-xs mt-1.5" style={{ color: "var(--ink-faint)" }}>
            Used only to estimate remaining hours — never shown as a certainty.
          </p>
        </div>

        <div style={{ background: "var(--paper)", borderRadius: 10, padding: "12px 14px" }}>
          <p className="text-xs" style={{ color: "var(--ink-faint)", lineHeight: 1.5 }}>
            Birth date and life expectancy update your hours lived, hours remaining, and the Life Clock right
            away. Sleep, work, commute, and screen time flow into the projections on Home and Insights, and
            into Life Wrapped.
          </p>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <button
            type="submit"
            className="lih-btn lih-focus text-sm"
            style={{ padding: "10px 20px", borderRadius: 999, background: "var(--ink)", color: "var(--paper)" }}
          >
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------
   20. ONBOARDING
   ------------------------------------------------------------------------- */
function Onboarding({ onComplete, initialData, onCancel }) {
  const isRedo = !!initialData;
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(
    initialData ? { ...initialData } : { ...DEFAULT_PROFILE, birthDate: "" }
  );
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const steps = [
    {
      title: "When were you born?",
      body: (
        <input type="date" className="lih-input" value={form.birthDate} onChange={set("birthDate")} autoFocus />
      ),
      valid: !!form.birthDate,
    },
    {
      title: "What do you currently do?",
      body: (
        <div className="flex flex-wrap gap-2">
          {["Student", "Employee", "Business", "Other"].map((o) => (
            <button
              type="button"
              key={o}
              onClick={() => setForm((f) => ({ ...f, occupation: o }))}
              className={`lih-tab lih-focus ${form.occupation === o ? "active" : ""}`}
              style={{ padding: "9px 16px" }}
            >
              {o}
            </button>
          ))}
        </div>
      ),
      valid: true,
    },
    {
      title: "Average sleep per night?",
      body: <input type="number" step="0.25" className="lih-input" value={form.avgSleep} onChange={set("avgSleep")} />,
      valid: true,
    },
    {
      title: "Average working hours per day?",
      body: <input type="number" step="0.25" className="lih-input" value={form.avgWork} onChange={set("avgWork")} />,
      valid: true,
    },
    {
      title: "Average commute per day?",
      body: <input type="number" step="0.25" className="lih-input" value={form.avgCommute} onChange={set("avgCommute")} />,
      valid: true,
    },
    {
      title: "How much screen time do you usually have?",
      body: <input type="number" step="0.25" className="lih-input" value={form.avgScreenTime} onChange={set("avgScreenTime")} />,
      valid: true,
    },
  ];

  const cur = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="lih-root" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="lih-card lih-enter" style={{ width: 440, maxWidth: "100%", padding: 34, position: "relative" }}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel and return"
            className="lih-btn lih-focus"
            style={{
              position: "absolute",
              top: 18,
              right: 18,
              background: "transparent",
              color: "var(--ink-faint)",
              padding: 4,
            }}
          >
            <X size={17} />
          </button>
        )}
        <div style={{ color: "var(--sand)" }} className="text-xs font-medium mb-2">
          {isRedo ? "Update your details" : "Life in Hours"} · {step + 1} of {steps.length}
        </div>
        <h2 className="lih-serif" style={{ fontSize: 24, marginBottom: 20 }}>
          {cur.title}
        </h2>
        <div className="mb-8">{cur.body}</div>

        {last && (
          <p className="text-xs mb-6" style={{ color: "var(--ink-faint)" }}>
            {isRedo
              ? "We'll use this to refresh how your life looks across the dashboard. Nothing you've logged will be lost."
              : "We'll use this information to create your first picture of how you're spending your life. You can edit everything later from your profile."}
          </p>
        )}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="lih-btn lih-focus text-sm"
            style={{ padding: "9px 14px", background: "transparent", color: "var(--ink-soft)", opacity: step === 0 ? 0.3 : 1 }}
          >
            Back
          </button>
          <button
            type="button"
            disabled={!cur.valid}
            onClick={() => (last ? onComplete({ ...form, onboarded: true }) : setStep((s) => s + 1))}
            className="lih-btn lih-focus text-sm flex items-center gap-1.5"
            style={{
              padding: "10px 18px",
              borderRadius: 999,
              background: "var(--ink)",
              color: "var(--paper)",
              opacity: cur.valid ? 1 : 0.4,
            }}
          >
            {last ? (isRedo ? "Update my life" : "See my life") : "Continue"} <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   TOAST
   ------------------------------------------------------------------------- */
function Toast({ message, visible }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="lih-toast"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(-50%) translateY(0)" : "translateX(-50%) translateY(8px)",
        pointerEvents: "none",
      }}
    >
      <Sparkles size={13} style={{ color: "var(--sand-soft)", flexShrink: 0 }} />
      <span>{message}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------
   21. APP SHELL
   ------------------------------------------------------------------------- */
const NAV_ITEMS = [
  { key: "home", label: "Home", icon: HomeIcon },
  { key: "timeline", label: "Timeline", icon: Clock },
  { key: "insights", label: "Insights", icon: BarChart3 },
  { key: "clock", label: "Life Clock", icon: CircleDot },
  { key: "profile", label: "Profile", icon: User },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [profile, setProfileState] = useState(DEFAULT_PROFILE);
  const [activities, setActivities] = useState([]);
  const [page, setPage] = useState("home");
  const [modal, setModal] = useState(null); // { mode: 'add'|'edit', date, activity }
  const [toast, setToast] = useState({ message: "", visible: false });
  const [showOnboarding, setShowOnboarding] = useState(false);
  const toastTimer = useRef(null);

  const showToast = useCallback((message) => {
    setToast({ message, visible: true });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToast((t) => ({ ...t, visible: false }));
    }, 2800);
  }, []);

  // Load persisted data (falls back to generated mock data)
  useEffect(() => {
    (async () => {
      let loadedProfile = null;
      let loadedActs = null;
      try {
        const p = await storageGet("profile");
        if (p?.value) loadedProfile = JSON.parse(p.value);
      } catch (e) {}
      try {
        const a = await storageGet("activities");
        if (a?.value) loadedActs = JSON.parse(a.value);
      } catch (e) {}

      const finalProfile = loadedProfile || DEFAULT_PROFILE;
      setProfileState(finalProfile);
      setActivities(loadedActs || generateMockActivities(finalProfile));
      setReady(true);
    })();
  }, []);

  const persistProfile = useCallback(async (next) => {
    setProfileState(next);
    try {
      await storageSet("profile", JSON.stringify(next));
    } catch (e) {}
  }, []);

  const persistActivities = useCallback(async (next) => {
    setActivities(next);
    try {
      await storageSet("activities", JSON.stringify(next));
    } catch (e) {}
  }, []);

  const openAdd = (date) => setModal({ mode: "add", date });
  const openEdit = (activity) => setModal({ mode: "edit", activity });
  const closeModal = () => setModal(null);

  const saveActivity = (form) => {
    if (form.id) {
      persistActivities(activities.map((a) => (a.id === form.id ? { ...a, ...form } : a)));
    } else {
      const id = "u" + Date.now();
      persistActivities([...activities, { ...form, id }]);
    }
    closeModal();
  };

  const deleteActivity = (id) => {
    persistActivities(activities.filter((a) => a.id !== id));
    closeModal();
  };

  if (!ready) {
    return (
      <div className="lih-root" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="text-sm" style={{ color: "var(--ink-soft)" }}>
          Loading your life…
        </div>
      </div>
    );
  }

  if (!profile.onboarded) {
    return <Onboarding onComplete={persistProfile} />;
  }

  if (showOnboarding) {
    return (
      <Onboarding
        initialData={profile}
        onComplete={(next) => {
          persistProfile(next);
          setShowOnboarding(false);
          showToast("Your details have been updated.");
        }}
        onCancel={() => setShowOnboarding(false)}
      />
    );
  }

  return (
    <div className="lih-root">
      <div className="lih-shell">
        {/* Sidebar */}
        <div className="lih-sidebar">
          <div className="lih-serif" style={{ fontSize: 17, padding: "0 10px", marginBottom: 26 }}>
            Life in Hours
          </div>
          <nav className="lih-sidebar-nav">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.key}
                  onClick={() => setPage(item.key)}
                  className={`lih-nav-item lih-focus ${page === item.key ? "active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setPage(item.key)}
                >
                  <Icon size={15} />
                  {item.label}
                </div>
              );
            })}
          </nav>
          <div style={{ marginTop: "auto", padding: "0 10px" }}>
            <p className="text-xs" style={{ color: "var(--ink-faint)", lineHeight: 1.5 }}>
              Every hour counts. Not every hour needs to be productive.
            </p>
          </div>
        </div>

        {/* Main content */}
        <div className="lih-main">
          {page === "home" && <HomePage profile={profile} activities={activities} openAdd={openAdd} openEdit={openEdit} />}
          {page === "timeline" && <TimelinePage profile={profile} activities={activities} openAdd={openAdd} openEdit={openEdit} />}
          {page === "insights" && <InsightsPage profile={profile} activities={activities} />}
          {page === "clock" && <LifeClockPage profile={profile} activities={activities} />}
          {page === "profile" && <ProfilePage profile={profile} setProfile={persistProfile} showToast={showToast} />}
        </div>
      </div>

      {modal && (
        <ActivityModal
          initial={modal.mode === "edit" ? modal.activity : null}
          defaultDate={modal.date}
          onSave={saveActivity}
          onDelete={deleteActivity}
          onClose={closeModal}
        />
      )}

      <Toast message={toast.message} visible={toast.visible} />

      <button
        type="button"
        onClick={() => setShowOnboarding(true)}
        className="lih-btn lih-focus lih-onboard-fab"
        aria-label="Redo onboarding and update your details"
        title="Redo onboarding"
      >
        <RotateCcw size={13} />
        <span>Retake setup</span>
      </button>
    </div>
  );
}
