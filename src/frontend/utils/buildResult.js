// Helper to translate the resolver payload into a shape
// directly consumable by the UI Kit chart components.
// This deliberately contains no UI code so it can be tested
// or reused by multiple chart renderers if needed.

export const buildResult = (payload) => {
  const { chartType, data, accessors, title } = payload;
  const subtitle =
    payload.meta?.mode === "multi-jql"
      ? `Multi JQL comparison (${payload.meta?.jqls?.length || 0} queries)`
      : payload.meta?.jql
        ? `JQL: ${payload.meta.jql}`
        : "";
  const acc = accessors?.[chartType] || {};

  // Resolve the accessor keys the chart expects.
  const xKey = acc.xAccessor ?? acc.labelAccessor ?? "label";
  const yKey = acc.yAccessor ?? acc.valueAccessor ?? "value";
  const colorKey = acc.colorAccessor ?? "type";

  return { data, xKey, yKey, colorKey, title, subtitle, meta: payload.meta };
};

