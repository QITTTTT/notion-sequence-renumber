const DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID || "74435839-019f-43b0-8f19-0f8ec169e508";
const NOTION_VERSION = process.env.NOTION_VERSION || "2025-09-03";
const SEQUENCE_PROPERTY = process.env.SEQUENCE_PROPERTY || "序号";
const DATE_PROPERTY = process.env.DATE_PROPERTY || "投递时间";
const INCLUDE_BLANK_ROWS = (process.env.INCLUDE_BLANK_ROWS || "true") !== "false";
const MIN_DELAY_MS = Number(process.env.MIN_DELAY_MS || 350);

const token = process.env.NOTION_TOKEN;
if (!token) {
  throw new Error("Missing NOTION_TOKEN. Run with --env-file=.env or export it first.");
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Notion-Version": NOTION_VERSION,
  "Content-Type": "application/json",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function notion(path, options = {}, attempt = 0) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    await sleep(Math.max(MIN_DELAY_MS, retryAfter * 1000, 1000 * 2 ** attempt));
    return notion(path, options, attempt + 1);
  }
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    throw new Error(`Notion API ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function plainText(property) {
  if (!property) return "";
  if (property.type === "title" || property.type === "rich_text") {
    return (property[property.type] || [])
      .map((item) => item.plain_text ?? item.text?.content ?? "")
      .join("")
      .trim();
  }
  if (property.type === "text") return String(property.text || "").trim();
  return "";
}

function numberValue(property) {
  return property?.type === "number" && typeof property.number === "number"
    ? property.number
    : null;
}

function dateKey(value) {
  const match = /^(?:\d{4}[./-])?(\d{1,2})[./-](\d{1,2})$/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2])] : null;
}

async function queryAllPages() {
  const pages = [];
  let start_cursor;
  do {
    const body = { page_size: 100 };
    if (start_cursor) body.start_cursor = start_cursor;
    const result = await notion(`/data_sources/${DATA_SOURCE_ID}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    pages.push(...(result.results || []));
    start_cursor = result.has_more ? result.next_cursor : undefined;
  } while (start_cursor);
  return pages;
}

const pages = await queryAllPages();
const rows = pages.map((page, index) => {
  const properties = page.properties || {};
  const dateText = plainText(properties[DATE_PROPERTY]);
  return {
    page,
    index,
    date: dateKey(dateText),
    oldNumber: numberValue(properties[SEQUENCE_PROPERTY]),
    createdTime: page.created_time || "",
  };
});

const sortableRows = INCLUDE_BLANK_ROWS ? rows : rows.filter((row) => row.date);
sortableRows.sort((a, b) => {
  if (!a.date && !b.date) {
    return (a.oldNumber ?? Number.MAX_SAFE_INTEGER) - (b.oldNumber ?? Number.MAX_SAFE_INTEGER)
      || a.createdTime.localeCompare(b.createdTime)
      || a.index - b.index;
  }
  if (!a.date) return 1;
  if (!b.date) return -1;
  return a.date[0] - b.date[0]
    || a.date[1] - b.date[1]
    || (a.oldNumber ?? Number.MAX_SAFE_INTEGER) - (b.oldNumber ?? Number.MAX_SAFE_INTEGER)
    || a.createdTime.localeCompare(b.createdTime)
    || a.index - b.index;
});

let updated = 0;
for (const [index, row] of sortableRows.entries()) {
  const nextNumber = index + 1;
  if (row.oldNumber === nextNumber) continue;
  await notion(`/pages/${row.page.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: { [SEQUENCE_PROPERTY]: { number: nextNumber } },
    }),
  });
  updated += 1;
  await sleep(MIN_DELAY_MS);
}

if (!INCLUDE_BLANK_ROWS) {
  for (const row of rows.filter((row) => !row.date)) {
    if (row.oldNumber === null) continue;
    await notion(`/pages/${row.page.id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties: { [SEQUENCE_PROPERTY]: { number: null } } }),
    });
    updated += 1;
    await sleep(MIN_DELAY_MS);
  }
}

console.log(JSON.stringify({
  dataSourceId: DATA_SOURCE_ID,
  totalRows: pages.length,
  numberedRows: sortableRows.length,
  blankRows: rows.filter((row) => !row.date).length,
  updated,
}, null, 2));
