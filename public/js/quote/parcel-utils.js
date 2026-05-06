// Parcel / address pure utilities — extracted from app.js (Phase 13b)
// Depends on globals: EPSG26915, EPSG4326 (config.js), proj4 (CDN)

function firstTextValue(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text && !/^n\/?a$/i.test(text)) return text;
  }
  return '';
}

function normalizeServiceAddressParts(parts = {}) {
  const clean = (value) => {
    const text = String(value || '').trim();
    return /^n\/?a$/i.test(text) ? '' : text;
  };
  const street = clean(parts.street || parts.address);
  const address = street;
  const city = clean(parts.city);
  const stateValue = clean(parts.state);
  const zip = clean(parts.zip);
  const full = clean(parts.full || parts.formattedAddress || parts.formatted_address);
  return {
    street,
    address,
    city,
    state: stateValue || 'AR',
    zip,
    full,
  };
}

function parseCityStateZipFromAddress(str = '') {
  const empty = { city: '', state: '', zip: '' };
  if (!str) return empty;

  const cleaned = String(str).replace(/\s+/g, ' ').trim();

  // Match: CITY, ST ZIP
  let match = cleaned.match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})/i);

  if (!match) {
    // Match: CITY ST ZIP (no commas)
    match = cleaned.match(/\b([A-Za-z\s]+)\s+([A-Z]{2})\s+(\d{5})$/);
  }

  if (match) {
    const result = {
      city: match[1].trim(),
      state: match[2].trim().toUpperCase(),
      zip: match[3].trim()
    };

    console.log('[PARSE TEST]', {
      input: str,
      result
    });

    return result;
  }

  console.warn('[Address Parse Failed]', str);
  console.log('[PARSE TEST]', {
    input: str,
    result: empty
  });

  return empty;
}

function hasServiceAddress(parts = {}) {
  return Boolean(String(parts.street || parts.address || parts.city || parts.zip || parts.full || '').trim());
}

function serviceAddressBlocksFallback(parts = {}) {
  return ['gps-location', 'manual-parcel-selection', 'parcel-no-address', 'quote-reset', 'address-reset']
    .includes(parts.source || '');
}

function propText(props = {}, ...keys) {
  if (!props || typeof props !== 'object') return '';
  for (const key of keys) {
    if (!key) continue;
    const direct = firstTextValue(props[key]);
    if (direct) return direct;
    const foundKey = Object.keys(props).find((candidate) => candidate.toLowerCase() === String(key).toLowerCase());
    const found = foundKey ? firstTextValue(props[foundKey]) : '';
    if (found) return found;
  }
  return '';
}

function propTextByNormalizedKeys(props = {}, keys = []) {
  if (!props || typeof props !== 'object') return '';
  const wanted = new Set(keys.map((key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '')));
  for (const [key, value] of Object.entries(props)) {
    const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (wanted.has(normalized)) {
      const text = firstTextValue(value);
      if (text) return text;
    }
  }
  return '';
}

function propTextByAddressIntent(props = {}, intent = '') {
  if (!props || typeof props !== 'object') return '';
  const nonServiceKey = /(owner|mail|mailing|billing|tax|payer|grantee|grantor)/i;
  const matchers = {
    city: (key) => (
      key.includes('city') ||
      key.includes('municipality') ||
      key === 'mun' ||
      key.startsWith('muni') ||
      key.startsWith('mun')
    ),
    state: (key) => key.includes('state') || key === 'st',
    zip: (key) => key.includes('zip') || key.includes('postal') || key.includes('postcode'),
  };
  const matches = matchers[intent];
  if (!matches) return '';

  for (const [key, value] of Object.entries(props)) {
    if (nonServiceKey.test(String(key))) continue;
    const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (matches(normalized)) {
      const text = firstTextValue(value);
      if (intent === 'city' && !/[A-Za-z]/.test(text)) continue;
      if (intent === 'state' && !/[A-Za-z]/.test(text)) continue;
      if (intent === 'zip' && !/\d{5}/.test(text)) continue;
      if (text) return text;
    }
  }
  return '';
}

function parcelAddressFieldCandidates(props = {}) {
  if (!props || typeof props !== 'object') return [];
  const addressKey = /(city|zip|postal|situs|site|physical|location|mun|municipality|mail|adr)/i;
  return Object.entries(props)
    .filter(([key, value]) => addressKey.test(String(key)) && firstTextValue(value))
    .map(([key, value]) => ({ key, value }));
}

function parcelFullAddressFromProps(props = {}) {
  return propText(
    props,
    'adrlabel',
    'adr_label',
    'situsaddress',
    'situs_address',
    'situsaddr',
    'situs_addr',
    'situsfulladdress',
    'situs_full_address',
    'siteaddress',
    'site_address',
    'siteaddr',
    'site_addr',
    'physicaladdress',
    'physical_address',
    'locationaddress',
    'location_address',
    'propertyaddress',
    'property_address',
    'fulladdress',
    'fullAddress',
    'full_address',
    'address'
  ).replace(/\s+/g, ' ').trim();
}

function parcelStructuredAddressFromProps(props = {}) {
  const city = firstTextValue(
    propTextByNormalizedKeys(props, [
      'adrcity', 'adr_city', 'situscity', 'situs_city', 'sitecity', 'site_city',
      'physicalcity', 'physical_city', 'locationcity', 'location_city',
      'propertycity', 'property_city', 'servicecity', 'service_city',
      'municipality', 'muni', 'munname', 'muniname', 'locality', 'city'
    ]),
    propTextByAddressIntent(props, 'city')
  );
  const stateValue = firstTextValue(
    propTextByNormalizedKeys(props, [
      'adrstate', 'adr_state', 'situsstate', 'situs_state', 'sitestate', 'site_state',
      'physicalstate', 'physical_state', 'locationstate', 'location_state',
      'propertystate', 'property_state', 'servicestate', 'service_state', 'state'
    ]),
    propTextByAddressIntent(props, 'state')
  );
  const zip = firstTextValue(
    propTextByNormalizedKeys(props, [
      'adrzip5', 'adrzip', 'adr_zip', 'adr_zip5', 'situszip', 'situs_zip',
      'situszip5', 'situs_zip5', 'sitezip', 'site_zip', 'sitezip5', 'site_zip5',
      'physicalzip', 'physical_zip', 'physicalzip5', 'physical_zip5', 'locationzip',
      'location_zip', 'propertyzip', 'property_zip', 'servicezip', 'service_zip',
      'zipcode', 'zip_code', 'postalcode', 'postal_code', 'postcode', 'zip'
    ]),
    propTextByAddressIntent(props, 'zip')
  );

  return normalizeServiceAddressParts({
    address: parcelFullAddressFromProps(props),
    city,
    state: stateValue,
    zip,
  });
}

function sameLeadingStreetNumber(left = '', right = '') {
  const leftNumber = String(left || '').trim().match(/^\d+/)?.[0] || '';
  const rightNumber = String(right || '').trim().match(/^\d+/)?.[0] || '';
  return Boolean(leftNumber && rightNumber && leftNumber === rightNumber);
}

function parseFullServiceAddress(str) {
  const raw = String(str || '').trim();
  if (!raw) return normalizeServiceAddressParts();

  const withCommas = raw.match(/^\s*(.+?),\s*([^,]+?),\s*([A-Za-z]{2})[,\s]+(\d{5}(?:-\d{4})?)\s*$/);
  if (withCommas) {
    return normalizeServiceAddressParts({
      address: withCommas[1],
      city: withCommas[2],
      state: withCommas[3],
      zip: withCommas[4],
    });
  }

  const parsed = parseCityStateZipFromAddress(raw);
  return normalizeServiceAddressParts({
    address: raw,
    city: parsed.city || '',
    state: parsed.state || '',
    zip: parsed.zip || '',
  });
}

function geometryLooksProjected(geometry) {
  const rings = geometry?.rings || geometry?.coordinates || [];
  const firstRing = rings.find((ring) => Array.isArray(ring) && ring.length);
  const firstPoint = firstRing?.find((pt) => Array.isArray(pt) && pt.length >= 2);
  if (!firstPoint) return false;
  const x = Number(firstPoint[0]);
  const y = Number(firstPoint[1]);
  return Math.abs(x) > 180 || Math.abs(y) > 90;
}

function ringToLngLatCoords(ring, geometry) {
  const projected = geometryLooksProjected(geometry);
  return ring.map(([xRaw, yRaw]) => {
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    if (projected) {
      const [lng, lat] = proj4(EPSG26915, EPSG4326, [x, y]);
      return [lng, lat];
    }

    return [x, y];
  }).filter(Boolean);
}

function closeRing(coords) {
  if (!coords.length) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return coords;
  return coords.concat([[first[0], first[1]]]);
}

function esriPolygonToGeoJSONFeature(geometry, properties = {}) {
  const rings = geometry?.rings || geometry?.coordinates || [];
  const coordinates = rings
    .map((ring) => closeRing(ringToLngLatCoords(ring, geometry)))
    .filter((ring) => ring.length >= 4);
  if (!coordinates.length) return null;
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Polygon', coordinates },
  };
}

function esriPolygonToLatLngPairs(geometry) {
  const feature = esriPolygonToGeoJSONFeature(geometry);
  return (feature?.geometry?.coordinates || []).map((ring) => ring.map(([lng, lat]) => [lat, lng]));
}

function addressPartsFromParcelProps(props = {}) {
  const fullAddress = parcelFullAddressFromProps(props);
  const parsed = parseFullServiceAddress(fullAddress);
  const structured = parcelStructuredAddressFromProps(props);
  return normalizeServiceAddressParts({
    address: structured.address || parsed.address || fullAddress,
    city: firstTextValue(structured.city, parsed.city),
    state: firstTextValue(structured.state, parsed.state, 'AR'),
    zip: firstTextValue(structured.zip, parsed.zip),
  });
}

function addressPartsFromQuote(quote = {}) {
  const fullAddress = firstTextValue(
    quote.parcelAddressLabel,
    quote.address,
    quote.serviceAddress,
    quote.customerAddress,
    quote.fullAddress,
    quote.full_address,
    quote.formattedAddress,
    quote.formatted_address
  );
  const parsed = parseFullServiceAddress(fullAddress);
  return normalizeServiceAddressParts({
    address: parsed.address || fullAddress,
    city: firstTextValue(quote.parcelCity, quote.city, quote.serviceCity, quote.customerCity, parsed.city),
    state: firstTextValue(quote.parcelState, quote.state, quote.serviceState, quote.customerState, parsed.state, 'AR'),
    zip: firstTextValue(quote.parcelZip, quote.zip, quote.serviceZip, quote.customerZip, quote.postalCode, quote.postal_code, parsed.zip),
  });
}

function mergeAddressResolution(target, candidate) {
  const parts = normalizeServiceAddressParts(candidate.parts || {});
  const beforeCity = target.parts.city;
  const beforeZip = target.parts.zip;
  if (!target.parts.address && parts.address) {
    target.parts.address = parts.address;
    target.addressSource = candidate.source;
  }
  if (!target.parts.city && parts.city) {
    target.parts.city = parts.city;
    target.citySource = candidate.source;
  }
  if ((!target.parts.state || target.parts.state === 'AR') && parts.state) {
    target.parts.state = parts.state;
    target.stateSource = candidate.source;
  }
  if (!target.parts.zip && parts.zip) {
    target.parts.zip = parts.zip;
    target.zipSource = candidate.source;
  }
  if ((target.parts.city && !beforeCity) || (target.parts.zip && !beforeZip)) {
    target.rawAddress = candidate.rawAddress || target.rawAddress;
    target.parsed = candidate.parsed || target.parsed;
    target.parcelProps = candidate.parcelProps || target.parcelProps;
  }
}

function parcelAddressFromNormalized(normalized = {}) {
  return addressPartsFromParcelProps({
    ...(normalized.attributes || {}),
    address: normalized.address || '',
    city: normalized.city || '',
    zip: normalized.zip || '',
  });
}

function parcelPropertiesFromLookupData(data = {}) {
  const normalized = data.normalized || {};
  const attrs = {
    ...(data.feature?.properties || {}),
    ...(data.feature?.attributes || {}),
    ...(normalized.attributes || {}),
  };
  const structured = parcelStructuredAddressFromProps(attrs);
  const derived = {
    parcelId: normalized.parcelId || propText(attrs, 'parcelid', 'parcel_id', 'PARCELID', 'PIN') || '',
    county: normalized.county || propText(attrs, 'countyid', 'county', 'COUNTY', 'COUNTY_NAME') || '',
    areaSqft: normalized.areaSqft || '',
    acres: normalized.acres || '',
    adrlabel: propText(attrs, 'adrlabel', 'situsaddress', 'siteaddress', 'propertyaddress', 'address') || normalized.address || '',
    adrcity: structured.city || normalized.city || '',
    adrstate: structured.state || normalized.state || 'AR',
    adrzip5: structured.zip || normalized.zip || '',
  };
  return Object.fromEntries(
    Object.entries({ ...attrs, ...derived }).filter(([, value]) => value !== undefined && value !== null)
  );
}

window.esriPolygonToGeoJSONFeature = esriPolygonToGeoJSONFeature;
window.esriPolygonToLatLngPairs = esriPolygonToLatLngPairs;
