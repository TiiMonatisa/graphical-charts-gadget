// Shared parsing helpers for the gadget's "Multi JQL" mode.
// The same parsing rules are used in both the configuration screen
// and the backend resolver so that what the user sees while editing
// matches what the gadget will execute at runtime.

const LABEL_SEPARATORS = ["::", "=>", " | ", "|"];

const JQL_HINT_PATTERN =
  /\b(and|or|order by|is|in|not in|was|changed|project|status|assignee|issuetype|priority|created|updated|resolution)\b|[=!<>]/i;

const normalizeWhitespace = (value) => String(value || "").replace(/\s+/g, " ").trim();

const looksLikeJql = (value) => JQL_HINT_PATTERN.test(String(value || ""));

const inferLabelFromJql = (jql, index) => {
  const compact = normalizeWhitespace(jql);
  if (!compact) {
    return `Query ${index + 1}`;
  }
  return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact;
};

const splitLabelledLine = (line) => {
  for (const separator of LABEL_SEPARATORS) {
    const index = line.indexOf(separator);
    if (index === -1) {
      continue;
    }

    const label = normalizeWhitespace(line.slice(0, index));
    const jql = normalizeWhitespace(line.slice(index + separator.length));

    if (label && jql) {
      return { label, jql, separator };
    }
  }

  // We still support the older "Label: JQL" format, but only when the text
  // before the colon does not already look like actual JQL. This prevents
  // raw queries such as "project = ABC" from being split incorrectly.
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) {
    return null;
  }

  const label = normalizeWhitespace(line.slice(0, colonIndex));
  const jql = normalizeWhitespace(line.slice(colonIndex + 1));

  if (!label || !jql || looksLikeJql(label)) {
    return null;
  }

  return { label, jql, separator: ":" };
};

export const parseMultiJqlInput = (input) => {
  const lines = String(input || "").split(/\r?\n/);
  const entries = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = normalizeWhitespace(rawLine);

    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }

    const parsed = splitLabelledLine(line);
    if (parsed) {
      entries.push({
        label: parsed.label,
        jql: parsed.jql,
        lineNumber: index + 1,
        isAutoLabel: false,
        separator: parsed.separator,
      });
      continue;
    }

    entries.push({
      label: inferLabelFromJql(line, entries.length),
      jql: line,
      lineNumber: index + 1,
      isAutoLabel: true,
      separator: null,
    });
  }

  return entries;
};
