const d = require("./domain");
const { fail } = require("./errors");

function numberingDate(value = d.today()) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !d.date(value) ||
    value.startsWith("0000-")
  )
    fail(400, "Data de numeração da OS inválida.");
  return value;
}
function importNumbering(term, importedOn = d.today()) {
  return {
    date: numberingDate(term || importedOn),
    source: term ? "term" : "import_date",
  };
}
// Must run on the caller's transaction connection so reservations roll back with the OS.
async function nextOrderId(db, value = d.today()) {
  const day = numberingDate(value),
    prefix = day.replaceAll("-", "");
  let counter = await d.one(
    db,
    "UPDATE zc_order_counters SET last_value=last_value+1 WHERE day=$1::date AND last_value<4095 RETURNING last_value",
    [day],
  );
  if (!counter) {
    // Seed only on a new day, including numbered OS recovered from older backups.
    // The conflict branch also handles simultaneous first reservations.
    counter = await d.one(
      db,
      `
      INSERT INTO zc_order_counters(day,last_value)
      SELECT $1::date,COALESCE(MAX(('x'||right(id,3))::bit(12)::int),0)+1
      FROM zc_orders WHERE id ~ $2
      HAVING COALESCE(MAX(('x'||right(id,3))::bit(12)::int),0)<4095
      ON CONFLICT(day) DO UPDATE SET last_value=zc_order_counters.last_value+1
      WHERE zc_order_counters.last_value<4095
      RETURNING last_value`,
      [day, "^" + prefix + "[0-9A-F]{3}$"],
    );
  }
  if (!counter)
    fail(
      409,
      `O dia ${day.split("-").reverse().join("/")} atingiu o limite de 4095 OS (FFF). Nenhuma OS desta operação foi gravada.`,
    );
  return (
    prefix + counter.last_value.toString(16).toUpperCase().padStart(3, "0")
  );
}
module.exports = { nextOrderId, importNumbering, numberingDate };
