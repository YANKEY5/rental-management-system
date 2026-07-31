const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');

const connectionString = process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL;

let db;
let pool;
let isPostgres = false;

if (connectionString) {
  isPostgres = true;
  let config = {};
  try {
    const dbUrl = new URL(connectionString);
    config = {
      user: decodeURIComponent(dbUrl.username),
      password: decodeURIComponent(dbUrl.password),
      host: dbUrl.hostname,
      port: dbUrl.port || 5432,
      database: decodeURIComponent(dbUrl.pathname.slice(1))
    };
  } catch (e) {
    config = { connectionString };
  }

  if (connectionString && !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1')) {
    config.ssl = { rejectUnauthorized: false };
  } else {
    config.ssl = false;
  }

  pool = new Pool(config);
} else {
  // Fallback to SQLite locally, using variable key to prevent Vercel static tracing
  const sqliteModuleName = 'sqlite3';
  const sqlite3 = require(sqliteModuleName).verbose();
  const sqliteDb = new sqlite3.Database(path.join(__dirname, 'rental_system.db'));

  db = {
    get(sql, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      sqliteDb.get(sql, params, callback);
    },
    all(sql, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      sqliteDb.all(sql, params, callback);
    },
    run(sql, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      sqliteDb.run(sql, params, callback);
    },
    serialize(callback) {
      sqliteDb.serialize(callback);
    }
  };
}

function convertSql(sql) {
  let index = 1;
  let pgSql = sql.replace(/\?/g, () => `$${index++}`);
  
  // Convert SQLite case-insensitive LIKE to PostgreSQL ILIKE
  pgSql = pgSql.replace(/\s+LIKE\s+/gi, ' ILIKE ');
  
  return pgSql;
}

if (isPostgres) {
  db = {
    get(sql, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      const pgSql = convertSql(sql);
      pool.query(pgSql, params, (err, res) => {
        if (err) {
          if (callback) callback(err);
          return;
        }
        if (callback) callback(null, res.rows[0] || null);
      });
    },

    all(sql, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      const pgSql = convertSql(sql);
      pool.query(pgSql, params, (err, res) => {
        if (err) {
          if (callback) callback(err);
          return;
        }
        if (callback) callback(null, res.rows);
      });
    },

    run(sql, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      let pgSql = convertSql(sql);
      
      const isInsert = /^\s*insert\s+/i.test(pgSql);
      const hasReturning = /returning\s+/i.test(pgSql);
      if (isInsert && !hasReturning) {
        pgSql += ' RETURNING id';
      }

      pool.query(pgSql, params, (err, res) => {
        if (err) {
          if (callback) callback(err);
          return;
        }
        if (callback) {
          const lastID = (isInsert && res.rows[0]) ? res.rows[0].id : null;
          const context = {
            lastID: lastID,
            changes: res.rowCount
          };
          callback.call(context, null);
        }
      });
    },

    serialize(callback) {
      callback();
    }
  };
}

async function initDatabase() {
  if (!isPostgres) {
    console.log("Local SQLite database verified (init skipped).");
    return;
  }
  const client = await pool.connect();
  try {
    // 0. Create strftime overloaded functions to support existing queries
    await client.query(`
      CREATE OR REPLACE FUNCTION strftime(format text, val text)
      RETURNS text AS $$
      BEGIN
        IF val = 'now' THEN
          RETURN to_char(CURRENT_TIMESTAMP, 'YYYY-MM');
        ELSE
          RETURN to_char(val::timestamp, 'YYYY-MM');
        END IF;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);
    
    await client.query(`
      CREATE OR REPLACE FUNCTION strftime(format text, val timestamp)
      RETURNS text AS $$
      BEGIN
        RETURN to_char(val, 'YYYY-MM');
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION strftime(format text, val timestamptz)
      RETURNS text AS $$
      BEGIN
        RETURN to_char(val, 'YYYY-MM');
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION strftime(format text, val date)
      RETURNS text AS $$
      BEGIN
        RETURN to_char(val, 'YYYY-MM');
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // 1. Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) CHECK(role IN ('Super Admin', 'Property Manager', 'Landlord', 'Accountant', 'Maintenance Officer', 'Receptionist', 'Tenant')) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        is_verified INTEGER DEFAULT 0,
        two_factor_secret VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);');

    // 2. Properties Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS properties (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL,
        type VARCHAR(50) NOT NULL,
        address VARCHAR(255) NOT NULL,
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NOT NULL,
        country VARCHAR(100) NOT NULL,
        description TEXT,
        owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        floors INTEGER NOT NULL,
        units_count INTEGER NOT NULL,
        gps_lat DOUBLE PRECISION,
        gps_lng DOUBLE PRECISION,
        amenities TEXT,
        images TEXT,
        videos TEXT,
        bank_name VARCHAR(100),
        bank_account VARCHAR(100),
        mobile_money_number VARCHAR(100),
        online_gateway_secret TEXT,
        online_gateway_publishable TEXT,
        online_gateway_type VARCHAR(50) DEFAULT 'stripe',
        credit_card_details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Units Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS units (
        id SERIAL PRIMARY KEY,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        unit_number VARCHAR(50) NOT NULL,
        floor INTEGER NOT NULL,
        bedrooms INTEGER NOT NULL,
        bathrooms DOUBLE PRECISION NOT NULL,
        monthly_rent DOUBLE PRECISION NOT NULL,
        deposit DOUBLE PRECISION NOT NULL,
        service_charge DOUBLE PRECISION DEFAULT 0,
        status VARCHAR(50) CHECK(status IN ('Vacant', 'Occupied', 'Reserved', 'Under Maintenance')) DEFAULT 'Vacant'
      )
    `);

    // 4. Tenants Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        national_id VARCHAR(100),
        passport_number VARCHAR(100),
        dob VARCHAR(100),
        occupation VARCHAR(255),
        employer VARCHAR(255),
        emergency_contact TEXT,
        guarantor TEXT,
        digital_signature TEXT
      )
    `);

    // 5. Leases Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS leases (
        id SERIAL PRIMARY KEY,
        unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
        start_date VARCHAR(100) NOT NULL,
        end_date VARCHAR(100) NOT NULL,
        rent_amount DOUBLE PRECISION NOT NULL,
        deposit_amount DOUBLE PRECISION NOT NULL,
        status VARCHAR(50) CHECK(status IN ('Active', 'Expired', 'Terminated', 'Pending')) DEFAULT 'Pending',
        signature_path TEXT,
        terms TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. Invoices Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
        invoice_number VARCHAR(100) UNIQUE NOT NULL,
        billing_period VARCHAR(50) NOT NULL,
        rent_due DOUBLE PRECISION NOT NULL,
        utilities_due DOUBLE PRECISION DEFAULT 0,
        penalties DOUBLE PRECISION DEFAULT 0,
        total_due DOUBLE PRECISION NOT NULL,
        paid_amount DOUBLE PRECISION DEFAULT 0,
        status VARCHAR(50) CHECK(status IN ('Paid', 'Partially Paid', 'Unpaid', 'Overdue')) DEFAULT 'Unpaid',
        due_date VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 7. Payments Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
        payment_method VARCHAR(50) CHECK(payment_method IN ('Cash', 'Bank Transfer', 'Mobile Money', 'Credit Card', 'Online Payment Gateway')) NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        transaction_reference VARCHAR(255),
        payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        receipt_number VARCHAR(100) UNIQUE NOT NULL
      )
    `);

    // 8. Maintenance Requests Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS maintenance_requests (
        id SERIAL PRIMARY KEY,
        unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        category VARCHAR(100) CHECK(category IN ('Plumbing', 'Electrical', 'Carpentry', 'Painting', 'Roofing', 'Cleaning', 'Security')) NOT NULL,
        description TEXT NOT NULL,
        priority VARCHAR(50) CHECK(priority IN ('Low', 'Medium', 'High', 'Emergency')) DEFAULT 'Low',
        status VARCHAR(50) CHECK(status IN ('Pending', 'Assigned', 'In Progress', 'Completed', 'Cancelled')) DEFAULT 'Pending',
        image_before TEXT,
        image_after TEXT,
        assigned_officer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at VARCHAR(100)
      )
    `);

    // 9. Expenses Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        category VARCHAR(100) CHECK(category IN ('Repairs', 'Water', 'Electricity', 'Fuel', 'Salaries', 'Cleaning', 'Internet', 'Insurance', 'Taxes')) NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        description TEXT NOT NULL,
        expense_date VARCHAR(100) NOT NULL,
        recorded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        receipt_path TEXT
      )
    `);

    // 10. Visitor Log Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS visitor_log (
        id SERIAL PRIMARY KEY,
        visitor_name VARCHAR(255) NOT NULL,
        phone_number VARCHAR(100) NOT NULL,
        host_tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL,
        check_in TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        check_out VARCHAR(100),
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT
      )
    `);

    // 11. Utilities Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS utilities (
        id SERIAL PRIMARY KEY,
        unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        utility_type VARCHAR(100) CHECK(utility_type IN ('Water', 'Electricity', 'Gas', 'Internet', 'Waste')) NOT NULL,
        reading_date VARCHAR(100) NOT NULL,
        previous_reading DOUBLE PRECISION NOT NULL,
        current_reading DOUBLE PRECISION NOT NULL,
        rate DOUBLE PRECISION NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        status VARCHAR(50) CHECK(status IN ('Pending', 'Billed')) DEFAULT 'Pending'
      )
    `);

    // 12. Audit Logs Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(255) NOT NULL,
        details TEXT NOT NULL,
        ip_address VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 13. Landlord Payment Settings Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS landlord_payment_settings (
        id SERIAL PRIMARY KEY,
        landlord_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bank_name VARCHAR(100),
        bank_account VARCHAR(100),
        mobile_money_number VARCHAR(100),
        online_gateway_secret TEXT,
        online_gateway_publishable TEXT,
        online_gateway_type VARCHAR(50) DEFAULT 'stripe',
        credit_card_details TEXT
      )
    `);

    // Check if seeding is required
    const resCount = await client.query("SELECT COUNT(*) as count FROM users");
    const count = parseInt(resCount.rows[0].count, 10);
    if (count === 0) {
      console.log("Database empty. Seeding data...");
      await seedDatabase(client);
    } else {
      console.log("Database schema initialized. Seeding skipped (already has data).");
    }

  } finally {
    client.release();
  }
}

async function seedDatabase(client) {
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

  for (const u of usersData) {
    await client.query("INSERT INTO users (username, email, password_hash, role, full_name, phone, is_verified) VALUES ($1, $2, $3, $4, $5, $6, $7)", u);
  }

  // 3. Insert Properties (Bruce Wayne is landlord, user_id = 3)
  const propertiesData = [
    ['Grand Horizon Apartments', 'GHA-01', 'Apartment', '101 Ocean Drive', 'Miami', 'Florida', 'USA', 'Luxurious sea-facing residential apartments', 3, 10, 6, 25.7617, -80.1918, 'Pool, Gym, Parking, 24/7 Security, Wi-Fi'],
    ['Oakwood Business Plaza', 'OBP-02', 'Commercial', '500 Corporate Way', 'Austin', 'Texas', 'USA', 'Premium office spaces in the tech hub', 3, 5, 3, 30.2672, -97.7431, 'Fiber Internet, Conference Rooms, Cafeteria, Receptionist, Parking'],
    ['Sunset Villas', 'SV-03', 'Villa', '77 Scenic Route', 'Malibu', 'California', 'USA', 'Private bungalows and duplex villas', 3, 2, 2, 34.0259, -118.7798, 'Private Garden, Swimming Pool, Smart Home, Beach View']
  ];

  for (const p of propertiesData) {
    await client.query("INSERT INTO properties (name, code, type, address, city, state, country, description, owner_id, floors, units_count, gps_lat, gps_lng, amenities) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)", p);
  }

  // 4. Insert Units
  const unitsData = [
    [1, '101', 1, 2, 2, 1800.0, 1800.0, 150.0, 'Occupied'],
    [1, '102', 1, 2, 1.5, 1600.0, 1600.0, 150.0, 'Occupied'],
    [1, '201', 2, 3, 2.5, 2500.0, 2500.0, 200.0, 'Occupied'],
    [1, '202', 2, 1, 1, 1200.0, 1200.0, 100.0, 'Vacant'],
    [1, '301', 3, 3, 3, 3200.0, 3200.0, 250.0, 'Reserved'],
    [1, '302', 3, 2, 2, 1900.0, 1900.0, 150.0, 'Under Maintenance'],
    [2, 'Suite A', 1, 0, 2, 4500.0, 9000.0, 500.0, 'Vacant'],
    [2, 'Suite B', 2, 0, 2, 5500.0, 11000.0, 600.0, 'Vacant'],
    [2, 'Suite C', 3, 0, 4, 8500.0, 17000.0, 900.0, 'Vacant'],
    [3, 'Villa Alpha', 1, 4, 4.5, 6000.0, 6000.0, 400.0, 'Vacant'],
    [3, 'Villa Beta', 2, 3, 3.5, 5200.0, 5200.0, 350.0, 'Vacant']
  ];

  for (const u of unitsData) {
    await client.query("INSERT INTO units (property_id, unit_number, floor, bedrooms, bathrooms, monthly_rent, deposit, service_charge, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)", u);
  }

  // 5. Insert Tenants (user_id 7, 8, 9)
  const dummyPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const dummyJpgBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

  const tenantsData = [
    [7, 'NID-987654', 'PPT-A123456', '1995-08-10', 'Freelance Photographer', 'Self Employed', JSON.stringify({ name: 'May Parker', phone: '+15550888', relation: 'Aunt' }), JSON.stringify({ name: 'J. Jonah Jameson', phone: '+15550999', income: 80000 }), 'data:image/png;base64,mockSignaturePeterParker...'],
    [8, 'NID-876543', 'PPT-B765432', '1996-03-22', 'Broadway Actress', 'Manhattan Theatre Co', JSON.stringify({ name: 'Mrs. Watson', phone: '+15550889', relation: 'Mother' }), JSON.stringify({ name: 'Harry Osborn', phone: '+15550990', income: 150000 }), 'data:image/png;base64,mockSignatureMaryJane...'],
    [9, 'NID-765432', 'PPT-C987654', '1985-05-29', 'Tech Executive', 'Stark Industries', JSON.stringify({ name: 'Pepper Potts', phone: '+15550890', relation: 'Spouse' }), JSON.stringify({ name: 'Happy Hogan', phone: '+15550991', income: 500000 }), 'data:image/png;base64,mockSignatureTonyStark...']
  ];

  for (const t of tenantsData) {
    await client.query("INSERT INTO tenants (user_id, national_id, passport_number, dob, occupation, employer, emergency_contact, guarantor, digital_signature) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)", t);
  }

  // 6. Insert Leases
  const leasesData = [
    [1, 1, '2025-06-01', '2026-06-01', 1800.0, 1800.0, 'Active', dummyPngBase64, 'Standard 1-year residential lease. No smoking, no pets without prior approval.'],
    [2, 2, '2025-09-01', '2026-09-01', 1600.0, 1600.0, 'Active', dummyPngBase64, 'Standard 1-year residential lease. Quiet hours after 10 PM.'],
    [3, 3, '2024-01-01', '2024-12-31', 2400.0, 2400.0, 'Expired', dummyPngBase64, 'Legacy lease agreement.'],
    [3, 3, '2025-01-01', '2026-12-31', 2500.0, 2500.0, 'Active', dummyPngBase64, 'Premium 2-year residential lease agreement with smart automation access rights.']
  ];

  for (const l of leasesData) {
    await client.query("INSERT INTO leases (unit_id, tenant_id, start_date, end_date, rent_amount, deposit_amount, status, signature_path, terms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)", l);
  }

  // 7. Insert Invoices & Payments
  const invoicesData = [
    [1, 'INV-2026-04-01', '2026-04', 1800.0, 100.0, 0.0, 1900.0, 1900.0, 'Paid', '2026-04-05'],
    [1, 'INV-2026-05-01', '2026-05', 1800.0, 120.0, 0.0, 1920.0, 1920.0, 'Paid', '2026-05-05'],
    [1, 'INV-2026-06-01', '2026-06', 1800.0, 110.0, 0.0, 1910.0, 0.0, 'Overdue', '2026-06-05'],
    [2, 'INV-2026-04-02', '2026-04', 1600.0, 80.0, 0.0, 1680.0, 1680.0, 'Paid', '2026-04-05'],
    [2, 'INV-2026-05-02', '2026-05', 1600.0, 95.0, 0.0, 1695.0, 1695.0, 'Paid', '2026-05-05'],
    [2, 'INV-2026-06-02', '2026-06', 1600.0, 85.0, 0.0, 1685.0, 1000.0, 'Partially Paid', '2026-06-05'],
    [4, 'INV-2026-04-03', '2026-04', 2500.0, 300.0, 0.0, 2800.0, 2800.0, 'Paid', '2026-04-05'],
    [4, 'INV-2026-05-03', '2026-05', 2500.0, 320.0, 0.0, 2820.0, 2820.0, 'Paid', '2026-05-05'],
    [4, 'INV-2026-06-03', '2026-06', 2500.0, 290.0, 0.0, 2790.0, 2790.0, 'Paid', '2026-06-05']
  ];

  for (const inv of invoicesData) {
    await client.query("INSERT INTO invoices (lease_id, invoice_number, billing_period, rent_due, utilities_due, penalties, total_due, paid_amount, status, due_date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", inv);
  }

  const paymentsData = [
    [1, 'Bank Transfer', 1900.0, 'TXN-PETER-APRIL', '2026-04-04', 'REC-10001'],
    [2, 'Credit Card', 1920.0, 'TXN-PETER-MAY', '2026-05-03', 'REC-10002'],
    [4, 'Bank Transfer', 1680.0, 'TXN-MJ-APRIL', '2026-04-03', 'REC-10003'],
    [5, 'Mobile Money', 1695.0, 'TXN-MJ-MAY', '2026-05-04', 'REC-10004'],
    [6, 'Cash', 1000.0, 'TXN-MJ-JUNE-CASH', '2026-06-04', 'REC-10005'],
    [7, 'Online Payment Gateway', 2800.0, 'TXN-STARK-APRIL', '2026-04-01', 'REC-10006'],
    [8, 'Online Payment Gateway', 2820.0, 'TXN-STARK-MAY', '2026-05-02', 'REC-10007'],
    [9, 'Online Payment Gateway', 2790.0, 'TXN-STARK-JUNE', '2026-06-01', 'REC-10008']
  ];

  for (const py of paymentsData) {
    await client.query("INSERT INTO payments (invoice_id, payment_method, amount, transaction_reference, payment_date, receipt_number) VALUES ($1, $2, $3, $4, $5, $6)", py);
  }

  // 8. Maintenance Requests
  const maintenanceData = [
    [1, 1, 'Plumbing', 'Leaking kitchen faucet needs replacement.', 'Medium', 'Completed', dummyJpgBase64, dummyJpgBase64, 5, '2026-05-10', '2026-05-12'],
    [2, 2, 'Electrical', 'Living room ceiling fan spark on turn-on.', 'High', 'In Progress', dummyJpgBase64, null, 5, '2026-06-20', null],
    [1, 1, 'Carpentry', 'Front door lock jammed, difficult to insert key.', 'High', 'Pending', null, null, null, '2026-06-25', null],
    [3, 3, 'Security', 'Digital intercom screen not responding.', 'Low', 'Assigned', null, null, 5, '2026-06-26', null]
  ];

  for (const m of maintenanceData) {
    await client.query("INSERT INTO maintenance_requests (unit_id, tenant_id, category, description, priority, status, image_before, image_after, assigned_officer_id, created_at, completed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)", m);
  }

  // 9. Expenses
  const expensesData = [
    [1, 'Repairs', 150.0, 'Purchased premium brass kitchen faucet for Unit 101', '2026-05-11', 2, dummyJpgBase64],
    [1, 'Cleaning', 300.0, 'Bi-weekly lobby and elevator deep cleaning service', '2026-06-01', 2, null],
    [2, 'Salaries', 2500.0, 'Staff salary payout - Receptionist and Maintenance Officer', '2026-06-05', 4, null],
    [3, 'Insurance', 1200.0, 'Annual property structural fire insurance - Sunset Villas', '2026-04-15', 3, dummyJpgBase64],
    [1, 'Electricity', 450.0, 'Common area power grid utility bill', '2026-06-10', 4, null]
  ];

  for (const e of expensesData) {
    await client.query("INSERT INTO expenses (property_id, category, amount, description, expense_date, recorded_by, receipt_path) VALUES ($1, $2, $3, $4, $5, $6, $7)", e);
  }

  // 10. Visitor Log
  const visitorsData = [
    ['Gwen Stacy', '+15551111', 1, 'Project study meeting', '2026-06-25 14:00:00', '2026-06-25 18:30:00', 6],
    ['Otto Octavius', '+15552222', 1, 'Delivery of private packages', '2026-06-26 10:15:00', null, 6],
    ['Norman Osborn', '+15553333', 3, 'Business collaboration discussion', '2026-06-26 09:00:00', '2026-06-26 10:00:00', 6]
  ];

  for (const v of visitorsData) {
    await client.query("INSERT INTO visitor_log (visitor_name, phone_number, host_tenant_id, purpose, check_in, check_out, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)", v);
  }

  // 11. Utilities
  const utilitiesData = [
    [1, 'Water', '2026-06-01', 1500.0, 1550.0, 1.2, 60.0, 'Billed'],
    [1, 'Electricity', '2026-06-01', 8200.0, 8450.0, 0.2, 50.0, 'Billed'],
    [2, 'Water', '2026-06-01', 950.0, 990.0, 1.2, 48.0, 'Billed'],
    [2, 'Electricity', '2026-06-01', 4100.0, 4280.0, 0.2, 36.0, 'Billed'],
    [3, 'Water', '2026-06-01', 3200.0, 3350.0, 1.2, 180.0, 'Billed'],
    [3, 'Electricity', '2026-06-01', 12500.0, 13050.0, 0.2, 110.0, 'Billed'],
    [1, 'Water', '2026-06-25', 1550.0, 1585.0, 1.2, 42.0, 'Pending'],
    [1, 'Electricity', '2026-06-25', 8450.0, 8690.0, 0.2, 48.0, 'Pending']
  ];

  for (const ut of utilitiesData) {
    await client.query("INSERT INTO utilities (unit_id, utility_type, reading_date, previous_reading, current_reading, rate, amount, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", ut);
  }

  // 12. Audit Logs
  const auditData = [
    [1, 'DATABASE_SEED', 'Successfully seeded Rental Management System with initial data structures and roles.', '127.0.0.1'],
    [3, 'CREATE_LEASE', 'Landlord Bruce Wayne signed a 2-year lease with Tenant Tony Stark for Unit 201.', '127.0.0.1'],
    [4, 'RECORD_EXPENSE', 'Accountant Clark Kent recorded common area power grid bill expense (GH₵450).', '127.0.0.1']
  ];

  for (const a of auditData) {
    await client.query("INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)", a);
  }

  console.log("Database seeded successfully!");
}

module.exports = {
  db,
  initDatabase
};
