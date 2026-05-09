/**
 * Terrain card renderer — customer-facing terrain analysis UI.
 *
 * Displays only when:
 *   terrain.enabled && terrain.available &&
 *   (terrain.mode === "display_only" || terrain.mode === "pricing_enabled")
 *
 * Relies on:
 *   escapeHtml  → public/js/utils/dom.js
 *
 * Called from renderEstimateResult() after the main estimate card renders.
 */

/**
 * Render the terrain guardrail warning card.
 * Called after renderTerrainCard() when manualReviewRequired=true,
 * and also directly from checkout-request.js when the user tries to book.
 *
 * @param {object|null|undefined} terrain
 */
function renderTerrainGuardrailCard(terrain) {
  const container = document.getElementById("terrainGuardrailCard");
  if (!container) return;

  const guardrail = terrain?.terrainGuardrail;
  if (!guardrail?.manualReviewRequired) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }

  const category    = terrain.difficultyCategory || "";
  const adminMsg    = guardrail.message || "";
  const address     = (typeof state !== "undefined" && state?.selectedServiceLocation?.address) || "";

  container.innerHTML = `
    <div class="terrain-guardrail-card flow-card" role="alert">
      <div class="section-label terrain-guardrail-label">Steep Terrain Detected</div>
      <p class="terrain-guardrail-headline"><strong>Your selected mowing area appears to include steep or difficult terrain.</strong></p>
      <p class="terrain-guardrail-subtext">Online booking is paused so we can manually verify safe access and accurate pricing.${category ? ` Detected terrain: <strong>${escapeHtml(category)}</strong>.` : ""}</p>
      ${adminMsg ? `<p class="terrain-guardrail-admin-msg">${escapeHtml(adminMsg)}</p>` : ""}
      <p class="terrain-guardrail-disclaimer">If this looks incorrect, contact us and we'll review the selected mowing area.</p>
      <div class="terrain-guardrail-actions">
        <button class="btn primary ui-icon-btn" type="button" id="terrainRequestManualReviewBtn">
          <img src="/assets/icons/lucide/clipboard-list.svg" alt="" class="ui-icon">
          <span class="ui-label">Request manual review</span>
        </button>
        <button class="btn secondary ui-icon-btn" type="button" id="terrainContactBtn">
          <img src="/assets/icons/lucide/phone.svg" alt="" class="ui-icon">
          <span class="ui-label">Contact MowNWA</span>
        </button>
      </div>
      <div id="terrainGuardrailRequestResult" class="result hidden" style="margin-top:8px"></div>
    </div>`;
  container.hidden = false;

  // Wire up manual review button
  const reviewBtn = container.querySelector("#terrainRequestManualReviewBtn");
  if (reviewBtn && !reviewBtn._bound) {
    reviewBtn._bound = true;
    reviewBtn.addEventListener("click", () => submitTerrainManualReview(terrain, reviewBtn));
  }

  // Wire up contact button — open manual quote panel if available, otherwise mailto
  const contactBtn = container.querySelector("#terrainContactBtn");
  if (contactBtn && !contactBtn._bound) {
    contactBtn._bound = true;
    contactBtn.addEventListener("click", () => {
      const manualBtn = document.getElementById("manualQuoteBtn");
      if (manualBtn) {
        manualBtn.click();
      } else {
        window.location.href = "tel:+14799999999";
      }
    });
  }
}

/** Submit a terrain manual review request to the backend. */
async function submitTerrainManualReview(terrain, btn) {
  const resultEl = document.getElementById("terrainGuardrailRequestResult");
  if (btn) { btn.disabled = true; btn.querySelector?.(".ui-label")?.textContent && (btn.querySelector(".ui-label").textContent = "Submitting…"); }
  try {
    const q = (typeof state !== "undefined" && (state.lastQuote || state.pendingQuote)) || {};
    const body = {
      customerName:   q.customerName || q.name || "",
      customerPhone:  q.customerPhone || q.phone || "",
      customerEmail:  q.customerEmail || q.email || "",
      address:        q.address || "",
      city:           q.city || "",
      state:          q.state || "",
      zip:            q.zip || "",
      estimate:       q.estimate || 0,
      terrain,
      reasonCode:     terrain?.terrainGuardrail?.reasonCode || "",
      parcelGeoJson:  q.parcelGeoJSON || q.parcelGeoJson || null,
      mowableGeoJson: q.mowableGeoJSON || q.mowableGeoJson || q.selectedMowableGeoJSON || null,
    };
    const res = await (typeof api === "function"
      ? api("/api/terrain/manual-review-request", { method: "POST", body: JSON.stringify(body) })
      : fetch("/api/terrain/manual-review-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()));

    if (res.ok) {
      if (resultEl) {
        resultEl.className = "result success";
        resultEl.innerHTML = "<strong>Request submitted.</strong> We'll reach out to review your property.";
        resultEl.hidden = false;
      }
      if (btn) { btn.disabled = true; btn.querySelector?.(".ui-label") && (btn.querySelector(".ui-label").textContent = "Request sent"); }
    } else {
      throw new Error(res.error || "Submission failed");
    }
  } catch (err) {
    if (resultEl) {
      resultEl.className = "result error";
      resultEl.textContent = "Could not submit request. Please contact us directly.";
      resultEl.hidden = false;
    }
    if (btn) { btn.disabled = false; btn.querySelector?.(".ui-label") && (btn.querySelector(".ui-label").textContent = "Request manual review"); }
  }
}

/** @param {object|null|undefined} terrain */
function renderTerrainCard(terrain) {
  const container = document.getElementById("terrainCard");
  if (!container) return;

  if (
    !terrain ||
    !terrain.enabled ||
    !terrain.available ||
    terrain.mode === "off"
  ) {
    container.hidden = true;
    container.innerHTML = "";
    // Also hide guardrail card if terrain is off/unavailable
    renderTerrainGuardrailCard(null);
    return;
  }

  const category    = terrain.difficultyCategory || "Flat";
  const score       = Number(terrain.difficultyScore || 0);
  const meterPct    = Number(terrain.indicators?.slopeMeterPercent || 0);
  const horizon     = terrain.indicators?.horizonStyle || "━━━━━━━━━━";
  const elevChg     = terrain.elevationChangeFt != null ? Math.round(terrain.elevationChangeFt) : null;
  const avgGrade    = terrain.averageGradePercent != null ? Math.round(terrain.averageGradePercent) : null;
  const isPricingOn = terrain.mode === "pricing_enabled";
  const multiplier  = Number(terrain.priceMultiplier || 1.0);

  // Build meter bar (10 blocks)
  const filled = Math.round(score);
  const empty  = 10 - filled;
  const meterBar = `Flat ${"▓".repeat(Math.max(0, filled))}${"░".repeat(Math.max(0, empty))} Steep`;

  // Grade label
  const gradeLabel =
    avgGrade == null    ? null :
    avgGrade < 5        ? "Gentle"         :
    avgGrade < 10       ? "Moderate"       :
    avgGrade < 20       ? "Moderate–High"  : "Steep";

  // Pricing / transparency line
  const pricingLine = (isPricingOn && multiplier > 1.001)
    ? `<p class="terrain-pricing-note">Terrain difficulty adjustment: +${Math.round((multiplier - 1) * 100)}% applied to quote</p>`
    : "";

  const modeNotice = isPricingOn
    ? `<p class="terrain-mode-notice">Terrain difficulty may affect pricing for steep, rocky, or difficult-access lawns.</p>`
    : `<p class="terrain-mode-notice">Terrain estimate shown for transparency. It is not currently changing your price.</p>`;

  const html = `
    <div class="terrain-card flow-card">
      <div class="section-label">Terrain Analysis</div>
      <div class="terrain-horizon" aria-hidden="true"><pre>${escapeHtml(horizon)}</pre></div>
      <div class="terrain-meter" aria-hidden="true"><pre>${escapeHtml(meterBar)}</pre></div>
      <ul class="terrain-stats">
        ${elevChg !== null ? `<li>Elevation change: <strong>${elevChg} ft</strong></li>` : ""}
        ${gradeLabel ? `<li>Average grade: <strong>${escapeHtml(gradeLabel)}</strong></li>` : ""}
        <li>Terrain difficulty: <strong>${escapeHtml(category)}</strong></li>
      </ul>
      ${pricingLine}
      ${modeNotice}
      ${(category === "High" || category === "Extreme") ? `
      <div class="terrain-advisory">
        <p>Steeper terrain may require:</p>
        <ul>
          <li>Slower mowing speeds</li>
          <li>Additional trimming</li>
          <li>Smaller equipment</li>
          <li>Additional safety considerations</li>
        </ul>
      </div>` : ""}
    </div>`;

  container.innerHTML = html;
  container.hidden = false;

  // Also render (or clear) the guardrail warning card
  renderTerrainGuardrailCard(terrain);
}
