// View component for rendering the chart. It starts or resumes a report job,
// keeps the last completed result on screen during refreshes, and shows a
// progress bar while the resolver incrementally rebuilds the report.

import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Inline,
  ProgressBar,
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

const POLL_INTERVAL_MS = 3000;
const ACTIVE_JOB_STATES = new Set(["queued", "running"]);

const toMultiValue = (value) => {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
};

const optionValueSet = (options) => new Set(options.map((option) => option.value));

const clampProgressValue = (current, total) => {
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  return Math.min(Math.max(current / total, 0), 1);
};

const View = () => {
  const [job, setJob] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [cachedResult, setCachedResult] = useState(null);
  const context = useProductContext();
  const gadgetConfiguration = context?.extension?.gadgetConfiguration || {};
  const configurationKey = useMemo(() => JSON.stringify(gadgetConfiguration), [gadgetConfiguration]);

  useEffect(() => {
    if (!context) {
      return undefined;
    }

    let alive = true;
    let pollTimer = null;

    const loadJob = async (options = {}) => {
      try {
        setIsLoading(true);
        setRequestError(null);
        const response = await invoke(
          options.forceRefresh ? "startReportJob" : "getReportJobStatus",
          options.forceRefresh ? { forceRefresh: true } : {}
        );

        if (!alive) {
          return;
        }

        setJob(response);
        if (ACTIVE_JOB_STATES.has(response?.state)) {
          pollTimer = setTimeout(() => {
            loadJob({ forceRefresh: false });
          }, POLL_INTERVAL_MS);
        }
      } catch (error) {
        if (alive) {
          setRequestError(error?.message || "Unable to load report job status.");
        }
      } finally {
        if (alive) {
          setIsLoading(false);
        }
      }
    };

    loadJob({ forceRefresh: refreshToken > 0 });

    return () => {
      alive = false;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
    };
  }, [context, refreshToken]);

  useEffect(() => {
    // A saved gadget config change means this is effectively a new report
    // definition, so the previous chart filters and cached render should reset.
    setCachedResult(null);
    setSelectedLabels([]);
    setSelectedSeries([]);
  }, [configurationKey]);

  const chartType = gadgetConfiguration[GRAPH_TYPE]?.value || gadgetConfiguration[GRAPH_TYPE];
  const liveResult = useMemo(() => (job?.result ? buildResult(job.result) : null), [job?.result]);
  const isError = Boolean(requestError) || job?.state === "failed" || job?.state === "invalid-config";
  const errorPayload = requestError ? { error: requestError } : job?.error || null;

  useEffect(() => {
    if (liveResult) {
      setCachedResult(liveResult);
    }
  }, [liveResult]);

  const result = liveResult || cachedResult;

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

  const selectedLabelValues = useMemo(() => optionValueSet(selectedLabels), [selectedLabels]);
  const selectedSeriesValues = useMemo(() => optionValueSet(selectedSeries), [selectedSeries]);

  const filteredResult = useMemo(() => {
    if (!result?.data) {
      return result;
    }

    if (selectedLabelValues.size === 0 && selectedSeriesValues.size === 0) {
      return result;
    }

    return {
      ...result,
      data: result.data.filter((entry) => {
        const keepLabel = selectedLabelValues.size === 0 || selectedLabelValues.has(entry.label);
        const keepSeries = selectedSeriesValues.size === 0 || selectedSeriesValues.has(entry.type);
        return keepLabel && keepSeries;
      }),
    };
  }, [result, selectedLabelValues, selectedSeriesValues]);

  const hasActiveFilter = selectedLabels.length > 0 || selectedSeries.length > 0;
  const isWorking = isLoading || ACTIVE_JOB_STATES.has(job?.state);
  const processedIssues = Number(job?.progress?.processedIssues);
  const progressValue = clampProgressValue(Number(job?.progress?.current), Number(job?.progress?.total));
  const hasProgressValue = progressValue != null;

  if (!context) {
    return "Loading...";
  }

  return (
    <Stack space="space.100">
      <Inline space="space.100">
        <Button appearance="primary" onClick={() => setRefreshToken((current) => current + 1)}>
          Refresh report
        </Button>
        {isWorking && <Text>{job?.progress?.stage || "Building report"}</Text>}
      </Inline>

      {isWorking && (
        <SectionMessage appearance="information" title="Building report">
          <Stack space="space.050">
            <Text>{isLoading ? "Starting the Jira search." : job?.progress?.detail || "Processing report data."}</Text>
            <ProgressBar
              ariaLabel="Report generation progress"
              isIndeterminate={!hasProgressValue}
              value={hasProgressValue ? progressValue : undefined}
            />
            {Number.isFinite(processedIssues) && (
              <Text>{`${processedIssues.toLocaleString()} issues processed`}</Text>
            )}
          </Stack>
        </SectionMessage>
      )}

      {isError && (
        <SectionMessage appearance="error" title="Unable to render chart">
          <Stack space="space.050">
            <Text>{String(errorPayload?.error || "Unknown error")}</Text>
            {errorPayload?.status && <Text>Status: {String(errorPayload.status)}</Text>}
            {errorPayload?.jql && <Text>JQL: {String(errorPayload.jql)}</Text>}
            {errorPayload?.body && <Text>Details: {String(errorPayload.body).slice(0, 500)}</Text>}
          </Stack>
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

      {!result && !isError && !isWorking && (
        <Text>No cached report is available yet. Select Refresh report to start generating this chart.</Text>
      )}
    </Stack>
  );
};

export default View;
