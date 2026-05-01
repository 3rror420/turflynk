from pathlib import Path
import re
from datetime import datetime

app = Path("public/app.js")
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

backup = app.with_suffix(f".js.bak-autocomplete-fix-{stamp}")
backup.write_text(app.read_text(), encoding="utf-8")
print("Backup:", backup)

code = app.read_text()

# 1. Prevent immediate estimate refresh after autocomplete
code = re.sub(
    r'scheduleEstimateRefresh\([^\)]*\);',
    '// scheduleEstimateRefresh disabled during autocomplete (patched)',
    code
)

# 2. Prevent setCurrentServiceAddress from overriding place data
code = re.sub(
    r'setCurrentServiceAddress\([^\)]*\);',
    '// setCurrentServiceAddress disabled during autocomplete (patched)',
    code
)

# 3. Inject clean reset inside place_changed
code = re.sub(
    r'autocomplete\.addListener\([\'"]place_changed[\'"],\s*\(\)\s*=>\s*\{',
    '''autocomplete.addListener('place_changed', () => {

    // CLEAN RESET: prevent stale data from overriding autocomplete
    window.currentParcel = null;
    window.currentAddress = null;

    const gpsBar = document.getElementById('gpsConfirmBar');
    if (gpsBar) gpsBar.classList.add('hidden');

    const parcelInfo = document.getElementById('parcelInfo');
    if (parcelInfo) parcelInfo.innerHTML = '';
''',
    code
)

app.write_text(code)
print("Patched autocomplete logic.")
