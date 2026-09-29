import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

type SuggestedStatus =
  | "open"
  | "rolling"
  | "upcoming"
  | "limited"
  | "waitlist"
  | "temporarily-unavailable"
  | "closed"
  | "expired"
  | "unconfirmed";

interface SourceResult {
  requestedUrl: string;
  finalUrl: string | null;
  fetchedAt: string;
  httpStatus: number | null;
  contentType: string | null;
  pageTitle: string | null;
  canonicalUrl: string | null;
  sourceHash: string | null;
  visibleTextLength: number;
  error: string | null;
  blocked: boolean;
  evidence: Array<{ signal: string; snippet: string }>;
  suggestedStatus: SuggestedStatus;
  confidence: number;
  reason: string;
}

interface FetchedSource {
  requestedUrl: string;
  finalUrl: string | null;
  fetchedAt: string;
  httpStatus: number | null;
  contentType: string | null;
  pageTitle: string | null;
  canonicalUrl: string | null;
  sourceHash: string | null;
  visibleTextLength: number;
  visibleText: string;
  error: string | null;
  blocked: boolean;
}

interface ReviewRecord {
  id: string;
  provider: string;
  title: string;
  currentStatus: string;
  urls: string[];
  sources: SourceResult[];
  suggestedStatus: SuggestedStatus;
  confidence: number;
  reason: string;
  reviewState:
    | "explicit-source-supported"
    | "ongoing-page-supported"
    | "context-reviewed"
    | "manual-review-required";
}

interface AvailabilityOverride {
  id: string;
  status: SuggestedStatus;
  confidence: number;
  evidenceUrl: string;
  rationale: string;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fetchedAt = new Date().toISOString();
const timeoutMs = 20_000;
const maximumBytes = 2_000_000;

const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").trim();
const normalizeMatch = (value: string) =>
  normalizeWhitespace(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
const uniqueStrings = (values: Array<unknown>): string[] =>
  [...new Set(values.filter((value): value is string =>
    typeof value === "string" && /^https:\/\//.test(value)
  ))];

const sourceFields = (raw: Record<string, unknown>) => {
  if (raw.schemaVersion !== "2.0") {
    return {
      urls: uniqueStrings([raw.sourceUrl, raw.officialUrl]),
      currentStatus: String(raw.status),
    };
  }
  const urls = raw.urls as Record<string, unknown>;
  const evidence = Array.isArray(urls.evidenceUrls)
    ? urls.evidenceUrls as Array<{ url?: unknown }>
    : [];
  const availability = raw.availability as Record<string, unknown>;
  return {
    urls: uniqueStrings([
      ...evidence.map((item) => item.url),
      urls.applicationUrl,
      urls.programUrl,
      raw.canonicalUrl,
    ]),
    currentStatus: String(availability.status),
  };
};

const readLimitedText = async (response: Response): Promise<string> => {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(`response exceeds ${maximumBytes} bytes`);
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
};

const patterns: Array<{
  status: SuggestedStatus;
  signal: string;
  expression: RegExp;
  confidence: number;
}> = [
  {
    status: "temporarily-unavailable",
    signal: "temporarily-unavailable",
    expression:
      /\b(?:(?:this |the )?(?:program|offer) (?:is )?temporarily unavailable|applications? (?:are|is) temporarily (?:paused|suspended)|applications? (?:are|is) not currently available)\b/i,
    confidence: 0.93,
  },
  {
    status: "closed",
    signal: "applications-closed",
    expression:
      /\b(?:applications? (?:are|is|have) (?:now )?closed|applications? (?:are|is) no longer (?:open|being accepted)|not accepting applications?|submissions? (?:are|is) (?:now )?closed|application window has closed|application deadline (?:has )?passed)\b/i,
    confidence: 0.94,
  },
  {
    status: "expired",
    signal: "program-ended",
    expression:
      /\b(?:program has ended|program is no longer offered|offer has expired|offer is no longer available|this program has been discontinued)\b/i,
    confidence: 0.95,
  },
  {
    status: "waitlist",
    signal: "waitlist",
    expression:
      /\b(?:join (?:the|our) waitlist|join waitlist|waitlist is open|waitlist only)\b/i,
    confidence: 0.92,
  },
  {
    status: "upcoming",
    signal: "future-opening",
    expression:
      /\b(?:applications? (?:will )?open (?:on|in)|applications? (?:are )?opening soon|next application (?:round|window|cycle))\b/i,
    confidence: 0.86,
  },
  {
    status: "rolling",
    signal: "rolling-applications",
    expression:
      /\b(?:applications? (?:are )?(?:accepted |reviewed )?on a rolling basis|rolling applications?|apply (?:at any time|year-round)|applications? (?:are )?open year-round)\b/i,
    confidence: 0.94,
  },
  {
    status: "open",
    signal: "applications-open",
    expression:
      /\b(?:applications? (?:are|is) (?:now )?open|now accepting applications?|submissions? (?:are|is) (?:now )?open|application (?:is )?open)\b/i,
    confidence: 0.92,
  },
  {
    status: "limited",
    signal: "restricted-availability",
    expression:
      /\b(?:invite[- ]only|available (?:only )?through (?:selected |approved )?partners|limited availability|selected cohorts?|subject to capacity|only available in selected (?:countries|regions))\b/i,
    confidence: 0.86,
  },
];

const snippetFor = (text: string, expression: RegExp): string | null => {
  const match = expression.exec(text);
  if (!match || match.index === undefined) return null;
  const start = Math.max(0, match.index - 70);
  const end = Math.min(text.length, match.index + match[0].length + 70);
  return normalizeWhitespace(text.slice(start, end)).slice(0, 220);
};

const classifyText = (
  text: string,
  recordIdentity: string,
): Pick<SourceResult, "evidence" | "suggestedStatus" | "confidence" | "reason"> => {
  const evidence = patterns.flatMap((rule) => {
    const snippet = snippetFor(text, rule.expression);
    return snippet ? [{ signal: rule.signal, snippet }] : [];
  });
  const identityTokens = normalizeMatch(recordIdentity)
    .split(" ")
    .filter((token) => token.length >= 4);
  const normalizedText = normalizeMatch(text);
  const identityMatches = identityTokens.filter((token) =>
    normalizedText.includes(token)
  ).length;
  const identitySupported =
    identityTokens.length === 0 ||
    identityMatches >= Math.min(2, identityTokens.length);
  const matches = patterns
    .map((rule) => ({
      ...rule,
      found: rule.expression.test(text),
    }))
    .filter((item) => item.found);
  if (!identitySupported) {
    return {
      evidence,
      suggestedStatus: "unconfirmed",
      confidence: 0.15,
      reason: "The fetched page did not contain enough provider/title identity terms.",
    };
  }
  if (matches.length === 0) {
    return {
      evidence,
      suggestedStatus: "unconfirmed",
      confidence: 0.25,
      reason: "No explicit current-availability statement was found in visible source text.",
    };
  }
  const statusSet = new Set(matches.map((item) => item.status));
  if (statusSet.size > 1) {
    return {
      evidence,
      suggestedStatus: "unconfirmed",
      confidence: 0.35,
      reason: `Conflicting availability signals were found: ${[...statusSet].join(", ")}.`,
    };
  }
  const match = matches[0];
  return {
    evidence,
    suggestedStatus: match.status,
    confidence: match.confidence,
    reason: `Visible source text contains the '${match.signal}' signal.`,
  };
};

const fetchSource = async (requestedUrl: string): Promise<FetchedSource> => {
  const base: FetchedSource = {
    requestedUrl,
    finalUrl: null,
    fetchedAt,
    httpStatus: null,
    contentType: null,
    pageTitle: null,
    canonicalUrl: null,
    sourceHash: null,
    visibleTextLength: 0,
    error: null,
    blocked: false,
    visibleText: "",
  };
  try {
    const response = await fetch(requestedUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "user-agent":
          "PerkCommons availability research/2.0 (+https://perkcommons.com)",
        accept: "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.2",
      },
    });
    base.finalUrl = response.url;
    base.httpStatus = response.status;
    base.contentType = response.headers.get("content-type");
    base.blocked = [401, 403, 405, 429, 503].includes(response.status);
    if (!response.ok) {
      await response.body?.cancel();
      return {
        ...base,
        error: `HTTP ${response.status}`,
      };
    }
    if (!/(?:html|xhtml|json|text\/plain)/i.test(base.contentType ?? "")) {
      await response.body?.cancel();
      return {
        ...base,
        error: `unsupported content type '${base.contentType ?? "unknown"}'`,
      };
    }
    const body = await readLimitedText(response);
    let visibleText = body;
    if (/(?:html|xhtml)/i.test(base.contentType ?? "")) {
      const $ = cheerio.load(body, { scriptingEnabled: false });
      base.pageTitle = normalizeWhitespace($("title").first().text()) || null;
      base.canonicalUrl =
        $('link[rel="canonical"]').first().attr("href") ?? null;
      $("script, style, noscript, template, svg").remove();
      visibleText = normalizeWhitespace($("body").text());
    } else if (/json/i.test(base.contentType ?? "")) {
      visibleText = normalizeWhitespace(body);
    }
    base.visibleTextLength = visibleText.length;
    base.visibleText = visibleText;
    base.sourceHash = createHash("sha256").update(visibleText).digest("hex");
    return base;
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
      blocked: true,
    };
  }
};

const classifySource = (
  fetched: FetchedSource,
  recordIdentity: string,
): SourceResult => {
  const { visibleText, ...publicFields } = fetched;
  if (fetched.error) {
    return {
      ...publicFields,
      evidence: [],
      suggestedStatus: "unconfirmed",
      confidence: 0,
      reason: fetched.blocked
        ? "The provider blocked automated access; manual browser review is required."
        : "The cited source could not be evaluated successfully.",
    };
  }
  return {
    ...publicFields,
    ...classifyText(visibleText, recordIdentity),
  };
};

const files = (await readdir(join(root, "opportunities")))
  .filter((name) => name.endsWith(".json") && !name.startsWith("_"))
  .sort();
const rawRecords = await Promise.all(
  files.map(async (file) =>
    JSON.parse(
      await readFile(join(root, "opportunities", file), "utf8"),
    ) as Record<string, unknown>
  ),
);
const records = rawRecords.map((raw) => ({
  raw,
  id: String(raw.id),
  provider: String(raw.provider),
  title: String(raw.title),
  category: raw.schemaVersion === "2.0"
    ? String((raw.classification as Record<string, unknown>).primaryCategory)
    : String(raw.category),
  isResourceOutsideDefault:
    raw.schemaVersion === "2.0" &&
    (raw.classification as Record<string, unknown>).defaultSearchEligible === false,
  ...sourceFields(raw),
}));
const ongoingCategories = new Set([
  "discounts-perks",
  "startup-benefits",
  "student-benefits",
  "nonprofit-benefits",
  "mentorship-community",
]);
const fetchCache = new Map<string, Promise<FetchedSource>>();
const sourceFor = async (url: string, identity: string) => {
  const existing = fetchCache.get(url);
  if (existing) return classifySource(await existing, identity);
  const pending = fetchSource(url);
  fetchCache.set(url, pending);
  return classifySource(await pending, identity);
};

const queue = records.slice();
const reviewed: ReviewRecord[] = [];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length > 0) {
      const record = queue.shift();
      if (!record) continue;
      const identity = `${record.provider} ${record.title}`;
      const sources = await Promise.all(
        record.urls.map((url) => sourceFor(url, identity)),
      );
      const supported = sources
        .filter((source) =>
          source.suggestedStatus !== "unconfirmed" &&
          source.confidence >= 0.8
        )
        .sort((left, right) => right.confidence - left.confidence);
      const supportedStatuses = new Set(
        supported.map((source) => source.suggestedStatus),
      );
      const source = supportedStatuses.size === 1 ? supported[0] : null;
      const pageSupportedOngoing =
        !source &&
        supportedStatuses.size === 0 &&
        (record.isResourceOutsideDefault || ongoingCategories.has(record.category)) &&
        sources.some((item) =>
          item.httpStatus === 200 &&
          item.error === null &&
          item.suggestedStatus === "unconfirmed" &&
          item.confidence === 0.25
        );
      const inferredStatus = pageSupportedOngoing ? "open" : "unconfirmed";
      reviewed.push({
        id: record.id,
        provider: record.provider,
        title: record.title,
        currentStatus: record.currentStatus,
        urls: record.urls,
        sources,
        suggestedStatus: source?.suggestedStatus ?? inferredStatus,
        confidence: source?.confidence ?? (pageSupportedOngoing ? 0.7 : Math.max(
          0,
          ...sources.map((item) => item.confidence),
        )),
        reason: supportedStatuses.size > 1
          ? `Sources disagree: ${[...supportedStatuses].join(", ")}.`
          : source?.reason ??
            (pageSupportedOngoing
              ? "A relevant provider page is live for an ongoing program or non-default resource; no contrary availability signal was found."
              : "No source provided sufficiently clear current-availability evidence."),
        reviewState: source
          ? "explicit-source-supported"
          : pageSupportedOngoing
          ? "ongoing-page-supported"
          : "manual-review-required",
      });
    }
  }),
);
reviewed.sort((left, right) => left.id.localeCompare(right.id));
const overrideDocument = JSON.parse(
  await readFile(
    join(root, "editorial", "availability-overrides.json"),
    "utf8",
  ),
) as { decisions: AvailabilityOverride[] };
const overrides = new Map(
  overrideDocument.decisions.map((decision) => [decision.id, decision]),
);
const unknownOverrides = [...overrides.keys()].filter(
  (id) => !reviewed.some((record) => record.id === id),
);
if (unknownOverrides.length > 0) {
  throw new Error(
    `Availability overrides reference unknown records: ${unknownOverrides.join(", ")}`,
  );
}
for (const record of reviewed) {
  const override = overrides.get(record.id);
  if (!override) continue;
  record.suggestedStatus = override.status;
  record.confidence = override.confidence;
  record.reason = override.rationale;
  record.reviewState = "context-reviewed";
  if (!record.urls.includes(override.evidenceUrl)) {
    record.urls.push(override.evidenceUrl);
  }
}
const counts = reviewed.reduce<Record<string, number>>((result, record) => {
  result[record.suggestedStatus] = (result[record.suggestedStatus] ?? 0) + 1;
  return result;
}, {});
const report = {
  reportVersion: 1,
  generatedAt: fetchedAt,
  methodology: {
    reviewer: "ai-assisted-source-research",
    automaticPublicationAllowed: false,
    timeoutMs,
    maximumBytes,
    note:
      "Suggested statuses require direct evidence or an explicitly documented context decision and are not represented as manual human review. Ambiguous, blocked, conflicting, or unsupported sources remain unconfirmed.",
    contextOverrides: overrides.size,
  },
  recordsInspected: reviewed.length,
  uniqueSourceRequests: fetchCache.size,
  counts,
  records: reviewed,
};
await mkdir(join(root, "reports"), { recursive: true });
await writeFile(
  join(root, "reports/availability-research.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  `Researched ${reviewed.length} records across ${fetchCache.size} unique source URLs: ${JSON.stringify(counts)}`,
);
