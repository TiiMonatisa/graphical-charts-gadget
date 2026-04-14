// Streamlined edit view for the dashboard gadget configuration.
// The goal here is to keep the current configuration visible without burying
// the actual form in explanatory blocks and duplicated saved values.

import React, { useEffect, useState } from "react";
import {
  Button,
  ButtonGroup,
  Form,
  FormFooter,
  FormSection,
  Label,
  RequiredAsterisk,
  SectionMessage,
  Select,
  Text,
  TextArea,
  Textfield,
  useForm,
  useProductContext,
} from "@forge/react";
import { requestJira, view } from "@forge/bridge";
import {
  AGG_OPTIONS,
  CHART_OPTIONS,
  GRAPH_AGG,
  GRAPH_GROUP,
  GRAPH_JQL,
  GRAPH_MULTI_JQL,
  GRAPH_NAME,
  GRAPH_STACK,
  GRAPH_TYPE,
} from "../constants";
import { parseMultiJqlInput } from "../../common/multiJql";

const normalizeSelectValue = (value) =>
  value && typeof value === "object" && "value" in value ? value.value : value || "";

const normalizeSelectLabel = (value) =>
  value && typeof value === "object" ? value.label || value.value || "" : value || "";

const findOptionLabel = (options, value) =>
  options.find((option) => option.value === value)?.label || value || "Not set";

const normalizeSearchInput = (value) =>
  typeof value === "string" ? value : value?.target?.value || "";

const SPECIAL_FIELD_OPTIONS = [
  { label: "Project", value: "project" },
  { label: "Status Category", value: "statuscategory" },
];

const buildFieldLabel = (value, resolvedFieldLabels) => {
  const normalizedValue = normalizeSelectValue(value);

  if (!normalizedValue) {
    return "None";
  }

  const specialField = SPECIAL_FIELD_OPTIONS.find((option) => option.value === normalizedValue);
  if (specialField) {
    return specialField.label;
  }

  return normalizeSelectLabel(value) || resolvedFieldLabels[normalizedValue] || normalizedValue;
};

const JQL_MODE_OPTIONS = [
  { label: "Single JQL", value: "single" },
  { label: "Multi JQL", value: "multi" },
];

const STACK_ENABLED_CHART_TYPES = new Set(["stack-bar", "horizontal-stack-bar"]);

const supportsStackBy = (chartType) => STACK_ENABLED_CHART_TYPES.has(chartType);

const filterFieldOptions = (options, query) => {
  const trimmed = String(query || "").trim().toLowerCase();
  if (!trimmed) {
    return options.slice(0, 50);
  }

  return options
    .filter((option) => {
      const label = String(option.label || "").toLowerCase();
      const value = String(option.value || "").toLowerCase();
      return label.includes(trimmed) || value.includes(trimmed);
    })
    .slice(0, 50);
};

const Edit = () => {
  const { handleSubmit, register, getFieldId } = useForm();
  const context = useProductContext();
  const cfg = context?.extension?.gadgetConfiguration || {};

  const initialChartType = normalizeSelectValue(cfg[GRAPH_TYPE]) || "bar";
  const currentGroupValue = normalizeSelectValue(cfg[GRAPH_GROUP]);
  const currentStackValue = normalizeSelectValue(cfg[GRAPH_STACK]);

  const [groupQuery, setGroupQuery] = useState("");
  const [stackQuery, setStackQuery] = useState("");
  const [groupOptions, setGroupOptions] = useState([]);
  const [stackOptions, setStackOptions] = useState([]);
  const [allFieldOptions, setAllFieldOptions] = useState([]);
  const [groupLoading, setGroupLoading] = useState(false);
  const [stackLoading, setStackLoading] = useState(false);
  const [groupError, setGroupError] = useState(null);
  const [stackError, setStackError] = useState(null);
  const [resolvedFieldLabels, setResolvedFieldLabels] = useState({});
  const [multiJqlDraft, setMultiJqlDraft] = useState(cfg[GRAPH_MULTI_JQL] || "");
  const [jqlMode, setJqlMode] = useState(
    String(cfg[GRAPH_MULTI_JQL] || "").trim() ? "multi" : "single"
  );
  const [selectedChartType, setSelectedChartType] = useState(initialChartType);

  const titleField = register(GRAPH_NAME, { required: true });
  const chartTypeField = register(GRAPH_TYPE);
  const singleJqlField = register(GRAPH_JQL);
  const multiJqlField = register(GRAPH_MULTI_JQL);
  const groupField = register(GRAPH_GROUP, { required: true });
  const stackField = register(GRAPH_STACK);
  const aggregationField = register(GRAPH_AGG);

  const multiEntries = parseMultiJqlInput(multiJqlDraft);

  const withSpecialAndSelected = (baseOptions, selectedValue, includeNone) => {
    const selectedId = normalizeSelectValue(selectedValue);
    const selectedLabel =
      normalizeSelectLabel(selectedValue) || resolvedFieldLabels[selectedId] || selectedId;

    const seen = new Set(baseOptions.map((option) => option.value));
    const options = [...SPECIAL_FIELD_OPTIONS, ...baseOptions];

    if (includeNone) {
      options.unshift({ label: "(None)", value: "" });
    }

    const isSpecialField = SPECIAL_FIELD_OPTIONS.some((option) => option.value === selectedId);
    if (selectedId && !seen.has(selectedId) && !isSpecialField) {
      options.push({ label: selectedLabel, value: selectedId });
    }

    return options;
  };

  useEffect(() => {
    let alive = true;

    const loadFields = async () => {
      try {
        setGroupLoading(true);
        setStackLoading(true);

        const response = await requestJira("/rest/api/3/field");
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Failed to load fields: ${response.status} ${text}`);
        }

        const fields = await response.json();
        const fieldOptions = (Array.isArray(fields) ? fields : [])
          .map((field) => ({
            label: `${field.name} (${field.id})`,
            value: field.id,
          }))
          .sort((a, b) => a.label.localeCompare(b.label));

        const nextLabels = {};
        for (const option of fieldOptions) {
          nextLabels[option.value] = option.label;
        }

        if (alive) {
          setAllFieldOptions(fieldOptions);
          setResolvedFieldLabels(nextLabels);
        }
      } catch (error) {
        if (alive) {
          const message = error?.message || String(error);
          setGroupError(message);
          setStackError(message);
        }
      } finally {
        if (alive) {
          setGroupLoading(false);
          setStackLoading(false);
        }
      }
    };

    loadFields();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setGroupOptions(
      withSpecialAndSelected(filterFieldOptions(allFieldOptions, groupQuery), currentGroupValue, false)
    );
  }, [allFieldOptions, groupQuery, currentGroupValue, resolvedFieldLabels]);

  useEffect(() => {
    setStackOptions(
      withSpecialAndSelected(filterFieldOptions(allFieldOptions, stackQuery), currentStackValue, true)
    );
  }, [allFieldOptions, stackQuery, currentStackValue, resolvedFieldLabels]);

  const onSubmit = async (formData) => {
    const nextFormData = {
      ...formData,
      [GRAPH_JQL]: jqlMode === "single" ? formData[GRAPH_JQL] || "" : "",
      [GRAPH_MULTI_JQL]: jqlMode === "multi" ? formData[GRAPH_MULTI_JQL] || "" : "",
      [GRAPH_STACK]: supportsStackBy(selectedChartType) && jqlMode === "single"
        ? formData[GRAPH_STACK] || ""
        : "",
    };

    await view.submit(nextFormData);
    return nextFormData;
  };

  return (
    <Form onSubmit={handleSubmit(onSubmit)}>
      <FormSection>
        <SectionMessage appearance="information" title="Current setup">
          <Text>
            {`${cfg[GRAPH_NAME] || "Untitled"} | ${findOptionLabel(
              CHART_OPTIONS,
              normalizeSelectValue(cfg[GRAPH_TYPE])
            )} | ${
              String(cfg[GRAPH_MULTI_JQL] || "").trim() ? "Multi JQL" : "Single JQL"
            }`}
          </Text>
          <Text>
            {`Group: ${buildFieldLabel(cfg[GRAPH_GROUP], resolvedFieldLabels)} | Stack: ${buildFieldLabel(
              cfg[GRAPH_STACK],
              resolvedFieldLabels
            )} | Aggregation: ${findOptionLabel(
              AGG_OPTIONS,
              normalizeSelectValue(cfg[GRAPH_AGG]) || "count"
            )}`}
          </Text>
        </SectionMessage>
      </FormSection>

      <FormSection>
        <Label labelFor={getFieldId(GRAPH_NAME)}>
          Gadget title <RequiredAsterisk />
        </Label>
        <Textfield {...titleField} defaultValue={cfg[GRAPH_NAME] || ""} />
      </FormSection>

      <FormSection>
        <Label labelFor={getFieldId(GRAPH_TYPE)}>Chart type</Label>
        <Select
          {...chartTypeField}
          defaultValue={cfg[GRAPH_TYPE] || "bar"}
          onChange={(value) => {
            setSelectedChartType(normalizeSelectValue(value));
            return chartTypeField.onChange(value);
          }}
          options={CHART_OPTIONS}
        />
      </FormSection>

      <FormSection>
        <Label labelFor="jql-mode">Query mode</Label>
        <ButtonGroup>
          {JQL_MODE_OPTIONS.map((option) => (
            <Button
              appearance={jqlMode === option.value ? "primary" : "default"}
              key={option.value}
              onClick={() => setJqlMode(option.value)}
              type="button"
            >
              {option.label}
            </Button>
          ))}
        </ButtonGroup>
      </FormSection>

      {jqlMode === "single" && (
        <FormSection>
          <Label labelFor={getFieldId(GRAPH_JQL)}>Base JQL</Label>
          <TextArea
            {...singleJqlField}
            defaultValue={cfg[GRAPH_JQL] || ""}
            placeholder='Example: project = DEMO AND resolution is EMPTY'
          />
        </FormSection>
      )}

      {jqlMode === "multi" && (
        <FormSection>
          <Label labelFor={getFieldId(GRAPH_MULTI_JQL)}>Multi JQL</Label>
          <TextArea
            {...multiJqlField}
            defaultValue={cfg[GRAPH_MULTI_JQL] || ""}
            placeholder={`Open work :: project = DEMO AND resolution is EMPTY
Ready for QA => project = DEMO AND status = "Ready for QA"`}
            onChange={(event) => {
              setMultiJqlDraft(event.target.value);
              return multiJqlField.onChange(event);
            }}
          />
          <Text>Optional labels: `Label :: JQL`, `Label =&gt; JQL`, or `Label | JQL`.</Text>
          {!!multiEntries.length && (
            <Text>{`Detected comparison entries: ${multiEntries
              .map((entry) => entry.label)
              .slice(0, 5)
              .join(", ")}${multiEntries.length > 5 ? "..." : ""}`}</Text>
          )}
        </FormSection>
      )}

      {jqlMode === "single" && (
        <FormSection>
          <Label labelFor={getFieldId(GRAPH_GROUP)}>
            Group by field <RequiredAsterisk />
          </Label>
          <Select
            {...groupField}
            defaultValue={cfg[GRAPH_GROUP] || ""}
            isDisabled={groupLoading}
            isLoading={groupLoading}
            isSearchable
            onInputChange={(value) => setGroupQuery(normalizeSearchInput(value))}
            options={groupOptions}
            placeholder="Type to search Jira fields"
          />
          {groupError && <Text>{`Field search error: ${String(groupError)}`}</Text>}
        </FormSection>
      )}

      {jqlMode === "single" && supportsStackBy(selectedChartType) && (
        <FormSection>
          <Label labelFor={getFieldId(GRAPH_STACK)}>Stack by field (optional)</Label>
          <Select
            {...stackField}
            defaultValue={cfg[GRAPH_STACK] || ""}
            isDisabled={stackLoading}
            isLoading={stackLoading}
            isSearchable
            onInputChange={(value) => setStackQuery(normalizeSearchInput(value))}
            options={stackOptions}
            placeholder="Type to search Jira fields"
          />
          {stackError && <Text>{`Field search error: ${String(stackError)}`}</Text>}
        </FormSection>
      )}

      {jqlMode === "single" && (
        <FormSection>
          <Label labelFor={getFieldId(GRAPH_AGG)}>Aggregation</Label>
          <Select {...aggregationField} defaultValue={cfg[GRAPH_AGG] || "count"} options={AGG_OPTIONS} />
        </FormSection>
      )}

      <FormFooter>
        <Button appearance="primary" type="submit">
          Submit
        </Button>
        <Button type="button" onClick={() => view.close()}>
          Cancel
        </Button>
      </FormFooter>
    </Form>
  );
};

export default Edit;
