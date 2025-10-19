import React, {useEffect, useState} from "react";
import ForgeReconciler, {
    Text,
    Select,
    useProductContext,
    Textfield,
    TextArea,
    Form,
    Button,
    LoadingButton,
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
    SectionMessage,
    DynamicTable
} from "@forge/react";
import {invoke, view, requestJira} from "@forge/bridge";

const GRAPH_NAME = "graph-name";
const GRAPH_JQL = "graph-jql";
// Optional: allow multiple JQLs for comparison mode (one per line as Label: JQL)
const GRAPH_MULTI_JQL = "graph-multi-jql";
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

    // Local state for JQL inputs so we can validate inline without saving yet
    const [jqlInput, setJqlInput] = useState(cfg[GRAPH_JQL] || "");
    const [multiInput, setMultiInput] = useState(cfg[GRAPH_MULTI_JQL] || "");

    // Validation state
    const [validating, setValidating] = useState(false);
    const [validationMode, setValidationMode] = useState(null); // 'single' | 'multi' | null
    const [validationResults, setValidationResults] = useState(null); // array of {label, jql, total}
    const [validationTotal, setValidationTotal] = useState(null); // number | null
    const [validationError, setValidationError] = useState(null);

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

    // Helper: parse Multi JQL textarea into structured items
    const parseMulti = (raw) => {
        if (!raw) return [];
        return String(raw)
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l.length > 0)
            .map(line => {
                // Support both ":" and "=" as separators
                const m = line.match(/^(.*?)[=:](.*)$/);
                if (!m) return { label: (line.slice(0, 24).trim() || 'Series'), jql: line };
                return { label: m[1].trim() || 'Series', jql: m[2].trim() };
            });
    };

    // Count issues for a JQL by paging using nextPageToken/isLast when present;
    // fallback to single page with 'total' when available.
    const countIssuesPaged = async (q) => {
        const MAX_RESULTS = 1000; // 1..5000 allowed; choose 1000 to balance payload
        const MAX_PAGES = 100;    // safety cap (~100k issues)
        let totalCount = 0;
        let nextToken = null;
        for (let page = 0; page < MAX_PAGES; page++) {
            const params = new URLSearchParams();
            params.set('jql', q);
            params.set('maxResults', String(MAX_RESULTS));
            params.set('fields', 'key');
            if (nextToken) params.set('nextPageToken', nextToken);
            const url = `/rest/api/3/search/jql?${params.toString()}`;
            const resp = await requestJira(url);
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(`Jira search failed (${resp.status}): ${text}`);
            }
            const json = await resp.json();
            const issues = Array.isArray(json.issues) ? json.issues : [];
            totalCount += issues.length;
            const hasTokenPaging = Object.prototype.hasOwnProperty.call(json, 'isLast') || Object.prototype.hasOwnProperty.call(json, 'nextPageToken');
            if (hasTokenPaging) {
                if (json.isLast === true) break;
                nextToken = json.nextPageToken;
                if (!nextToken) break;
            } else if (typeof json.total === 'number') {
                // Old-style response exposes total; trust it and stop.
                totalCount = json.total;
                break;
            } else {
                // No way to continue deterministically; stop here.
                break;
            }
        }
        return totalCount;
    };

    // Validate a single JQL by paging to compute the total count
    const validateSingle = async () => {
        setValidationError(null);
        setValidationResults(null);
        setValidationTotal(null);
        setValidationMode('single');
        const q = (jqlInput || '').trim();
        if (!q) {
            setValidationError('Enter a JQL to validate.');
            return;
        }
        setValidating(true);
        try {
            const total = await countIssuesPaged(q);
            setValidationResults([{ label: 'Query', jql: q, total }]);
            setValidationTotal(total);
        } catch (e) {
            setValidationError(e.message || String(e));
        } finally {
            setValidating(false);
        }
    };

    // Validate multiple JQLs (one per line) and compute totals per line plus overall
    const validateMulti = async () => {
        setValidationError(null);
        setValidationResults(null);
        setValidationTotal(null);
        setValidationMode('multi');
        const items = parseMulti(multiInput);
        if (items.length === 0) {
            setValidationError('Enter one or more lines using "Label: JQL".');
            return;
        }
        setValidating(true);
        try {
            const results = await Promise.all(items.map(async (it) => {
                try {
                    const total = await countIssuesPaged(it.jql);
                    return { ...it, total };
                } catch (err) {
                    return { ...it, error: String(err?.message || err), total: null };
                }
            }));
            const sum = results.reduce((acc, r) => acc + (typeof r.total === 'number' ? r.total : 0), 0);
            setValidationResults(results);
            setValidationTotal(sum);
        } catch (e) {
            setValidationError(e.message || String(e));
        } finally {
            setValidating(false);
        }
    };

    const configureGadget = async (data) => {
        // Inject our controlled fields so they are saved even though we don't use register for them
        const payload = {
            ...data,
            [GRAPH_JQL]: jqlInput,
            [GRAPH_MULTI_JQL]: multiInput,
        };
        view.submit(payload);
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
                </Label>
                <Textfield
                    value={jqlInput}
                    onChange={(e) => setJqlInput(e.target.value)}
                    placeholder={'e.g. project = ABC AND statusCategory != Done'}
                />
                <LoadingButton appearance="primary" isLoading={validating && validationMode === 'single'} onClick={validateSingle}>
                    Validate JQL
                </LoadingButton>
                {validationMode === 'single' && validationError && (
                    <SectionMessage appearance="error" title="Validation failed">{validationError}</SectionMessage>
                )}
                {validationMode === 'single' && validationResults && (
                    <SectionMessage appearance="confirmation" title={`Found ${validationTotal} issues`}>
                        Your JQL returned {validationTotal} issue(s).
                    </SectionMessage>
                )}
            </FormSection>

            {/* Multi-JQL comparison mode (optional). If provided, the app will compare totals across these JQLs. */}
            <FormSection>
                <Label labelFor={getFieldId(GRAPH_MULTI_JQL)}>
                    Multi JQL (optional)
                </Label>
                <TextArea
                    value={multiInput}
                    onChange={(e) => setMultiInput(e.target.value)}
                    placeholder={
                        "Enter one per line in the format: Label: JQL\n" +
                        "Example:\nTeam A: assignee in (alice,bob) AND statusCategory != Done\n" +
                        "Team B: assignee in (charlie,diana) AND statusCategory != Done"
                    }
                />
                <SectionMessage appearance="information" title="How it works">
                    When Multi JQL is provided, the gadget compares totals per line and ignores Group/Stack/Aggregation settings below. Pie/Donut works best.
                </SectionMessage>
                <LoadingButton appearance="primary" isLoading={validating && validationMode === 'multi'} onClick={validateMulti}>
                    Validate Multi JQLs
                </LoadingButton>
                {validationMode === 'multi' && validationError && (
                    <SectionMessage appearance="error" title="Validation failed">{validationError}</SectionMessage>
                )}
                {validationMode === 'multi' && validationResults && (
                    <>
                        <SectionMessage appearance="success" title={`Combined total: ${validationTotal} issues`}>
                            Totals per line shown below.
                        </SectionMessage>
                        <DynamicTable
                            head={{ cells: [ { content: 'Label' }, { content: 'Total' }, { content: 'Status' } ] }}
                            rows={validationResults.map((r, i) => ({
                                key: String(i),
                                cells: [
                                    { content: <Text>{r.label}</Text> },
                                    { content: <Text>{typeof r.total === 'number' ? r.total : '-'}</Text> },
                                    { content: r.error ? <SectionMessage appearance="error" title="Error" /> : <Text>OK</Text> },
                                ],
                            }))}
                            rowsPerPage={10}
                            defaultPage={1}
                        />
                    </>
                )}
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
                    Group By (ignored in Multi JQL)
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
                    {...register(GRAPH_GROUP)}
                    isDisabled={groupLoading}
                    options={groupOptions}
                />
            </FormSection>

            {/* Optional: allow a second grouping for stacked charts */}
            <FormSection>
                <Label labelFor={getFieldId(GRAPH_STACK)}>
                    Stack By (optional, ignored in Multi JQL)
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
                    Aggregation (ignored in Multi JQL)
                </Label>
                <Select
                    {...register(GRAPH_AGG)}
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
        // Fetch chart data from resolver; it will auto-detect multi-JQL vs single-JQL mode.
        invoke('getText2', {example: 'my-invoke-variable'}).then(setData);
    }, []);

    if (!context) {
        return "Loading...";
    }

    const {
        extension: {gadgetConfiguration},
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
