export interface SourceAuditSummary {
  asOf: string;
  urlsInspected: number;
  counts: Record<string, number>;
}

export interface MeasuredNetworkMetric {
  status: "measured";
  count: number;
  inspected: number;
  percentage: number;
  asOf: string;
}

const percentage = (count: number, total: number) =>
  total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0;

export function sourceAuditMetrics(report: SourceAuditSummary): {
  brokenLinkRate: MeasuredNetworkMetric;
  redirectRate: MeasuredNetworkMetric;
} {
  const broken = report.counts.broken ?? 0;
  const redirects =
    (report.counts.redirect ?? 0) + (report.counts["redirect-chain"] ?? 0);
  return {
    brokenLinkRate: {
      status: "measured",
      count: broken,
      inspected: report.urlsInspected,
      percentage: percentage(broken, report.urlsInspected),
      asOf: report.asOf,
    },
    redirectRate: {
      status: "measured",
      count: redirects,
      inspected: report.urlsInspected,
      percentage: percentage(redirects, report.urlsInspected),
      asOf: report.asOf,
    },
  };
}
