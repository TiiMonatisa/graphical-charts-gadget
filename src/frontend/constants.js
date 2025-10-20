// Constants and option lists shared across the UI Kit frontend.
// Keeping these in a dedicated module makes the UI components simpler
// and avoids magic strings scattered throughout the codebase.

// Configuration keys persisted by the dashboard gadget
export const GRAPH_NAME = "graph-name";
export const GRAPH_JQL = "graph-jql";
// Optional: allow multiple JQLs for comparison mode (one per line as Label: JQL)
export const GRAPH_MULTI_JQL = "graph-multi-jql";
export const GRAPH_TYPE = "graph-type";
export const GRAPH_GROUP = "graph-group";
export const GRAPH_AGG = "graph-agg";
// Optional: support stacked charts by a second field
export const GRAPH_STACK = "graph-stack";

// Available chart types as displayed in the configuration Select
export const CHART_OPTIONS = [
  { label: "Bar", value: "bar" },
  { label: "Donut", value: "donut" },
  { label: "Horizontal bar", value: "horizontal-bar" },
  { label: "Horizontal stack bar", value: "horizontal-stack-bar" },
  { label: "Line", value: "line" },
  { label: "Pie", value: "pie" },
  { label: "Stack bar", value: "stack-bar" },
];

// Supported aggregation types when not using Multi JQL mode
export const AGG_OPTIONS = [
  { label: "Count (issues)", value: "count" },
  { label: "Sum (numeric field)", value: "sum" },
  { label: "Average (numeric field)", value: "avg" },
];

