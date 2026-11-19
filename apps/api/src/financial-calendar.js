const { fail } = require("./errors");
const DAY = 86400000;
function date(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + "T12:00:00Z")) ||
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value
  )
    fail(400, "Data inválida. Use AAAA-MM-DD.");
  return value;
}
const stamp = (s) => Date.parse(date(s) + "T12:00:00Z");
const iso = (n) => new Date(n).toISOString().slice(0, 10);
const add = (s, n) => iso(stamp(s) + n * DAY);
const business = (s, holidays = []) =>
  ![0, 6].includes(new Date(stamp(s)).getUTCDay()) && !holidays.includes(s);
function advance(s, n, work, holidays = []) {
  let value = s;
  for (let i = 0; i < n; i++) {
    value = add(value, 1);
    while (work && !business(value, holidays)) value = add(value, 1);
  }
  return value;
}
function validatePolicy(p) {
  if (!p || !["days", "weeks", "months", "twice_monthly"].includes(p.unit))
    fail(400, "Ciclo inválido.");
  date(p.anchor);
  const every = Number(p.every ?? 1),
    due_days = Number(p.due_days || 0),
    cut_day = Number(p.cut_day || Number(p.anchor.slice(8)));
  if (
    !Number.isInteger(every) ||
    every < 1 ||
    every > 366 ||
    !Number.isInteger(due_days) ||
    due_days < 0 ||
    due_days > 365 ||
    !Number.isInteger(cut_day) ||
    cut_day < 1 ||
    cut_day > 31
  )
    fail(400, "Intervalo, corte ou vencimento inválido.");
  const days = p.days || [15, 31];
  if (
    p.unit === "twice_monthly" &&
    (!Array.isArray(days) ||
      days.length !== 2 ||
      days.some((n) => !Number.isInteger(n) || n < 1 || n > 31) ||
      days[0] >= days[1])
  )
    fail(400, "Informe dois dias de corte distintos e crescentes.");
  return {
    unit: p.unit,
    anchor: p.anchor,
    every,
    due_days,
    cut_day,
    days,
    business_days: p.business_days === true,
    due_business_days: p.due_business_days === true,
  };
}
function monthDay(anchor, offset, day) {
  const d = new Date(stamp(anchor));
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d.getTime());
}
function period(policy, on, holidays = []) {
  const p = validatePolicy(policy);
  date(on);
  if (on < p.anchor) fail(400, "Data anterior à referência do ciclo.");
  let start = p.anchor,
    end,
    next;
  if (p.unit === "days" || p.unit === "weeks") {
    const n = p.every * (p.unit === "weeks" ? 7 : 1);
    if (!p.business_days || p.unit === "weeks") {
      const index = Math.floor((stamp(on) - stamp(start)) / (n * DAY));
      start = add(start, index * n);
      next = add(start, n);
      end = add(next, -1);
    } else {
      for (let i = 0; i < 50000; i++) {
        next = advance(start, n, true, holidays);
        end = add(next, -1);
        if (on <= end) break;
        start = next;
      }
    }
  } else {
    // Month and semi-month cuts are inclusive; the next cycle starts the following day.
    const d = new Date(stamp(on)),
      a = new Date(stamp(p.anchor));
    const diff =
      (d.getUTCFullYear() - a.getUTCFullYear()) * 12 +
      d.getUTCMonth() -
      a.getUTCMonth();
    let cuts = [];
    const firstMonth =
      (monthDay(p.anchor, 0, p.cut_day) < p.anchor ? 1 : 0) + p.every - 1;
    const radius = p.unit === "months" ? p.every : 1;
    for (
      let i = Math.max(0, Math.floor(diff / radius) * radius - radius);
      i <= diff + radius + 1;
      i++
    ) {
      if (
        p.unit === "months" &&
        (i < firstMonth || (i - firstMonth) % p.every !== 0)
      )
        continue;
      for (const day of p.unit === "months" ? [p.cut_day] : p.days)
        cuts.push(monthDay(p.anchor, i, day));
    }
    cuts = [...new Set(cuts)].filter((x) => x >= p.anchor).sort();
    end = cuts.find((x) => x >= on);
    const before = cuts.filter((x) => x < on).at(-1);
    start = before ? add(before, 1) : p.anchor;
    next = add(end, 1);
  }
  if (!end || start > on || end < on)
    fail(400, "Referência muito distante para calcular este ciclo.");
  let due = advance(end, p.due_days, p.due_business_days, holidays);
  while (p.due_business_days && !business(due, holidays)) due = add(due, 1);
  return {
    start,
    end,
    next_start: next,
    due_on: due,
    timezone: "America/Sao_Paulo",
  };
}
module.exports = { date, add, advance, period, validatePolicy };
