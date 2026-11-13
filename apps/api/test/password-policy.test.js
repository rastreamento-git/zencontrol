const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const modules = [["central", require("../src/auth")], ["stock adapter", require("../../../integrations/estoque-pro/src/auth")]];
const cases = [["Ab1!cdef",true],["Áb1!cdef",true],["Ab1€cdef",true],["Aa1!aaa",false],["abcdef1!",false],["ABCDEF1!",false],["Abcdefg!",false],["Abcdefg1",false],["Abcdef1 ",false],["ab1!defghijklmnop",false]];
for (const [name, auth] of modules) {
  test(name + ": password requires 8–128 characters and all four character classes", () => {
    for (const [value, accepted] of cases) {
      if (accepted) assert.equal(auth.password(value), value);
      else assert.throws(() => auth.password(value), /8 a 128/);
    }
    for (const value of [null, undefined, 12345678, "", "Aa1!" + "x".repeat(125)])
      assert.throws(() => auth.password(value));
    assert.equal(auth.password("Aa1!" + "x".repeat(124)).length, 128);
  });
  test(name + ": exactly eight characters can be hashed and used to authenticate", async () => {
    const hash = await auth.hashPassword("Ab1!cdef");
    assert.equal(await auth.checkPassword("Ab1!cdef", hash), true);
    assert.equal(await auth.checkPassword("Ab1!cdeg", hash), false);
    await assert.rejects(auth.hashPassword("abcdefgh"));
  });
}
test("browser constraints agree with server policy and do not treat whitespace as a symbol", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../../packages/ui/src/lib/password-policy.js"), "utf8");
  const line = source.split("\n").find((line) => line.trim().startsWith("pattern:"));
  const pattern = JSON.parse(line.trim().slice("pattern:".length).replace(/,$/, "").trim());
  const rule = new RegExp("^(?:" + pattern + ")$", "v");
  assert.match(source, /minLength: 8/);
  assert.match(source, /maxLength: 128/);
  for (const [value, accepted] of cases)
    assert.equal(value.length >= 8 && value.length <= 128 && rule.test(value), accepted, value);
});
