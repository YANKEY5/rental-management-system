const { spawn } = require('child_process');
const path = require('path');

// Port definition
const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

console.log('Starting Rental Management System integration tests...');

// 1. Spawn server.js as a subprocess
const serverProcess = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  stdio: 'inherit',
  env: { ...process.env, PORT: PORT, NODE_ENV: 'test' }
});

serverProcess.on('error', (err) => {
  console.error('Failed to start server subprocess:', err);
});

serverProcess.on('exit', (code, signal) => {
  console.log(`Server subprocess exited with code ${code}, signal ${signal}`);
});

// Helper to wait
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTests() {
  // Wait 3 seconds for server boot and database seed
  console.log('Waiting for server to initialize and seed database...');
  await sleep(3000);

  let passed = true;
  let authToken = '';

  try {
    // Test Case 1: Failed Login (Bad credentials)
    console.log('\n[TEST 1] Testing login with invalid credentials...');
    const loginFailRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrongpassword' })
    });
    
    if (loginFailRes.status === 401) {
      console.log('✔ Test 1 Passed: Correctly returned 401 Unauthorized for bad credentials.');
    } else {
      console.log(`❌ Test 1 Failed: Expected status 401, got ${loginFailRes.status}`);
      passed = false;
    }

    // Test Case 2: Successful Login (Super Admin)
    console.log('\n[TEST 2] Testing login with valid Super Admin credentials...');
    const loginOkRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });

    if (loginOkRes.status === 200) {
      const data = await loginOkRes.json();
      if (data.token && data.user.role === 'Super Admin') {
        authToken = data.token;
        console.log('✔ Test 2 Passed: JWT Token successfully generated for Super Admin.');
      } else {
        console.log('❌ Test 2 Failed: Token missing or role mismatch in login response.');
        passed = false;
      }
    } else {
      console.log(`❌ Test 2 Failed: Expected status 200, got ${loginOkRes.status}`);
      passed = false;
    }

    if (!authToken) {
      throw new Error('Aborting remaining tests: Auth token could not be retrieved.');
    }

    // Test Case 3: Dashboard Stats Endpoint
    console.log('\n[TEST 3] Testing Dashboard stats endpoint (Authenticated)...');
    const statsRes = await fetch(`${BASE_URL}/api/dashboard/stats`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (statsRes.status === 200) {
      const stats = await statsRes.json();
      const requiredKeys = ['totalProperties', 'totalUnits', 'occupiedUnits', 'vacantUnits', 'monthlyRevenue', 'recentPayments', 'expiringLeases'];
      const hasAllKeys = requiredKeys.every(k => k in stats);
      if (hasAllKeys) {
        console.log('✔ Test 3 Passed: Dashboard stats verified. Metrics loaded correctly.');
        console.log(`   - Properties: ${stats.totalProperties}, Units: ${stats.totalUnits}, Active Leases: ${stats.activeLeases}`);
      } else {
        console.log('❌ Test 3 Failed: Stats response missing expected metric keys.');
        passed = false;
      }
    } else {
      console.log(`❌ Test 3 Failed: Expected status 200, got ${statsRes.status}`);
      passed = false;
    }

    // Test Case 4: Properties Endpoint
    console.log('\n[TEST 4] Testing Properties listing...');
    const propsRes = await fetch(`${BASE_URL}/api/properties`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (propsRes.status === 200) {
      const props = await propsRes.json();
      if (props.length > 0) {
        console.log(`✔ Test 4 Passed: Retrieved ${props.length} property records successfully.`);
        console.log(`   - Seed Property Name: "${props[0].name}"`);
      } else {
        console.log('❌ Test 4 Failed: No properties returned. Seeding may have failed.');
        passed = false;
      }
    } else {
      console.log(`❌ Test 4 Failed: Expected status 200, got ${propsRes.status}`);
      passed = false;
    }

    // Test Case 5: Audit Logs Endpoint (Super Admin Only)
    console.log('\n[TEST 5] Testing Audit Logs endpoint (Super Admin)...');
    const auditRes = await fetch(`${BASE_URL}/api/audit-logs`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (auditRes.status === 200) {
      const logs = await auditRes.json();
      if (logs.length > 0) {
        console.log(`✔ Test 5 Passed: Successfully retrieved ${logs.length} system audit logs.`);
        console.log(`   - Last Log Action: "${logs[0].action}"`);
      } else {
        console.log('❌ Test 5 Failed: Audit logs table is empty.');
        passed = false;
      }
    } else {
      console.log(`❌ Test 5 Failed: Expected status 200, got ${auditRes.status}`);
      passed = false;
    }

    // Test Case 6: Self-Registration API
    console.log('\n[TEST 6] Testing Self-Registration endpoint...');
    const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `new_user_${Date.now()}`,
        email: `new_user_${Date.now()}@rental.com`,
        password: 'password123',
        full_name: 'Self Registered User',
        phone: '+15559999',
        role: 'Tenant'
      })
    });

    if (registerRes.status === 201) {
      const data = await registerRes.json();
      if (data.token && data.user.role === 'Tenant') {
        console.log('✔ Test 6 Passed: Account self-registration successful, JWT issued.');
      } else {
        console.log('❌ Test 6 Failed: Registration token missing or role mismatch.');
        passed = false;
      }
    } else {
      console.log(`❌ Test 6 Failed: Expected status 201, got ${registerRes.status}`);
      passed = false;
    }

    // Test Case 7: Google Login API (JIT Provisioning)
    console.log('\n[TEST 7] Testing Google Login dynamic JIT provisioning...');
    const googleMail = `personal_gmail_${Date.now()}@gmail.com`;
    const googleLoginRes = await fetch(`${BASE_URL}/api/auth/google-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: googleMail,
        name: 'Personal Gmail User'
      })
    });

    if (googleLoginRes.status === 201) {
      const data = await googleLoginRes.json();
      if (data.token && data.user.email === googleMail && data.user.role === 'Tenant') {
        console.log('✔ Test 7 Passed: Gmail JIT provisioned and authenticated successfully.');
      } else {
        console.log('❌ Test 7 Failed: Gmail JIT return structure mismatch.');
        passed = false;
      }
    } else {
      console.log(`❌ Test 7 Failed: Expected status 201, got ${googleLoginRes.status}`);
      passed = false;
    }

    // Test Case 8: Landlord Payment Settings API
    console.log('\n[TEST 8] Testing Landlord Payment Settings API...');
    // 8a. Login as Landlord
    const landlordLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'landlord', password: 'landlord123' })
    });
    
    let landlordToken = '';
    if (landlordLoginRes.status === 200) {
      const data = await landlordLoginRes.json();
      landlordToken = data.token;
    } else {
      console.log(`❌ Test 8 Failed: Expected Landlord login status 200, got ${landlordLoginRes.status}`);
      passed = false;
    }

    if (landlordToken) {
      // 8b. Save payment settings
      const settingsPayload = {
        bank_name: 'Chase Bank',
        bank_account: '987654321',
        mobile_money_number: '+15550300',
        online_gateway_secret: 'sk_test_mock_secret_key',
        online_gateway_publishable: 'pk_test_mock_pub_key',
        credit_card_details: 'Mock Descriptor'
      };

      const saveSettingsRes = await fetch(`${BASE_URL}/api/landlord/payment-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${landlordToken}`
        },
        body: JSON.stringify(settingsPayload)
      });

      if (saveSettingsRes.status === 201 || saveSettingsRes.status === 200) {
        console.log('✔ Test 8a Passed: Successfully saved landlord payment settings.');
      } else {
        console.log(`❌ Test 8 Failed: Save settings status unexpected: ${saveSettingsRes.status}`);
        passed = false;
      }

      // 8c. Retrieve settings as landlord
      const getSettingsRes = await fetch(`${BASE_URL}/api/landlord/payment-settings`, {
        headers: { 'Authorization': `Bearer ${landlordToken}` }
      });

      if (getSettingsRes.status === 200) {
        const settings = await getSettingsRes.json();
        if (settings.bank_name === 'Chase Bank' && settings.online_gateway_secret === 'sk_test_mock_secret_key') {
          console.log('✔ Test 8b Passed: Successfully retrieved matching landlord payment settings.');
        } else {
          console.log('❌ Test 8 Failed: Retrieved settings mismatch.');
          passed = false;
        }
      } else {
        console.log(`❌ Test 8 Failed: Get settings status unexpected: ${getSettingsRes.status}`);
        passed = false;
      }

      // 8d. Fetch public details for an invoice as tenant
      const publicSettingsRes = await fetch(`${BASE_URL}/api/invoices/1/landlord-payment-settings`, {
        headers: { 'Authorization': `Bearer ${authToken}` } // use tenant/admin auth token
      });

      if (publicSettingsRes.status === 200) {
        const publicSettings = await publicSettingsRes.json();
        // Should not expose secret key
        if (publicSettings.bank_name === 'Chase Bank' && !publicSettings.online_gateway_secret) {
          console.log('✔ Test 8c Passed: Successfully retrieved public landlord payment details for tenant invoice.');
        } else {
          console.log('❌ Test 8 Failed: Public details mismatch or exposed secret key.', publicSettings);
          passed = false;
        }
      } else {
        console.log(`❌ Test 8 Failed: Fetch public invoice settings status unexpected: ${publicSettingsRes.status}`);
        passed = false;
      }

      // Test Case 9: Property-Specific Payment Settings
      console.log('\n[TEST 9] Testing property-specific payment details and override...');
      // 9a. Create a property with custom payment settings
      const customPropPayload = {
        name: 'Waterside Villa',
        code: `WV-${Date.now().toString().slice(-4)}`,
        type: 'Villa',
        address: '99 Water Lane',
        city: 'Miami',
        state: 'Florida',
        country: 'USA',
        floors: 2,
        units_count: 1,
        bank_name: 'Waterside Trust Bank',
        bank_account: 'WS-999-888',
        mobile_money_number: '+15559900',
        online_gateway_secret: 'sk_test_waterside_secret',
        online_gateway_publishable: 'pk_test_waterside_pub',
        credit_card_details: 'Waterside CC'
      };

      const createPropRes = await fetch(`${BASE_URL}/api/properties`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${landlordToken}`
        },
        body: JSON.stringify(customPropPayload)
      });

      if (createPropRes.status === 201) {
        const propData = await createPropRes.json();
        const propertyId = propData.id;
        console.log('✔ Test 9a Passed: Successfully created property with custom payment credentials.');

        // 9b. Create a unit in that property
        const createUnitRes = await fetch(`${BASE_URL}/api/units`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${landlordToken}`
          },
          body: JSON.stringify({
            property_id: propertyId,
            unit_number: 'Villa 1',
            floor: 1,
            bedrooms: 3,
            bathrooms: 3,
            monthly_rent: 5000,
            deposit: 5000
          })
        });

        if (createUnitRes.status === 201) {
          const unitData = await createUnitRes.json();
          const unitId = unitData.id;
          console.log('✔ Test 9b Passed: Successfully created unit in the new property.');

          // 9c. Draft a lease for Tenant 1 (tenant_id = 1)
          const createLeaseRes = await fetch(`${BASE_URL}/api/leases`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}` // using admin token to create lease
            },
            body: JSON.stringify({
              unit_id: unitId,
              tenant_id: 1,
              start_date: '2026-07-01',
              end_date: '2027-07-01',
              rent_amount: 5000,
              deposit_amount: 5000
            })
          });

          if (createLeaseRes.status === 201) {
            const leaseData = await createLeaseRes.json();
            const leaseId = leaseData.id;
            console.log('✔ Test 9c Passed: Successfully created lease.');

            // 9d. Generate invoice on lease
            const createInvoiceRes = await fetch(`${BASE_URL}/api/invoices`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
              },
              body: JSON.stringify({
                lease_id: leaseId,
                billing_period: '2026-07',
                rent_due: 5000,
                due_date: '2026-07-10'
              })
            });

            if (createInvoiceRes.status === 201) {
              const invData = await createInvoiceRes.json();
              const invoiceId = invData.id;
              console.log('✔ Test 9d Passed: Successfully generated invoice.');

              // 9e. Fetch public payment details for the invoice as tenant
              const publicSettingsRes2 = await fetch(`${BASE_URL}/api/invoices/${invoiceId}/landlord-payment-settings`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
              });

              if (publicSettingsRes2.status === 200) {
                const publicSettings = await publicSettingsRes2.json();
                if (
                  publicSettings.bank_name === 'Waterside Trust Bank' &&
                  publicSettings.bank_account === 'WS-999-888' &&
                  publicSettings.mobile_money_number === '+15559900' &&
                  publicSettings.online_gateway_publishable === 'pk_test_waterside_pub' &&
                  publicSettings.credit_card_details === 'Waterside CC' &&
                  !publicSettings.online_gateway_secret
                ) {
                  console.log('✔ Test 9e Passed: Successfully verified invoice payment settings use property-level details.');
                } else {
                  console.log('❌ Test 9e Failed: Property-level payment settings mismatch or leaked secret key.', publicSettings);
                  passed = false;
                }
              } else {
                console.log(`❌ Test 9e Failed: Status unexpected: ${publicSettingsRes2.status}`);
                passed = false;
              }
            } else {
              console.log(`❌ Test 9d Failed: Status unexpected: ${createInvoiceRes.status}`);
              passed = false;
            }
          } else {
            console.log(`❌ Test 9c Failed: Status unexpected: ${createLeaseRes.status}`);
            passed = false;
          }
        } else {
          console.log(`❌ Test 9b Failed: Status unexpected: ${createUnitRes.status}`);
          passed = false;
        }
      } else {
        console.log(`❌ Test 9a Failed: Status unexpected: ${createPropRes.status}`);
        passed = false;
      }

      // Test Case 10: Paystack Payment Gateway Integration
      console.log('\n[TEST 10] Testing Paystack Gateway Integration...');
      // 10a. Save landlord payment settings with Paystack
      const paystackSettingsPayload = {
        bank_name: 'Chase Bank',
        bank_account: '987654321',
        mobile_money_number: '+15550300',
        online_gateway_secret: 'sk_test_paystack_secret_key',
        online_gateway_publishable: 'pk_test_paystack_pub_key',
        online_gateway_type: 'paystack',
        credit_card_details: 'Mock Paystack Descriptor'
      };

      const savePaystackSettingsRes = await fetch(`${BASE_URL}/api/landlord/payment-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${landlordToken}`
        },
        body: JSON.stringify(paystackSettingsPayload)
      });

      if (savePaystackSettingsRes.status === 201 || savePaystackSettingsRes.status === 200) {
        console.log('✔ Test 10a Passed: Successfully saved landlord payment settings with Paystack.');
      } else {
        console.log(`❌ Test 10 Failed: Save Paystack settings status unexpected: ${savePaystackSettingsRes.status}`);
        passed = false;
      }

      // 10b. Retrieve and verify settings
      const getPaystackSettingsRes = await fetch(`${BASE_URL}/api/landlord/payment-settings`, {
        headers: { 'Authorization': `Bearer ${landlordToken}` }
      });

      if (getPaystackSettingsRes.status === 200) {
        const settings = await getPaystackSettingsRes.json();
        if (settings.online_gateway_type === 'paystack' && settings.online_gateway_secret === 'sk_test_paystack_secret_key') {
          console.log('✔ Test 10b Passed: Successfully verified settings have Paystack gateway type.');
        } else {
          console.log('❌ Test 10 Failed: Paystack settings mismatch.', settings);
          passed = false;
        }
      } else {
        console.log(`❌ Test 10 Failed: Get Paystack settings status unexpected: ${getPaystackSettingsRes.status}`);
        passed = false;
      }

      // 10c. Create a checkout session (as tenant, using invoice 1)
      const paystackCheckoutRes = await fetch(`${BASE_URL}/api/payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ invoice_id: 1, amount: 100 })
      });

      let checkoutUrl = '';
      if (paystackCheckoutRes.status === 200) {
        const data = await paystackCheckoutRes.json();
        checkoutUrl = data.url;
        if (checkoutUrl && checkoutUrl.includes('gateway=paystack')) {
          console.log('✔ Test 10c Passed: Successfully initialized Paystack mock checkout session.');
        } else {
          console.log('❌ Test 10 Failed: Checkout URL was not a mock Paystack URL.', data);
          passed = false;
        }
      } else {
        console.log(`❌ Test 10 Failed: Create Paystack session status unexpected: ${paystackCheckoutRes.status}`);
        passed = false;
      }

      // 10d. Verify the checkout session (using a mock reference)
      const paystackVerifyRes = await fetch(`${BASE_URL}/api/payments/verify-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ session_id: 'mock_paystack_ref_123', invoice_id: 1 })
      });

      if (paystackVerifyRes.status === 201) {
        const verifyData = await paystackVerifyRes.json();
        if (verifyData.receipt_number) {
          console.log('✔ Test 10d Passed: Successfully verified mock Paystack session and recorded payment.');
        } else {
          console.log('❌ Test 10 Failed: Paystack verify response missing receipt number.', verifyData);
          passed = false;
        }
      } else {
        console.log(`❌ Test 10 Failed: Verify Paystack session status unexpected: ${paystackVerifyRes.status}`);
        passed = false;
      }
    }

  } catch (err) {
    console.error('❌ Integration tests aborted due to error:', err);
    passed = false;
  } finally {
    // Terminate the background server process
    console.log('\nShutting down the integration test server...');
    serverProcess.kill('SIGINT');
    await sleep(1000);

    if (passed) {
      console.log('\n======================================');
      console.log('ALL INTEGRATION TEST CASES PASSED! ✔');
      console.log('======================================');
      process.exit(0);
    } else {
      console.log('\n======================================');
      console.log('INTEGRATION TEST CASES FAILED! ❌');
      console.log('======================================');
      process.exit(1);
    }
  }
}

runTests();
