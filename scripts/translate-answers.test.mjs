import test from "node:test";
import assert from "node:assert/strict";
import { translate, translateInChunks, translationEndpoint, ollamaProvider } from "./translate-answers.mjs";

test("formula and image reference survive translation byte for byte", async () => {
  const body = "经常账户 $CA_1=-10/21$\n\n![图](fig.png)\n\n$$C_1=C_2$$";
  const result = await translate(body, async (text) => {
    assert.doesNotMatch(text, /CA_1|fig\.png|C_1/);
    return { target_lang: "en", body: text.replace("经常账户", "Current account") };
  });
  assert.equal(result.body, body.replace("经常账户", "Current account"));
});

test("rejects missing or repeated placeholders", async () => {
  for (const body of ["No formula", "OEM_KEEP_0_END OEM_KEEP_0_END"]) {
    await assert.rejects(translate("结论 $x=1$", async () => ({ target_lang: "en", body })), /Protected content changed/);
  }
});

test("already bilingual or no prose can be marked skipped", async () => {
  const skipped = { target_lang: null, body: null };
  assert.deepEqual(await translate("结论 / Conclusion", async () => skipped), skipped);
});

test("only the loopback Ollama chat route can use HTTP without a key", () => {
  assert.equal(translationEndpoint("http://127.0.0.1:11434/api/chat").local, true);
  assert.throws(() => translationEndpoint("http://example.org/api/chat"));
  assert.throws(() => translationEndpoint("http://127.0.0.1:11434/other"));
  assert.throws(() => translationEndpoint("https://example.org/api/chat"));
});

test("Ollama adapter keeps the formula on the local side", async () => {
  const { endpoint } = translationEndpoint("http://127.0.0.1:11434/api/chat");
  const provider = ollamaProvider(endpoint, "test", async (url, init) => {
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(init.redirect, "error");
    const input = JSON.parse(init.body).messages[1].content;
    assert.doesNotMatch(input, /x=1/);
    return { ok: true, json: async () => ({ done_reason: "stop",
      message: { content: JSON.stringify({ target_lang: "en", body: input.replace("结论", "Conclusion") }) } }) };
  });
  assert.deepEqual(await translate("结论 $x=1$", provider), { target_lang: "en", body: "Conclusion $x=1$" });
});

test("chunks retry only a failed segment and preserve plain equations and numbers", async () => {
  const calls = [];
  const result = await translateInChunks("CA₁=5-10=-5\n因此 CA₂=B₂-B₁，数值是 10。\n结果不变。", async (part, lang) => {
    assert.equal(lang, "en");
    assert.doesNotMatch(part, /CA₂|B₂|10/);
    calls.push(part);
    if (calls.length === 2) throw Error("temporary failure");
    return { target_lang: "en", body: part.replace("因此", "Therefore").replace("，数值是", ", the value is").replace("结果不变", "The result is unchanged") };
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[1], calls[2]);
  assert.match(result.body, /CA₁=5-10=-5\nTherefore CA₂=B₂-B₁, the value is 10/);
});

test("cannot return an incomplete translation after both attempts fail", async () => {
  await assert.rejects(translateInChunks("结论 $x=1$。", async () =>
    ({ target_lang: "en", body: "Conclusion" })), /Protected content changed/);
});
