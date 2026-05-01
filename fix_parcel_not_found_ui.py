from pathlib import Path
import re
from datetime import datetime

app = Path("public/app.js")
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

backup = app.with_suffix(f".js.bak-parcel-ui-fix-{stamp}")
backup.write_text(app.read_text(), encoding="utf-8")
print("Backup:", backup)

code = app.read_text()

# Inject logic: hide confirm UI when parcel not found
patch = """

// FIX: hide confirm UI when parcel not found
function handleParcelResult(result) {
  const gpsBar = document.getElementById('gpsConfirmBar');
  const parcelActions = document.querySelector('.parcel-actions-card');

  if (!result || result.ok === false || result.reason === 'not_found') {
    if (gpsBar) gpsBar.classList.add('hidden');
    if (parcelActions) parcelActions.classList.add('hidden');
    return;
  }

  if (gpsBar) gpsBar.classList.remove('hidden');
  if (parcelActions) parcelActions.classList.remove('hidden');
}
"""

# Add near top if not already present
if "handleParcelResult" not in code:
    code = patch + "\n" + code

app.write_text(code)
print("Patched parcel UI logic.")
