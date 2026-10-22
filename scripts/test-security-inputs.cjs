const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const safety = require("../marble-roulette/roulette-input-safety.js");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "marble-roulette/index.html"), "utf8");

test("ordinary and weighted entries preserve their exact engine inputs", () => {
  for (const names of [[], ["[테스트용] 생선"], ["[테스트용] A/2*3", "[테스트용] B*2"], ["[테스트용]*500"]]) {
    assert.equal(safety.validateNames(names), names);
  }
});

test("untrusted counts, aggregate sizes, names and weights cannot reach engine allocation", () => {
  const invalid = [
    ["[테스트용]*10000000000"], ["[테스트용]*" + "9".repeat(400)],
    ["[테스트용]*501"], ["[테스트용]*250", "[테스트용] B*251"],
    Array(501).fill("[테스트용]"), ["[테스트용]/" + "9".repeat(400)],
    ["[테스트용]/100001"], ["[테스트용]/0"], ["[테스트용]*0"],
    ["/2"], ["*2"], ["[테스트용]".repeat(40)], [null], {},
  ];
  let resetsOrAllocations = 0;
  const engine = { setMarbles() { resetsOrAllocations++; }, getCount: () => 0 };
  safety.install(engine);
  for (const names of invalid) assert.throws(() => engine.setMarbles(names));
  assert.equal(resetsOrAllocations, 0);
  const normal = ["[테스트용] A/2*3", "[테스트용] B*2"];
  engine.setMarbles(normal);
  assert.equal(resetsOrAllocations, 1);
});

test("installation is idempotent and preserves the original receiver and return value", () => {
  const engine = { value: 12, setMarbles(names) { assert.equal(this, engine); return this.value + names.length; } };
  safety.install(engine);
  const wrapped = engine.setMarbles;
  safety.install(engine);
  assert.equal(engine.setMarbles, wrapped);
  assert.equal(engine.setMarbles(["[테스트용]"]), 13);
});

test("game UI rejects a malicious shared-link input, disables Start and can recover", () => {
  const input = { value: "[테스트용]*10000000000", setCustomValidity(value) { this.validity = value; } };
  const status = { textContent: "" };
  const source = html.slice(html.indexOf("function getNames()"), html.indexOf("function setWinnerRank("));
  const calls = [], storage = [];
  const roulette = { setMarbles: names => calls.push(names), getCount: () => 4 };
  safety.install(roulette);
  const context = vm.createContext({
    document: { querySelector: selector => selector === "#in_names" ? input : status },
    RouletteInputSafety: safety, window: { roulette }, localStorage: { setItem: (...args) => storage.push(args) },
    ready: true, winnerType: "first", setWinnerRank() {},
  });
  vm.runInContext(source, context);
  assert.equal(context.getReady(), false);
  assert.equal(context.ready, false);
  assert.equal(calls.length, 0);
  assert.equal(storage.length, 0);
  assert.match(status.textContent, /중복 수/);
  assert.equal(input.validity, status.textContent);
  input.value = "[테스트용] A,[테스트용] B*3";
  context.getReady();
  assert.equal(context.ready, true);
  assert.equal(calls.length, 1);
  assert.equal(storage.length, 1);
  assert.equal(status.textContent, "");
  assert.equal(input.validity, "");
});

test("input length is checked before tokenizing and saved invalid lists stay blocked", () => {
  const source = html.slice(html.indexOf("function getNames()"), html.indexOf("function setWinnerRank("));
  const input = { value: "[테스트용]".repeat(10000), setCustomValidity(value) { this.validity = value; } };
  const status = { textContent: "" };
  const context = vm.createContext({ document: { querySelector: selector => selector === "#in_names" ? input : status }, RouletteInputSafety: safety, ready: true });
  vm.runInContext(source, context);
  context.getNames = () => assert.fail("oversized raw input must be rejected before splitting");
  assert.equal(context.validRouletteInput(), false);
  assert.equal(context.ready, false);
  assert.match(status.textContent, /너무 길/);
});

test("game loads its guard before engine setup and reports input errors accessibly", () => {
  assert(html.indexOf('src="roulette-input-safety.js') < html.indexOf("type=module"));
  assert.match(html, /RouletteInputSafety\.install\(window\.roulette\)/);
  assert.match(html, /id="roulette-input-status" role="status"/);
  assert.match(html, /id=in_names maxlength=50000 aria-describedby="roulette-input-status"/);
  assert.match(html, /addEventListener\("blur",\(\)=>\{if\(!validRouletteInput\(\)\)return/);
  assert.match(html, /n=Object\.create\(null\)/);
  assert.match(fs.readFileSync(path.join(root, "index.html"), "utf8"), /data-src="games\.html\?v=security-20261022"/);
  assert.match(fs.readFileSync(path.join(root, "games.html"), "utf8"), /data-src="marble-roulette\/index\.html\?v=security-20261022"/);
});

test("executable CDN imports require pinned versions, SHA-384 integrity and anonymous CORS", () => {
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const scripts = [...index.matchAll(/<script\b[^>]*src="(https:\/\/[^"]+)"[^>]*>/g)];
  assert.equal(scripts.length, 2);
  for (const [tag, url] of scripts) {
    assert.match(url, /@\d+\.\d+\.\d+\//);
    assert.match(tag, /integrity="sha384-[A-Za-z0-9+/]{64}"/);
    assert.match(tag, /crossorigin="anonymous"/);
  }
});
