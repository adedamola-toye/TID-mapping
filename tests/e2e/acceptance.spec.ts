import { test, expect } from "@playwright/test";
import { USERS, login, newSession, uniqueTerminal } from "./helpers";

/**
 * CRITICAL ACCEPTANCE TESTS (spec §46): the full new-mapping and remapping workflows driven
 * through the real UI by an internal user and an Elnexu vendor user in separate sessions.
 */

test("NEW MAPPING: internal create → submit → vendor copies & treats → internal sees TREATED → audit trail", async ({ browser }) => {
  const t = uniqueTerminal();
  const account = "9012345678";

  // ── Internal user creates & submits ──
  const ops = await newSession(browser, USERS.ops);
  const p = ops.page;
  await p.goto("/requests/new/mapping");
  await p.getByLabel("Terminal serial number").fill(t.serial);
  await p.getByLabel("TID", { exact: false }).first().fill(t.tid);
  await p.getByLabel("Agent / merchant name").fill("E2E Acceptance Ventures");
  await p.getByLabel("Account number").fill(account);
  await p.getByLabel("Location (state)").selectOption("Rivers");
  // ANM must come from the controlled dropdown
  const anmSelect = p.getByLabel("ANM");
  await expect(anmSelect).toHaveJSProperty("tagName", "SELECT");
  await anmSelect.selectOption({ index: 1 });
  await p.getByRole("button", { name: "Continue to review" }).click();
  await expect(p.getByRole("heading", { name: "Review mapping" })).toBeVisible();
  await expect(p.getByText("E2E ACCEPTANCE VENTURES")).toBeVisible();
  await expect(p.getByText("••••••5678")).toBeVisible();
  const submit = p.getByRole("button", { name: "Submit to Elnexu" });
  await expect(submit).toBeDisabled();
  await p.getByLabel("I have reviewed the information and it is ready for vendor treatment.").check();
  await submit.click();
  await expect(p.getByText(/Request WKL-MAP-\d+ created/)).toBeVisible();
  await expect(p.getByText("It is now in Elnexu's treatment queue.")).toBeVisible();
  await p.getByRole("link", { name: "View request" }).click();
  await expect(p.getByText("Pending Vendor Treatment").first()).toBeVisible();
  const requestUrl = p.url();
  const reference = (await p.locator("h1 .ident").textContent())!.trim();
  // URLs never contain account numbers
  expect(requestUrl).not.toContain(account);

  // ── Vendor treats ──
  const vendor = await newSession(browser, USERS.vendor);
  const v = vendor.page;
  await v.goto("/vendor");
  await v.getByLabel("Search requests").fill(t.serial);
  const row = v.getByRole("row").filter({ hasText: t.serial });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Treat" }).click();
  await expect(v.getByRole("heading", { name: new RegExp(`Map terminal ${reference}`) })).toBeVisible();
  // Internal comment / names are not exposed to the vendor
  await expect(v.getByText("Ola Operations")).toHaveCount(0);

  // Copy a single field and the full payload
  await v.getByRole("button", { name: "Copy TID" }).click();
  await expect(v.getByRole("button", { name: "Copy TID" })).toHaveText(/Copied/);
  expect(await v.evaluate(() => navigator.clipboard.readText())).toBe(t.tid);
  await v.getByRole("button", { name: "Copy all" }).click();
  await expect(v.getByRole("button", { name: /Copied/ }).first()).toBeVisible();
  const payload = await v.evaluate(() => navigator.clipboard.readText());
  expect(payload).toContain(`Terminal Serial Number:\n${t.serial}`);
  expect(payload).toContain(`TID:\n${t.tid}`);
  expect(payload).toContain("Agent/Merchant:\nE2E ACCEPTANCE VENTURES");
  expect(payload).toContain(`Account Number:\n${account}`);
  expect(payload).toContain("Location:\nRivers");
  expect(payload).not.toMatch(/internal/i);

  await v.getByRole("button", { name: "Mark as treated" }).click();
  const confirmBtn = v.getByRole("button", { name: "Confirm treated" });
  await expect(confirmBtn).toBeDisabled();
  await v.getByLabel(/Confirm that this terminal has been successfully mapped in the TMS/).check();
  await v.getByLabel("Treatment comment (optional)").fill("Profiled on TMS");
  await confirmBtn.click();
  await v.waitForURL("**/vendor");

  // ── Internal sees TREATED immediately ──
  await p.goto(requestUrl);
  await expect(p.getByText("Treated", { exact: true }).first()).toBeVisible();
  await expect(p.getByText(/Treated by Emeka Elnexu \(Test\)/)).toBeVisible();
  await expect(p.getByText("Profiled on TMS").first()).toBeVisible();
  // Timeline shows the whole story
  for (const step of ["Created", "Reviewed & submitted to Elnexu", "Opened by vendor", "Treated in TMS"]) {
    await expect(p.getByText(step, { exact: true }).first()).toBeVisible();
  }
  // Notification delivered to the internal user
  await p.getByRole("button", { name: /Notifications/ }).click();
  await expect(p.getByText(`${reference} has been treated by the vendor`)).toBeVisible();

  // ── Audit trail ──
  const admin = await newSession(browser, USERS.admin);
  await admin.page.goto("/admin/audit");
  await admin.page.getByLabel("Search audit log").fill(reference);
  for (const action of ["REQUEST_CREATED", "REQUEST_SUBMIT_TO_VENDOR", "VENDOR_OPENED_REQUEST", "VENDOR_COPIED_DATA", "REQUEST_TREAT"]) {
    await expect(admin.page.locator("tbody").getByText(action, { exact: true }).first()).toBeVisible();
  }
  await admin.page.getByRole("button", { name: "Verify integrity" }).click();
  await expect(admin.page.getByText(/Hash chain intact/)).toBeVisible();

  await Promise.all([ops.ctx.close(), vendor.ctx.close(), admin.ctx.close()]);
});

test("REMAPPING: lookup current mapping → new agent → vendor treats → history preserved", async ({ browser }) => {
  const ops = await newSession(browser, USERS.ops);
  const p = ops.page;
  // Find a mapped terminal from the terminal master
  await p.goto("/terminals");
  await p.getByRole("tab", { name: "Mapped", exact: true }).click();
  const firstRow = p.locator("tbody tr").filter({ has: p.getByText("Mapped", { exact: true }) }).first();
  await expect(firstRow).toBeVisible();
  const serial = (await firstRow.locator("td").first().textContent())!.trim();
  const tid = (await firstRow.locator("td").nth(1).textContent())!.trim();

  await p.goto("/requests/new/remapping");
  await p.getByLabel("Serial number or TID").fill(tid);
  await p.getByRole("button", { name: "Find terminal" }).click();
  await expect(p.getByText(/Current mapping · v\d/)).toBeVisible();
  const oldAgent = (await p.locator("dt:has-text('Agent / merchant') + dd").first().textContent())!.trim();
  // Serial/TID are shown locked; no editable inputs for them
  await expect(p.getByText("Locked for remapping")).toBeVisible();
  await expect(p.getByLabel("Terminal serial number")).toHaveCount(0);

  await p.getByLabel("Agent / merchant name").fill("E2E Remapped Holdings");
  await p.getByLabel("Account number").fill("9087654321");
  await p.getByLabel("Location (state)").selectOption("Ogun");
  await p.getByLabel("ANM").selectOption({ index: 1 });
  await p.getByLabel("Reason for remapping").fill("Agent relocated (e2e)");
  await p.getByRole("button", { name: "Continue to review" }).click();
  await expect(p.getByText("Serial number (unchanged)")).toBeVisible();
  await p.getByLabel("I have reviewed the information and it is ready for vendor treatment.").check();
  await p.getByRole("button", { name: "Submit to Elnexu" }).click();
  await expect(p.getByText(/Remapping WKL-REM-\d+ created/)).toBeVisible();

  const vendor = await newSession(browser, USERS.vendor);
  const v = vendor.page;
  await v.goto("/vendor?tab=remapping");
  await v.getByLabel("Search requests").fill(serial);
  await v.getByRole("row").filter({ hasText: serial }).getByRole("link", { name: "Treat" }).click();
  await expect(v.getByText("Remapping — the terminal serial number and TID do not change.")).toBeVisible();
  await expect(v.getByText(/Current mapping in TMS \(version \d+\) — being replaced/)).toBeVisible();
  await v.getByRole("button", { name: "Mark as treated" }).click();
  await v.getByLabel(/successfully remapped in the TMS/).check();
  await v.getByRole("button", { name: "Confirm treated" }).click();
  await v.waitForURL("**/vendor");

  // History on the terminal page: old mapping preserved, new one current, same serial/TID
  await p.goto("/terminals");
  await p.getByLabel("Search terminals").fill(serial);
  await p.getByRole("link", { name: serial }).click();
  await expect(p.locator("h1")).toContainText(serial);
  await expect(p.getByText(`TID ${tid}`)).toBeVisible();
  const current = p.locator("li", { hasText: "Current" }).first();
  await expect(current).toContainText("E2E REMAPPED HOLDINGS");
  await expect(current).toContainText("Agent relocated (e2e)");
  await expect(p.locator("li", { hasText: "Superseded" }).filter({ hasText: oldAgent }).first()).toBeVisible();

  await Promise.all([ops.ctx.close(), vendor.ctx.close()]);
});

test("BATCH: upload mapping CSV → validate → correct a row → import → bulk submit", async ({ page }) => {
  await login(page, USERS.ops);
  const a = uniqueTerminal();
  const b = uniqueTerminal();
  const csv = [
    "Terminal Serial Number,TID,Agent Name,Account Number,State,ANM",
    `${a.serial},${a.tid},BATCH AGENT ONE,9011111112,Lagos,ANM-001`,
    `${b.serial},${b.tid},BATCH AGENT TWO,123,Lagos,Not An ANM`,
  ].join("\n");
  await page.goto("/imports");
  await page.getByLabel("New mapping requests").check();
  await page.getByLabel("Choose file").setInputFiles({ name: "e2e-batch.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Upload & detect columns" }).click();
  await page.waitForURL(/\/imports\/[0-9a-f-]+$/);
  await page.getByRole("button", { name: "Validate all rows" }).click();
  await expect(page.getByText("Validation complete.")).toBeVisible();
  await expect(page.getByText("is not on the approved ANM list")).toBeVisible();
  await page.getByRole("button", { name: "Correct row 3" }).click();
  await page.getByRole("dialog").getByLabel("Account Number").fill("9022222223");
  await page.getByRole("dialog").getByLabel("ANM").fill("ANM-002");
  await page.getByRole("button", { name: "Save & re-validate" }).click();
  await expect(page.getByRole("button", { name: "Import 2 valid rows" })).toBeEnabled();
  await page.getByRole("button", { name: "Import 2 valid rows" }).click();
  await expect(page.getByText(/Import complete — 2 record\(s\) imported/)).toBeVisible();
  await page.getByRole("link", { name: "Review this batch's requests" }).click();
  await expect(page.getByRole("row").filter({ hasText: "BATCH AGENT ONE" })).toBeVisible();
  await page.getByLabel("Select all on this page").check();
  await page.getByRole("button", { name: "Submit to Elnexu" }).click();
  await page.getByRole("dialog").getByLabel(/I have reviewed the information/).check();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("2 requests updated.")).toBeVisible();
});

test("VENDOR EXCEPTION: vendor cannot silently treat; exception returns to internal queue", async ({ browser }) => {
  const vendor = await newSession(browser, USERS.vendor);
  const v = vendor.page;
  await v.goto("/vendor");
  await v.getByRole("row").filter({ hasText: "Pending" }).first().getByRole("link", { name: "Treat" }).click();
  const ref = (await v.locator("h1 .ident").textContent())!.trim();
  await v.getByRole("button", { name: "Unable to treat" }).click();
  const raise = v.getByRole("button", { name: "Raise exception" });
  await expect(raise).toBeDisabled();
  await v.getByLabel("Other").check();
  await expect(raise).toBeDisabled(); // "Other" needs an explanation
  await v.getByLabel(/Explanation/).fill("Terminal shows <b>tamper</b> alert");
  await raise.click();
  await v.waitForURL("**/vendor");

  const ops = await newSession(browser, USERS.ops);
  await ops.page.goto("/requests?view=exceptions");
  await ops.page.getByLabel("Search requests").fill(ref);
  await ops.page.getByRole("link", { name: ref }).first().click();
  await expect(ops.page.getByText("Vendor exception: Other")).toBeVisible();
  // Stored markup is rendered as text, never as HTML
  await expect(ops.page.getByText("Terminal shows <b>tamper</b> alert").first()).toBeVisible();
  await ops.page.getByRole("button", { name: "Return for correction" }).click();
  await ops.page.getByLabel(/What needs to be corrected/).fill("Confirm terminal condition with field officer");
  await ops.page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(ops.page.getByText("Returned for correction").first()).toBeVisible();
  await Promise.all([ops.ctx.close(), vendor.ctx.close()]);
});

test("FIELD SUBMITTER: mobile capture, submit for review, cannot release to vendor", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await login(page, USERS.field);
  await expect(page).toHaveURL(/\/my-requests/);
  const t = uniqueTerminal();
  await page.goto("/requests/new/mapping");
  await page.getByLabel("Terminal serial number").fill(t.serial);
  await page.getByLabel("TID", { exact: false }).first().fill(t.tid);
  await page.getByLabel("Agent / merchant name").fill("Mobile Field Stores");
  await page.getByLabel("Account number").fill("9033333334");
  await page.getByLabel("Location (state)").selectOption("Kano");
  await page.getByLabel("ANM").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Continue to review" }).click();
  await expect(page.getByRole("button", { name: "Submit to Elnexu" })).toHaveCount(0);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("It is ready for review and release.")).toBeVisible();
  // No horizontal page scroll on phone width
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // Admin pages are off limits
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/forbidden/);
  await page.goto("/vendor");
  await expect(page).toHaveURL(/\/forbidden/);
  await ctx.close();
});
