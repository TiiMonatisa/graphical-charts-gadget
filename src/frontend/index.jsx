import React, {useEffect, useState} from "react";
import ForgeReconciler, {
    Text,
    Select,
    useProductContext,
    Textfield,
    Form,
    Button,
    FormSection,
    FormFooter,
    Label,
    RequiredAsterisk,
    useForm,
    DonutChart,
    BarChart,
    HorizontalBarChart,
    StackBarChart,
    HorizontalStackBarChart,
    LineChart,
    PieChart,
    SectionMessage
} from "@forge/react";
import {invoke, view, requestJira} from "@forge/bridge";

const GRAPH_NAME = "graph-name";
const GRAPH_JQL = "graph-jql";
const GRAPH_TYPE = "graph-type";
const GRAPH_GROUP = "graph-group";
const GRAPH_AGG = "graph-agg";
// New optional config to support stacked charts by a second field
const GRAPH_STACK = "graph-stack";

const CHART_OPTIONS = [
    {label: "Bar", value: "bar"},
    {label: "Donut", value: "donut"},
    {label: "Horizontal bar", value: "horizontal-bar"},
    {label: "Horizontal stack bar", value: "horizontal-stack-bar"},
    {label: "Line", value: "line"},
    {label: "Pie", value: "pie"},
    {label: "Stack bar", value: "stack-bar"},
];

const AGG_OPTIONS = [
    {label: "Count (issues)", value: "count"},
    {label: "Sum (numeric field)", value: "sum"},
    {label: "Average (numeric field)", value: "avg"},
];

export const Edit = () => {
    const {handleSubmit, register, getFieldId} = useForm();
    // Use type-ahead search to avoid loading too many fields at once.
    // Users type into a search box; we fetch matching fields via Jira field search API.
    const context = useProductContext();
    const cfg = context?.extension?.gadgetConfiguration || {};
    // Normalize a stored config value to its id string if it's an option object
    const toId = (v) => (v && typeof v === 'object' && 'value' in v) ? v.value : (v || '');
    const toLabel = (v) => (v && typeof v === 'object') ? (v.label || v.value || '') : (v || '');
    const currentGroupValue = toId(cfg[GRAPH_GROUP]);
    const currentStackValue = toId(cfg[GRAPH_STACK]);

    const [groupQuery, setGroupQuery] = useState("");
    const [stackQuery, setStackQuery] = useState("");
    const [groupOptions, setGroupOptions] = useState([]);
    const [stackOptions, setStackOptions] = useState([]);
    const [groupLoading, setGroupLoading] = useState(false);
    const [stackLoading, setStackLoading] = useState(false);
    const [groupError, setGroupError] = useState(null);
    const [stackError, setStackError] = useState(null);

    // Helper to build options list with special entries and ensure current selection is included.
    const withSpecialAndSelected = (base, selectedValue, includeNone) => {
        // Ensure we always work with scalar selected id/label, not object
        const selectedId = toId(selectedValue);
        const selectedLabel = toLabel(selectedValue) || selectedId;
        const seen = new Set(base.map(o => o.value));
        // Add Status Category synthetic option at top always
        const statusOpt = { label: 'Status Category (derived)', value: 'statuscategory' };
        const result = [statusOpt, ...base];
        if (includeNone) {
            result.unshift({ label: '(None)', value: '' });
        }
        if (selectedId && !seen.has(selectedId) && selectedId !== 'statuscategory') {
            // Include currently selected value if not present
            result.push({ label: selectedLabel || selectedId, value: selectedId });
        }
        return result;
    };

    // Debounced fetchers for group and stack queries.
    useEffect(() => {
        let alive = true;
        const q = groupQuery.trim();
        if (q.length < 2) {
            // Keep only specials and current selection when query too short
            const base = [];
            const opts = withSpecialAndSelected(base, currentGroupValue, false);
            if (alive) setGroupOptions(opts);
            return () => { alive = false; };
        }
        setGroupLoading(true);
        setGroupError(null);
        const handle = setTimeout(async () => {
            try {
                const resp = await requestJira(`/rest/api/3/field/search?query=${encodeURIComponent(q)}&maxResults=50`);
                if (!resp.ok) {
                    const text = await resp.text();
                    throw new Error(`Failed to search fields: ${resp.status} ${text}`);
                }
                const json = await resp.json();
                const values = Array.isArray(json.values) ? json.values : [];
                const base = values.map(f => ({ label: `${f.name} (${f.id})`, value: f.id }));
                if (alive) setGroupOptions(withSpecialAndSelected(base, currentGroupValue, false));
            } catch (e) {
                if (alive) setGroupError(e.message || String(e));
            } finally {
                if (alive) setGroupLoading(false);
            }
        }, 300);
        return () => { alive = false; clearTimeout(handle); };
    }, [groupQuery, currentGroupValue]);

    useEffect(() => {
        let alive = true;
        const q = stackQuery.trim();
        if (q.length < 2) {
            const base = [];
            const opts = withSpecialAndSelected(base, currentStackValue, true);
            if (alive) setStackOptions(opts);
            return () => { alive = false; };
        }
        setStackLoading(true);
        setStackError(null);
        const handle = setTimeout(async () => {
            try {
                const resp = await requestJira(`/rest/api/3/field/search?query=${encodeURIComponent(q)}&maxResults=50`);
                if (!resp.ok) {
                    const text = await resp.text();
                    throw new Error(`Failed to search fields: ${resp.status} ${text}`);
                }
                const json = await resp.json();
                const values = Array.isArray(json.values) ? json.values : [];
                const base = values.map(f => ({ label: `${f.name} (${f.id})`, value: f.id }));
                if (alive) setStackOptions(withSpecialAndSelected(base, currentStackValue, true));
            } catch (e) {
                if (alive) setStackError(e.message || String(e));
            } finally {
                if (alive) setStackLoading(false);
            }
        }, 300);
        return () => { alive = false; clearTimeout(handle); };
    }, [stackQuery, currentStackValue]);

    const configureGadget = async (data) => {
        console.log(data);
        view.submit(data);
    };

    return (
        <Form onSubmit={handleSubmit(configureGadget)}>
            <FormSection>
                <Label labelFor={getFieldId(GRAPH_NAME)}>
                    Title
                    <RequiredAsterisk/>
                </Label>
                <Textfield {...register(GRAPH_NAME, {required: true})} />
            </FormSection>

            <FormSection>
                <Label labelFor={getFieldId(GRAPH_JQL)}>
                    JQL
                    <RequiredAsterisk/>
                </Label>
                <Textfield {...register(GRAPH_JQL, {required: true})} />
            </FormSection>

            <FormSection>
                <Label labelFor={getFieldId(GRAPH_TYPE)}>
                    Chart Type
                    <RequiredAsterisk/>
                </Label>
                <Select
                    {...register(GRAPH_TYPE, {required: true})}
                    options={CHART_OPTIONS}
                />
            </FormSection>

            <FormSection>
                <Label labelFor={getFieldId(GRAPH_GROUP)}>
                    Group By
                    <RequiredAsterisk/>
                </Label>
                {groupError && (
                    <SectionMessage appearance="error" title="Failed to load fields">
                        {groupError}
                    </SectionMessage>
                )}
                <Textfield
                    placeholder="Type to search fields (min 2 chars)"
                    onChange={(e) => setGroupQuery(e.target.value)}
                />
                <Select
                    {...register(GRAPH_GROUP, {required: true})}
                    isDisabled={groupLoading}
                    options={groupOptions}
                />
            </FormSection>

            {/* Optional: allow a second grouping for stacked charts */}
            <FormSection>
                <Label labelFor={getFieldId(GRAPH_STACK)}>
                    Stack By (optional)
                </Label>
                {stackError && (
                    <SectionMessage appearance="error" title="Failed to load fields">
                        {stackError}
                    </SectionMessage>
                )}
                <Textfield
                    placeholder="Type to search fields (min 2 chars)"
                    onChange={(e) => setStackQuery(e.target.value)}
                />
                <Select
                    {...register(GRAPH_STACK)}
                    isDisabled={stackLoading}
                    options={stackOptions}
                />
            </FormSection>

            <FormSection>
                <Label labelFor={getFieldId(GRAPH_AGG)}>
                    Aggregation
                    <RequiredAsterisk/>
                </Label>
                <Select
                    {...register(GRAPH_AGG, {required: true})}
                    options={AGG_OPTIONS}
                />
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

const buildResult = (payload) => {
    const {chartType, data, accessors, title} = payload;
    const subtitle = `JQL: ${payload.meta.jql}` || "";
    const acc = accessors?.[chartType] || {};

    const xKey = acc.xAccessor ?? acc.labelAccessor ?? "label";
    const yKey = acc.yAccessor ?? acc.valueAccessor ?? "value";
    const colorKey = acc.colorAccessor ?? "type";

    return {data, xKey, yKey, colorKey, title, subtitle};
};

const ChartRenderer = ({ chartType, result }) => {
    if (!result) return null;
    const { data, xKey, yKey, colorKey, title, subtitle } = result;

    if (!Array.isArray(data) || data.length === 0) {
        return <SectionMessage title="No data" appearance="warning">Your JQL returned no issues after filtering.</SectionMessage>;
    }

    switch (chartType) {
        case "bar":
            return <BarChart data={data} xAccessor={xKey} yAccessor={yKey} colorAccessor={colorKey} title={title} subtitle={subtitle} />;
        case "horizontal-bar":
            return <HorizontalBarChart data={data} xAccessor={xKey} yAccessor={yKey} colorAccessor={colorKey} title={title} subtitle={subtitle} />;
        case "stack-bar":
            return <StackBarChart data={data} xAccessor={xKey} yAccessor={yKey} colorAccessor={colorKey} title={title} subtitle={subtitle} />;
        case "horizontal-stack-bar":
            return <HorizontalStackBarChart data={data} xAccessor={xKey} yAccessor={yKey} colorAccessor={colorKey} title={title} subtitle={subtitle} />;
        case "line":
            return <LineChart data={data} xAccessor={xKey} yAccessor={yKey} colorAccessor={colorKey} title={title} subtitle={subtitle} />;
        case "pie":
            return <PieChart data={data} valueAccessor={yKey} labelAccessor={xKey} colorAccessor={colorKey} title={title} subtitle={subtitle} />;
        case "donut":
            return <DonutChart data={data} valueAccessor={yKey} labelAccessor={xKey} colorAccessor={colorKey} title={title} subtitle={subtitle} />;
        default:
            return <SectionMessage title="Unknown chart type" appearance="error">Selected chart type "{chartType}" is not supported.</SectionMessage>;
    }
};

const View = () => {
    const [data, setData] = useState(null);
    const context = useProductContext();

    useEffect(() => {
        invoke('getText2', {example: 'my-invoke-variable'}).then(setData);
    }, []);

    if (!context) {
        return "Loading...";
    }

    const {
        extension: {gadgetConfiguration},
    } = context;

    const chartType = gadgetConfiguration[GRAPH_TYPE]?.value || gadgetConfiguration[GRAPH_TYPE];
    const result = data ? buildResult(data) : null;

    return (
        <>
            {/*<Text>Title: {gadgetConfiguration[GRAPH_NAME]}</Text>*/}
            {/*<Text>JQL: {gadgetConfiguration[GRAPH_JQL]}</Text>*/}
            {/*<Text>Chart Type: {chartType}</Text>*/}
            {result && <ChartRenderer chartType={chartType} result={result} />}
            {!result && <Text>Loading chart data...</Text>}
        </>
    );
};

const App = () => {
    const context = useProductContext();
    if (!context) {
        return "Loading...";
    }

    return context.extension.entryPoint === "edit" ? <Edit/> : <View/>;
};

ForgeReconciler.render(
    <React.StrictMode>
        <App/>
    </React.StrictMode>
);
