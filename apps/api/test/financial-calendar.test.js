const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { period, date } = require("../src/financial-calendar");
test("E/F: weekly, 14, 10 and arbitrary day/week cycles cross year boundaries", () => {
  assert.deepEqual(
    period(
      {
        unit: "weeks",
        every: 1,
        anchor: "2026-12-28",
        due_days: 2,
        due_business_days: true,
      },
      "2027-01-02",
      ["2027-01-04"],
    ),
    {
      start: "2026-12-28",
      end: "2027-01-03",
      next_start: "2027-01-04",
      due_on: "2027-01-06",
      timezone: "America/Sao_Paulo",
    },
  );
  for (const [unit, every, end] of [
    ["days", 14, "2027-01-10"],
    ["days", 10, "2027-01-06"],
    ["weeks", 2, "2027-01-10"],
  ])
    assert.equal(
      period({ unit, every, anchor: "2026-12-28" }, "2027-01-02").end,
      end,
    );
  assert.equal(
    period({ unit: "days", every: 10, anchor: "2026-12-28" }, "2027-01-07")
      .start,
    "2027-01-07",
  );
});
test("monthly and semi-monthly cuts clamp February and preserve original anchor across leap years", () => {
  const p = { unit: "months", anchor: "2024-01-01", cut_day: 31 };
  assert.equal(period(p, "2024-02-28").end, "2024-02-29");
  assert.equal(period(p, "2025-02-28").end, "2025-02-28");
  assert.equal(period({ ...p, every: 2 }, "2024-02-15").end, "2024-02-29");
  assert.equal(period({ ...p, every: 2 }, "2024-03-01").end, "2024-04-30");
  const semi = { unit: "twice_monthly", anchor: "2026-01-01", days: [15, 31] };
  assert.equal(period(semi, "2026-02-15").start, "2026-02-01");
  assert.equal(period(semi, "2026-02-16").end, "2026-02-28");
  assert.equal(period(semi, "2026-03-01").start, "2026-03-01");
  assert.equal(
    period({ ...semi, days: [30, 31] }, "2026-02-28").end,
    "2026-02-28",
  );
});
test("business-day cycle and due date skip weekends and explicitly registered holidays", () => {
  const p = {
    unit: "days",
    every: 2,
    business_days: true,
    anchor: "2026-10-09",
    due_days: 1,
    due_business_days: true,
  };
  const x = period(p, "2026-10-12", ["2026-10-12"]);
  assert.equal(x.end, "2026-10-13");
  assert.equal(x.next_start, "2026-10-14");
  assert.equal(x.due_on, "2026-10-14");
  assert.throws(() => date("2026-02-30"), /Data inválida/);
  assert.throws(() => period({ ...p, every: 0 }, "2026-10-12"), /Intervalo/);
});
