// TurfLynk AI Grass Detection (stub version)
// Prevents frontend errors when feature is disabled

window.TurfLynkAiGrass = {
  enabled: false,
  detect: function () {
    console.warn("AI grass detection is currently disabled.");
    return null;
  },
  recalcMowAreaFromEditableLayers: function () {
    if (typeof window.syncMowAreaFromLayers === "function") {
      window.syncMowAreaFromLayers();
    }
  }
};

// Optional: hide any UI if it somehow appears
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll('[data-ai-grass], .ai-detect-btn').forEach(el => {
    el.style.display = "none";
  });
});
