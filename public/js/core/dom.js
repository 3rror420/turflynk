// Service/config label helpers and select population utilities.
// Extracted from app.js — Phase 13d modular refactor. Loads before app.js.
//
// Pre-load globals required (satisfied by earlier script tags):
//   state      → public/js/state.js
//   (state.regions, state.services read at call time)

function normalizeRegion(region) {
  return {
    ...region,
    id: region.id,
    label: region.label || region.name || region.id || 'Region',
    name: region.name || region.label || region.id || 'Region',
    enabled: region.enabled ?? region.active ?? true,
    featuredCities: Array.isArray(region.featuredCities) ? region.featuredCities : [],
    counties: Array.isArray(region.counties) ? region.counties : [],
    metro: region.metro || '',
    marketMultiplier: Number(region.marketMultiplier ?? 1),
    travelFee: Number(region.travelFee ?? 0),
    minimumJob: Number(region.minimumJob ?? 0),
  };
}

function normalizeService(service) {
  return {
    ...service,
    id: service.id,
    label: service.label || service.name || service.id || 'Service',
    name: service.name || service.label || service.id || 'Service',
    baseFee: Number(service.baseFee ?? 0),
    ratePer1000Sqft: Number(service.ratePer1000Sqft ?? 0),
    minimumPrice: Number(service.minimumPrice ?? 0),
  };
}

function regionLabel(regionId) {
  return state.regions.find((item) => item.id === regionId)?.label || regionId || 'Unassigned';
}

function serviceLabel(serviceId) {
  return state.services.find((item) => item.id === serviceId)?.label || serviceId || 'Service';
}

function fillSelect(select, items, includeBlank = false) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '';

  if (includeBlank) {
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select...';
    select.append(blank);
  }

  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label || item.name || item.id;
    select.append(option);
  });

  if (previous && Array.from(select.options).some((option) => option.value === previous)) {
    select.value = previous;
  }

  if (!select.value && select.options.length) {
    select.selectedIndex = 0;
  }
}
