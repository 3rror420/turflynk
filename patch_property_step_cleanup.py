from pathlib import Path
from datetime import datetime
import re

ROOT = Path(".")
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

files = [
    ROOT / "public/index.html",
    ROOT / "public/styles.css",
    ROOT / "public/app.js",
]

for f in files:
    if f.exists():
        backup = f.with_suffix(f.suffix + f".bak-property-cleanup-{stamp}")
        backup.write_text(f.read_text(), encoding="utf-8")
        print(f"Backup: {backup}")

index = ROOT / "public/index.html"
css = ROOT / "public/styles.css"
app = ROOT / "public/app.js"

html = index.read_text(encoding="utf-8")

# Rename parcel step copy to act as the single confirmation area.
html = re.sub(
    r"<h[23][^>]*>\s*Parcel Found\s*</h[23]>",
    '<h2>Confirm Property</h2>',
    html,
    flags=re.I,
)

# Remove obvious duplicate confirm-property panels/sections if present.
duplicate_patterns = [
    r'\n\s*<section[^>]*(?:id|class)="[^"]*(?:confirm[-_ ]?property|property[-_ ]?confirm)[^"]*"[\s\S]*?</section>\s*',
    r'\n\s*<div[^>]*(?:id|class)="[^"]*(?:confirm[-_ ]?property|property[-_ ]?confirm)[^"]*"[\s\S]*?</div>\s*',
]
for pat in duplicate_patterns:
    html, n = re.subn(pat, "\n", html, flags=re.I)
    if n:
        print(f"Removed {n} duplicate confirm property block(s).")

# Add a unified action row after common parcel/details containers when possible.
if "property-unified-actions" not in html:
    inserted = False

    candidates = [
        r'(<div[^>]+id="parcelSummary"[^>]*>[\s\S]*?</div>)',
        r'(<div[^>]+id="parcelDetails"[^>]*>[\s\S]*?</div>)',
        r'(<div[^>]+class="[^"]*parcel[^"]*summary[^"]*"[^>]*>[\s\S]*?</div>)',
    ]

    action_html = '''
        <div class="property-unified-actions">
          <button type="button" id="changeAddressBtn" class="btn-secondary">Change Address</button>
          <button type="button" id="editPropertyAreaBtn" class="btn-secondary">Edit Area</button>
          <button type="button" id="continueToDrawBtn" class="btn-primary">Continue</button>
        </div>'''

    for pat in candidates:
        html, n = re.subn(pat, r"\1" + action_html, html, count=1, flags=re.I)
        if n:
            inserted = True
            print("Inserted unified property action buttons.")
            break

    if not inserted:
        print("Could not auto-place unified buttons. No known parcel summary container found.")

# Hide old duplicate buttons instead of risky deletion.
css_text = css.read_text(encoding="utf-8")

add_css = r'''

/* Property step cleanup: find + confirm property in one place */
.property-unified-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-top: 14px;
}

.property-unified-actions button {
  width: 100%;
  min-height: 46px;
}

@media (min-width: 720px) {
  .property-unified-actions {
    grid-template-columns: 1fr 1fr 1.2fr;
    align-items: center;
  }
}

/* Hide common duplicate confirmation UI if old markup still exists */
.confirm-property,
.property-confirm,
#confirmProperty,
#propertyConfirm,
#confirmParcel,
.parcel-confirm,
#parcelConfirm {
  display: none !important;
}
'''

if "Property step cleanup: find + confirm property in one place" not in css_text:
    css_text += add_css
    print("Added cleanup CSS.")

# Wire new buttons to existing buttons/functions by click forwarding.
js = app.read_text(encoding="utf-8")

add_js = r'''

// Property step cleanup: unified buttons
(function setupUnifiedPropertyActions() {
  function clickFirst(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && !el.disabled) {
        el.click();
        return true;
      }
    }
    return false;
  }

  document.addEventListener("click", function (event) {
    const target = event.target;
    if (!target) return;

    if (target.id === "changeAddressBtn") {
      event.preventDefault();
      clickFirst(["#backToAddressBtn", "#changeParcelBtn", "#startOverBtn", "[data-step='start']"]);
    }

    if (target.id === "editPropertyAreaBtn") {
      event.preventDefault();
      clickFirst(["#editAreasBtn", "#drawAreaBtn", "#continueToDrawAreaBtn", "#parcelContinueBtn"]);
    }

    if (target.id === "continueToDrawBtn") {
      event.preventDefault();
      clickFirst(["#parcelContinueBtn", "#continueParcelBtn", "#confirmPropertyBtn", "#continueToDrawAreaBtn", "#drawAreaBtn"]);
    }
  });
})();
'''

if "Property step cleanup: unified buttons" not in js:
    js += add_js
    print("Added unified button JS forwarding.")

index.write_text(html, encoding="utf-8")
css.write_text(css_text, encoding="utf-8")
app.write_text(js, encoding="utf-8")

print("Patch complete.")
