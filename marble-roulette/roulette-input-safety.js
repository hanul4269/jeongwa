(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RouletteInputSafety = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_MARBLES = 500;
  const MAX_TEXT_LENGTH = 50000;
  const MAX_NAME_LENGTH = 120;
  const MAX_WEIGHT = 100000;
  const installed = new WeakSet();

  function validateNames(names) {
    if (!Array.isArray(names) || names.length > MAX_MARBLES) {
      throw new RangeError(`참가자는 중복 수를 포함해 최대 ${MAX_MARBLES}개까지 입력할 수 있어요.`);
    }
    let total = 0;
    let textLength = 0;
    for (const entry of names) {
      if (typeof entry !== "string") throw new TypeError("참가자 이름을 확인해 주세요.");
      textLength += entry.length + 1;
      if (textLength > MAX_TEXT_LENGTH) throw new RangeError("참가자 입력이 너무 길어요.");
      const name = /^\s*([^/*]+)?/.exec(entry)?.[1] || "";
      const countMatch = /\*(\d+)/.exec(entry);
      const weightMatch = /\/(\d+)/.exec(entry);
      const count = countMatch ? Number(countMatch[1]) : 1;
      const weight = weightMatch ? Number(weightMatch[1]) : 1;
      if (!name.trim() || name.length > MAX_NAME_LENGTH) {
        throw new RangeError(`참가자 이름은 1~${MAX_NAME_LENGTH}자로 입력해 주세요.`);
      }
      if (!Number.isSafeInteger(count) || count < 1 || count > MAX_MARBLES) {
        throw new RangeError(`참가자 중복 수는 1~${MAX_MARBLES}로 입력해 주세요.`);
      }
      if (!Number.isSafeInteger(weight) || weight < 1 || weight > MAX_WEIGHT) {
        throw new RangeError(`참가자 가중치는 1~${MAX_WEIGHT}로 입력해 주세요.`);
      }
      total += count;
      if (total > MAX_MARBLES) {
        throw new RangeError(`참가자는 중복 수를 포함해 최대 ${MAX_MARBLES}개까지 입력할 수 있어요.`);
      }
    }
    return names;
  }

  function install(roulette) {
    if (!roulette || typeof roulette.setMarbles !== "function") throw new TypeError("게임을 준비하지 못했어요.");
    if (installed.has(roulette)) return;
    const original = roulette.setMarbles;
    roulette.setMarbles = function (names) {
      // Validate before the engine resets its state or allocates physics bodies.
      validateNames(names);
      return original.call(this, names);
    };
    installed.add(roulette);
  }

  return Object.freeze({ MAX_MARBLES, MAX_TEXT_LENGTH, MAX_NAME_LENGTH, MAX_WEIGHT, validateNames, install });
});
