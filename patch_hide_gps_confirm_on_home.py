from pathlib import Path
from datetime import datetime

stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
css = Path("public/styles.css")
app = Path("public/app.js")

for p in [css, app]:
    p.with_suffix(p.suffix + f".bak-hide-gps-confirm-{stamp}").write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
    print("Backup:", p)

css_text = css.read_text(encoding="utf-8")
css_patch = """

/* Keep GPS parcel confirmation from leaking onto landing/home page */
body:not([data-active-view="quote"]) #gpsConfirmBar,
body:not([data-active-view="quote"]) #parcelInfo,
body:not([data-active-view="quote"]) .parcel-actions-card {
  display: none !important;
}
"""
if "Keep GPS parcel confirmation from leaking onto landing/home page" not in css_text:
    css.write_text(css_text + css_patch, encoding="utf-8")
    print("Added CSS guard.")

app_text = app.read_text(encoding="utf-8")
js_patch = """

// Guard: keep property/parcel confirmation UI hidden outside quote flow
(function guardPropertyUiOutsideQuote() {
  function sync() {
    const isQuote = document.body?.dataset?.activeView === "quote";
    if (isQuote) return;

    for (const id of ["gpsConfirmBar", "parcelInfo"]) {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    }

    document.querySelectorAll(".parcel-actions-card").forEach((el) => {
      el.classList.add("hidden");
    });
  }

  document.addEventListener("DOMContentLoaded", sync);
  document.addEventListener("click", () => setTimeout(sync, 50));
  setInterval(sync, 1000);
})();
"""
if "guardPropertyUiOutsideQuote" not in app_text:
    app.write_text(app_text + js_patch, encoding="utf-8")
    print("Added JS guard.")

print("done")
