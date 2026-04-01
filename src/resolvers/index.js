import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";
import { parseMultiJqlInput } from "../common/multiJql";

const resolver = new Resolver();

const MAX_RESULTS_PER_PAGE = 100;
const MAX_TOTAL = 2000;
const MULTI_JQL_MAX_RESULTS = 1000;
const MULTI_JQL_MAX_PAGES = 100;
const MATCHING_ISSUE_DISPLAY_LIMIT = 100;

const normalizeSelectValue = (value) =>
  value && typeof value === "object" && "value" in value ? value.value : value;

const toJqlFieldReference = (fieldId) => {
  if (!fieldId) {
    return null;
  }

  if (fieldId === "statuscategory") {
    return "statusCategory";
  }

  const customFieldMatch = String(fieldId).match(/^customfield_(\d+)$/);
  if (customFieldMatch) {
    return `cf[${customFieldMatch[1]}]`;
  }

  return fieldId;
};

const escapeJqlString = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const toJqlLiteral = (value) => {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return `"${escapeJqlString(value)}"`;
};

const buildEqualityClause = (fieldId, value) => {
  const jqlField = toJqlFieldReference(fieldId);
  const literal = toJqlLiteral(value);

  if (!jqlField) {
    return null;
  }

  if (literal == null) {
    return `${jqlField} is EMPTY`;
  }

  return `${jqlField} = ${literal}`;
};

const combineDrilldownJql = (baseJql, clauseGroups = []) => {
  const parts = [`(${String(baseJql || "").trim()})`];

  for (const group of clauseGroups) {
    const clauses = Array.from(group || []).filter(Boolean);
    if (clauses.length === 0) {
      continue;
    }

    if (clauses.length === 1) {
      parts.push(clauses[0]);
      continue;
    }

    parts.push(`(${clauses.join(" OR ")})`);
  }

  return parts.join(" AND ");
};

const normalizeIssueValue = (value) => {
  if (value == null) {
    return [{ label: "Unspecified", clauseValue: null }];
  }

  if (Array.isArray(value)) {
    const nested = value.flatMap((item) => normalizeIssueValue(item));
    const deduped = new Map();
    for (const entry of nested) {
      const key = JSON.stringify([entry.label, entry.clauseValue]);
      if (!deduped.has(key)) {
        deduped.set(key, entry);
      }
    }
    return deduped.size > 0
      ? Array.from(deduped.values())
      : [{ label: "Unspecified", clauseValue: null }];
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [{ label: String(value), clauseValue: value }];
  }

  if (typeof value === "object") {
    if (value.accountId) {
      return [
        {
          label: value.displayName || value.name || value.accountId,
          clauseValue: value.accountId,
        },
      ];
    }

    if (value.value != null) {
      return [{ label: String(value.value), clauseValue: value.value }];
    }

    if (value.key && value.name) {
      return [{ label: String(value.name), clauseValue: value.key }];
    }

    if (value.name != null) {
      return [{ label: String(value.name), clauseValue: value.name }];
    }

    if (value.displayName != null) {
      return [{ label: String(value.displayName), clauseValue: value.displayName }];
    }

    if (value.id != null) {
      return [{ label: String(value.id), clauseValue: value.id }];
    }
  }

  const fallback = String(value);
  return [{ label: fallback, clauseValue: fallback }];
};

const extractFieldEntries = (issueFields, fieldId) => {
  if (!fieldId) {
    return [{ label: "All", clause: null }];
  }

  if (fieldId === "statuscategory") {
    const statusCategory = issueFields?.status?.statusCategory;
    const label = statusCategory?.name || statusCategory?.key || "Unspecified";
    const clauseValue = statusCategory?.name || statusCategory?.key || null;
    return [{ label, clause: buildEqualityClause(fieldId, clauseValue) }];
  }

  return normalizeIssueValue(issueFields?.[fieldId]).map((entry) => ({
    label: entry.label || "Unspecified",
    clause: buildEqualityClause(fieldId, entry.clauseValue),
  }));
};

const toNumber = (value) => {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildAccessors = () => ({
  donut: { colorAccessor: "type", labelAccessor: "label", valueAccessor: "value" },
  pie: { colorAccessor: "type", labelAccessor: "label", valueAccessor: "value" },
  bar: { xAccessor: "label", yAccessor: "value", colorAccessor: "type" },
  "horizontal-bar": { xAccessor: "label", yAccessor: "value", colorAccessor: "type" },
  "stack-bar": { xAccessor: "label", yAccessor: "value", colorAccessor: "type" },
  "horizontal-stack-bar": { xAccessor: "label", yAccessor: "value", colorAccessor: "type" },
  line: { xAccessor: "label", yAccessor: "value" },
});

resolver.define("getText2", async (req) => {
  const cfg = req.context.extension.gadgetConfiguration || {};
  const name = cfg["graph-name"];
  const jql = String(cfg["graph-jql"] || "").trim();
  const multi = cfg["graph-multi-jql"];
  const chartType = normalizeSelectValue(cfg["graph-type"]) || "bar";
  const groupFieldId = normalizeSelectValue(cfg["graph-group"]);
  const stackFieldId = normalizeSelectValue(cfg["graph-stack"]);
  const aggSpec = normalizeSelectValue(cfg["graph-agg"]) || "count";

  if (String(multi || "").trim()) {
    const items = parseMultiJqlInput(multi);

    if (items.length === 0) {
      return { error: "Multi JQL provided but no valid lines were found." };
    }

    const results = [];
    for (const item of items) {
      let total = 0;
      let nextToken = null;

      for (let page = 0; page < MULTI_JQL_MAX_PAGES; page += 1) {
        let url = route`/rest/api/3/search/jql?jql=${item.jql}&maxResults=${String(
          MULTI_JQL_MAX_RESULTS
        )}&fields=key`;
        if (nextToken) {
          url = `${url}&nextPageToken=${encodeURIComponent(nextToken)}`;
        }

        const response = await api
          .asUser()
          .requestJira(url, { method: "GET", headers: { Accept: "application/json" } });

        if (!response.ok) {
          const text = await response.text();
          return {
            error: "Jira search failed",
            status: response.status,
            body: text,
            jql: item.jql,
          };
        }

        const data = await response.json();
        const issues = Array.isArray(data.issues) ? data.issues : [];
        total += issues.length;

        const usesTokenPaging =
          Object.prototype.hasOwnProperty.call(data, "isLast") ||
          Object.prototype.hasOwnProperty.call(data, "nextPageToken");

        if (usesTokenPaging) {
          if (data.isLast === true) {
            break;
          }
          nextToken = data.nextPageToken;
          if (!nextToken) {
            break;
          }
        } else if (typeof data.total === "number") {
          total = data.total;
          break;
        } else {
          break;
        }
      }

      results.push({
        type: item.label,
        label: item.label,
        value: total,
        drilldownJql: item.jql,
        groupDrilldownJql: item.jql,
      });
    }

    return {
      title: name,
      chartType: chartType || "pie",
      groupBy: null,
      stackBy: null,
      aggregation: "count",
      data: results,
      accessors: buildAccessors(),
      meta: {
        mode: "multi-jql",
        jqls: items.map((item) => ({ label: item.label, jql: item.jql })),
        notes: [
          "Totals are calculated per Multi JQL line.",
          "Each segment now includes a drilldown JQL that can be opened below the chart.",
        ],
      },
    };
  }

  if (!name || !jql || !groupFieldId) {
    return {
      error: "Missing required config.",
      missing: {
        "graph-name": !name,
        "graph-jql": !jql,
        "graph-group": !groupFieldId,
      },
    };
  }

  let agg = "count";
  let aggFieldId = null;
  const colonIndex = aggSpec.indexOf(":");

  if (aggSpec === "count") {
    agg = "count";
  } else if (colonIndex > -1) {
    agg = aggSpec.slice(0, colonIndex).toLowerCase();
    aggFieldId = aggSpec.slice(colonIndex + 1);
  } else {
    agg = aggSpec.toLowerCase();
  }

  if ((agg === "sum" || agg === "avg") && !aggFieldId) {
    return {
      error: "Aggregation field id required for sum/avg. Use a value like 'sum:customfield_10016'.",
    };
  }

  const fieldsSet = new Set([groupFieldId]);
  if (stackFieldId) {
    fieldsSet.add(stackFieldId);
  }
  if (aggFieldId) {
    fieldsSet.add(aggFieldId);
  }
  if (groupFieldId === "statuscategory" || stackFieldId === "statuscategory") {
    fieldsSet.add("status");
  }

  const fieldsParam = Array.from(fieldsSet).join(",");
  const buckets = new Map();
  const issueKeys = new Set();

  let startAt = 0;
  let fetched = 0;
  let total = Infinity;

  while (fetched < MAX_TOTAL && startAt < total) {
    const url = route`/rest/api/3/search/jql?jql=${jql}&fields=${fieldsParam}&startAt=${startAt}&maxResults=${MAX_RESULTS_PER_PAGE}`;
    const response = await api.asUser().requestJira(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const text = await response.text();
      return { error: "Jira search failed", status: response.status, body: text, jql };
    }

    const data = await response.json();
    total = typeof data.total === "number" ? data.total : 0;

    const issues = Array.isArray(data.issues) ? data.issues : [];
    fetched += issues.length;

    for (const issue of issues) {
      const fields = issue.fields || {};
      if (issue.key) {
        issueKeys.add(issue.key);
      }
      const groupEntries = extractFieldEntries(fields, groupFieldId);
      const stackEntries = extractFieldEntries(fields, stackFieldId);
      const metricValue = agg === "count" ? 1 : toNumber(fields[aggFieldId]);

      for (const groupEntry of groupEntries) {
        const groupLabel = groupEntry.label || "Unspecified";

        if (!stackFieldId) {
          if (!buckets.has(groupLabel)) {
            buckets.set(groupLabel, {
              count: 0,
              sum: 0,
              validCount: 0,
              groupClauses: new Set(),
            });
          }

          const bucket = buckets.get(groupLabel);
          bucket.count += 1;
          if (groupEntry.clause) {
            bucket.groupClauses.add(groupEntry.clause);
          }

          if (agg === "sum") {
            bucket.sum += metricValue == null ? 0 : metricValue;
            bucket.validCount += metricValue == null ? 0 : 1;
          } else if (agg === "avg" && metricValue != null) {
            bucket.sum += metricValue;
            bucket.validCount += 1;
          }

          continue;
        }

        if (!buckets.has(groupLabel)) {
          buckets.set(groupLabel, new Map());
        }

        const innerBuckets = buckets.get(groupLabel);
        for (const stackEntry of stackEntries) {
          const stackLabel = stackEntry.label || "Unspecified";

          if (!innerBuckets.has(stackLabel)) {
            innerBuckets.set(stackLabel, {
              count: 0,
              sum: 0,
              validCount: 0,
              groupClauses: new Set(),
              stackClauses: new Set(),
            });
          }

          const bucket = innerBuckets.get(stackLabel);
          bucket.count += 1;
          if (groupEntry.clause) {
            bucket.groupClauses.add(groupEntry.clause);
          }
          if (stackEntry.clause) {
            bucket.stackClauses.add(stackEntry.clause);
          }

          if (agg === "sum") {
            bucket.sum += metricValue == null ? 0 : metricValue;
            bucket.validCount += metricValue == null ? 0 : 1;
          } else if (agg === "avg" && metricValue != null) {
            bucket.sum += metricValue;
            bucket.validCount += 1;
          }
        }
      }
    }

    startAt += MAX_RESULTS_PER_PAGE;
    if (issues.length === 0) {
      break;
    }
  }

  const result = [];

  if (!stackFieldId) {
    for (const [label, bucket] of buckets.entries()) {
      let value = bucket.count;
      if (agg === "sum") {
        value = bucket.sum;
      } else if (agg === "avg") {
        value = bucket.validCount > 0 ? bucket.sum / bucket.validCount : 0;
      }

      result.push({
        type: label,
        label,
        value,
        drilldownJql: combineDrilldownJql(jql, [bucket.groupClauses]),
        groupDrilldownJql: combineDrilldownJql(jql, [bucket.groupClauses]),
      });
    }
  } else {
    for (const [label, innerBuckets] of buckets.entries()) {
      for (const [stackLabel, bucket] of innerBuckets.entries()) {
        let value = bucket.count;
        if (agg === "sum") {
          value = bucket.sum;
        } else if (agg === "avg") {
          value = bucket.validCount > 0 ? bucket.sum / bucket.validCount : 0;
        }

        result.push({
          type: stackLabel,
          label,
          value,
          drilldownJql: combineDrilldownJql(jql, [bucket.groupClauses, bucket.stackClauses]),
          groupDrilldownJql: combineDrilldownJql(jql, [bucket.groupClauses]),
        });
      }
    }
  }

  return {
    title: name,
    chartType,
    groupBy: groupFieldId,
    stackBy: stackFieldId || null,
    aggregation: aggSpec,
    data: result,
    accessors: buildAccessors(),
    meta: {
      mode: "single-jql",
      totalIssuesInspected: fetched,
      cappedAt: Math.min(fetched, MAX_TOTAL),
      jql,
      fieldsRequested: Array.from(fieldsSet),
      matchingIssueCount: issueKeys.size,
      matchingIssues: Array.from(issueKeys)
        .slice(0, MATCHING_ISSUE_DISPLAY_LIMIT)
        .map((key) => ({ key })),
      notes: [
        "Data is shaped for Forge UI Kit chart components.",
        "Each rendered segment includes a drilldown JQL derived from the selected bucket values.",
      ],
    },
  };
});

export const handler = resolver.getDefinitions();
