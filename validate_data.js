#!/usr/bin/env node
"use strict";

// ---------------------------------------------------------------------------
// validate_data.js — CLI tool to validate status parsing on data files.
//
// Loads each data/app_data_YYYY.js file in reverse chronological order and
// runs the same deriveStatus / effectiveStatus / parseExpectedDelivery logic
// used by the browser app.  Prints errors for anything that cannot be parsed.
//
// Items listed in data/known_status_issues.json are silently skipped (old
// orders with degraded data that cannot be fixed).
//
// Usage:
//   node validate_data.js [data_dir]
//
// data_dir defaults to ./data
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const {
  STATUS_RULES,
  deriveStatus,
  effectiveStatus,
  parseExpectedDelivery,
  daysSince,
  ASSUME_DELIVERED_AFTER_DAYS,
} = require("./status.js");

// ---------------------------------------------------------------------------
// Known keywords — delivery_status strings that DON'T match any STATUS_RULE
// but are silently classified via the order-age fallback are flagged here.
// ---------------------------------------------------------------------------
const KNOWN_KEYWORDS = STATUS_RULES.map(([pattern]) => pattern);

const VALID_RETURN_POLICIES = new Set([
  "free_or_replace", "return_only", "non_returnable", null, undefined,
]);

const VALID_RETURN_STATUSES = new Set([
  "none", "return_started", "return_in_transit", "return_complete",
  "replacement_ordered", "replacement_complete", null, undefined, "",
]);

// ---------------------------------------------------------------------------
// Load the known-issues allowlist (lives in the data directory).
// ---------------------------------------------------------------------------
function loadKnownIssues(dataDir) {
  const p = path.join(dataDir, "known_status_issues.json");
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    return new Set(data.items || []);
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Parse a data file.  Format: window.ORDER_DATA_YYYY = { ... };
// ---------------------------------------------------------------------------
function loadDataFile(filePath) {
  const src = fs.readFileSync(filePath, "utf-8");
  // Extract JSON between the first `=` and the trailing `;`
  const eqIdx = src.indexOf("=");
  if (eqIdx === -1) throw new Error(`No '=' found in ${filePath}`);
  let json = src.slice(eqIdx + 1).trim();
  if (json.endsWith(";")) json = json.slice(0, -1).trim();
  return JSON.parse(json);
}

// ---------------------------------------------------------------------------
// Validate a single item, returning an array of error strings (empty = ok).
// ---------------------------------------------------------------------------
function validateItem(item, year) {
  const errors = [];
  const id = item.item_id || item.order_id || "(unknown)";

  // --- Required fields ---
  if (!item.order_date) {
    errors.push(`missing order_date`);
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(item.order_date)) {
    errors.push(`malformed order_date: ${item.order_date}`);
  }

  // --- Status derivation ---
  let derived;
  try {
    derived = deriveStatus(item.delivery_status, item.order_date, item.tracking_url);
  } catch (e) {
    errors.push(`deriveStatus threw: ${e.message}`);
  }

  // Check for unrecognised delivery_status that fell through to order-age default
  if (item.delivery_status && (derived === "Ordered" || derived === "Delivered")) {
    const raw = item.delivery_status.toLowerCase();
    if (!KNOWN_KEYWORDS.some(k => raw.includes(k))) {
      errors.push(`unrecognised delivery_status: "${item.delivery_status}" → defaulted to ${derived}`);
    }
  }

  // --- effectiveStatus ---
  try {
    effectiveStatus(item);
  } catch (e) {
    errors.push(`effectiveStatus threw: ${e.message}`);
  }

  // --- Expected delivery parsing ---
  if (item.delivery_status) {
    try {
      parseExpectedDelivery(item.delivery_status);
    } catch (e) {
      errors.push(`parseExpectedDelivery threw: ${e.message}`);
    }
  }

  // --- return_window_end format ---
  if (item.return_window_end != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.return_window_end)) {
      errors.push(`malformed return_window_end: ${item.return_window_end}`);
    }
  }

  // --- return_policy enum ---
  if (!VALID_RETURN_POLICIES.has(item.return_policy)) {
    errors.push(`unknown return_policy: "${item.return_policy}"`);
  }

  // --- return_status enum ---
  if (!VALID_RETURN_STATUSES.has(item.return_status)) {
    errors.push(`unknown return_status: "${item.return_status}"`);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const dataDir = path.resolve(process.argv[2] || "data");
  if (!fs.existsSync(dataDir)) {
    console.error(`Data directory not found: ${dataDir}`);
    process.exit(1);
  }

  const knownIssues = loadKnownIssues(dataDir);

  // Discover year files and sort in reverse chronological order
  const yearFiles = fs.readdirSync(dataDir)
    .filter(f => /^app_data_\d{4}\.js$/.test(f))
    .sort((a, b) => {
      const ya = parseInt(a.match(/\d{4}/)[0], 10);
      const yb = parseInt(b.match(/\d{4}/)[0], 10);
      return yb - ya;
    });

  if (yearFiles.length === 0) {
    console.error(`No app_data_YYYY.js files found in ${dataDir}`);
    process.exit(1);
  }

  let totalItems = 0;
  let totalErrors = 0;
  let totalSkipped = 0;
  const statusCounts = {};

  for (const file of yearFiles) {
    const filePath = path.join(dataDir, file);
    const year = file.match(/\d{4}/)[0];

    let data;
    try {
      data = loadDataFile(filePath);
    } catch (e) {
      console.error(`ERROR  ${file}: failed to parse file — ${e.message}`);
      totalErrors++;
      continue;
    }

    const items = data.items || [];
    let yearErrors = 0;
    let yearSkipped = 0;

    for (const item of items) {
      totalItems++;
      const derived = deriveStatus(item.delivery_status, item.order_date, item.tracking_url);
      statusCounts[derived] = (statusCounts[derived] || 0) + 1;

      const errors = validateItem(item, year);
      if (errors.length > 0) {
        const id = item.item_id || item.order_id || "(unknown)";
        if (knownIssues.has(id)) {
          yearSkipped++;
          totalSkipped++;
          continue;
        }
        yearErrors += errors.length;
        totalErrors += errors.length;
        for (const err of errors) {
          console.error(`ERROR  ${year}  ${id}  ${err}`);
        }
      }
    }

    const parts = [`${items.length} items`];
    if (yearErrors > 0) parts.push(`${yearErrors} error(s)`);
    if (yearSkipped > 0) parts.push(`${yearSkipped} known issue(s) skipped`);
    if (yearErrors === 0 && yearSkipped === 0) parts.push("ok");
    console.log(`${year}  ${parts.join("  ")}`);
  }

  // Summary
  console.log("");
  console.log(`Total: ${totalItems} items across ${yearFiles.length} files`);
  console.log("Status distribution:");
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  "${status}": ${count}`);
  }
  if (totalSkipped > 0) {
    console.log(`(${totalSkipped} known issue(s) skipped — see data/known_status_issues.json)`);
  }

  if (totalErrors > 0) {
    console.log(`\n${totalErrors} error(s) found.`);
    process.exit(1);
  } else {
    console.log("\nAll items validated successfully.");
  }
}

main();
