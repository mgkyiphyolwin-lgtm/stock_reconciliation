const STORAGE_KEY = "daily-stock-reconciliation-records";
const itemMaster = typeof ITEM_MASTER === "undefined" ? [] : ITEM_MASTER;

const fields = {
  date: document.querySelector("#entry-date"),
  executive: document.querySelector("#executive-name"),
  route: document.querySelector("#route-name"),
  warehouse: document.querySelector("#warehouse-name"),
};

const stockBody = document.querySelector("#stock-body");
const rowTemplate = document.querySelector("#row-template");
const productOptions = document.querySelector("#product-options");
const totals = {
  issued: document.querySelector("#total-issued"),
  out: document.querySelector("#total-out"),
  expected: document.querySelector("#total-expected"),
  variance: document.querySelector("#total-variance"),
  deposit: document.querySelector("#total-deposit"),
};
const statusPill = document.querySelector("#reconcile-status");
const historyList = document.querySelector("#history-list");

document.querySelector("#add-row").addEventListener("click", () => addRow());
document.querySelector("#clear-form").addEventListener("click", resetForm);
document.querySelector("#save-entry").addEventListener("click", saveEntry);
document.querySelector("#export-csv").addEventListener("click", exportCsv);
document.querySelector("#clear-history").addEventListener("click", clearHistory);

stockBody.addEventListener("input", (event) => {
  if (event.target.dataset.field === "product") {
    syncProductSelection(event.target.closest("tr"), event.target.value);
  }
  calculate();
});
stockBody.addEventListener("focusin", (event) => {
  if (event.target.matches('input[type="number"]') && event.target.value === "0") {
    event.target.value = "";
  }
});
stockBody.addEventListener("focusout", (event) => {
  if (event.target.matches('input[type="number"]') && event.target.value.trim() === "") {
    event.target.value = "0";
    calculate();
  }
});
stockBody.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".row-remove");
  if (!removeButton) return;

  if (stockBody.rows.length > 1) {
    removeButton.closest("tr").remove();
    calculate();
  }
});

historyList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const recordId = button.closest(".record-card")?.dataset.recordId;
  if (!recordId) return;

  if (button.dataset.action === "load") {
    loadRecord(recordId);
  }

  if (button.dataset.action === "delete") {
    deleteRecord(recordId);
  }
});

init();

function init() {
  fields.date.value = getToday();
  populateProductOptions();
  resetStockRows();
  renderHistory();
}

function populateProductOptions() {
  if (!productOptions) return;

  productOptions.replaceChildren();
  itemMaster.forEach((item) => {
    const option = document.createElement("option");
    option.value = productLabel(item);
    option.label = item.price ? `${formatNumber(item.price)} | ${item.category}` : item.category;
    productOptions.appendChild(option);
  });
}

function resetStockRows(lines = []) {
  stockBody.replaceChildren();

  if (itemMaster.length) {
    const unusedLines = [...lines];

    itemMaster.forEach((item) => {
      const savedIndex = unusedLines.findIndex((line) => getLineItemCode(line) === item.code);
      const saved = savedIndex >= 0 ? unusedLines.splice(savedIndex, 1)[0] : {};
      const rowData = {
        ...saved,
        code: item.code,
        product: productLabel(item),
        price: hasNumber(saved.price) ? saved.price : item.price,
      };
      addRow(rowData, false);
    });

    unusedLines.forEach((line) => addRow(line, false));
  } else {
    addRow({}, false);
    addRow({}, false);
    addRow({}, false);
  }

  calculate();
}

function addRow(line = {}, shouldCalculate = true) {
  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  const matchingItem = getItemFromLine(line);

  if (matchingItem) {
    row.dataset.itemCode = matchingItem.code;
  }

  row.querySelectorAll("input").forEach((input) => {
    const field = input.dataset.field;

    if (field === "product") {
      input.value = line.product || (matchingItem ? productLabel(matchingItem) : "");
      return;
    }

    if (field === "price") {
      input.value = hasNumber(line.price) ? line.price : matchingItem?.price || 0;
      return;
    }

    if (Object.prototype.hasOwnProperty.call(line, field)) {
      input.value = line[field];
      return;
    }

    if (field === "returnExchange" && Object.prototype.hasOwnProperty.call(line, "return")) {
      input.value = line.return;
    }
  });

  stockBody.appendChild(row);
  if (shouldCalculate) calculate();
}

function syncProductSelection(row, value) {
  const item = findItem(value);
  const priceInput = row.querySelector('[data-field="price"]');

  if (!item) {
    row.dataset.itemCode = "";
    return;
  }

  row.dataset.itemCode = item.code;
  row.querySelector('[data-field="product"]').value = productLabel(item);
  priceInput.value = item.price || 0;
}

function calculate() {
  const summary = getEntrySummary();

  totals.issued.textContent = formatNumber(summary.issued);
  totals.out.textContent = formatNumber(summary.out);
  totals.expected.textContent = formatNumber(summary.expected);
  totals.variance.textContent = formatNumber(summary.variance);
  totals.deposit.textContent = formatNumber(summary.deposit);

  statusPill.classList.remove("warning", "danger");

  if (summary.hasOverSoldLine) {
    statusPill.textContent = "Check Stock";
    statusPill.classList.add("danger");
  } else if (summary.variance !== 0) {
    statusPill.textContent = "Variance";
    statusPill.classList.add("warning");
  } else {
    statusPill.textContent = "Balanced";
  }

  return summary;
}

function getEntrySummary() {
  const lines = readLines();
  let issued = 0;
  let out = 0;
  let expected = 0;
  let variance = 0;
  let deposit = 0;
  let hasOverSoldLine = false;

  lines.forEach(({ row, line }) => {
    const lineIssued = line.issued;
    const lineOut = line.sales + line.foc + line.returnExchange;
    const lineExpected = lineIssued - lineOut;
    const lineVariance = line.unload - lineExpected;
    const lineSalesAmount = line.sales * line.price;

    issued += lineIssued;
    out += lineOut;
    expected += lineExpected;
    variance += lineVariance;
    deposit += lineSalesAmount;

    if (lineExpected < 0) {
      hasOverSoldLine = true;
    }

    row.querySelector('[data-output="salesAmount"]').textContent = formatNumber(lineSalesAmount);
    row.querySelector('[data-output="expected"]').textContent = formatNumber(lineExpected);
    const varianceCell = row.querySelector('[data-output="variance"]');
    varianceCell.textContent = formatNumber(lineVariance);
    varianceCell.classList.toggle("ok", lineVariance === 0 && lineExpected >= 0);
    varianceCell.classList.toggle("danger", lineVariance !== 0 || lineExpected < 0);
  });

  return { issued, out, expected, variance, deposit, hasOverSoldLine };
}

function readLines() {
  return [...stockBody.rows].map((row) => {
    const line = {};

    row.querySelectorAll("input").forEach((input) => {
      const field = input.dataset.field;
      line[field] = input.type === "number" ? toNumber(input.value) : input.value.trim();
    });

    const item = row.dataset.itemCode ? getItemByCode(row.dataset.itemCode) : findItem(line.product);
    line.code = item?.code || row.dataset.itemCode || "";
    line.productName = item?.name || line.product;
    line.weight = item?.weight || "";
    line.category = item?.category || "";
    line.subcategory = item?.subcategory || "";

    return { row, line };
  });
}

function getCleanLines() {
  return readLines()
    .map(({ line }) => ({
      code: line.code,
      product: line.product || "Untitled product",
      productName: line.productName,
      weight: line.weight,
      category: line.category,
      subcategory: line.subcategory,
      price: line.price,
      issued: line.issued,
      sales: line.sales,
      salesAmount: line.sales * line.price,
      foc: line.foc,
      returnExchange: line.returnExchange,
      unload: line.unload,
      expected: line.issued - line.sales - line.foc - line.returnExchange,
      variance: line.unload - (line.issued - line.sales - line.foc - line.returnExchange),
    }))
    .filter((line) => {
      const hasQuantity =
        line.issued ||
        line.sales ||
        line.foc ||
        line.returnExchange ||
        line.unload;
      return line.product !== "Untitled product" && hasQuantity;
    });
}

function saveEntry() {
  const lines = getCleanLines();

  if (!lines.length) {
    return;
  }

  const summary = calculate();
  const records = getRecords();
  const record = {
    id: crypto.randomUUID(),
    date: fields.date.value || getToday(),
    executive: fields.executive.value.trim(),
    route: fields.route.value.trim(),
    warehouse: fields.warehouse.value.trim(),
    lines,
    totals: {
      issued: summary.issued,
      out: summary.out,
      expected: summary.expected,
      variance: summary.variance,
      deposit: summary.deposit,
    },
    savedAt: new Date().toISOString(),
  };

  records.unshift(record);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  renderHistory();
}

function loadRecord(recordId) {
  const record = getRecords().find((item) => item.id === recordId);
  if (!record) return;

  fields.date.value = record.date || getToday();
  fields.executive.value = record.executive || "";
  fields.route.value = record.route || "";
  fields.warehouse.value = record.warehouse || "";

  resetStockRows(record.lines || []);
}

function deleteRecord(recordId) {
  const records = getRecords().filter((record) => record.id !== recordId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  renderHistory();
}

function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
  renderHistory();
}

function resetForm() {
  fields.date.value = getToday();
  fields.executive.value = "";
  fields.route.value = "";
  fields.warehouse.value = "";
  resetStockRows();
}

function renderHistory() {
  const records = getRecords();
  historyList.replaceChildren();

  if (!records.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No records saved yet.";
    historyList.appendChild(empty);
    return;
  }

  records.forEach((record) => {
    const card = document.createElement("article");
    card.className = "record-card";
    card.classList.toggle("variance", record.totals.variance !== 0);
    card.dataset.recordId = record.id;

    const top = document.createElement("div");
    top.className = "record-top";

    const titleWrap = document.createElement("div");
    const title = document.createElement("p");
    title.className = "record-title";
    title.textContent = record.executive || "Unnamed executive";
    const meta = document.createElement("p");
    meta.className = "record-meta";
    meta.textContent = [record.date, record.route, record.warehouse].filter(Boolean).join(" | ");
    titleWrap.append(title, meta);

    const variance = document.createElement("p");
    variance.className = "record-total";
    variance.innerHTML = `Variance <strong>${formatNumber(record.totals.variance)}</strong>`;

    top.append(titleWrap, variance);

    const totalsLine = document.createElement("p");
    totalsLine.className = "record-total";
    totalsLine.innerHTML = `Expected <strong>${formatNumber(
      record.totals.expected,
    )}</strong> | Actual <strong>${formatNumber(
      record.totals.expected + record.totals.variance,
    )}</strong> | Deposit <strong>${formatNumber(record.totals.deposit || 0)}</strong>`;

    const actions = document.createElement("div");
    actions.className = "record-actions";
    actions.innerHTML = `
      <button type="button" data-action="load">Open</button>
      <button type="button" data-action="delete">Delete</button>
    `;

    card.append(top, totalsLine, actions);
    historyList.appendChild(card);
  });
}

function exportCsv() {
  const lines = getCleanLines();
  if (!lines.length) return;

  const summary = calculate();
  const headerRows = [
    ["Date", fields.date.value || getToday()],
    ["Sales Executive", fields.executive.value.trim()],
    ["Route / Area", fields.route.value.trim()],
    ["Warehouse", fields.warehouse.value.trim()],
    [],
    [
      "Item Code",
      "Product",
      "Weight",
      "Category",
      "Sub Category",
      "Price",
      "Issued",
      "Sales",
      "Sales Amount",
      "FOC",
      "Return / Exchange",
      "Actual Unload",
      "Closing Balance",
      "Variance",
    ],
  ];
  const lineRows = lines.map((line) => [
    line.code,
    line.productName,
    line.weight,
    line.category,
    line.subcategory,
    line.price,
    line.issued,
    line.sales,
    line.salesAmount,
    line.foc,
    line.returnExchange,
    line.unload,
    line.expected,
    line.variance,
  ]);
  const footerRows = [
    [],
    ["Total Issued", summary.issued],
    ["Total Out", summary.out],
    ["Closing Balance", summary.expected],
    ["Variance", summary.variance],
    ["Finance Deposit", summary.deposit],
  ];
  const csv = [...headerRows, ...lineRows, ...footerRows].map(toCsvRow).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const fileDate = fields.date.value || getToday();
  link.href = url;
  link.download = `stock-reconciliation-${fileDate}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function getItemFromLine(line) {
  if (line.code) return getItemByCode(line.code);
  if (line.product) return findItem(line.product);
  return null;
}

function getLineItemCode(line) {
  return line.code || findItem(line.product)?.code || "";
}

function findItem(value) {
  const normalized = normalize(value);
  if (!normalized) return null;

  return (
    itemMaster.find((item) => normalize(productLabel(item)) === normalized) ||
    itemMaster.find((item) => normalize(item.code) === normalized) ||
    itemMaster.find((item) => normalize(item.name) === normalized) ||
    itemMaster.find((item) => normalize(`${item.code} - ${item.name}`) === normalized) ||
    null
  );
}

function getItemByCode(code) {
  const normalized = normalize(code);
  return itemMaster.find((item) => normalize(item.code) === normalized) || null;
}

function productLabel(item) {
  return `${item.code} - ${item.name}${item.weight ? ` (${item.weight})` : ""}`;
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getRecords() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function toCsvRow(values) {
  return values
    .map((value) => {
      const text = value === undefined || value === null ? "" : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    })
    .join(",");
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function hasNumber(value) {
  return value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function getToday() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}
