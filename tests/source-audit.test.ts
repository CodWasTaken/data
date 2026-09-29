import assert from "node:assert/strict";
import test from "node:test";
import { auditUrl, sourceUrlsForRecord } from "../scripts/source-audit";

test("v2 source audit extracts evidence and canonical destination URLs", () => {
  const urls = sourceUrlsForRecord({
    id: "example",
    schemaVersion: "2.0",
    canonicalUrl: "https://example.org/program",
    urls: {
      providerUrl: "https://example.org/",
      programUrl: "https://example.org/program",
      applicationUrl: "https://example.org/apply",
      evidenceUrls: [
        { type: "overview", url: "https://example.org/evidence" },
        { type: "eligibility", url: "https://example.org/evidence" },
      ],
    },
  });
  assert.deepEqual(urls, [
    { field: "evidence:overview", url: "https://example.org/evidence" },
    { field: "providerUrl", url: "https://example.org/" },
    { field: "programUrl", url: "https://example.org/program" },
    { field: "applicationUrl", url: "https://example.org/apply" },
  ]);
});

test("v1 source audit preserves source and official URL behavior", () => {
  assert.deepEqual(
    sourceUrlsForRecord({
      sourceUrl: "https://example.org/evidence",
      officialUrl: "https://example.org/program",
    }),
    [
      { field: "sourceUrl", url: "https://example.org/evidence" },
      { field: "officialUrl", url: "https://example.org/program" },
    ],
  );
});

test("audit distinguishes redirects, blocked, broken, and ambiguous results", async () => {
  const responses = new Map<string, Response>([
    ["https://example.org/start", new Response(null, { status: 302, headers: { location: "/middle" } })],
    ["https://example.org/middle", new Response(null, { status: 301, headers: { location: "/final" } })],
    ["https://example.org/final", new Response("ok", { status: 200 })],
    ["https://example.org/blocked", new Response("no", { status: 403 })],
    ["https://example.org/broken", new Response("gone", { status: 404 })],
    ["https://example.org/transient", new Response("bad gateway", { status: 502 })],
  ]);
  const fetchFn: typeof fetch = async (input) => {
    const response = responses.get(String(input));
    if (!response) throw new Error("network unavailable");
    return response;
  };

  const redirected = await auditUrl("https://example.org/start", fetchFn);
  assert.equal(redirected.status, "redirect-chain");
  assert.equal(redirected.finalUrl, "https://example.org/final");
  assert.equal(redirected.redirects.length, 2);

  assert.equal((await auditUrl("https://example.org/blocked", fetchFn)).status, "blocked");
  assert.equal((await auditUrl("https://example.org/broken", fetchFn)).status, "broken");
  assert.equal((await auditUrl("https://example.org/transient", fetchFn)).status, "ambiguous");
  assert.equal((await auditUrl("https://example.org/unknown", fetchFn)).status, "ambiguous");
});