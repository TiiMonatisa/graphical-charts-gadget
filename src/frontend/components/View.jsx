// View component for rendering the chart. It fetches data from the resolver
// and delegates charting to ChartRenderer while keeping concerns separate.

import React, { useEffect, useState } from "react";
import { Text, useProductContext, SectionMessage } from "@forge/react";
import { invoke } from "@forge/bridge";
import ChartRenderer from "./ChartRenderer";
import { buildResult } from "../utils/buildResult";
import { GRAPH_TYPE, GRAPH_MULTI_JQL } from "../constants";

const View = () => {
  const [data, setData] = useState(null);
  const context = useProductContext();

  // Fetch chart data from resolver; it auto-detects multi-JQL vs single-JQL mode
  useEffect(() => {
    invoke("getText2", { example: "my-invoke-variable" }).then(setData);
  }, []);

  if (!context) {
    return "Loading...";
  }

  const {
    extension: { gadgetConfiguration },
  } = context;

  const chartType = gadgetConfiguration[GRAPH_TYPE]?.value || gadgetConfiguration[GRAPH_TYPE];
  const isError = data && data.error;
  const result = data && !isError ? buildResult(data) : null;

  const multi = gadgetConfiguration[GRAPH_MULTI_JQL];

  return (
    <>
      {multi && (
        <SectionMessage appearance="information" title="Comparison mode">
          Rendering totals per Multi JQL entry. Group/Stack/Aggregation are ignored.
        </SectionMessage>
      )}
      {isError && (
        <SectionMessage appearance="error" title="Unable to render chart">
          <Text>{String(data.error)}</Text>
          {data.status && <Text>Status: {String(data.status)}</Text>}
          {data.jql && <Text>JQL: {String(data.jql)}</Text>}
          {data.body && <Text>Details: {String(data.body).slice(0, 500)}</Text>}
        </SectionMessage>
      )}
      {result && <ChartRenderer chartType={chartType} result={result} />} 
      {!result && !isError && <Text>Loading chart data...</Text>}
    </>
  );
};

export default View;

