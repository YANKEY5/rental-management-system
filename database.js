const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'rental_system.db');
const db = new sqlite3.Database(dbPath);

function ensureSeedFilesExist() {
  const dummyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  const dummyJpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

  const files = [
    { relPath: 'public/uploads/signatures/lease_1.png', content: dummyPng },
    { relPath: 'public/uploads/signatures/lease_2.png', content: dummyPng },
    { relPath: 'public/uploads/signatures/lease_3.png', content: dummyPng },
    { relPath: 'public/uploads/signatures/lease_3_old.png', content: dummyPng },
    { relPath: 'public/uploads/maintenance/sink_leak.jpg', content: dummyJpg },
    { relPath: 'public/uploads/maintenance/sink_fixed.jpg', content: dummyJpg },
    { relPath: 'public/uploads/maintenance/fan_spark.jpg', content: dummyJpg },
    { relPath: 'public/uploads/receipts/exp_1.jpg', content: dummyJpg },
    { relPath: 'public/uploads/receipts/exp_2.jpg', content: dummyJpg }
  ];

  files.forEach(f => {
    const fullPath = path.join(__dirname, f.relPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, f.content);
    }
  });
}

function initDatabase() {
  ensureSeedFilesExist();
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Enable foreign keys
      db.run('PRAGMA foreign_keys = ON;');

      // 1. Users Table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT CHECK(role IN ('Super Admin', 'Property Manager', 'Landlord', 'Accountant', 'Maintenance Officer', 'Receptionist', 'Tenant')) NOT NULL,
          full_name TEXT NOT NULL,
          phone TEXT,
          is_verified INTEGER DEFAULT 0,
          two_factor_secret TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create indexes
      db.run('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);');
      db.run('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);');

      // 2. Properties Table
      db.run(`
        CREATE TABLE IF NOT EXISTS properties (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          code TEXT UNIQUE NOT NULL,
          type TEXT NOT NULL, -- e.g., Apartment, Commercial, Villa
          address TEXT NOT NULL,
          city TEXT NOT NULL,
          state TEXT NOT NULL,
          country TEXT NOT NULL,
          description TEXT,
          owner_id INTEGER,
          floors INTEGER NOT NULL,
          units_count INTEGER NOT NULL,
          gps_lat REAL,
          gps_lng REAL,
          amenities TEXT, -- JSON string or comma-separated
          images TEXT, -- JSON array of image URLs
          videos TEXT, -- JSON array of video URLs
          bank_name TEXT,
          bank_account TEXT,
          mobile_money_number TEXT,
          online_gateway_secret TEXT,
          online_gateway_publishable TEXT,
          online_gateway_type TEXT DEFAULT 'stripe',
          credit_card_details TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      db.run("ALTER TABLE properties ADD COLUMN images TEXT;", () => {});
      db.run("ALTER TABLE properties ADD COLUMN videos TEXT;", () => {});
      db.run("ALTER TABLE properties ADD COLUMN bank_name TEXT;", () => {});
      db.run("ALTER TABLE properties ADD COLUMN bank_account TEXT;", () => {});
      db.run("ALTER TABLE properties ADD COLUMN mobile_money_number TEXT;", () => {});
      db.run("ALTER TABLE properties ADD COLUMN online_gateway_secret TEXT;", () => {});
      db.run("ALTER TABLE properties ADD COLUMN online_gateway_publishable TEXT;", () => {});
      db.run("ALTER TABLE properties ADD COLUMN credit_card_details TEXT;", () => {});
      db.run("ALTER TABLE properties ADD COLUMN online_gateway_type TEXT DEFAULT 'stripe';", () => {});

      // 3. Units Table
      db.run(`
        CREATE TABLE IF NOT EXISTS units (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          property_id INTEGER NOT NULL,
          unit_number TEXT NOT NULL,
          floor INTEGER NOT NULL,
          bedrooms INTEGER NOT NULL,
          bathrooms INTEGER NOT NULL,
          monthly_rent REAL NOT NULL,
          deposit REAL NOT NULL,
          service_charge REAL DEFAULT 0,
          status TEXT CHECK(status IN ('Vacant', 'Occupied', 'Reserved', 'Under Maintenance')) DEFAULT 'Vacant',
          FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
        )
      `);

      // 4. Tenants Table
      db.run(`
        CREATE TABLE IF NOT EXISTS tenants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER UNIQUE NOT NULL,
          national_id TEXT,
          passport_number TEXT,
          dob TEXT,
          occupation TEXT,
          employer TEXT,
          emergency_contact TEXT, -- JSON string or raw text
          guarantor TEXT, -- JSON string or raw text
          digital_signature TEXT, -- base64 signature string
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // 5. Leases Table
      db.run(`
        CREATE TABLE IF NOT EXISTS leases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          unit_id INTEGER NOT NULL,
          tenant_id INTEGER NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          rent_amount REAL NOT NULL,
          deposit_amount REAL NOT NULL,
          status TEXT CHECK(status IN ('Active', 'Expired', 'Terminated', 'Pending')) DEFAULT 'Pending',
          signature_path TEXT, -- file path or confirmation code
          terms TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE RESTRICT,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
        )
      `);

      // 6. Invoices Table
      db.run(`
        CREATE TABLE IF NOT EXISTS invoices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lease_id INTEGER NOT NULL,
          invoice_number TEXT UNIQUE NOT NULL,
          billing_period TEXT NOT NULL, -- YYYY-MM
          rent_due REAL NOT NULL,
          utilities_due REAL DEFAULT 0,
          penalties REAL DEFAULT 0,
          total_due REAL NOT NULL,
          paid_amount REAL DEFAULT 0,
          status TEXT CHECK(status IN ('Paid', 'Partially Paid', 'Unpaid', 'Overdue')) DEFAULT 'Unpaid',
          due_date TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE
        )
      `);

      // 7. Payments Table
      db.run(`
        CREATE TABLE IF NOT EXISTS payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_id INTEGER NOT NULL,
          payment_method TEXT CHECK(payment_method IN ('Cash', 'Bank Transfer', 'Mobile Money', 'Credit Card', 'Online Payment Gateway')) NOT NULL,
          amount REAL NOT NULL,
          transaction_reference TEXT,
          payment_date TEXT DEFAULT CURRENT_TIMESTAMP,
          receipt_number TEXT UNIQUE NOT NULL,
          FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT
        )
      `);

      // 8. Maintenance Requests Table
      db.run(`
        CREATE TABLE IF NOT EXISTS maintenance_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          unit_id INTEGER NOT NULL,
          tenant_id INTEGER NOT NULL,
          category TEXT CHECK(category IN ('Plumbing', 'Electrical', 'Carpentry', 'Painting', 'Roofing', 'Cleaning', 'Security')) NOT NULL,
          description TEXT NOT NULL,
          priority TEXT CHECK(priority IN ('Low', 'Medium', 'High', 'Emergency')) DEFAULT 'Low',
          status TEXT CHECK(status IN ('Pending', 'Assigned', 'In Progress', 'Completed', 'Cancelled')) DEFAULT 'Pending',
          image_before TEXT, -- filepath
          image_after TEXT, -- filepath
          assigned_officer_id INTEGER,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          completed_at TEXT,
          FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          FOREIGN KEY (assigned_officer_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      // 9. Expenses Table
      db.run(`
        CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          property_id INTEGER NOT NULL,
          category TEXT CHECK(category IN ('Repairs', 'Water', 'Electricity', 'Fuel', 'Salaries', 'Cleaning', 'Internet', 'Insurance', 'Taxes')) NOT NULL,
          amount REAL NOT NULL,
          description TEXT NOT NULL,
          expense_date TEXT NOT NULL,
          recorded_by INTEGER NOT NULL,
          receipt_path TEXT,
          FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
          FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT
        )
      `);

      // 10. Visitor Log Table
      db.run(`
        CREATE TABLE IF NOT EXISTS visitor_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          visitor_name TEXT NOT NULL,
          phone_number TEXT NOT NULL,
          host_tenant_id INTEGER NOT NULL,
          purpose TEXT NOT NULL,
          check_in TEXT DEFAULT CURRENT_TIMESTAMP,
          check_out TEXT,
          created_by INTEGER NOT NULL,
          FOREIGN KEY (host_tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
        )
      `);

      // 11. Utilities Table
      db.run(`
        CREATE TABLE IF NOT EXISTS utilities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          unit_id INTEGER NOT NULL,
          utility_type TEXT CHECK(utility_type IN ('Water', 'Electricity', 'Gas', 'Internet', 'Waste')) NOT NULL,
          reading_date TEXT NOT NULL,
          previous_reading REAL NOT NULL,
          current_reading REAL NOT NULL,
          rate REAL NOT NULL,
          amount REAL NOT NULL,
          status TEXT CHECK(status IN ('Pending', 'Billed')) DEFAULT 'Pending',
          FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE
        )
      `);

      // 12. Audit Logs Table
      db.run(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          action TEXT NOT NULL,
          details TEXT NOT NULL,
          ip_address TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      // 13. Landlord Payment Settings Table
      db.run(`
        CREATE TABLE IF NOT EXISTS landlord_payment_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          landlord_id INTEGER UNIQUE NOT NULL,
          bank_name TEXT,
          bank_account TEXT,
          mobile_money_number TEXT,
          online_gateway_secret TEXT,
          online_gateway_publishable TEXT,
          online_gateway_type TEXT DEFAULT 'stripe',
          credit_card_details TEXT,
          FOREIGN KEY (landlord_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      db.run("ALTER TABLE landlord_payment_settings ADD COLUMN online_gateway_type TEXT DEFAULT 'stripe';", () => {});

      // Resolve and check if we need to seed
      db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (err) {
          return reject(err);
        }
        if (row.count === 0) {
          console.log("Database empty. Seeding data...");
          seedDatabase()
            .then(resolve)
            .catch(reject);
        } else {
          console.log("Database schema initialized. Seeding skipped (already has data).");
          resolve();
        }
      });
    });
  });
}

function seedDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. Create Hashed Passwords
      const salt = bcrypt.genSaltSync(10);
      const adminPass = bcrypt.hashSync('admin123', salt);
      const managerPass = bcrypt.hashSync('manager123', salt);
      const landlordPass = bcrypt.hashSync('landlord123', salt);
      const accountantPass = bcrypt.hashSync('accountant123', salt);
      const maintenancePass = bcrypt.hashSync('maintenance123', salt);
      const receptionistPass = bcrypt.hashSync('receptionist123', salt);
      const tenant1Pass = bcrypt.hashSync('tenant123', salt);
      const tenant2Pass = bcrypt.hashSync('tenant123', salt);
      const tenant3Pass = bcrypt.hashSync('tenant123', salt);

      // 2. Insert Users
      const usersData = [
        ['admin', 'admin@rental.com', adminPass, 'Super Admin', 'Alex Mercer', '+15550100', 1],
        ['manager', 'manager@rental.com', managerPass, 'Property Manager', 'Sarah Connor', '+15550200', 1],
        ['landlord', 'landlord@rental.com', landlordPass, 'Landlord', 'Bruce Wayne', '+15550300', 1],
        ['accountant', 'accountant@rental.com', accountantPass, 'Accountant', 'Clark Kent', '+15550400', 1],
        ['maintenance', 'maintenance@rental.com', maintenancePass, 'Maintenance Officer', 'Bob Builder', '+15550500', 1],
        ['receptionist', 'receptionist@rental.com', receptionistPass, 'Receptionist', 'Lois Lane', '+15550600', 1],
        ['tenant1', 'tenant1@rental.com', tenant1Pass, 'Tenant', 'Peter Parker', '+15550701', 1],
        ['tenant2', 'tenant2@rental.com', tenant2Pass, 'Tenant', 'Mary Jane', '+15550702', 1],
        ['tenant3', 'tenant3@rental.com', tenant3Pass, 'Tenant', 'Tony Stark', '+15550703', 1]
      ];

      const stmtUser = db.prepare("INSERT INTO users (username, email, password_hash, role, full_name, phone, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const u of usersData) {
        stmtUser.run(u);
      }
      stmtUser.finalize();

      // 3. Insert Properties (Landlord is Bruce Wayne, user_id = 3)
      const propertiesData = [
        ['Grand Horizon Apartments', 'GHA-01', 'Apartment', '101 Ocean Drive', 'Miami', 'Florida', 'USA', 'Luxurious sea-facing residential apartments', 3, 10, 6, 25.7617, -80.1918, 'Pool, Gym, Parking, 24/7 Security, Wi-Fi'],
        ['Oakwood Business Plaza', 'OBP-02', 'Commercial', '500 Corporate Way', 'Austin', 'Texas', 'USA', 'Premium office spaces in the tech hub', 3, 5, 3, 30.2672, -97.7431, 'Fiber Internet, Conference Rooms, Cafeteria, Receptionist, Parking'],
        ['Sunset Villas', 'SV-03', 'Villa', '77 Scenic Route', 'Malibu', 'California', 'USA', 'Private bungalows and duplex villas', 3, 2, 2, 34.0259, -118.7798, 'Private Garden, Swimming Pool, Smart Home, Beach View']
      ];

      const stmtProp = db.prepare("INSERT INTO properties (name, code, type, address, city, state, country, description, owner_id, floors, units_count, gps_lat, gps_lng, amenities) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const p of propertiesData) {
        stmtProp.run(p);
      }
      stmtProp.finalize();

      // 4. Insert Units
      // Property 1 (Grand Horizon Apartments): 6 units
      // Property 2 (Oakwood Business Plaza): 3 units
      // Property 3 (Sunset Villas): 2 units
      const unitsData = [
        // Property 1 (ID: 1)
        [1, '101', 1, 2, 2, 1800.0, 1800.0, 150.0, 'Occupied'],
        [1, '102', 1, 2, 1.5, 1600.0, 1600.0, 150.0, 'Occupied'],
        [1, '201', 2, 3, 2.5, 2500.0, 2500.0, 200.0, 'Occupied'],
        [1, '202', 2, 1, 1, 1200.0, 1200.0, 100.0, 'Vacant'],
        [1, '301', 3, 3, 3, 3200.0, 3200.0, 250.0, 'Reserved'],
        [1, '302', 3, 2, 2, 1900.0, 1900.0, 150.0, 'Under Maintenance'],
        // Property 2 (ID: 2)
        [2, 'Suite A', 1, 0, 2, 4500.0, 9000.0, 500.0, 'Vacant'],
        [2, 'Suite B', 2, 0, 2, 5500.0, 11000.0, 600.0, 'Vacant'],
        [2, 'Suite C', 3, 0, 4, 8500.0, 17000.0, 900.0, 'Vacant'],
        // Property 3 (ID: 3)
        [3, 'Villa Alpha', 1, 4, 4.5, 6000.0, 6000.0, 400.0, 'Vacant'],
        [3, 'Villa Beta', 2, 3, 3.5, 5200.0, 5200.0, 350.0, 'Vacant']
      ];

      const stmtUnit = db.prepare("INSERT INTO units (property_id, unit_number, floor, bedrooms, bathrooms, monthly_rent, deposit, service_charge, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const u of unitsData) {
        stmtUnit.run(u);
      }
      stmtUnit.finalize();

      // 5. Insert Tenants (user_id 7, 8, 9)
      const tenantsData = [
        [7, 'NID-987654', 'PPT-A123456', '1995-08-10', 'Freelance Photographer', 'Self Employed', JSON.stringify({ name: 'May Parker', phone: '+15550888', relation: 'Aunt' }), JSON.stringify({ name: 'J. Jonah Jameson', phone: '+15550999', income: 80000 }), 'data:image/png;base64,mockSignaturePeterParker...'],
        [8, 'NID-876543', 'PPT-B765432', '1996-03-22', 'Broadway Actress', 'Manhattan Theatre Co', JSON.stringify({ name: 'Mrs. Watson', phone: '+15550889', relation: 'Mother' }), JSON.stringify({ name: 'Harry Osborn', phone: '+15550990', income: 150000 }), 'data:image/png;base64,mockSignatureMaryJane...'],
        [9, 'NID-765432', 'PPT-C987654', '1985-05-29', 'Tech Executive', 'Stark Industries', JSON.stringify({ name: 'Pepper Potts', phone: '+15550890', relation: 'Spouse' }), JSON.stringify({ name: 'Happy Hogan', phone: '+15550991', income: 500000 }), 'data:image/png;base64,mockSignatureTonyStark...']
      ];

      const stmtTenant = db.prepare("INSERT INTO tenants (user_id, national_id, passport_number, dob, occupation, employer, emergency_contact, guarantor, digital_signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const t of tenantsData) {
        stmtTenant.run(t);
      }
      stmtTenant.finalize();

      // 6. Insert Leases
      // Tenant 1 (Peter Parker, tenant_id = 1) in Unit 101 (unit_id = 1) -> Active
      // Tenant 2 (Mary Jane, tenant_id = 2) in Unit 102 (unit_id = 2) -> Active
      // Tenant 3 (Tony Stark, tenant_id = 3) in Unit 201 (unit_id = 3) -> Expired lease, and now has a new Active lease
      const leasesData = [
        [1, 1, '2025-06-01', '2026-06-01', 1800.0, 1800.0, 'Active', 'uploads/signatures/lease_1.png', 'Standard 1-year residential lease. No smoking, no pets without prior approval.'],
        [2, 2, '2025-09-01', '2026-09-01', 1600.0, 1600.0, 'Active', 'uploads/signatures/lease_2.png', 'Standard 1-year residential lease. Quiet hours after 10 PM.'],
        [3, 3, '2024-01-01', '2024-12-31', 2400.0, 2400.0, 'Expired', 'uploads/signatures/lease_3_old.png', 'Legacy lease agreement.'],
        [3, 3, '2025-01-01', '2026-12-31', 2500.0, 2500.0, 'Active', 'uploads/signatures/lease_3.png', 'Premium 2-year residential lease agreement with smart automation access rights.']
      ];

      const stmtLease = db.prepare("INSERT INTO leases (unit_id, tenant_id, start_date, end_date, rent_amount, deposit_amount, status, signature_path, terms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const l of leasesData) {
        stmtLease.run(l);
      }
      stmtLease.finalize();

      // 7. Insert Invoices & Payments
      // Let's create invoices for the past 3 months (April, May, June 2026)
      // We will create some Paid, some Partially Paid, some Overdue/Unpaid
      const invoicesData = [
        // Lease 1 (Peter Parker)
        [1, 'INV-2026-04-01', '2026-04', 1800.0, 100.0, 0.0, 1900.0, 1900.0, 'Paid', '2026-04-05'],
        [1, 'INV-2026-05-01', '2026-05', 1800.0, 120.0, 0.0, 1920.0, 1920.0, 'Paid', '2026-05-05'],
        [1, 'INV-2026-06-01', '2026-06', 1800.0, 110.0, 0.0, 1910.0, 0.0, 'Overdue', '2026-06-05'], // Outstanding

        // Lease 2 (Mary Jane)
        [2, 'INV-2026-04-02', '2026-04', 1600.0, 80.0, 0.0, 1680.0, 1680.0, 'Paid', '2026-04-05'],
        [2, 'INV-2026-05-02', '2026-05', 1600.0, 95.0, 0.0, 1695.0, 1695.0, 'Paid', '2026-05-05'],
        [2, 'INV-2026-06-02', '2026-06', 1600.0, 85.0, 0.0, 1685.0, 1000.0, 'Partially Paid', '2026-06-05'], // Partially Paid

        // Lease 4 (Tony Stark)
        [4, 'INV-2026-04-03', '2026-04', 2500.0, 300.0, 0.0, 2800.0, 2800.0, 'Paid', '2026-04-05'],
        [4, 'INV-2026-05-03', '2026-05', 2500.0, 320.0, 0.0, 2820.0, 2820.0, 'Paid', '2026-05-05'],
        [4, 'INV-2026-06-03', '2026-06', 2500.0, 290.0, 0.0, 2790.0, 2790.0, 'Paid', '2026-06-05']
      ];

      const stmtInv = db.prepare("INSERT INTO invoices (lease_id, invoice_number, billing_period, rent_due, utilities_due, penalties, total_due, paid_amount, status, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const inv of invoicesData) {
        stmtInv.run(inv);
      }
      stmtInv.finalize();

      // Payments for Paid and Partially Paid Invoices
      const paymentsData = [
        // Invoice 1 (Peter Parker, April)
        [1, 'Bank Transfer', 1900.0, 'TXN-PETER-APRIL', '2026-04-04', 'REC-10001'],
        // Invoice 2 (Peter Parker, May)
        [2, 'Credit Card', 1920.0, 'TXN-PETER-MAY', '2026-05-03', 'REC-10002'],
        // Invoice 4 (Mary Jane, April)
        [4, 'Bank Transfer', 1680.0, 'TXN-MJ-APRIL', '2026-04-03', 'REC-10003'],
        // Invoice 5 (Mary Jane, May)
        [5, 'Mobile Money', 1695.0, 'TXN-MJ-MAY', '2026-05-04', 'REC-10004'],
        // Invoice 6 (Mary Jane, June - Partially Paid)
        [6, 'Cash', 1000.0, 'TXN-MJ-JUNE-CASH', '2026-06-04', 'REC-10005'],
        // Invoice 7 (Tony Stark, April)
        [7, 'Online Payment Gateway', 2800.0, 'TXN-STARK-APRIL', '2026-04-01', 'REC-10006'],
        // Invoice 8 (Tony Stark, May)
        [8, 'Online Payment Gateway', 2820.0, 'TXN-STARK-MAY', '2026-05-02', 'REC-10007'],
        // Invoice 9 (Tony Stark, June)
        [9, 'Online Payment Gateway', 2790.0, 'TXN-STARK-JUNE', '2026-06-01', 'REC-10008']
      ];

      const stmtPay = db.prepare("INSERT INTO payments (invoice_id, payment_method, amount, transaction_reference, payment_date, receipt_number) VALUES (?, ?, ?, ?, ?, ?)");
      for (const py of paymentsData) {
        stmtPay.run(py);
      }
      stmtPay.finalize();

      // 8. Maintenance Requests
      // Category: Plumbing, Electrical, Carpentry, Painting, Roofing, Cleaning, Security
      // Status: Pending, Assigned, In Progress, Completed, Cancelled
      // Maintenance Officer user_id = 5 (Bob Builder)
      const maintenanceData = [
        [1, 1, 'Plumbing', 'Leaking kitchen faucet needs replacement.', 'Medium', 'Completed', 'uploads/maintenance/sink_leak.jpg', 'uploads/maintenance/sink_fixed.jpg', 5, '2026-05-10', '2026-05-12'],
        [2, 2, 'Electrical', 'Living room ceiling fan spark on turn-on.', 'High', 'In Progress', 'uploads/maintenance/fan_spark.jpg', null, 5, '2026-06-20', null],
        [1, 1, 'Carpentry', 'Front door lock jammed, difficult to insert key.', 'High', 'Pending', null, null, null, '2026-06-25', null],
        [3, 3, 'Security', 'Digital intercom screen not responding.', 'Low', 'Assigned', null, null, 5, '2026-06-26', null]
      ];

      const stmtMaint = db.prepare("INSERT INTO maintenance_requests (unit_id, tenant_id, category, description, priority, status, image_before, image_after, assigned_officer_id, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const m of maintenanceData) {
        stmtMaint.run(m);
      }
      stmtMaint.finalize();

      // 9. Expenses
      // Category: Repairs, Water, Electricity, Fuel, Salaries, Cleaning, Internet, Insurance, Taxes
      const expensesData = [
        [1, 'Repairs', 150.0, 'Purchased premium brass kitchen faucet for Unit 101', '2026-05-11', 2, 'uploads/receipts/exp_1.jpg'],
        [1, 'Cleaning', 300.0, 'Bi-weekly lobby and elevator deep cleaning service', '2026-06-01', 2, null],
        [2, 'Salaries', 2500.0, 'Staff salary payout - Receptionist and Maintenance Officer', '2026-06-05', 4, null],
        [3, 'Insurance', 1200.0, 'Annual property structural fire insurance - Sunset Villas', '2026-04-15', 3, 'uploads/receipts/exp_2.jpg'],
        [1, 'Electricity', 450.0, 'Common area power grid utility bill', '2026-06-10', 4, null]
      ];

      const stmtExp = db.prepare("INSERT INTO expenses (property_id, category, amount, description, expense_date, recorded_by, receipt_path) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const e of expensesData) {
        stmtExp.run(e);
      }
      stmtExp.finalize();

      // 10. Visitor Log
      // Host Tenants: tenant1=1, tenant2=2, tenant3=3
      // Created by Receptionist user_id = 6 (Lois Lane)
      const visitorsData = [
        ['Gwen Stacy', '+15551111', 1, 'Project study meeting', '2026-06-25 14:00:00', '2026-06-25 18:30:00', 6],
        ['Otto Octavius', '+15552222', 1, 'Delivery of private packages', '2026-06-26 10:15:00', null, 6],
        ['Norman Osborn', '+15553333', 3, 'Business collaboration discussion', '2026-06-26 09:00:00', '2026-06-26 10:00:00', 6]
      ];

      const stmtVis = db.prepare("INSERT INTO visitor_log (visitor_name, phone_number, host_tenant_id, purpose, check_in, check_out, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const v of visitorsData) {
        stmtVis.run(v);
      }
      stmtVis.finalize();

      // 11. Utilities
      // Unit 101 (Peter), 102 (MJ), 201 (Tony)
      const utilitiesData = [
        [1, 'Water', '2026-06-01', 1500.0, 1550.0, 1.2, 60.0, 'Billed'],
        [1, 'Electricity', '2026-06-01', 8200.0, 8450.0, 0.2, 50.0, 'Billed'],
        [2, 'Water', '2026-06-01', 950.0, 990.0, 1.2, 48.0, 'Billed'],
        [2, 'Electricity', '2026-06-01', 4100.0, 4280.0, 0.2, 36.0, 'Billed'],
        [3, 'Water', '2026-06-01', 3200.0, 3350.0, 1.2, 180.0, 'Billed'],
        [3, 'Electricity', '2026-06-01', 12500.0, 13050.0, 0.2, 110.0, 'Billed'],
        // Pending next readings
        [1, 'Water', '2026-06-25', 1550.0, 1585.0, 1.2, 42.0, 'Pending'],
        [1, 'Electricity', '2026-06-25', 8450.0, 8690.0, 0.2, 48.0, 'Pending']
      ];

      const stmtUtil = db.prepare("INSERT INTO utilities (unit_id, utility_type, reading_date, previous_reading, current_reading, rate, amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const ut of utilitiesData) {
        stmtUtil.run(ut);
      }
      stmtUtil.finalize();

      // 12. Audit Logs
      const auditData = [
        [1, 'DATABASE_SEED', 'Successfully seeded Rental Management System with initial data structures and roles.', '127.0.0.1'],
        [3, 'CREATE_LEASE', 'Landlord Bruce Wayne signed a 2-year lease with Tenant Tony Stark for Unit 201.', '127.0.0.1'],
        [4, 'RECORD_EXPENSE', 'Accountant Clark Kent recorded common area power grid bill expense ($450).', '127.0.0.1']
      ];

      const stmtAudit = db.prepare("INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)");
      for (const a of auditData) {
        stmtAudit.run(a);
      }
      stmtAudit.finalize();

      console.log("Database seeded successfully!");
      resolve();
    });
  });
}

module.exports = {
  db,
  initDatabase
};
