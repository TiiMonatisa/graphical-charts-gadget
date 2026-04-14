// View component for rendering the chart. It starts or resumes a report job,
// polls lightweight job status from the resolver, and only renders chart data
// once the incremental report build has finished.

import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Inline,
  SectionMessage,
  Select,
  Spinner,
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

const formatTimestamp = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString();
};

const View = () => {
  const [job, setJob] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const context = useProductContext();

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

  const gadgetConfiguration = context?.extension?.gadgetConfiguration || {};
  const chartType = gadgetConfiguration[GRAPH_TYPE]?.value || gadgetConfiguration[GRAPH_TYPE];
  const data = job?.result || null;
  const isError = Boolean(requestError) || job?.state === "failed" || job?.state === "invalid-config";
  const errorPayload = requestError ? { error: requestError } : job?.error || null;
  const result = data ? buildResult(data) : null;
  const reportMeta = result?.meta || null;

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
  const isWorking = isLoading || ACTIVE_JOB_STATES.has(job?.state);
  const lastUpdatedText = formatTimestamp(job?.updatedAt);
  const completedAtText = formatTimestamp(job?.completedAt);

  if (!context) {
    return "Loading...";
  }

  return (
    <Stack space="space.100">
      <Inline space="space.100">
        <Button appearance="primary" onClick={() => setRefreshToken((current) => current + 1)}>
          Refresh report
        </Button>
        {job?.state && <Text>Status: {String(job.state)}</Text>}
        {lastUpdatedText && <Text>Updated: {lastUpdatedText}</Text>}
      </Inline>

      {isWorking && (
        <SectionMessage appearance="information" title="Building report">
          <Stack space="space.050">
            <Inline space="space.100">
              <Spinner size="small" />
              <Text>
                {isLoading ? "Running the Jira search and preparing chart data." : job?.progress?.stage || "Processing"}
                {!isLoading && job?.progress?.detail ? ` — ${job.progress.detail}` : ""}
              </Text>
            </Inline>
            {!isLoading && job?.progress?.current != null && (
              <Text>
                Progress: {String(job.progress.current)}
                {job?.progress?.total != null ? ` / ${String(job.progress.total)}` : ""}
              </Text>
            )}
            <Text>
              The gadget is computing the report in the resolver and will render the chart as soon as the data is ready.
            </Text>
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
          {completedAtText && (
            <Text>
              Showing cached results from {completedAtText}. Use Refresh report to run the report again.
            </Text>
          )}

          {(reportMeta?.matchingIssueCount != null ||
            reportMeta?.totalIssuesInspected != null ||
            (Array.isArray(reportMeta?.notes) && reportMeta.notes.length > 0)) && (
            <SectionMessage appearance="information" title="Report details">
              <Stack space="space.050">
                {reportMeta?.matchingIssueCount != null && (
                  <Text>Matching issues included in this report: {String(reportMeta.matchingIssueCount)}</Text>
                )}
                {reportMeta?.totalIssuesInspected != null && (
                  <Text>Issues inspected while building the report: {String(reportMeta.totalIssuesInspected)}</Text>
                )}
                {Array.isArray(reportMeta?.notes) &&
                  reportMeta.notes.filter(Boolean).map((note) => <Text key={note}>{String(note)}</Text>)}
              </Stack>
            </SectionMessage>
          )}

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
