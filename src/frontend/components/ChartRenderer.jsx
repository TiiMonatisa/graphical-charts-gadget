// ChartRenderer is a small, focused component responsible for choosing
// the correct UI Kit chart component based on the selected chart type.
// It accepts a normalized `result` structure produced by buildResult(...)
// so that the logic and the rendering concerns remain separate.

import React from "react";
import {
  SectionMessage,
  BarChart,
  HorizontalBarChart,
  StackBarChart,
  HorizontalStackBarChart,
  LineChart,
  PieChart,
  DonutChart,
} from "@forge/react";

const ChartRenderer = ({ chartType, result }) => {
  if (!result) return null;
  const { data, xKey, yKey, colorKey, title, subtitle } = result;

  // Friendly message when there is nothing to plot.
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <SectionMessage title="No data" appearance="warning">
        Your JQL returned no issues after filtering.
      </SectionMessage>
    );
  }

  switch (chartType) {
    case "bar":
      return (
        <BarChart
          data={data}
          xAccessor={xKey}
          yAccessor={yKey}
          colorAccessor={colorKey}
          title={title}
          subtitle={subtitle}
        />
      );
    case "horizontal-bar":
      return (
        <HorizontalBarChart
          data={data}
          xAccessor={xKey}
          yAccessor={yKey}
          colorAccessor={colorKey}
          title={title}
          subtitle={subtitle}
        />
      );
    case "stack-bar":
      return (
        <StackBarChart
          data={data}
          xAccessor={xKey}
          yAccessor={yKey}
          colorAccessor={colorKey}
          title={title}
          subtitle={subtitle}
        />
      );
    case "horizontal-stack-bar":
      return (
        <HorizontalStackBarChart
          data={data}
          xAccessor={xKey}
          yAccessor={yKey}
          colorAccessor={colorKey}
          title={title}
          subtitle={subtitle}
        />
      );
    case "line":
      return (
        <LineChart
          data={data}
          xAccessor={xKey}
          yAccessor={yKey}
          colorAccessor={colorKey}
          title={title}
          subtitle={subtitle}
        />
      );
    case "pie":
      return (
        <PieChart
          data={data}
          valueAccessor={yKey}
          labelAccessor={xKey}
          colorAccessor={colorKey}
          title={title}
          subtitle={subtitle}
        />
      );
    case "donut":
      return (
        <DonutChart
          data={data}
          valueAccessor={yKey}
          labelAccessor={xKey}
          colorAccessor={colorKey}
          title={title}
          subtitle={subtitle}
        />
      );
    default:
      return (
        <SectionMessage title="Unknown chart type" appearance="error">
          Selected chart type "{chartType}" is not supported.
        </SectionMessage>
      );
  }
};

export default ChartRenderer;

