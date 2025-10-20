// Edit view for the dashboard gadget configuration.
// This component remains functionally equivalent to the original single-file version
// but is now isolated as a standalone component to keep the entrypoint lean.

import React, { useEffect, useState } from "react";
import {
  Text,
  Select,
  useProductContext,
  Textfield,
  TextArea,
  Form,
  Button,
  FormSection,
  FormFooter,
  Label,
  RequiredAsterisk,
  useForm,
  SectionMessage,
} from "@forge/react";
import { requestJira } from "@forge/bridge";
import {
  GRAPH_NAME,
  GRAPH_JQL,
  GRAPH_MULTI_JQL,
  GRAPH_TYPE,
  GRAPH_GROUP,
  GRAPH_AGG,
  GRAPH_STACK,
  CHART_OPTIONS,
  AGG_OPTIONS,
} from "../constants";

const Edit = () => {
  const { handleSubmit, register, getFieldId } = useForm();
  const context = useProductContext();
  const cfg = context?.extension?.gadgetConfiguration || {};

  // Helpers to normalize Select values which can be strings or {label,value} objects
  const toId = (v) => (v && typeof v === "object" && "value" in v ? v.value : v || "");
  const toLabel = (v) => (v && typeof v === "object" ? v.label || v.value || "" : v || "");

  const currentGroupValue = toId(cfg[GRAPH_GROUP]);
  const currentStackValue = toId(cfg[GRAPH_STACK]);

  // Local states for inputs; matches original behavior
  const [jqlInput, setJqlInput] = useState(cfg[GRAPH_JQL] || "");
  const [multiInput, setMultiInput] = useState(cfg[GRAPH_MULTI_JQL] || "");

  // Type-ahead state for field search
  const [groupQuery, setGroupQuery] = useState("");
  const [stackQuery, setStackQuery] = useState("");
  const [groupOptions, setGroupOptions] = useState([]);
  const [stackOptions, setStackOptions] = useState([]);
  const [groupLoading, setGroupLoading] = useState(false);
  const [stackLoading, setStackLoading] = useState(false);
  const [groupError, setGroupError] = useState(null);
  const [stackError, setStackError] = useState(null);

  // Include synthetic options and preserve current selection in the option list
  const withSpecialAndSelected = (base, selectedValue, includeNone) => {
    const selectedId = toId(selectedValue);
    const selectedLabel = toLabel(selectedValue) || selectedId;
    const seen = new Set(base.map((o) => o.value));
    const statusOpt = { label: "Status Category (derived)", value: "statuscategory" };
    const result = [statusOpt, ...base];
    if (includeNone) {
      result.unshift({ label: "(None)", value: "" });
    }
    if (selectedId && !seen.has(selectedId) && selectedId !== "statuscategory") {
      result.push({ label: selectedLabel || selectedId, value: selectedId });
    }
    return result;
  };

  // Debounced field search — mirrors the previous inline logic
  useEffect(() => {
    let alive = true;
    const q = groupQuery.trim();
    if (q.length < 2) {
      const base = [];
      const opts = withSpecialAndSelected(base, currentGroupValue, false);
      if (alive) setGroupOptions(opts);
      return () => {
        alive = false;
      };
    }
    setGroupLoading(true);
    setGroupError(null);
    const handle = setTimeout(async () => {
      try {
        const resp = await requestJira(
          `/rest/api/3/field/search?query=${encodeURIComponent(q)}&maxResults=50`
        );
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`Failed to search fields: ${resp.status} ${text}`);
        }
        const json = await resp.json();
        const values = Array.isArray(json.values) ? json.values : [];
        const base = values.map((f) => ({ label: `${f.name} (${f.id})`, value: f.id }));
        if (alive) setGroupOptions(withSpecialAndSelected(base, currentGroupValue, false));
      } catch (e) {
        if (alive) setGroupError(e.message || String(e));
      } finally {
        if (alive) setGroupLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(handle);
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupQuery, currentGroupValue]);

  useEffect(() => {
    let alive = true;
    const q = stackQuery.trim();
    if (q.length < 2) {
      const base = [];
      const opts = withSpecialAndSelected(base, currentStackValue, true);
      if (alive) setStackOptions(opts);
      return () => {
        alive = false;
      };
    }
    setStackLoading(true);
    setStackError(null);
    const handle = setTimeout(async () => {
      try {
        const resp = await requestJira(
          `/rest/api/3/field/search?query=${encodeURIComponent(q)}&maxResults=50`
        );
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`Failed to search fields: ${resp.status} ${text}`);
        }
        const json = await resp.json();
        const values = Array.isArray(json.values) ? json.values : [];
        const base = values.map((f) => ({ label: `${f.name} (${f.id})`, value: f.id }));
        if (alive) setStackOptions(withSpecialAndSelected(base, currentStackValue, true));
      } catch (e) {
        if (alive) setStackError(e.message || String(e));
      } finally {
        if (alive) setStackLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(handle);
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackQuery, currentStackValue]);

  // Submit handler — uses the built-in Form submit
  const onSubmit = (formData) => {
    // Form submission is handled automatically by UI Kit gadget config.
    // We simply return, as the platform persists fields in gadgetConfiguration.
    return formData;
  };

  return (
    <Form onSubmit={handleSubmit(onSubmit)}>
      <FormSection>
        <Label labelFor={getFieldId(GRAPH_NAME)}>
          Gadget title <RequiredAsterisk />
        </Label>
        <Textfield {...register(GRAPH_NAME)} />
      </FormSection>

      <FormSection>
        <Label labelFor={getFieldId(GRAPH_TYPE)}>Chart type</Label>
        <Select {...register(GRAPH_TYPE)} options={CHART_OPTIONS} />
      </FormSection>

      <FormSection>
        <Label labelFor={getFieldId(GRAPH_JQL)}>
          JQL (ignored if Multi JQL is set)
        </Label>
        <TextArea
          {...register(GRAPH_JQL)}
          value={jqlInput}
          onChange={(e) => setJqlInput(e.target.value)}
        />
      </FormSection>

      <FormSection>
        <Label labelFor={getFieldId(GRAPH_MULTI_JQL)}>
          Multi JQL (one per line as Label: JQL)
        </Label>
        <TextArea
          {...register(GRAPH_MULTI_JQL)}
          value={multiInput}
          onChange={(e) => setMultiInput(e.target.value)}
        />
        <SectionMessage appearance="information" title="Tip">
          When Multi JQL is provided, Group/Stack/Aggregation are ignored. Each line is counted.
        </SectionMessage>
      </FormSection>

      <FormSection>
        <Label labelFor={getFieldId(GRAPH_GROUP)}>
          Group by field <RequiredAsterisk />
        </Label>
        {groupError && (
          <Text appearance="error">Field search error: {String(groupError)}</Text>
        )}
        <Textfield
          placeholder="Search fields (min 2 characters)"
          value={groupQuery}
          onChange={(e) => setGroupQuery(e.target.value)}
        />
        <Select {...register(GRAPH_GROUP)} isDisabled={groupLoading} options={groupOptions} />
      </FormSection>

      <FormSection>
        <Label labelFor={getFieldId(GRAPH_STACK)}>
          Stack by field (optional)
        </Label>
        {stackError && (
          <Text appearance="error">Field search error: {String(stackError)}</Text>
        )}
        <Textfield
          placeholder="Search fields (min 2 characters)"
          value={stackQuery}
          onChange={(e) => setStackQuery(e.target.value)}
        />
        <Select {...register(GRAPH_STACK)} isDisabled={stackLoading} options={stackOptions} />
      </FormSection>

      <FormSection>
        <Label labelFor={getFieldId(GRAPH_AGG)}>
          Aggregation (ignored in Multi JQL)
        </Label>
        <Select {...register(GRAPH_AGG)} options={AGG_OPTIONS} />
      </FormSection>

      <FormFooter>
        <Button appearance="primary" type="submit">
          Submit
        </Button>
        <Button appearance="cancel" type="cancel">
          Cancel
        </Button>
      </FormFooter>
    </Form>
  );
};

export default Edit;

