import Resolver from "@forge/resolver";
import api, { route, storage } from "@forge/api";
import { parseMultiJqlInput } from "../common/multiJql";

const resolver = new Resolver();

const MAX_RESULTS_PER_PAGE = 250;
const MAX_TOTAL = 100000;
const MULTI_JQL_MAX_RESULTS = 1000;
const MULTI_JQL_MAX_PAGES = 1000;
const MATCHING_ISSUE_DISPLAY_LIMIT = 100;
const JOB_VERSION = 1;
const PROCESSING_TIME_BUDGET_MS = 8000;

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

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const toConfigSnapshot = (cfg = {}) => ({
  name: String(cfg["graph-name"] || ""),
  jql: String(cfg["graph-jql"] || "").trim(),
  multi: String(cfg["graph-multi-jql"] || "").trim(),
  chartType: normalizeSelectValue(cfg["graph-type"]) || "bar",
  groupFieldId: normalizeSelectValue(cfg["graph-group"]) || null,
  stackFieldId: normalizeSelectValue(cfg["graph-stack"]) || null,
  aggSpec: normalizeSelectValue(cfg["graph-agg"]) || "count",
});

const hashString = (input) => {
  let hash = 0;
  const text = String(input || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const buildJobFingerprint = (configSnapshot) => hashString(stableStringify({ v: JOB_VERSION, configSnapshot }));

const getInstallationKey = (context = {}) => {
  const cloudId =
    context.cloudId ||
    context.extension?.cloudId ||
    context.installContext ||
    context.localId ||
    "unknown-installation";

  return String(cloudId);
};

const getJobStorageKey = (installationKey, fingerprint) =>
  `report-job:${installationKey}:${fingerprint}`;

const getJobSummary = (job) => ({
  state: job?.state || "missing",
  fingerprint: job?.fingerprint || null,
  startedAt: job?.startedAt || null,
  updatedAt: job?.updatedAt || null,
  completedAt: job?.completedAt || null,
  progress: job?.progress || null,
  error: job?.error || null,
  result: job?.state === "complete" ? job.result : null,
});

const setJobRecord = async (storageKey, value) => {
  await storage.set(storageKey, value);
};

const fetchJson = async (url, options = {}) => {
  const response = await api.asUser().requestJira(url, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...(options.body ? { body: options.body } : {}),
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      error: {
        error: "Jira search failed",
        status: response.status,
        body: text,
      },
    };
  }

  return { ok: true, data: await response.json() };
};

const searchJqlPage = async ({ jql, fields, maxResults, nextPageToken = null }) =>
  fetchJson(route`/rest/api/3/search/jql`, {
    method: "POST",
    body: JSON.stringify({
      jql,
      maxResults,
      fields,
      ...(nextPageToken ? { nextPageToken } : {}),
    }),
  });

const buildMissingConfigError = (config) => ({
  error: "Missing required config.",
  missing: {
    "graph-name": !config.name,
    "graph-jql": !config.jql,
    "graph-group": !config.groupFieldId,
  },
});

const addUniqueClause = (list, clause) => {
  if (!clause || list.includes(clause)) {
    return;
  }
  list.push(clause);
};

const getAggregationSpec = (config) => {
  let agg = "count";
  let aggFieldId = null;
  const colonIndex = config.aggSpec.indexOf(":");

  if (config.aggSpec === "count") {
    agg = "count";
  } else if (colonIndex > -1) {
    agg = config.aggSpec.slice(0, colonIndex).toLowerCase();
    aggFieldId = config.aggSpec.slice(colonIndex + 1);
  } else {
    agg = config.aggSpec.toLowerCase();
  }

  return { agg, aggFieldId };
};

const getFieldsForSingleJql = (config, aggFieldId) => {
  const fieldsSet = new Set([config.groupFieldId]);
  if (config.stackFieldId) {
    fieldsSet.add(config.stackFieldId);
  }
  if (aggFieldId) {
    fieldsSet.add(aggFieldId);
  }
  if (config.groupFieldId === "statuscategory" || config.stackFieldId === "statuscategory") {
    fieldsSet.add("status");
  }
  return Array.from(fieldsSet);
};

const createSingleBucket = () => ({
  count: 0,
  sum: 0,
  validCount: 0,
  groupClauses: [],
});

const createStackBucket = () => ({
  count: 0,
  sum: 0,
  validCount: 0,
  groupClauses: [],
  stackClauses: [],
});

const applyMetricToBucket = (bucket, agg, metricValue) => {
  bucket.count += 1;

  if (agg === "sum") {
    bucket.sum += metricValue == null ? 0 : metricValue;
    bucket.validCount += metricValue == null ? 0 : 1;
    return;
  }

  if (agg === "avg" && metricValue != null) {
    bucket.sum += metricValue;
    bucket.validCount += 1;
  }
};

const getBucketValue = (bucket, agg) => {
  if (agg === "sum") {
    return bucket.sum;
  }
  if (agg === "avg") {
    return bucket.validCount > 0 ? bucket.sum / bucket.validCount : 0;
  }
  return bucket.count;
};

const initializeSinglePartial = (config) => {
  const { agg, aggFieldId } = getAggregationSpec(config);

  if ((agg === "sum" || agg === "avg") && !aggFieldId) {
    return {
      error: {
        error: "Aggregation field id required for sum/avg. Use a value like 'sum:customfield_10016'.",
      },
    };
  }

  return {
    partial: {
      mode: "single-jql",
      agg,
      aggFieldId,
      fields: getFieldsForSingleJql(config, aggFieldId),
      nextPageToken: null,
      total: null,
      fetched: 0,
      page: 0,
      buckets: {},
    },
  };
};

const initializeMultiPartial = (config) => {
  const items = parseMultiJqlInput(config.multi);

  if (items.length === 0) {
    return {
      error: {
        error: "Multi JQL provided but no valid lines were found.",
      },
    };
  }

  return {
    partial: {
      mode: "multi-jql",
      items,
      itemIndex: 0,
      nextPageToken: null,
      currentItemTotal: 0,
      currentItemPage: 0,
      results: [],
    },
  };
};

const initializeJobPartial = (config) =>
  config.multi ? initializeMultiPartial(config) : initializeSinglePartial(config);

const finalizeSingleResult = (config, partial) => {
  const data = [];

  if (!config.stackFieldId) {
    for (const [label, bucket] of Object.entries(partial.buckets)) {
      data.push({
        type: label,
        label,
        value: getBucketValue(bucket, partial.agg),
        drilldownJql: combineDrilldownJql(config.jql, [bucket.groupClauses]),
        groupDrilldownJql: combineDrilldownJql(config.jql, [bucket.groupClauses]),
      });
    }
  } else {
    for (const [label, stackBuckets] of Object.entries(partial.buckets)) {
      for (const [stackLabel, bucket] of Object.entries(stackBuckets)) {
        data.push({
          type: stackLabel,
          label,
          value: getBucketValue(bucket, partial.agg),
          drilldownJql: combineDrilldownJql(config.jql, [bucket.groupClauses, bucket.stackClauses]),
          groupDrilldownJql: combineDrilldownJql(config.jql, [bucket.groupClauses]),
        });
      }
    }
  }

  return {
    title: config.name,
    chartType: config.chartType,
    groupBy: config.groupFieldId,
    stackBy: config.stackFieldId || null,
    aggregation: config.aggSpec,
    data,
    accessors: buildAccessors(),
    meta: {
      mode: "single-jql",
      totalIssuesInspected: partial.fetched,
      cappedAt: Math.min(partial.fetched, MAX_TOTAL),
      jql: config.jql,
      fieldsRequested: partial.fields,
      matchingIssueCount: partial.fetched,
      matchingIssues: [],
      notes: [
        "Data is shaped for Forge UI Kit chart components.",
        "Each rendered segment includes a drilldown JQL derived from the selected bucket values.",
        partial.fetched >= MAX_TOTAL
          ? `Processing stopped after ${MAX_TOTAL} issues to protect dashboard performance.`
          : null,
      ].filter(Boolean),
    },
  };
};

const finalizeMultiResult = (config, partial) => ({
  title: config.name,
  chartType: config.chartType || "pie",
  groupBy: null,
  stackBy: null,
  aggregation: "count",
  data: partial.results,
  accessors: buildAccessors(),
  meta: {
    mode: "multi-jql",
    jqls: partial.items.map((item) => ({ label: item.label, jql: item.jql })),
    notes: [
      "Totals are calculated per Multi JQL line.",
      "Each segment now includes a drilldown JQL that can be opened below the chart.",
    ],
  },
});

const buildProgress = (partial) => {
  if (partial.mode === "multi-jql") {
    const currentItem = partial.items[partial.itemIndex];

    return {
      stage: currentItem ? "Fetching Multi JQL results" : "Complete",
      current: currentItem ? partial.itemIndex + 1 : partial.items.length,
      total: partial.items.length,
      detail: currentItem
        ? `${currentItem.label} • page ${partial.currentItemPage || 1}`
        : "Report data is ready.",
    };
  }

  return {
    stage: "Fetching Jira issues",
    current: partial.fetched,
    total: partial.total,
    detail: `Page ${partial.page || 1} • ${partial.fetched} issues processed`,
  };
};

const createBaseJobRecord = ({ installationKey, fingerprint, configSnapshot, existingJob, partial }) => {
  const now = new Date().toISOString();

  return {
    fingerprint,
    installationKey,
    configSnapshot,
    state: "running",
    startedAt: existingJob?.startedAt || now,
    updatedAt: now,
    completedAt: null,
    progress: buildProgress(partial),
    error: null,
    result: existingJob?.state === "complete" ? existingJob.result : null,
    partial,
  };
};

const advanceSinglePartial = async (config, partial, deadline) => {
  while (Date.now() < deadline && partial.fetched < MAX_TOTAL) {
    const response = await searchJqlPage({
      jql: config.jql,
      fields: partial.fields,
      maxResults: MAX_RESULTS_PER_PAGE,
      nextPageToken: partial.nextPageToken,
    });

    if (!response.ok) {
      return { error: { ...response.error, jql: config.jql } };
    }

    const data = response.data;
    const issues = Array.isArray(data.issues) ? data.issues : [];
    partial.total = typeof data.total === "number" ? data.total : partial.total;
    partial.page += 1;
    partial.fetched += issues.length;
    partial.nextPageToken = data.nextPageToken || null;

    for (const issue of issues) {
      const fields = issue.fields || {};
      const groupEntries = extractFieldEntries(fields, config.groupFieldId);
      const stackEntries = extractFieldEntries(fields, config.stackFieldId);
      const metricValue = partial.agg === "count" ? 1 : toNumber(fields[partial.aggFieldId]);

      for (const groupEntry of groupEntries) {
        const groupLabel = groupEntry.label || "Unspecified";

        if (!config.stackFieldId) {
          const bucket = partial.buckets[groupLabel] || createSingleBucket();
          partial.buckets[groupLabel] = bucket;
          applyMetricToBucket(bucket, partial.agg, metricValue);
          addUniqueClause(bucket.groupClauses, groupEntry.clause);
          continue;
        }

        if (!partial.buckets[groupLabel]) {
          partial.buckets[groupLabel] = {};
        }

        for (const stackEntry of stackEntries) {
          const stackLabel = stackEntry.label || "Unspecified";
          const bucket = partial.buckets[groupLabel][stackLabel] || createStackBucket();
          partial.buckets[groupLabel][stackLabel] = bucket;
          applyMetricToBucket(bucket, partial.agg, metricValue);
          addUniqueClause(bucket.groupClauses, groupEntry.clause);
          addUniqueClause(bucket.stackClauses, stackEntry.clause);
        }
      }
    }

    if (issues.length === 0 || data.isLast === true || !partial.nextPageToken || partial.fetched >= MAX_TOTAL) {
      return { done: true };
    }
  }

  return { done: false };
};

const advanceMultiPartial = async (partial, deadline) => {
  while (Date.now() < deadline && partial.itemIndex < partial.items.length) {
    const item = partial.items[partial.itemIndex];

    const response = await searchJqlPage({
      jql: item.jql,
      fields: ["key"],
      maxResults: MULTI_JQL_MAX_RESULTS,
      nextPageToken: partial.nextPageToken,
    });

    if (!response.ok) {
      return { error: { ...response.error, jql: item.jql } };
    }

    const data = response.data;
    const issues = Array.isArray(data.issues) ? data.issues : [];
    partial.currentItemPage += 1;
    partial.currentItemTotal += issues.length;
    partial.nextPageToken = data.nextPageToken || null;

    if (issues.length === 0 || data.isLast === true || !partial.nextPageToken) {
      partial.results.push({
        type: item.label,
        label: item.label,
        value: partial.currentItemTotal,
        drilldownJql: item.jql,
        groupDrilldownJql: item.jql,
      });
      partial.itemIndex += 1;
      partial.nextPageToken = null;
      partial.currentItemTotal = 0;
      partial.currentItemPage = 0;
    }
  }

  return { done: partial.itemIndex >= partial.items.length };
};

const advanceReportJob = async ({ installationKey, fingerprint, configSnapshot, storageKey, existingJob }) => {
  const initialized =
    existingJob?.state === "running" && existingJob?.partial
      ? { partial: existingJob.partial }
      : initializeJobPartial(configSnapshot);

  if (initialized.error) {
    const failedJob = {
      fingerprint,
      installationKey,
      configSnapshot,
      state: "failed",
      startedAt: existingJob?.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      progress: null,
      error: initialized.error,
      result: null,
      partial: null,
    };
    await setJobRecord(storageKey, failedJob);
    return failedJob;
  }

  const partial = initialized.partial;
  const runningJob = createBaseJobRecord({
    installationKey,
    fingerprint,
    configSnapshot,
    existingJob,
    partial,
  });
  await setJobRecord(storageKey, runningJob);

  const deadline = Date.now() + PROCESSING_TIME_BUDGET_MS;
  const outcome =
    partial.mode === "multi-jql"
      ? await advanceMultiPartial(partial, deadline)
      : await advanceSinglePartial(configSnapshot, partial, deadline);

  if (outcome.error) {
    const failedJob = {
      ...runningJob,
      state: "failed",
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      progress: null,
      error: outcome.error,
      result: null,
      partial: null,
    };
    await setJobRecord(storageKey, failedJob);
    return failedJob;
  }

  if (!outcome.done) {
    const updatedJob = {
      ...runningJob,
      updatedAt: new Date().toISOString(),
      progress: buildProgress(partial),
      result: null,
      partial,
    };
    await setJobRecord(storageKey, updatedJob);
    return updatedJob;
  }

  const result =
    partial.mode === "multi-jql"
      ? finalizeMultiResult(configSnapshot, partial)
      : finalizeSingleResult(configSnapshot, partial);

  const completedJob = {
    ...runningJob,
    state: "complete",
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    progress: {
      stage: "Complete",
      current: 1,
      total: 1,
      detail: "Report data is ready.",
    },
    error: null,
    result,
    partial: null,
  };
  await setJobRecord(storageKey, completedJob);
  return completedJob;
};

const getOrQueueReportJobStatus = async ({ context, forceRefresh = false }) => {
  const configSnapshot = toConfigSnapshot(context?.extension?.gadgetConfiguration || {});

  if (!configSnapshot.multi && (!configSnapshot.name || !configSnapshot.jql || !configSnapshot.groupFieldId)) {
    return getJobSummary({
      state: "invalid-config",
      error: buildMissingConfigError(configSnapshot),
    });
  }

  const installationKey = getInstallationKey(context);
  const fingerprint = buildJobFingerprint(configSnapshot);
  const storageKey = getJobStorageKey(installationKey, fingerprint);
  const existingJob = await storage.get(storageKey);

  if (!forceRefresh && existingJob?.state === "complete") {
    return getJobSummary(existingJob);
  }

  const job = await advanceReportJob({
    installationKey,
    fingerprint,
    configSnapshot,
    storageKey,
    existingJob: forceRefresh ? null : existingJob,
  });

  return getJobSummary(job);
};

const computeMultiJqlReport = async (config, progressCallback) => {
  const items = parseMultiJqlInput(config.multi);

  if (items.length === 0) {
    return { error: "Multi JQL provided but no valid lines were found." };
  }

  const results = [];
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    let total = 0;
    let nextToken = null;

    for (let page = 0; page < MULTI_JQL_MAX_PAGES; page += 1) {
      const response = await searchJqlPage({
        jql: item.jql,
        maxResults: MULTI_JQL_MAX_RESULTS,
        fields: ["key"],
        nextPageToken: nextToken,
      });
      if (!response.ok) {
        return { ...response.error, jql: item.jql };
      }

      const data = response.data;
      const issues = Array.isArray(data.issues) ? data.issues : [];
      total += issues.length;

      await progressCallback({
        stage: "Fetching Multi JQL results",
        current: itemIndex + 1,
        total: items.length,
        detail: `${item.label} • page ${page + 1}`,
      });

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
    title: config.name,
    chartType: config.chartType || "pie",
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
};

const computeSingleJqlReport = async (config, progressCallback) => {
  if (!config.name || !config.jql || !config.groupFieldId) {
    return buildMissingConfigError(config);
  }

  let agg = "count";
  let aggFieldId = null;
  const colonIndex = config.aggSpec.indexOf(":");

  if (config.aggSpec === "count") {
    agg = "count";
  } else if (colonIndex > -1) {
    agg = config.aggSpec.slice(0, colonIndex).toLowerCase();
    aggFieldId = config.aggSpec.slice(colonIndex + 1);
  } else {
    agg = config.aggSpec.toLowerCase();
  }

  if ((agg === "sum" || agg === "avg") && !aggFieldId) {
    return {
      error: "Aggregation field id required for sum/avg. Use a value like 'sum:customfield_10016'.",
    };
  }

  const fieldsSet = new Set([config.groupFieldId]);
  if (config.stackFieldId) {
    fieldsSet.add(config.stackFieldId);
  }
  if (aggFieldId) {
    fieldsSet.add(aggFieldId);
  }
  if (config.groupFieldId === "statuscategory" || config.stackFieldId === "statuscategory") {
    fieldsSet.add("status");
  }

  const fieldsParam = Array.from(fieldsSet).join(",");
  const buckets = new Map();
  const issueKeys = new Set();

  let startAt = 0;
  let fetched = 0;
  let total = null;
  let page = 0;
  let nextToken = null;

  while (fetched < MAX_TOTAL) {
    const response = await searchJqlPage({
      jql: config.jql,
      fields: Array.from(fieldsSet),
      maxResults: MAX_RESULTS_PER_PAGE,
      nextPageToken: nextToken,
    });
    if (!response.ok) {
      return { ...response.error, jql: config.jql };
    }

    const data = response.data;
    total = typeof data.total === "number" ? data.total : total;

    const issues = Array.isArray(data.issues) ? data.issues : [];
    fetched += issues.length;
    page += 1;
    nextToken = data.nextPageToken || null;

    await progressCallback({
      stage: "Fetching Jira issues",
      current: fetched,
      total,
      detail: `Page ${page} • ${fetched} issues processed`,
    });

    for (const issue of issues) {
      const fields = issue.fields || {};
      if (issue.key) {
        issueKeys.add(issue.key);
      }
      const groupEntries = extractFieldEntries(fields, config.groupFieldId);
      const stackEntries = extractFieldEntries(fields, config.stackFieldId);
      const metricValue = agg === "count" ? 1 : toNumber(fields[aggFieldId]);

      for (const groupEntry of groupEntries) {
        const groupLabel = groupEntry.label || "Unspecified";

        if (!config.stackFieldId) {
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

    if (issues.length === 0 || data.isLast === true || !nextToken) {
      break;
    }
  }

  const result = [];

  if (!config.stackFieldId) {
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
        drilldownJql: combineDrilldownJql(config.jql, [bucket.groupClauses]),
        groupDrilldownJql: combineDrilldownJql(config.jql, [bucket.groupClauses]),
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
          drilldownJql: combineDrilldownJql(config.jql, [bucket.groupClauses, bucket.stackClauses]),
          groupDrilldownJql: combineDrilldownJql(config.jql, [bucket.groupClauses]),
        });
      }
    }
  }

  return {
    title: config.name,
    chartType: config.chartType,
    groupBy: config.groupFieldId,
    stackBy: config.stackFieldId || null,
    aggregation: config.aggSpec,
    data: result,
    accessors: buildAccessors(),
    meta: {
      mode: "single-jql",
      totalIssuesInspected: fetched,
      cappedAt: Math.min(fetched, MAX_TOTAL),
      jql: config.jql,
      fieldsRequested: Array.from(fieldsSet),
      matchingIssueCount: issueKeys.size,
      matchingIssues: Array.from(issueKeys)
        .slice(0, MATCHING_ISSUE_DISPLAY_LIMIT)
        .map((key) => ({ key })),
      notes: [
        "Data is shaped for Forge UI Kit chart components.",
        "Each rendered segment includes a drilldown JQL derived from the selected bucket values.",
        fetched >= MAX_TOTAL ? `Processing stopped after ${MAX_TOTAL} issues to protect dashboard performance.` : null,
      ].filter(Boolean),
    },
  };
};

const computeReport = async (config, progressCallback) => {
  if (config.multi) {
    return computeMultiJqlReport(config, progressCallback);
  }
  return computeSingleJqlReport(config, progressCallback);
};

resolver.define("startReportJob", async (req) =>
  getOrQueueReportJobStatus({
    context: req.context,
    forceRefresh: Boolean(req.payload?.forceRefresh),
  })
);

resolver.define("getReportJobStatus", async (req) =>
  getOrQueueReportJobStatus({
    context: req.context,
    forceRefresh: false,
  })
);

resolver.define("getText2", async (req) =>
  getOrQueueReportJobStatus({
    context: req.context,
    forceRefresh: false,
  })
);

// The consumer is intentionally a no-op for now.
// The Forge Queue constructor is failing in the target runtime, so the gadget
// falls back to direct resolver execution until the async events path is safe.
export const processReportJob = async () => {};

export const handler = resolver.getDefinitions();
