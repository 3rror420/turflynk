import { test, expect } from '@playwright/test';

async function expectParcelConfirmationUi(page) {
  const panel = page.locator('#parcel-confirm-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Confirm your property');
  await expect(panel.locator('#parcelInfo')).toContainText('Parcel found');
  await expect(panel.getByRole('button', { name: 'Yes, use this property' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Search again' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Select Different Parcel' })).toBeVisible();
}

test('homepage loads', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');
  await expect(page).toHaveTitle(/MowNWA|TurfLynk/i);
});

test('health endpoint works', async ({ request }) => {
  const res = await request.get('http://127.0.0.1:3000/health');
  expect(res.ok()).toBeTruthy();

  const body = await res.json();
  expect(body.ok).toBe(true);
});

test('config endpoint works', async ({ request }) => {
  const res = await request.get('http://127.0.0.1:3000/api/config');
  expect(res.ok()).toBeTruthy();

  const body = await res.json();
  expect(body.siteBrand || body.appName).toBeTruthy();
});

test('ai mowable endpoint returns empty fallback when detection is unavailable', async ({ request }) => {
  const parcelGeoJson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-94.21, 36.37],
          [-94.20, 36.37],
          [-94.20, 36.38],
          [-94.21, 36.38],
          [-94.21, 36.37]
        ]]
      }
    }]
  };

  const res = await request.post('http://127.0.0.1:3000/api/ai/detect-mowable', {
    data: { parcelGeoJson, source: 'maplibre' }
  });
  expect(res.ok()).toBeTruthy();

  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.featureCollection?.type).toBe('FeatureCollection');
  expect(body.featureCollection?.features || []).toHaveLength(0);
  expect(body.features || []).toHaveLength(0);
  expect(Number(body.mowableAreaSqft || 0)).toBe(0);
  expect(body.message).toContain('Use Lasso Yard');
});

test('logout endpoint clears session', async ({ request }) => {
  const res = await request.post('http://127.0.0.1:3000/api/auth/logout', { data: {} });
  expect(res.ok()).toBeTruthy();

  const body = await res.json();
  expect(body.ok).toBe(true);
});

test('sign out button is hidden when logged out', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');
  await expect(page.locator('#logoutBtn')).toBeHidden();
});

test('logged-out homepage shows global menu and login access on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:3000/');

  await expect(page.locator('#openAppDrawer')).toBeVisible();
  await expect(page.locator('#mobileAuthBtn')).toBeVisible();
  await expect(page.locator('#mobileAuthBtn')).toContainText('Login');
  await expect(page.locator('#mobileAccountAvatar')).toBeHidden();
});

test('account avatar uses initials fallback', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => {
    window.updateSessionStatus?.({ id: 'user-1', email: 'jane@example.com', fullName: 'Jane Doe', role: 'customer' });
  });

  await expect(page.locator('body')).toHaveAttribute('data-session-state', 'logged-in');
  await expect(page.locator('#mobileAccountAvatar [data-avatar-initials]')).toHaveText('JD');
  await expect(page.locator('#mobileAccountAvatar')).toBeVisible();
  await expect(page.locator('#mobileAuthLabel')).toBeHidden();
  await expect(page.locator('#openAuth')).toBeHidden();
});

test('logged-in drawer shows account links and sign out', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => {
    window.updateSessionStatus?.({ id: 'user-1', email: 'jane@example.com', fullName: 'Jane Doe', role: 'customer' });
  });

  await page.locator('#openAppDrawer').click();
  await expect(page.locator('#appDrawer')).toBeVisible();
  await expect(page.locator('#drawerAccountName')).toHaveText('Jane Doe');
  await expect(page.locator('#appDrawer').getByRole('button', { name: /Account Settings/i })).toBeVisible();
  await expect(page.locator('#appDrawer').getByRole('button', { name: /Recent Jobs/i }).first()).toBeVisible();
  await expect(page.locator('#drawerLogoutBtn')).toBeVisible();
  await expect(page.locator('#drawerLogoutBtn')).toContainText(/Sign Out/i);
});

test('provider area is hidden when logged out', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.locator('#openAppDrawer').click();

  await expect(page.locator('#appDrawer').getByRole('button', { name: /Provider Dashboard/i })).toBeHidden();
});

test('provider area renders for simulated provider session', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => {
    window.updateSessionStatus?.({ id: 'provider-1', email: 'pro@example.com', fullName: 'Provider User', role: 'provider' });
  });

  await page.locator('#openAppDrawer').click();
  await expect(page.locator('#appDrawer').getByRole('button', { name: /Provider Dashboard/i })).toBeVisible();
});

test('provider job card status controls render without crashing', async ({ page }) => {
  await page.route('**/api/provider/overview', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        ok: true,
        metrics: {},
        recentJobs: []
      }
    });
  });
  await page.route('**/api/provider/jobs?filter=active', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        ok: true,
        jobs: [{
          id: 'job-1',
          title: 'Mowing job',
          customerName: 'Jane D.',
          customerPhone: '555-555-1212',
          address: '123 Test St',
          city: 'Bentonville',
          state: 'AR',
          zip: '72712',
          serviceType: 'mowing',
          preferredDate: '2026-05-01',
          status: 'assigned',
          budget: 55,
          details: 'Gate unlocked',
          createdAt: '2026-04-29T00:00:00Z'
        }]
      }
    });
  });
  await page.goto('http://127.0.0.1:3000/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    localStorage.setItem('turflynk.authToken', 'test-provider-token');
    window.updateSessionStatus?.({ id: 'provider-1', email: 'pro@example.com', fullName: 'Provider User', role: 'provider' });
    window.setActiveView?.('providers');
    await window.renderProviderJobs?.('active');
  });

  await expect(page.locator('#providerWorkspaceContent')).toContainText('Mowing job');
  await expect(page.locator('#providerWorkspaceContent').getByRole('button', { name: /Mark scheduled/i })).toBeVisible();
});

test('mobile homepage keeps hamburger menu visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('http://127.0.0.1:3000/');

  await expect(page.locator('#openAppDrawer')).toBeVisible();
  await page.locator('#openAppDrawer').click();
  await expect(page.locator('#appDrawer')).toBeVisible();
});

test('mobile property step shows current location button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('http://127.0.0.1:3000/');

  await page.evaluate(() => {
    window.setActiveView?.('quote');
    window.showQuoteFlowStep?.('property', { scroll: false });
  });

  await expect(page.locator('#quoteStartScreen')).toBeVisible();
  await expect(page.locator('#useLocationBtn')).toBeVisible();
});

test('property step confirms parcel and returns from lawn area', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 36.3729, longitude: -94.2088 });
  await page.route('https://maps.googleapis.com/maps/api/js?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.google = { maps: {} };'
    });
  });
  await page.route('https://nominatim.openstreetmap.org/reverse?**', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        display_name: '123 TEST ST, BENTONVILLE, AR 72712',
        address: {
          house_number: '123',
          road: 'TEST ST',
          city: 'Bentonville',
          state: 'Arkansas',
          state_code: 'AR',
          postcode: '72712'
        }
      }
    });
  });
  await page.route('**/api/parcel/lookup?**', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        ok: true,
        method: 'test',
        normalized: {
          parcelId: 'parcel-test-1',
          county: 'Benton',
          areaSqft: 10890,
          attributes: {
            adrlabel: '123 TEST ST, BENTONVILLE, AR 72712',
            countyid: 'Benton',
            parcelid: 'parcel-test-1'
          }
        },
        feature: {
          geometry: {
            rings: [[
              [-94.2092, 36.3726],
              [-94.2084, 36.3726],
              [-94.2084, 36.3732],
              [-94.2092, 36.3732],
              [-94.2092, 36.3726]
            ]]
          }
        }
      }
    });
  });

  await page.goto('http://127.0.0.1:3000/');
  await page.evaluate(() => {
    if (window.google?.maps) window.google.maps.Geocoder = undefined;
    window.setActiveView?.('quote');
    window.showQuoteFlowStep?.('property', { scroll: false });
  });

  await page.locator('#useLocationBtn').click();
  await expectParcelConfirmationUi(page);
  await page.locator('#continueToDrawBtn').click();
  await expect(page.locator('body')).toHaveAttribute('data-quote-flow-step', 'draw');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-quote-flow-step', 'property');
  await expect(page.locator('#quoteStartScreen')).toBeVisible();
});

test('ai detect button handles parcel-sized rejection without overwriting mowable area', async ({ page }) => {
  const parcelFeature = {
    type: 'Feature',
    properties: { adrlabel: '123 TEST ST, BENTONVILLE, AR 72712' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-94.2092, 36.3726],
        [-94.2084, 36.3726],
        [-94.2084, 36.3732],
        [-94.2092, 36.3732],
        [-94.2092, 36.3726]
      ]]
    }
  };
  const existingMowableFeature = {
    type: 'Feature',
    properties: { id: 'manual-yard', role: 'mowable' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-94.2090, 36.37275],
        [-94.2087, 36.37275],
        [-94.2087, 36.3730],
        [-94.2090, 36.3730],
        [-94.2090, 36.37275]
      ]]
    }
  };

  await page.route('**/api/ai/detect-mowable', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        ok: false,
        reason: 'detected geometry matched the full parcel',
        source: 'vision',
        featureCollection: { type: 'FeatureCollection', features: [] },
        features: [],
        mowableAreaSqft: 0,
        diagnostics: {
          reason: 'detected geometry matched the full parcel',
          guardrailReason: 'detected geometry matched the full parcel',
          featuresReturned: 1,
          detectedAreaSqft: 24000,
          parcelAreaSqft: 24000
        }
      }
    });
  });
  await page.route('**/api/estimate', async (route) => {
    await route.fulfill({ status: 200, json: { ok: true, estimate: 42 } });
  });

  await page.goto('http://127.0.0.1:3000/');
  await page.evaluate(({ feature, existing }) => {
    window.eval(`
      state.map = {
        getCenter: () => ({ lng: -94.2088, lat: 36.3729 }),
        getZoom: () => 18,
        getSource: () => ({ setData() {} }),
        isStyleLoaded: () => false,
        resize() {}
      };
      state.parcelFeature = ${JSON.stringify(feature)};
      state.parcelLayer = state.parcelFeature;
      state.parcelGeometry = { rings: ${JSON.stringify(feature.geometry.coordinates)} };
      state.selectedParcel = state.parcelFeature;
      state.selectedParcelGeoJson = state.parcelFeature;
      state.selectedParcelGeoJSON = state.parcelFeature;
      state.parcelGeoJson = state.parcelFeature;
      state.parcelGeoJSON = state.parcelFeature;
      state.currentParcelGeoJson = state.parcelFeature;
      state.currentParcelGeoJSONData = state.parcelFeature;
      state.currentParcel = state.parcelFeature;
      state.confirmedParcel = state.parcelFeature;
      state.parcelProperties = state.parcelFeature.properties || {};
      state.selectedParcelProperties = state.parcelFeature.properties || {};
      state.currentParcelProperties = state.parcelFeature.properties || {};
      state.confirmedParcelProperties = state.parcelFeature.properties || {};
      window.selectedParcelGeoJson = state.parcelFeature;
      window.selectedParcelGeoJSON = state.parcelFeature;
      window.parcelGeoJson = state.parcelFeature;
      window.parcelGeoJSON = state.parcelFeature;
      window.currentParcelGeoJson = state.parcelFeature;
      window.currentParcelGeoJSONData = state.parcelFeature;
      window.currentParcel = state.parcelFeature;
      window.confirmedParcel = state.parcelFeature;
      window.currentParcelGeometry = state.parcelFeature.geometry;
      window.parcelGeometry = state.parcelFeature.geometry;
      state.quoteFlowStep = 'draw';
      state.quoteUiMode = 'idle';
      state.currentServiceAddress = {
        address: '123 Test St',
        city: 'Bentonville',
        state: 'AR',
        zip: '72712'
      };
      window.setActiveView?.('quote');
      window.showQuoteFlowStep?.('draw', { scroll: false });
      window.setTurfLynkMowableFeatures?.(${JSON.stringify(existing)});
      updateQuoteFlowState();
      setMapToolPanelOpen(true);
    `);
  }, { feature: parcelFeature, existing: [existingMowableFeature] });

  await expect(page.locator('#aiDetectMowableBtn')).toBeVisible();
  await expect(page.locator('#aiDetectMowableBtn')).toBeEnabled();
  await page.locator('#aiDetectMowableBtn').click();
  await expect(page.locator('#parcelInfo')).toContainText('AI Detect: no result');
  await expect(page.locator('#parcelInfo')).toContainText('Use Lasso Yard');
  await expect(page.locator('#parcelInfo')).toContainText('detected geometry matched the full parcel');
  await expect(page.locator('#aiDetectMowableBtn')).toHaveText('Use Lasso Yard');

  const mowableIds = await page.evaluate(() => (state.mowableFeatureCollection?.features || []).map((feature) => feature.properties?.id));
  expect(mowableIds).toEqual(['manual-yard']);
});

test('address search shows parcel confirmation on property step', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route('https://nominatim.openstreetmap.org/search?**', async (route) => {
    await route.fulfill({
      status: 200,
      json: [{ lat: '36.3729', lon: '-94.2088' }]
    });
  });
  await page.route('**/api/parcel/lookup?**', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        ok: true,
        method: 'test',
        normalized: {
          parcelId: 'parcel-test-2',
          county: 'Benton',
          areaSqft: 12000,
          attributes: {
            adrlabel: '456 TEST AVE, BENTONVILLE, AR 72712',
            countyid: 'Benton',
            parcelid: 'parcel-test-2'
          }
        },
        feature: {
          geometry: {
            rings: [[
              [-94.2092, 36.3726],
              [-94.2084, 36.3726],
              [-94.2084, 36.3732],
              [-94.2092, 36.3732],
              [-94.2092, 36.3726]
            ]]
          }
        }
      }
    });
  });

  await page.goto('http://127.0.0.1:3000/');
  await page.evaluate(() => {
    window.setActiveView?.('quote');
    window.showQuoteFlowStep?.('property', { scroll: false });
  });
  await page.locator('#quoteForm input[name="address"]').fill('456 Test Ave');
  await page.locator('#quoteForm input[name="city"]').fill('Bentonville');
  await page.locator('#quoteForm input[name="zip"]').fill('72712');
  await page.locator('#locateAddressBtn').click();

  await expect(page.locator('body')).toHaveAttribute('data-quote-flow-step', 'property');
  await expectParcelConfirmationUi(page);
});

test('out-of-state address is rejected before parcel lookup', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route('https://nominatim.openstreetmap.org/search?**', async (route) => {
    await route.fulfill({
      status: 200,
      json: [{
        lat: '32.7767',
        lon: '-96.7970',
        address: {
          state: 'Texas',
          state_code: 'TX'
        }
      }]
    });
  });
  let parcelLookupRequests = 0;
  await page.route('**/api/parcel/lookup?**', async (route) => {
    parcelLookupRequests += 1;
    await route.fulfill({ status: 500, json: { ok: false } });
  });

  await page.goto('http://127.0.0.1:3000/');
  await page.evaluate(() => {
    window.setActiveView?.('quote');
    window.showQuoteFlowStep?.('property', { scroll: false });
  });
  await page.locator('#quoteForm input[name="address"]').fill('100 Main St');
  await page.locator('#quoteForm input[name="city"]').fill('Dallas');
  await page.locator('#quoteForm input[name="zip"]').fill('75201');
  await page.locator('#locateAddressBtn').click();

  await expect(page.locator('body')).toHaveAttribute('data-quote-flow-step', 'property');
  await expect(page.locator('#parcelInfo')).toContainText('MowNWA currently supports Arkansas properties only.');
  expect(parcelLookupRequests).toBe(0);
});

test('toasts are capped and stay off bottom nav', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');

  await page.evaluate(() => {
    window.showToast?.('One');
    window.showToast?.('Two');
    window.showToast?.('Three');
  });

  await expect(page.locator('#toastLayer .toast')).toHaveCount(2);
  const box = await page.locator('#toastLayer').boundingBox();
  expect(box?.y ?? 9999).toBeLessThan(130);
});

test('quote flow only shows active step', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');

  await page.evaluate(() => {
    window.setActiveView?.('quote');
    window.showQuoteFlowStep?.('property', { scroll: false });
  });

  await expect(page.locator('#quoteStartScreen')).toBeVisible();
  await expect(page.locator('#quoteEstimateScreen')).toBeHidden();
  await expect(page.locator('#quoteStepper')).toContainText('Property');
  await expect(page.locator('#quoteStepper')).toContainText('Lawn Area');
  await expect(page.locator('#quoteStepper')).not.toContainText('Parcel');

  await page.evaluate(() => {
    window.showQuoteFlowStep?.('parcel', { scroll: false });
  });

  await expect(page.locator('body')).toHaveAttribute('data-quote-flow-step', 'property');
  await expect(page.locator('#quoteStartScreen')).toBeVisible();

  await page.evaluate(() => {
    window.showQuoteFlowStep?.('estimate', { scroll: false });
  });

  await expect(page.locator('#quoteStartScreen')).toBeHidden();
  await expect(page.locator('#quoteEstimateScreen')).toBeVisible();
});

test('mobile bottom nav hides on draw step', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('http://127.0.0.1:3000/');

  await page.evaluate(() => {
    window.setActiveView?.('quote');
    window.showQuoteFlowStep?.('draw', { scroll: false });
  });

  await expect(page.locator('.mobile-bottom-nav')).toBeHidden();
});

test('checkout auth buttons show Facebook and email while Google is hidden', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');

  await page.evaluate(() => {
    window.setActiveView?.('quote');
    window.showQuoteFlowStep?.('property', { scroll: false });
  });

  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Continue with Facebook' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Continue with Email' })).toBeHidden();

  await page.evaluate(() => {
    window.showLeadRequestPanel?.({
      estimate: 42,
      mowAreaSqft: 5000,
      lotAreaSqft: 7000,
      serviceType: 'mowing',
      regionId: 'nwa',
      address: '123 Test St',
      city: 'Fayetteville',
      state: 'AR',
      zip: '72701'
    });
  });

  await expect(page.locator('#leadRequestPanel').getByRole('button', { name: 'Continue with Google' })).toBeHidden();
  await expect(page.locator('#leadRequestPanel').getByRole('button', { name: 'Continue with Facebook' })).toBeVisible();
  await expect(page.locator('#leadRequestPanel').getByRole('button', { name: 'Continue with Email' })).toBeVisible();
});

test('mobile account Facebook login uses same-tab redirect with source and current step', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route('**/api/auth/facebook?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>facebook auth</body></html>' });
  });

  await page.goto('http://127.0.0.1:3000/');
  await page.waitForFunction(() => typeof window.showQuoteFlowStep === 'function');
  await page.evaluate(() => {
    window.setActiveView?.('quote');
    window.showQuoteFlowStep?.('property', { scroll: false });
  });

  await page.locator('#mobileAuthBtn').click();
  const facebookLink = page.locator('#authPanel .facebook-login-link');
  await expect(facebookLink).toBeVisible();
  await expect(facebookLink).toHaveCSS('pointer-events', 'auto');
  await facebookLink.click();

  await expect(page).toHaveURL(/\/api\/auth\/facebook\?source=account&step=property$/);
});

test('mobile checkout Facebook login saves auth context and redirects same-tab', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route('**/api/auth/facebook?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>facebook auth</body></html>' });
  });

  await page.goto('http://127.0.0.1:3000/');
  await page.waitForFunction(() => typeof window.showLeadRequestPanel === 'function');
  await page.evaluate(() => {
    window.setActiveView?.('quote');
    window.showLeadRequestPanel?.({
      estimate: 42,
      mowAreaSqft: 5000,
      lotAreaSqft: 7000,
      serviceType: 'mowing',
      regionId: 'nwa',
      address: '123 Test St',
      city: 'Fayetteville',
      state: 'AR',
      zip: '72701'
    });
  });

  const facebookButton = page.locator('#leadRequestPanel').getByRole('button', { name: 'Continue with Facebook' });
  await expect(facebookButton).toBeVisible();
  await expect(facebookButton).toHaveCSS('pointer-events', 'auto');
  await facebookButton.click();

  await expect(page).toHaveURL(/\/api\/auth\/facebook\?source=checkout&step=request$/);
  const savedContext = await page.evaluate(() => JSON.parse(localStorage.getItem('turflynk.authReturn.v1') || 'null'));
  expect(savedContext?.source).toBe('checkout');
  expect(savedContext?.step).toBe('request');
  expect(savedContext?.quote?.serviceType).toBe('mowing');
});

test('desktop Facebook login starts auth without removing desktop support', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/api/auth/facebook?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>facebook auth</body></html>' });
  });

  await page.goto('http://127.0.0.1:3000/');
  await page.locator('#openAuth').click();
  await expect(page.locator('#authPanel .facebook-login-link')).toBeVisible();
  await page.locator('#authPanel .facebook-login-link').click();

  await expect(page).toHaveURL(/\/api\/auth\/facebook\?source=account&step=property$/);
});

test('auth return restores saved quote request state and clears context', async ({ page }) => {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        ok: true,
        user: { id: 'fb-user-1', email: 'jane@example.com', fullName: 'Jane Doe', role: 'customer' }
      }
    });
  });

  const savedContext = {
    step: 'request',
    source: 'checkout',
    quote: {
      estimate: 42,
      mowAreaSqft: 5000,
      lotAreaSqft: 7000,
      serviceType: 'mowing',
      regionId: 'nwa',
      address: '123 Test St',
      city: 'Fayetteville',
      state: 'AR',
      zip: '72701'
    },
    quoteFormData: {
      address: '123 Test St',
      city: 'Fayetteville',
      state: 'AR',
      zip: '72701',
      serviceType: 'mowing',
      regionId: 'nwa'
    },
    customerFields: {
      customerName: 'Jane Doe',
      customerPhone: '479-555-1212',
      customerEmail: 'jane@example.com',
      notes: 'Gate code 1234',
      preferredDate: '2026-05-05',
      schedule_preference: 'next_week',
      available_days_json: ['monday']
    },
    drawnGeoJSON: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { role: 'mowable' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-94.21, 36.37],
            [-94.20, 36.37],
            [-94.20, 36.38],
            [-94.21, 36.38],
            [-94.21, 36.37]
          ]]
        }
      }]
    },
    parcelGeoJSON: {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-94.211, 36.369],
          [-94.199, 36.369],
          [-94.199, 36.381],
          [-94.211, 36.381],
          [-94.211, 36.369]
        ]]
      }
    },
    savedAt: Date.now()
  };

  await page.addInitScript((context) => {
    localStorage.setItem('turflynk.authReturn.v1', JSON.stringify(context));
  }, savedContext);

  await page.goto('http://127.0.0.1:3000/?auth=success&view=quote&step=request');

  await expect(page.locator('#leadRequestPanel')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-quote-flow-step', 'request');
  await expect(page.locator('#leadRequestForm input[name="customerName"]')).toHaveValue('Jane Doe');
  await expect(page.locator('#leadRequestForm input[name="customerPhone"]')).toHaveValue('479-555-1212');
  await expect(page.locator('#leadRequestForm textarea[name="notes"]')).toHaveValue('Gate code 1234');
  await expect(page.locator('#quoteStartScreen')).toBeHidden();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('turflynk.authReturn.v1'))).toBeNull();
});

test('Facebook auth callback URL follows the active production host', async ({ request }) => {
  for (const host of ['nwamow.com', 'mownwa.com', 'turflynk.com']) {
    const res = await request.get('http://127.0.0.1:3000/api/auth/facebook?source=checkout&step=request', {
      headers: {
        Host: host,
        'X-Forwarded-Proto': 'https'
      },
      maxRedirects: 0
    });
    expect(res.headers()['x-facebook-callback-url']).toBe(`https://${host}/api/auth/facebook/callback`);
  }
});

test('booking/payment without phone is blocked before checkout', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');
  let checkoutRequests = 0;
  await page.route('**/api/checkout/instant-mow', async (route) => {
    checkoutRequests += 1;
    await route.fulfill({ status: 500, json: { ok: false } });
  });

  await page.evaluate(async () => {
    window.eval(`
      state.lastQuote = {
        estimate: 48,
        mowAreaSqft: 5200,
        lotAreaSqft: 7200,
        serviceType: 'mowing',
        regionId: 'nwa',
        name: 'Jane Doe',
        phone: '',
        email: 'jane@example.com',
        address: '123 Test St',
        city: 'Fayetteville',
        state: 'AR',
        zip: '72701',
        smsConsent: true,
        sms_consent: true,
        standardMowScopeAck: true
      };
    `);
    await window.bookQuoteAsJob();
  });

  await expect(page.locator('#leadRequestResult')).toContainText('Phone needed');
  expect(checkoutRequests).toBe(0);
});

test('booking/payment with phone opens checkout flow', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');
  let checkoutRequests = 0;
  await page.route('**/api/checkout/instant-mow', async (route) => {
    checkoutRequests += 1;
    await route.fulfill({
      status: 200,
      json: {
        ok: true,
        paymentStatus: 'checkout_pending',
        checkoutUrl: null,
        job: {
          id: 'job-phone-ok',
          title: 'Mowing - 123 Test St',
          address: '123 Test St',
          city: 'Fayetteville',
          state: 'AR',
          zip: '72701',
          budget: 48,
          status: 'open',
          serviceType: 'mowing'
        }
      }
    });
  });

  await page.evaluate(async () => {
    window.eval(`
      state.currentUser = null;
      state.lastQuote = {
        estimate: 48,
        mowAreaSqft: 5200,
        lotAreaSqft: 7200,
        serviceType: 'mowing',
        regionId: 'nwa',
        name: 'Jane Doe',
        phone: '479-555-1212',
        email: 'jane@example.com',
        address: '123 Test St',
        city: 'Fayetteville',
        state: 'AR',
        zip: '72701',
        smsConsent: true,
        sms_consent: true,
        standardMowScopeAck: true
      };
    `);
    await window.bookQuoteAsJob();
  });

  expect(checkoutRequests).toBe(1);
});

test('profile phone saves only if missing', async ({ request }) => {
  const email = `phone-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = 'test-password-123';
  const register = await request.post('http://127.0.0.1:3000/api/auth/register', {
    data: { email, password, fullName: 'Phone Test', role: 'customer' }
  });
  expect(register.ok()).toBeTruthy();

  const login = await request.post('http://127.0.0.1:3000/api/auth/login', {
    data: { email, password }
  });
  expect(login.ok()).toBeTruthy();
  const { token } = await login.json();

  const baseJob = {
    title: 'Phone test job',
    name: 'Phone Test',
    email,
    address: '123 Test St',
    city: 'Fayetteville',
    state: 'AR',
    zip: '72701',
    regionId: 'nwa',
    budget: 48,
    serviceType: 'mowing'
  };

  const missingPhone = await request.post('http://127.0.0.1:3000/api/jobs', {
    headers: { Authorization: `Bearer ${token}` },
    data: baseJob
  });
  expect(missingPhone.status()).toBe(400);

  const firstPhone = '479-555-1212';
  const created = await request.post('http://127.0.0.1:3000/api/jobs', {
    headers: { Authorization: `Bearer ${token}` },
    data: { ...baseJob, phone: firstPhone, customerPhone: firstPhone, smsConsent: true }
  });
  expect(created.ok()).toBeTruthy();

  const meAfterFirst = await request.get('http://127.0.0.1:3000/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect((await meAfterFirst.json()).user.phone).toBe('+14795551212');

  const secondPhone = '479-555-9999';
  const second = await request.post('http://127.0.0.1:3000/api/jobs', {
    headers: { Authorization: `Bearer ${token}` },
    data: { ...baseJob, phone: secondPhone, customerPhone: secondPhone, smsConsent: true }
  });
  expect(second.ok()).toBeTruthy();

  const meAfterSecond = await request.get('http://127.0.0.1:3000/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect((await meAfterSecond.json()).user.phone).toBe('+14795551212');
});

test('parcel hydrate parses adrlabel when ESRI city and zip are blank', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');

  const resolved = await page.evaluate(() => {
    const parcelProperties = {
      adrlabel: '11511 INDIAN HLS BLVD, BENTONVILLE, AR 72712',
      adrcity: '',
      adrstate: '',
      adrzip5: '',
    };

    return window.resolveCheckoutAddressSource?.({
      parcelAddressLabel: '',
      parcelCity: '',
      parcelState: '',
      parcelZip: '',
      parcelProperties,
    });
  });

  expect(resolved?.source).toBe('quote.parcelFields');
  expect(resolved?.parts.city).toBe('BENTONVILLE');
  expect(resolved?.parts.state).toBe('AR');
  expect(resolved?.parts.zip).toBe('72712');
});

test('parcel hydrate uses structured fields when adrlabel is street only', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');

  const resolved = await page.evaluate(() => {
    const parcelProperties = {
      adrlabel: '11511  INDIAN HLS BLVD',
      situscity: 'Rogers',
      situsstate: 'AR',
      situszip: '72756',
    };

    return window.resolveCheckoutAddressSource?.({
      parcelAddressLabel: '',
      parcelCity: '',
      parcelState: '',
      parcelZip: '',
      parcelProperties,
    });
  });

  expect(resolved?.parts.address).toBe('11511 INDIAN HLS BLVD');
  expect(resolved?.parts.city).toBe('Rogers');
  expect(resolved?.parts.state).toBe('AR');
  expect(resolved?.parts.zip).toBe('72756');
});
