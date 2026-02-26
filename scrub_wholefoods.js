#!/usr/bin/env node
"use strict";

// ---------------------------------------------------------------------------
// scrub_wholefoods.js — One-time cleanup: remove Whole Foods / grocery orders
// from existing data files.
//
// Whole Foods orders are identified by the combination of:
//   1. ALL items in the order have delivery_status "Cannot display current status"
//   2. ALL items have null tracking_url, null unit_price, and empty carrier
//   3. The order has 2+ items (single-item orders with degraded data are kept
//      since those are regular Amazon items, not grocery)
//
// Usage:
//   node scrub_wholefoods.js [data_dir]       # dry run (default)
//   node scrub_wholefoods.js [data_dir] --write
//
// data_dir defaults to ./data
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const write = args.includes("--write");
const dataDir = path.resolve(args.find(a => a !== "--write") || "data");

if (!fs.existsSync(dataDir)) {
  console.error(`Data directory not found: ${dataDir}`);
  process.exit(1);
}

function isNullDataItem(item) {
  return (
    item.delivery_status === "Cannot display current status" &&
    !item.tracking_url &&
    item.unit_price === null &&
    !item.carrier
  );
}

const yearFiles = fs.readdirSync(dataDir)
  .filter(f => /^app_data_\d{4}\.js$/.test(f))
  .sort((a, b) => {
    const ya = parseInt(a.match(/\d{4}/)[0], 10);
    const yb = parseInt(b.match(/\d{4}/)[0], 10);
    return yb - ya;
  });

let totalRemoved = 0;

for (const file of yearFiles) {
  const filePath = path.join(dataDir, file);
  const year = file.match(/\d{4}/)[0];

  const src = fs.readFileSync(filePath, "utf-8");
  const eqIdx = src.indexOf("=");
  let json = src.slice(eqIdx + 1).trim();
  if (json.endsWith(";")) json = json.slice(0, -1).trim();
  const data = JSON.parse(json);
  const items = data.items || [];

  // Group by order_id
  const byOrder = {};
  for (const item of items) {
    const oid = item.order_id;
    if (!byOrder[oid]) byOrder[oid] = [];
    byOrder[oid].push(item);
  }

  // Find Whole Foods order IDs
  const wholeFoodsOrders = new Set();
  for (const [oid, orderItems] of Object.entries(byOrder)) {
    if (orderItems.length >= 2 && orderItems.every(isNullDataItem)) {
      wholeFoodsOrders.add(oid);
    }
  }

  if (wholeFoodsOrders.size === 0) continue;

  const removedCount = items.filter(i => wholeFoodsOrders.has(i.order_id)).length;
  totalRemoved += removedCount;

  console.log(
    `${year}: removing ${removedCount} items from ${wholeFoodsOrders.size} ` +
    `Whole Foods order(s): ${[...wholeFoodsOrders].join(", ")}`
  );

  if (write) {
    const kept = items.filter(i => !wholeFoodsOrders.has(i.order_id));
    data.items = kept;
    const varName = `window.ORDER_DATA_${year}`;
    fs.writeFileSync(filePath, `${varName} = ${JSON.stringify(data, null, 0)};\n`, "utf-8");
  }
}

if (totalRemoved === 0) {
  console.log("No Whole Foods orders found.");
} else if (write) {
  console.log(`\nDone. Removed ${totalRemoved} items total.`);
  console.log("Run 'node validate_data.js' to verify.");
} else {
  console.log(`\nDry run: would remove ${totalRemoved} items total.`);
  console.log("Re-run with --write to apply changes.");
}
