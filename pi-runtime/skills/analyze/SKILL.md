---
# Adapted from anthropics/knowledge-work-plugins data/skills/analyze @da38ec1 (Apache-2.0). Modified by HappyVibe 2026-09-27: local files instead of a warehouse connector, python3 probe with a fallback, no references to skills HappyVibe does not bundle.
name: analyze
description: Answer data questions -- from quick lookups to full analyses. Use when looking up a single metric, investigating what's driving a trend or drop, comparing segments over time, or preparing a formal data report for stakeholders.
---

# Analyze - Answer Data Questions

Answer a data question, from a quick lookup to a full analysis to a formal report.

## Workflow

### 1. Understand the Question

Parse the user's question and determine:

- **Complexity level**:
  - **Quick answer**: Single metric, simple filter, factual lookup (e.g., "How many users signed up last week?")
  - **Full analysis**: Multi-dimensional exploration, trend analysis, comparison (e.g., "What's driving the drop in conversion rate?")
  - **Formal report**: Comprehensive investigation with methodology, caveats, and recommendations (e.g., "Prepare a quarterly business review of our subscription metrics")
- **Data requirements**: Which tables, metrics, dimensions, and time ranges are needed
- **Output format**: Number, table, chart, narrative, or combination

### 2. Gather Data

**If the data is a file in the workspace** (CSV, TSV, JSON, a SQLite database):

1. Look at its shape first: a header and a few rows (`read` with a small `limit`), the row count, the columns and their types
2. Excel and other office files: read them with `document_read`, which converts them to Markdown tables
3. Compute with the tools that exist on this machine. Check before relying on one: `python3 --version`, `sqlite3 --version`. If neither exists, use `awk`, `sort`, `uniq` and `wc`, or read a small file directly. Never install packages to answer a question
4. Never modify the source file. Write derived data or a report to a new file

**If the data is somewhere else:**

1. Ask the user to provide it in one of these ways:
   - Paste the data or query results directly
   - Attach a CSV or Excel file
   - Describe the schema so you can write queries for them to run
2. Once data is provided, proceed with analysis

### 3. Analyze

- Calculate relevant metrics, aggregations, and comparisons
- Identify patterns, trends, outliers, and anomalies
- Compare across dimensions (time periods, segments, categories)
- For complex analyses, break the problem into sub-questions and address each

### 4. Validate Before Presenting

Before sharing results, run through validation checks:

- **Row count sanity**: Does the number of records make sense?
- **Null check**: Are there unexpected nulls that could skew results?
- **Magnitude check**: Are the numbers in a reasonable range?
- **Trend continuity**: Do time series have unexpected gaps?
- **Aggregation logic**: Do subtotals sum to totals correctly?

If any check raises concerns, investigate and note caveats.

### 5. Present Findings

**For quick answers:**
- State the answer directly with relevant context
- Include the query used (collapsed or in a code block) for reproducibility

**For full analyses:**
- Lead with the key finding or insight
- Support with data tables and/or visualizations
- Note methodology and any caveats
- Suggest follow-up questions

**For formal reports:**
- Executive summary with key takeaways
- Methodology section explaining approach and data sources
- Detailed findings with supporting evidence
- Caveats, limitations, and data quality notes
- Recommendations and suggested next steps

### 6. Visualize Where Helpful

When a chart would communicate results more effectively than a table:

- Pick the chart type that fits the question (a line for trends over time, bars for comparing categories)
- If `python3` with matplotlib is available, generate a chart file; otherwise build a small self-contained HTML page, or present a clear table
- Follow visualization best practices for clarity and accuracy

## Examples

- **Quick answer:** "How many new users signed up in December?" (with `signups.csv`)
- **Full analysis:** "What's causing the increase in support ticket volume over the past 3 months? Break down by category and priority."
- **Formal report:** "Prepare a data quality assessment of our customer table -- completeness, consistency, and any issues we should address."

## Tips

- Be specific about time ranges, segments, or metrics when possible
- If you know the table names, mention them to speed up the process
- For complex questions, break them into multiple queries
- Always validate results before presenting them -- if something looks off, flag it
