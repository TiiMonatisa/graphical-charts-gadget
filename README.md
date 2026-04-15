# Graphical Charts Forge App

A Forge app that adds a **Jira dashboard gadget** for turning Jira issue search results into charts.

The gadget lets dashboard users configure a chart from Jira data using either:

- **Single JQL mode**: run one JQL query, group the matching issues by a Jira field, and optionally stack by a second field.
- **Multi JQL mode**: compare multiple JQL queries side by side, one query per line.

The app is built with **Atlassian Forge UI Kit** and runs as a Jira dashboard gadget.

## What the app does

This gadget can render the following chart types:

- Bar
- Horizontal bar
- Stack bar
- Horizontal stack bar
- Line
- Pie
- Donut

### Supported reporting modes

#### 1. Single JQL mode
Use a base JQL query and configure:

- **Chart title**
- **Chart type**
- **Group by field**
- **Optional stack by field** for stacked charts
- **Aggregation**:
  - `count` of issues
  - `sum` of a numeric field
  - `avg` of a numeric field
- **Browser optimization preset** to limit how much chart data is sent to the browser

In this mode, the app fetches Jira issues, groups them by the selected field, and produces chart-ready data.

#### 2. Multi JQL mode
Provide multiple JQL lines to compare totals across different filters.

Supported input styles include labelled queries such as:

```text
Open Bugs :: project = DEMO AND issuetype = Bug AND statusCategory != Done
Recently Updated => project = DEMO AND updated >= -7d
My Team | project = DEMO AND assignee in membersOf("my-team")
```

If a line does not contain a label, the app automatically derives one from the JQL text.

### Drilldown behavior
Each chart point includes a drilldown JQL. In the gadget view, users can expand a drilldown section and open the matching issues in Jira Issue Navigator.

### Performance behavior
To help keep dashboards responsive:

- the app stores computed job results in Forge storage
- report results are keyed by the gadget configuration
- browser optimization presets limit the number of labels and points sent to the frontend
- very large searches are capped to protect dashboard performance

## Prerequisites

Before installing or running this app, make sure you have:

1. **Node.js** installed
2. **npm** installed
3. The **Forge CLI** installed and authenticated
4. Access to a Jira Cloud site where you can install Forge apps

Helpful Atlassian setup docs:

- Forge setup: <https://developer.atlassian.com/platform/forge/set-up-forge/>
- Forge CLI overview: <https://developer.atlassian.com/platform/forge/cli-reference/>

## Project structure

```text
manifest.yml                Forge app manifest
src/index.js                Forge backend entry point exports
src/resolvers/index.js      Resolver logic for report generation and job status
src/common/multiJql.js      Shared parsing for Multi JQL input
src/frontend/index.jsx      UI Kit app entry point
src/frontend/components/    Edit/view/chart/drilldown UI components
src/frontend/utils/         Frontend data shaping helpers
```

## Install dependencies

From the root of the app:

```bash
npm install
```

## Lint the app

```bash
npm run lint
```

If linting fails in your environment, make sure your local Node.js and Forge tooling are installed correctly and compatible with the app.

## Deploy the app

Deploy to the Forge **development** environment:

```bash
forge deploy --non-interactive --e development
```

## Install the app into Jira

Install the app on your Jira Cloud site:

```bash
forge install --non-interactive --site <your-site>.atlassian.net --product jira --environment development
```

If the app is already installed and you changed permissions or scopes, upgrade the installation instead:

```bash
forge install --non-interactive --upgrade --site <your-site>.atlassian.net --product jira --environment development
```

## Run the app during development

Use Forge tunnel for local development:

```bash
forge tunnel
```

Notes:

- Code changes are hot reloaded while tunnelling.
- If you change `manifest.yml`, redeploy the app and restart the tunnel.
- If you add scopes, you must redeploy and then reinstall/upgrade the app.

## How to use the gadget in Jira

1. Open a Jira dashboard.
2. Add the installed gadget.
3. Open the gadget configuration screen.
4. Enter a title and choose a chart type.
5. Choose either:
   - **Single JQL** mode, or
   - **Multi JQL** mode
6. Save the configuration.
7. Wait for the gadget to fetch and render the report.
8. Optionally expand **drilldown links** to open matching issues in Jira.

## Configuration details

### Single JQL mode
Use this when you want to chart one Jira search.

Required fields:

- Title
- Base JQL
- Group by field

Optional fields:

- Stack by field
- Aggregation
- Browser optimization limits

### Multi JQL mode
Use this when you want to compare totals across multiple queries.

Provide one query per line. You can optionally label each line using separators such as:

- `::`
- `=>`
- ` | `
- `|`
- `:` (supported when the text before the colon is not itself JQL)

Example:

```text
All Bugs :: project = DEMO AND issuetype = Bug
Done Bugs :: project = DEMO AND issuetype = Bug AND statusCategory = Done
In Progress Bugs :: project = DEMO AND issuetype = Bug AND statusCategory = "In Progress"
```

## Permissions

The current manifest requests these Forge scopes:

- `read:jira-work`
- `storage:app`

## Troubleshooting

### The gadget shows no data

Check that:

- the configured JQL returns issues
- the selected grouping field exists and has values
- numeric aggregations use a numeric Jira field

### Drilldown links do not show

Drilldown links are only rendered when the chart data contains drilldown JQL values.

### Changes do not appear

- If you are using `forge tunnel`, verify the tunnel is running.
- If you changed the manifest, redeploy and restart the tunnel.
- If you changed scopes, reinstall or upgrade the app after deploy.

## Useful commands

```bash
npm install
npm run lint
forge deploy --non-interactive --e development
forge install --non-interactive --site <your-site>.atlassian.net --product jira --environment development
forge install --non-interactive --upgrade --site <your-site>.atlassian.net --product jira --environment development
forge tunnel
```
