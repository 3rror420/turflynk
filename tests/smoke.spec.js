import { test, expect } from '@playwright/test';

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
    window.setActiveView?.('quote');
    window.showQuoteFlowStep?.('property', { scroll: false });
  });

  await page.locator('#useLocationBtn').click();
  await expect(page.locator('#quoteParcelScreen')).toBeVisible();
  await expect(page.locator('#parcelInfo')).toContainText('Parcel found');
  await page.locator('#continueToDrawBtn').click();
  await expect(page.locator('body')).toHaveAttribute('data-quote-flow-step', 'draw');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-quote-flow-step', 'property');
  await expect(page.locator('#quoteStartScreen')).toBeVisible();
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
  await expect(page.locator('#quoteParcelScreen')).toBeVisible();
  await expect(page.locator('#parcelInfo')).toContainText('Parcel found');
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
        standardMowScopeAck: true
      };
    `);
    await window.bookQuoteAsJob();
  });

  expect(checkoutRequests).toBe(1);
  await expect(page.locator('#quoteResult')).toContainText('Job booked');
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
    data: { ...baseJob, phone: firstPhone, customerPhone: firstPhone }
  });
  expect(created.ok()).toBeTruthy();

  const meAfterFirst = await request.get('http://127.0.0.1:3000/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect((await meAfterFirst.json()).user.phone).toBe(firstPhone);

  const secondPhone = '479-555-9999';
  const second = await request.post('http://127.0.0.1:3000/api/jobs', {
    headers: { Authorization: `Bearer ${token}` },
    data: { ...baseJob, phone: secondPhone, customerPhone: secondPhone }
  });
  expect(second.ok()).toBeTruthy();

  const meAfterSecond = await request.get('http://127.0.0.1:3000/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect((await meAfterSecond.json()).user.phone).toBe(firstPhone);
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
