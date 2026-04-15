// Compact drilldown links for the chart.
// Each category shows a "whole bar" link first, and stacked charts can also
// reveal the smaller segment links beside it so the user can drill into either
// the total or one specific slice of the bar.

import React, { useMemo, useState } from "react";
import { Box, Button, Inline, Link, Stack, Text, xcss } from "@forge/react";

const WHOLE_BAR_STYLES = xcss({
  backgroundColor: "color.background.accent.blue.subtler",
  borderColor: "color.border.accent.blue",
  borderRadius: "border.radius.200",
  borderStyle: "solid",
  borderWidth: "border.width",
  paddingBlock: "space.050",
  paddingInline: "space.100",
});

const SEGMENT_TONES = [
  {
    backgroundColor: "color.background.accent.green.subtler",
    borderColor: "color.border.accent.green",
  },
  {
    backgroundColor: "color.background.accent.purple.subtler",
    borderColor: "color.border.accent.purple",
  },
  {
    backgroundColor: "color.background.accent.orange.subtler",
    borderColor: "color.border.accent.orange",
  },
  {
    backgroundColor: "color.background.accent.teal.subtler",
    borderColor: "color.border.accent.teal",
  },
  {
    backgroundColor: "color.background.accent.magenta.subtler",
    borderColor: "color.border.accent.magenta",
  },
  {
    backgroundColor: "color.background.accent.gray.subtler",
    borderColor: "color.border.accent.gray",
  },
];

const sectionStyles = xcss({
  borderColor: "color.border",
  borderRadius: "border.radius.200",
  borderStyle: "solid",
  borderWidth: "border.width",
  paddingBlock: "space.100",
  paddingInline: "space.100",
});

const rowStyles = xcss({
  borderColor: "color.border",
  borderRadius: "border.radius.200",
  borderStyle: "solid",
  borderWidth: "border.width",
  paddingBlock: "space.100",
  paddingInline: "space.100",
});

const buildSegmentStyles = (tone) =>
  xcss({
    backgroundColor: tone.backgroundColor,
    borderColor: tone.borderColor,
    borderRadius: "border.radius.200",
    borderStyle: "solid",
    borderWidth: "border.width",
    paddingBlock: "space.050",
    paddingInline: "space.100",
    minWidth: "72px",
  });

const buildIssueNavigatorUrl = (jql) => `/issues/?jql=${encodeURIComponent(jql)}`;

const groupPointsByLabel = (points) => {
  const groups = new Map();

  for (const point of points) {
    const key = point.label || "Unspecified";
    if (!groups.has(key)) {
      groups.set(key, {
        label: key,
        total: 0,
        wholeJql: point.groupDrilldownJql || point.drilldownJql,
        segments: [],
      });
    }

    const group = groups.get(key);
    group.total += Number(point.value) || 0;
    group.segments.push(point);
  }

  return Array.from(groups.values());
};

const hasVisibleSegments = (segments) =>
  segments.length > 1 || segments.some((segment) => segment.type && segment.type !== segment.label);

const DrilldownList = ({ data }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const drilldowns = useMemo(
    () => (Array.isArray(data) ? data.filter((point) => point?.drilldownJql) : []),
    [data]
  );
  // Grouping every point into drilldown rows is only useful once the user opens
  // the section. Deferring that work keeps the default view lighter, which helps
  // when several dashboard gadgets are open at the same time.
  const groups = useMemo(
    () => (isExpanded ? groupPointsByLabel(drilldowns) : []),
    [drilldowns, isExpanded]
  );

  if (drilldowns.length === 0) {
    return null;
  }

  return (
    <Box xcss={sectionStyles}>
      <Stack space="space.100">
        <Button appearance="subtle" onClick={() => setIsExpanded((current) => !current)}>
          {isExpanded ? "Hide drilldown links" : "Show drilldown links"}
        </Button>

        {isExpanded &&
          groups.map((group) => (
            <Box key={`${group.label}-${group.wholeJql}`} xcss={rowStyles}>
              <Stack space="space.100">
                <Text>{group.label}</Text>
                <Inline space="space.100">
                  <Box xcss={WHOLE_BAR_STYLES}>
                    <Link href={buildIssueNavigatorUrl(group.wholeJql)}>
                      {`${group.label} (${group.total})`}
                    </Link>
                  </Box>

                  {hasVisibleSegments(group.segments) &&
                    group.segments.map((segment, index) => {
                      const tone = SEGMENT_TONES[index % SEGMENT_TONES.length];
                      const label =
                        segment.type && segment.type !== segment.label ? segment.type : segment.label;

                      return (
                        <Box
                          key={`${group.label}-${segment.type}-${segment.drilldownJql}`}
                          xcss={buildSegmentStyles(tone)}
                        >
                          <Link href={buildIssueNavigatorUrl(segment.drilldownJql)}>
                            {`${label} (${segment.value})`}
                          </Link>
                        </Box>
                      );
                    })}
                </Inline>
              </Stack>
            </Box>
          ))}
      </Stack>
    </Box>
  );
};

export default DrilldownList;
