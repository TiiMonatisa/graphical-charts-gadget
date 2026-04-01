// View component for rendering the chart. It fetches data from the resolver,
// then applies lightweight, local chart filters in the frontend so the user
// can compare selected bars or selected series without editing gadget config.

import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Inline,
  SectionMessage,
  Select,
  Stack,
  Text,
  useProductContext,
} from "@forge/react";
import { invoke } from "@forge/bridge";
import ChartRenderer from "./ChartRenderer";
import DrilldownList from "./DrilldownList";
import { buildResult } from "../utils/buildResult";
import { GRAPH_TYPE } from "../constants";

const toMultiValue = (value) => {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
};

const optionValueSet = (options) => new Set(options.map((option) => option.value));

const View = () => {
  const [data, setData] = useState(null);
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState([]);
  const context = useProductContext();

  useEffect(() => {
    let alive = true;

    invoke("getText2", { example: "my-invoke-variable" }).then((response) => {
      if (alive) {
        setData(response);
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  const gadgetConfiguration = context?.extension?.gadgetConfiguration || {};
  const chartType = gadgetConfiguration[GRAPH_TYPE]?.value || gadgetConfiguration[GRAPH_TYPE];
  const isError = data && data.error;
  const result = data && !isError ? buildResult(data) : null;

  const labelOptions = useMemo(() => {
    if (!result?.data) {
      return [];
    }

    return Array.from(new Set(result.data.map((entry) => entry.label)))
      .filter(Boolean)
      .map((value) => ({ label: value, value }));
  }, [result]);

  const seriesOptions = useMemo(() => {
    if (!result?.data) {
      return [];
    }

    return Array.from(new Set(result.data.map((entry) => entry.type)))
      .filter(Boolean)
      .map((value) => ({ label: value, value }));
  }, [result]);

  const hasIndependentSeriesFilter =
    result?.data?.some((entry) => entry.type && entry.type !== entry.label) || false;

  useEffect(() => {
    const validLabels = optionValueSet(labelOptions);
    const validSeries = optionValueSet(seriesOptions);

    setSelectedLabels((current) => current.filter((option) => validLabels.has(option.value)));
    setSelectedSeries((current) => current.filter((option) => validSeries.has(option.value)));
  }, [labelOptions, seriesOptions]);

  const selectedLabelValues = optionValueSet(selectedLabels);
  const selectedSeriesValues = optionValueSet(selectedSeries);

  const filteredResult =
    result && result.data
      ? {
          ...result,
          data: result.data.filter((entry) => {
            const keepLabel =
              selectedLabelValues.size === 0 || selectedLabelValues.has(entry.label);
            const keepSeries =
              selectedSeriesValues.size === 0 || selectedSeriesValues.has(entry.type);
            return keepLabel && keepSeries;
          }),
        }
      : result;

  const hasActiveFilter = selectedLabels.length > 0 || selectedSeries.length > 0;

  if (!context) {
    return "Loading...";
  }

  return (
    <>
      {isError && (
        <SectionMessage appearance="error" title="Unable to render chart">
          <Text>{String(data.error)}</Text>
          {data.status && <Text>Status: {String(data.status)}</Text>}
          {data.jql && <Text>JQL: {String(data.jql)}</Text>}
          {data.body && <Text>Details: {String(data.body).slice(0, 500)}</Text>}
        </SectionMessage>
      )}

      {result && (
        <Stack space="space.100">
          <Inline space="space.100">
            <Select
              isMulti
              isClearable
              isSearchable
              onChange={(value) => setSelectedLabels(toMultiValue(value))}
              options={labelOptions}
              placeholder="Filter bars"
              value={selectedLabels}
            />
            {hasIndependentSeriesFilter && (
              <Select
                isMulti
                isClearable
                isSearchable
                onChange={(value) => setSelectedSeries(toMultiValue(value))}
                options={seriesOptions}
                placeholder="Filter series"
                value={selectedSeries}
              />
            )}
            {hasActiveFilter && (
              <Button
                appearance="subtle"
                onClick={() => {
                  setSelectedLabels([]);
                  setSelectedSeries([]);
                }}
              >
                Clear chart filters
              </Button>
            )}
          </Inline>

          <ChartRenderer chartType={chartType} result={filteredResult} />
          <DrilldownList data={filteredResult.data} />
        </Stack>
      )}

      {!result && !isError && <Text>Loading chart data...</Text>}
    </>
  );
};

export default View;
