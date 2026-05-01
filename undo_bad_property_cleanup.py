from pathlib import Path
from datetime import datetime
import re

stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

index = Path("public/index.html")
css = Path("public/styles.css")
app = Path("public/app.js")
backup = Path("public/index.html.bak-property-cleanup-20260430-203402")

for p in [index, css, app]:
    if p.exists():
        b = p.with_suffix(p.suffix + f".bak-before-undo-property-cleanup-{stamp}")
        b.write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
        print("Saved current backup:", b)

if not backup.exists():
    raise SystemExit("Missing backup: public/index.html.bak-property-cleanup-20260430-203402")

cur = index.read_text(encoding="utf-8")
old = backup.read_text(encoding="utf-8")

# Extract original parcel-actions-card from backup
m = re.search(
    r'\n\s*<div class="flow-card parcel-actions-card">[\s\S]*?\n\s*</div>\s*(?=\n\s*</section>)',
    old,
    flags=re.I
)
if not m:
    raise SystemExit("Could not find original parcel-actions-card in backup.")

original_block = m.group(0)

# Remove bad replacement property-unified-actions block
cur, n1 = re.subn(
    r'\n\s*<div[^>]*class="[^"]*property-unified-actions[^"]*"[^>]*>[\s\S]*?\n\s*</div>',
    "",
    cur,
    flags=re.I
)
print("Removed property-unified-actions blocks:", n1)

# If parcel-actions-card is missing, restore it after parcelInfo
if "parcel-actions-card" not in cur:
    cur, n2 = re.subn(
        r'(<div id="parcelInfo" class="parcel-found-card result hidden"></div>)',
        r'\1' + original_block,
        cur,
        count=1
    )
    print("Restored parcel-actions-card:", n2)
else:
    print("parcel-actions-card already exists; not duplicating.")

index.write_text(cur, encoding="utf-8")

# Remove CSS junk added by bad cleanup
if css.exists():
    s = css.read_text(encoding="utf-8")
    s = re.sub(
        r'\n/\* Property step cleanup: find \+ confirm property in one place \*/[\s\S]*?(?=\n/\*|\Z)',
        "\n",
        s,
        flags=re.I
    )
    s = re.sub(
        r'\n#propertyUnifiedActions\.hidden\s*\{[\s\S]*?\}\s*',
        "\n",
        s,
        flags=re.I
    )
    s = re.sub(
        r'\n\.property-unified-actions\.hidden\s*\{[\s\S]*?\}\s*',
        "\n",
        s,
        flags=re.I
    )
    css.write_text(s, encoding="utf-8")
    print("Cleaned CSS.")

# Remove JS junk added by bad cleanup
if app.exists():
    s = app.read_text(encoding="utf-8")
    s = re.sub(
        r'\n// Property step cleanup: unified buttons[\s\S]*?\n\}\)\(\);\s*',
        "\n",
        s,
        flags=re.I
    )
    s = re.sub(
        r'\n// Show property action buttons only when parcel info is visible[\s\S]*?\n\}\)\(\);\s*',
        "\n",
        s,
        flags=re.I
    )
    app.write_text(s, encoding="utf-8")
    print("Cleaned app.js.")

print("Undo patch complete.")
