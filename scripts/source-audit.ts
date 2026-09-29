export type SourceAuditStatus =
  | "success"
  | "redirect"
  | "redirect-chain"
  | "blocked"
  | "broken"
  | "ambiguous";

export interface SourceAuditUrl {
  field: string;
  url: string;
}

export interface SourceAuditRedirect {
  status: number;
  from: string;
  to: string;
}

export interface SourceAuditResult {
  url: string;
  finalUrl: string;
  status: SourceAuditStatus;
  httpStatus: number | null;
  redirects: SourceAuditRedirect[];
  error: string | null;
}

const blockedStatuses = new Set([401, 403, 405, 429, 503]);

const addUnique = (
  target: SourceAuditUrl[],
  seen: Set<string>,
  field: string,
  value: unknown,
) => {
  if (typeof value !== "string" || !/^https:\/\//i.test(value) || seen.has(value))
    return;
  seen.add(value);
  target.push({ field, url: value });
};

export function sourceUrlsForRecord(
  raw: Record<string, unknown>,
): SourceAuditUrl[] {
  const result: SourceAuditUrl[] = [];
  const seen = new Set<string>();

  if (raw.schemaVersion === "2.0") {
    const urls =
      raw.urls && typeof raw.urls === "object"
        ? raw.urls as Record<string, unknown>
        : {};
    const evidence = Array.isArray(urls.evidenceUrls)
      ? urls.evidenceUrls
      : [];
    for (const entry of evidence) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      addUnique(
        result,
        seen,
        `evidence:${typeof item.type === "string" ? item.type : "source"}`,
        item.url,
      );
    }
    addUnique(result, seen, "providerUrl", urls.providerUrl);
    addUnique(result, seen, "programUrl", urls.programUrl);
    addUnique(result, seen, "applicationUrl", urls.applicationUrl);
    addUnique(result, seen, "canonicalUrl", raw.canonicalUrl);
    return result;
  }

  addUnique(result, seen, "sourceUrl", raw.sourceUrl);
  addUnique(result, seen, "officialUrl", raw.officialUrl);
  return result;
}

export async function auditUrl(
  url: string,
  fetchFn: typeof fetch = fetch,
  maxRedirects = 5,
): Promise<SourceAuditResult> {
  let current = url;
  const redirects: SourceAuditRedirect[] = [];
  try {
    for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
      const response = await fetchFn(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: { "user-agent": "PerkCommons source audit/2.0" },
      });
      const status = response.status;
      if (status >= 300 && status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location)
          return {
            url,
            finalUrl: current,
            status: "ambiguous",
            httpStatus: status,
            redirects,
            error: "redirect response did not include a Location header",
          };
        if (redirects.length >= maxRedirects)
          return {
            url,
            finalUrl: current,
            status: "ambiguous",
            httpStatus: status,
            redirects,
            error: `redirect limit exceeded (${maxRedirects})`,
          };
        const next = new URL(location, current).toString();
        redirects.push({ status, from: current, to: next });
        current = next;
        continue;
      }

      await response.body?.cancel();
      if (blockedStatuses.has(status))
        return {
          url,
          finalUrl: current,
          status: "blocked",
          httpStatus: status,
          redirects,
          error: null,
        };
      if (status >= 500)
        return {
          url,
          finalUrl: current,
          status: "ambiguous",
          httpStatus: status,
          redirects,
          error: "server-side response may be transient",
        };
      if (status >= 400)
        return {
          url,
          finalUrl: current,
          status: "broken",
          httpStatus: status,
          redirects,
          error: null,
        };
      if (status >= 200 && status < 300)
        return {
          url,
          finalUrl: current,
          status:
            redirects.length === 0
              ? "success"
              : redirects.length === 1
                ? "redirect"
                : "redirect-chain",
          httpStatus: status,
          redirects,
          error: null,
        };

      return {
        url,
        finalUrl: current,
        status: "ambiguous",
        httpStatus: status,
        redirects,
        error: `unexpected HTTP status ${status}`,
      };
    }
  } catch (error) {
    return {
      url,
      finalUrl: current,
      status: "ambiguous",
      httpStatus: null,
      redirects,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    url,
    finalUrl: current,
    status: "ambiguous",
    httpStatus: null,
    redirects,
    error: "audit ended without a terminal response",
  };
}