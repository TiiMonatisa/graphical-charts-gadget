// Streamlined edit view for the dashboard gadget configuration.
// The goal here is to keep the current configuration visible without burying
// the actual form in explanatory blocks and duplicated saved values.

import React, { useEffect, useState } from "react";
import {
  Button,
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

const buildFieldLabel = (value, resolvedFieldLabels) => {
  const normalizedValue = normalizeSelectValue(value);

  if (!normalizedValue) {
    return "None";
  }

  if (normalizedValue === "statuscategory") {
    return "Status Category";
  }

  return normalizeSelectLabel(value) || resolvedFieldLabels[normalizedValue] || normalizedValue;
};

const Edit = () => {
  const { handleSubmit, register, getFieldId } = useForm();
  const context = useProductContext();
  const cfg = context?.extension?.gadgetConfiguration || {};

  const currentGroupValue = normalizeSelectValue(cfg[GRAPH_GROUP]);
  const currentStackValue = normalizeSelectValue(cfg[GRAPH_STACK]);

  const [groupQuery, setGroupQuery] = useState("");
  const [stackQuery, setStackQuery] = useState("");
  const [groupOptions, setGroupOptions] = useState([]);
  const [stackOptions, setStackOptions] = useState([]);
  const [groupLoading, setGroupLoading] = useState(false);
  const [stackLoading, setStackLoading] = useState(false);
  const [groupError, setGroupError] = useState(null);
  const [stackError, setStackError] = useState(null);
  const [resolvedFieldLabels, setResolvedFieldLabels] = useState({});
  const [multiJqlDraft, setMultiJqlDraft] = useState(cfg[GRAPH_MULTI_JQL] || "");

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
    const options = [{ label: "Status Category", value: "statuscategory" }, ...baseOptions];

    if (includeNone) {
      options.unshift({ label: "(None)", value: "" });
    }

    if (selectedId && !seen.has(selectedId) && selectedId !== "statuscategory") {
      options.push({ label: selectedLabel, value: selectedId });
    }

    return options;
  };

  useEffect(() => {
    const fieldIds = [currentGroupValue, currentStackValue].filter(
      (fieldId) => fieldId && fieldId !== "statuscategory"
    );

    if (fieldIds.length === 0) {
      return undefined;
    }

    let alive = true;

    const loadSelectedFieldLabels = async () => {
      try {
        const response = await requestJira("/rest/api/3/field");
        if (!response.ok) {
          return;
        }

        const fields = await response.json();
        const nextLabels = {};

        for (const field of Array.isArray(fields) ? fields : []) {
          if (fieldIds.includes(field.id)) {
            nextLabels[field.id] = `${field.name} (${field.id})`;
          }
        }

        if (alive && Object.keys(nextLabels).length > 0) {
          setResolvedFieldLabels((previous) => ({ ...previous, ...nextLabels }));
        }
      } catch (error) {
        // This lookup only improves readability in the summary and selected options.
      }
    };

    loadSelectedFieldLabels();

    return () => {
      alive = false;
    };
  }, [currentGroupValue, currentStackValue]);

  useEffect(() => {
    let alive = true;
    const query = groupQuery.trim();

    if (query.length < 2) {
      if (alive) {
        setGroupOptions(withSpecialAndSelected([], currentGroupValue, false));
      }
      return () => {
        alive = false;
      };
    }

    setGroupLoading(true);
    setGroupError(null);

    const handle = setTimeout(async () => {
      try {
        const response = await requestJira(
          `/rest/api/3/field/search?query=${encodeURIComponent(query)}&maxResults=50`
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Failed to search fields: ${response.status} ${text}`);
        }

        const payload = await response.json();
        const baseOptions = (Array.isArray(payload.values) ? payload.values : []).map((field) => ({
          label: `${field.name} (${field.id})`,
          value: field.id,
        }));

        if (alive) {
          setGroupOptions(withSpecialAndSelected(baseOptions, currentGroupValue, false));
        }
      } catch (error) {
        if (alive) {
          setGroupError(error?.message || String(error));
        }
      } finally {
        if (alive) {
          setGroupLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(handle);
      alive = false;
    };
  }, [groupQuery, currentGroupValue, resolvedFieldLabels]);

  useEffect(() => {
    let alive = true;
    const query = stackQuery.trim();

    if (query.length < 2) {
      if (alive) {
        setStackOptions(withSpecialAndSelected([], currentStackValue, true));
      }
      return () => {
        alive = false;
      };
    }

    setStackLoading(true);
    setStackError(null);

    const handle = setTimeout(async () => {
      try {
        const response = await requestJira(
          `/rest/api/3/field/search?query=${encodeURIComponent(query)}&maxResults=50`
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Failed to search fields: ${response.status} ${text}`);
        }

        const payload = await response.json();
        const baseOptions = (Array.isArray(payload.values) ? payload.values : []).map((field) => ({
          label: `${field.name} (${field.id})`,
          value: field.id,
        }));

        if (alive) {
          setStackOptions(withSpecialAndSelected(baseOptions, currentStackValue, true));
        }
      } catch (error) {
        if (alive) {
          setStackError(error?.message || String(error));
        }
      } finally {
        if (alive) {
          setStackLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(handle);
      alive = false;
    };
  }, [stackQuery, currentStackValue, resolvedFieldLabels]);

  const onSubmit = async (formData) => {
    await view.submit(formData);
    return formData;
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
        <Select {...chartTypeField} defaultValue={cfg[GRAPH_TYPE] || "bar"} options={CHART_OPTIONS} />
      </FormSection>

      <FormSection>
        <Label labelFor={getFieldId(GRAPH_JQL)}>Base JQL</Label>
        <TextArea
          {...singleJqlField}
          defaultValue={cfg[GRAPH_JQL] || ""}
          placeholder='Example: project = DEMO AND resolution is EMPTY'
        />
      </FormSection>

      <FormSection>
        <Label labelFor={getFieldId(GRAPH_MULTI_JQL)}>Multi JQL (optional)</Label>
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

      <FormSection>
        <Label labelFor={getFieldId(GRAPH_GROUP)}>
          Group by field <RequiredAsterisk />
        </Label>
        <Textfield
          placeholder="Search fields"
          value={groupQuery}
          onChange={(event) => setGroupQuery(event.target.value)}
        />
        <Select {...groupField} defaultValue={cfg[GRAPH_GROUP] || ""} isDisabled={groupLoading} options={groupOptions} />
        {groupError && <Text>{`Field search error: ${String(groupError)}`}</Text>}
      </FormSection>

      <FormSection>
        <Label labelFor={getFieldId(GRAPH_STACK)}>Stack by field (optional)</Label>
        <Textfield
          placeholder="Search fields"
          value={stackQuery}
          onChange={(event) => setStackQuery(event.target.value)}
        />
        <Select {...stackField} defaultValue={cfg[GRAPH_STACK] || ""} isDisabled={stackLoading} options={stackOptions} />
        {stackError && <Text>{`Field search error: ${String(stackError)}`}</Text>}
      </FormSection>

      <FormSection>
        <Label labelFor={getFieldId(GRAPH_AGG)}>Aggregation</Label>
        <Select {...aggregationField} defaultValue={cfg[GRAPH_AGG] || "count"} options={AGG_OPTIONS} />
      </FormSection>

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
