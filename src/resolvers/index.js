import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
const resolver = new Resolver();


resolver.define('getText', async (req) => {
  const name = req.context.extension.gadgetConfiguration['graph-name'];
  const jql = req.context.extension.gadgetConfiguration['graph-jql'];
  const type = req.context.extension.gadgetConfiguration['graph-type'];
  console.log(type);
  const resp = await api.asUser().requestJira(route`/rest/api/3/search/jql?jql=${jql}`,
      { method: 'GET', headers: { Accept: 'application/json' } }
  );
  const text = await resp.text();
  console.log(text);
  return 'Hello, world! ALL';
});


resolver.define('getText2', async (req) => {
  const cfg = req.context.extension.gadgetConfiguration || {};
  const name = cfg['graph-name'];
  const jql = cfg['graph-jql'] || "";
  const multi = cfg['graph-multi-jql'];

  // Fix: Handle both object with .value and direct string value
  const chartType = (cfg['graph-type']?.value) || cfg['graph-type'] || "bar";

  // Normalize Select values (can be object {label,value} or a plain string)
  const normId = (v) => (v && typeof v === 'object' && 'value' in v) ? v.value : v;
  const groupFieldId = normId(cfg['graph-group']);
  const stackFieldId = normId(cfg['graph-stack']); // optional second grouping for stacked charts
  const aggSpec = (cfg['graph-agg']?.value) || cfg['graph-agg'];

  // If multi-JQL is provided, we take a different, simpler path (totals per JQL).
  // Multi-JQL comparison mode: each line is "Label: JQL" (or "Label = JQL").
  // We fetch only the total count per JQL and return a simple dataset suitable for Pie/Donut charts.
  if (multi && String(multi).trim().length > 0) {
    const lines = String(multi)
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (lines.length === 0) {
      return { error: 'Multi JQL provided but no valid lines were found.' };
    }

    const items = [];
    for (const line of lines) {
      // Attempt to split by the first ':' or '=' to separate label from the JQL
      const m = line.match(/^(.*?)[=:](.*)$/);
      if (!m) {
        // If no label separator, use the whole line as JQL and auto-label
        items.push({ label: line.slice(0, 24).trim() || 'Series', jql: line });
      } else {
        const label = m[1].trim() || 'Series';
        const q = m[2].trim();
        if (q) items.push({ label, jql: q });
      }
    }

    if (items.length === 0) {
      return { error: 'No valid JQL found in Multi JQL input.' };
    }

    const results = [];
    for (const it of items) {
      // Count issues by paging via nextPageToken when present; fallback to 'total' if available.
      const MAX_RESULTS = 1000; // between 1 and 5000
      const MAX_PAGES = 100;    // safety cap
      let total = 0;
      let nextToken = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        // Build route with encoded params; use fields=key for minimal payload
        let url = route`/rest/api/3/search/jql?jql=${it.jql}&maxResults=${String(MAX_RESULTS)}&fields=key`;
        if (nextToken) {
          url = `${url}&nextPageToken=${encodeURIComponent(nextToken)}`;
        }
        const resp = await api.asUser().requestJira(url, { method: 'GET', headers: { Accept: 'application/json' } });
        if (!resp.ok) {
          const text = await resp.text();
          return { error: 'Jira search failed', status: resp.status, body: text, jql: it.jql };
        }
        const data = await resp.json();
        const issues = Array.isArray(data.issues) ? data.issues : [];
        total += issues.length;
        const hasTokenPaging = Object.prototype.hasOwnProperty.call(data, 'isLast') || Object.prototype.hasOwnProperty.call(data, 'nextPageToken');
        if (hasTokenPaging) {
          if (data.isLast === true) break;
          nextToken = data.nextPageToken;
          if (!nextToken) break;
        } else if (typeof data.total === 'number') {
          total = data.total;
          break;
        } else {
          break;
        }
      }
      results.push({ type: it.label, label: it.label, value: total });
    }

    const accessors = {
      donut: { colorAccessor: 'type', labelAccessor: 'label', valueAccessor: 'value' },
      pie: { colorAccessor: 'type', labelAccessor: 'label', valueAccessor: 'value' },
      bar: { xAccessor: 'label', yAccessor: 'value', colorAccessor: 'type' },
      'horizontal-bar': { xAccessor: 'label', yAccessor: 'value', colorAccessor: 'type' },
      'stack-bar': { xAccessor: 'label', yAccessor: 'value', colorAccessor: 'type' },
      'horizontal-stack-bar': { xAccessor: 'label', yAccessor: 'value', colorAccessor: 'type' },
      line: { xAccessor: 'label', yAccessor: 'value' },
    };

    return {
      title: name,
      chartType: (cfg['graph-type']?.value) || cfg['graph-type'] || 'pie',
      groupBy: null,
      stackBy: null,
      aggregation: 'count',
      data: results,
      accessors,
      meta: {
        mode: 'multi-jql',
        jqls: items.map(i => ({ label: i.label, jql: i.jql })),
        notes: ['Totals per JQL line; ideal for Pie/Donut comparisons.'],
      },
    };
  }

  if (!name || !jql || !groupFieldId) {
    return {
      error: "Missing required config.",
      missing: {
        ['graph-name']: !name,
        ['graph-jql']: !jql,
        ['graph-group']: !groupFieldId,
      },
    };
  }

  // Parse aggregation
  let agg = "count";
  let aggFieldId = null;
  const colonIdx = aggSpec.indexOf(":");
  if (aggSpec === "count") {
    agg = "count";
  } else if (colonIdx > -1) {
    agg = aggSpec.slice(0, colonIdx).toLowerCase();
    aggFieldId = aggSpec.slice(colonIdx + 1);
  } else {
    agg = aggSpec.toLowerCase();
  }
  if ((agg === "sum" || agg === "avg") && !aggFieldId) {
    return {error: "Aggregation field id required for sum/avg. Use e.g. 'sum:customfield_10016'."};
  }

  const fieldsSet = new Set([groupFieldId]);
  if (stackFieldId) fieldsSet.add(stackFieldId);
  if (aggFieldId) fieldsSet.add(aggFieldId);
  // If user asks for statuscategory, we actually need the 'status' field to derive it
  if (groupFieldId === 'statuscategory' || stackFieldId === 'statuscategory') {
    fieldsSet.add('status');
  }
  const fieldsParam = Array.from(fieldsSet).join(",");

  const MAX_RESULTS_PER_PAGE = 100;
  const MAX_TOTAL = 2000;
  let startAt = 0;
  let fetched = 0;
  let total = Infinity;

  // Buckets for aggregation:
  // - If no stack field: Map<label, {count,sum,validCount}>
  // - If stack field provided: Map<label, Map<stackLabel, {count,sum,validCount}>>
  const buckets = new Map();

  const normalizeToArray = (value) => {
    const labelOf = (v) => {
      if (v == null) return "Unspecified";
      if (Array.isArray(v)) return v.flatMap(labelOf);
      if (typeof v === "string" || typeof v === "number") return String(v);
      if (v.name) return String(v.name);
      if (v.displayName) return String(v.displayName);
      if (v.value != null) return String(v.value);
      if (v.key) return String(v.key);
      if (v.id) return String(v.id);
      return JSON.stringify(v);
    };
    const res = labelOf(value);
    return Array.isArray(res) ? res : [res];
  };

  const toNumber = (v) => {
    if (v == null) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };

  // Helper to extract a field's display labels for grouping. Supports direct field ids and a special alias 'statuscategory'.
  const extractLabels = (issueFields, fieldId) => {
    if (!fieldId) return ["All"];
    if (fieldId === 'statuscategory') {
      const sc = issueFields?.status?.statusCategory?.name || issueFields?.status?.statusCategory?.key;
      return normalizeToArray(sc);
    }
    return normalizeToArray(issueFields?.[fieldId]);
  };

  while (fetched < MAX_TOTAL && startAt < total) {
    const url = route`/rest/api/3/search/jql?jql=${jql}&fields=${fieldsParam}&startAt=${startAt}&maxResults=${MAX_RESULTS_PER_PAGE}`;
    const resp = await api.asUser().requestJira(url, {
      method: "GET",
      headers: {Accept: "application/json"},
    });
    if (!resp.ok) {
      const text = await resp.text();
      return {error: "Jira search failed", status: resp.status, body: text};
    }
    const data = await resp.json();
    total = typeof data.total === "number" ? data.total : 0;
    const issues = Array.isArray(data.issues) ? data.issues : [];
    fetched += issues.length;

    for (const issue of issues) {
      const f = issue.fields || {};
      const groupLabels = extractLabels(f, groupFieldId);
      const stackLabels = extractLabels(f, stackFieldId);

      const metricVal = agg === "count" ? 1 : toNumber(f[aggFieldId]);

      for (const gLabel of groupLabels) {
        const x = gLabel || "Unspecified";
        if (!stackFieldId) {
          // Single-dimension bucketing
          if (!buckets.has(x)) buckets.set(x, {count: 0, sum: 0, validCount: 0});
          const b = buckets.get(x);
          b.count += 1;
          if (agg === "sum") {
            b.sum += metricVal == null ? 0 : metricVal;
            b.validCount += metricVal == null ? 0 : 1;
          } else if (agg === "avg") {
            if (metricVal != null) {
              b.sum += metricVal;
              b.validCount += 1;
            }
          }
        } else {
          // Two-dimension bucketing
          if (!buckets.has(x)) buckets.set(x, new Map());
          const inner = buckets.get(x);
          for (const sLabel of stackLabels) {
            const c = sLabel || "Unspecified";
            if (!inner.has(c)) inner.set(c, {count: 0, sum: 0, validCount: 0});
            const b = inner.get(c);
            b.count += 1;
            if (agg === "sum") {
              b.sum += metricVal == null ? 0 : metricVal;
              b.validCount += metricVal == null ? 0 : 1;
            } else if (agg === "avg") {
              if (metricVal != null) {
                b.sum += metricVal;
                b.validCount += 1;
              }
            }
          }
        }
      }
    }

    startAt += MAX_RESULTS_PER_PAGE;
    if (issues.length === 0) break;
  }

  const result = [];
  if (!stackFieldId) {
    for (const [label, stats] of buckets.entries()) {
      let value;
      if (agg === "count") {
        value = stats.count;
      } else if (agg === "sum") {
        value = stats.sum;
      } else if (agg === "avg") {
        value = stats.validCount > 0 ? stats.sum / stats.validCount : 0;
      } else {
        value = stats.count;
      }
      result.push({ type: label, label, value });
    }
  } else {
    for (const [label, inner] of buckets.entries()) {
      for (const [stack, stats] of inner.entries()) {
        let value;
        if (agg === "count") {
          value = stats.count;
        } else if (agg === "sum") {
          value = stats.sum;
        } else if (agg === "avg") {
          value = stats.validCount > 0 ? stats.sum / stats.validCount : 0;
        } else {
          value = stats.count;
        }
        // For stacked charts, we emit objects with x=label and colorAccessor=type (stack label)
        result.push({ type: stack, label, value });
      }
    }
  }

  const accessors = {
    donut: {colorAccessor: "type", labelAccessor: "label", valueAccessor: "value"},
    pie: {colorAccessor: "type", labelAccessor: "label", valueAccessor: "value"},
    bar: {xAccessor: "label", yAccessor: "value", colorAccessor: "type"},
    "horizontal-bar": {xAccessor: "label", yAccessor: "value", colorAccessor: "type"},
    "stack-bar": {xAccessor: "label", yAccessor: "value", colorAccessor: "type"},
    "horizontal-stack-bar": {xAccessor: "label", yAccessor: "value", colorAccessor: "type"},
    line: {xAccessor: "label", yAccessor: "value"},
  };

  return {
    title: name,
    chartType: chartType,
    groupBy: groupFieldId,
    stackBy: stackFieldId || null,
    aggregation: aggSpec,
    data: result,
    accessors,
    meta: {
      totalIssuesInspected: fetched,
      cappedAt: Math.min(fetched, MAX_TOTAL),
      jql,
      fieldsRequested: Array.from(fieldsSet),
      notes: [
        "Data formatted per UI Kit chart components (array of objects with accessors).",
        "For Donut/Pie, use colorAccessor=type, labelAccessor=label, valueAccessor=value.",
        "For Bar/Line, use xAccessor=label, yAccessor=value.",
      ],
    },
  };
});



export const handler = resolver.getDefinitions();
