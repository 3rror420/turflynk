/**
 * Terrain visualization helpers — ASCII indicators and customer-facing text.
 * No external dependencies, no I/O.
 */

/**
 * Horizon-tilt indicator (aircraft pitch style).
 * Tilt represents average grade / difficulty.
 *
 * Flat:       ━━━━━━━━━━
 * Moderate:        /
 *             ━━━━━/━━━━━
 * High:           //
 *             ━━━//━━━━━━
 * Extreme:       ///
 *             ━━///━━━━━━
 */
export function horizonStyle(score) {
  if (score <= 2)  return "━━━━━━━━━━";
  if (score <= 4)  return "     /\n━━━━━/━━━━━";
  if (score <= 7)  return "    //\n━━━//━━━━━━";
  return           "   ///\n━━///━━━━━━━";
}

/**
 * Compact severity meter  Flat ▓▓▓░░░░░░░ Steep
 * Fill width: 10 chars driven by score 0–10.
 *
 * @param {number} score 0–10
 */
export function slopeMeterPercent(score) {
  return Math.round(Math.min(100, Math.max(0, score * 10)));
}

export function slopeMeterBar(score) {
  const filled = Math.round(score);           // 0–10 blocks
  const empty  = 10 - filled;
  return `Flat ${"▓".repeat(filled)}${"░".repeat(empty)} Steep`;
}

/**
 * Short customer-facing explanation of terrain difficulty.
 * Never uses GIS jargon.
 *
 * @param {{
 *   difficultyCategory: string,
 *   elevationChangeFt: number|null,
 *   averageGradePercent: number|null,
 *   mode?: string,
 * }} terrain
 */
export function buildCustomerExplanation(terrain) {
  const cat   = terrain.difficultyCategory || "Flat";
  const chg   = terrain.elevationChangeFt  != null ? Math.round(terrain.elevationChangeFt) : null;
  const grade = terrain.averageGradePercent != null ? Math.round(terrain.averageGradePercent) : null;
  const mode  = terrain.mode || "display_only";

  const lines = [];

  if (chg !== null)  lines.push(`Elevation change: ${chg} ft`);
  if (grade !== null) {
    const gradeLabel =
      grade < 5  ? "Gentle" :
      grade < 10 ? "Moderate" :
      grade < 20 ? "Moderate–High" : "Steep";
    lines.push(`Average grade: ${gradeLabel}`);
  }
  lines.push(`Terrain difficulty: ${cat}`);

  if (cat === "High" || cat === "Extreme") {
    lines.push(
      "",
      "Steeper terrain may require:",
      "• Slower mowing speeds",
      "• Additional trimming",
      "• Smaller equipment",
      "• Additional safety considerations"
    );
  } else if (cat === "Moderate") {
    lines.push("", "Mildly sloped terrain. Service proceeds normally.");
  } else {
    lines.push("", "Level terrain. No special considerations.");
  }

  if (mode === "display_only") {
    lines.push("", "Terrain estimate shown for transparency. It is not currently changing your price.");
  } else if (mode === "pricing_enabled") {
    lines.push("", "Terrain difficulty may affect pricing for steep, rocky, or difficult-access lawns.");
  }

  return lines.join("\n");
}
