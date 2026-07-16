const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const dotenv = require('dotenv');
const Stripe = require('stripe');
const { db, initDatabase } = require('./database');

dotenv.config();

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = Stripe(process.env.STRIPE_SECRET_KEY);
} else {
  console.warn('WARNING: STRIPE_SECRET_KEY is not defined in the environment. Stripe features will be unavailable.');
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_rental_key_2026';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Helper to convert uploaded files to Base64 data URIs
const fileToBase64 = (file) => {
  if (!file) return null;
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
};

// Configure Multer for file uploads in memory
const upload = multer({ storage: multer.memoryStorage() });

// Serves the public/ directory as static files
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiter helper for Login
const loginAttempts = {};
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 mins
const MAX_LOGIN_ATTEMPTS = 10;

function rateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  if (!loginAttempts[ip]) {
    loginAttempts[ip] = [];
  }
  loginAttempts[ip] = loginAttempts[ip].filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  if (loginAttempts[ip].length >= MAX_LOGIN_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again after 15 minutes.' });
  }
  next();
}

// Audit logger helper
function logAudit(userId, action, details, req) {
  const ip = req ? req.ip : '127.0.0.1';
  db.run(
    'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
    [userId, action, details, ip],
    (err) => {
      if (err) console.error('Failed to log audit:', err);
    }
  );
}

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(410).json({ error: 'Access token missing' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = decoded;
    next();
  });
}

// Role authorization middleware
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Unauthorized: Access denied for your user role.' });
    }
    next();
  };
}

app.get('/api/test-db', (req, res) => {
  db.all('SELECT 1 + 1 AS result', [], (err, rows) => {
    if (err) {
      return res.status(500).json({
        success: false,
        error: err.message,
        stack: err.stack,
        envKeys: Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('POSTGRES'))
      });
    }
    res.json({
      success: true,
      result: rows,
      envKeys: Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('POSTGRES'))
    });
  });
});

// ==========================================
// API ROUTES: AUTHENTICATION
// ==========================================

app.post('/api/auth/login', rateLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username.toLowerCase().trim()], (err, user) => {
    if (err) {
      console.error('Login DB Error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!user) {
      // Record failed attempt
      loginAttempts[req.ip].push(Date.now());
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = bcrypt.compareSync(password, user.password_hash);
    if (!isValid) {
      loginAttempts[req.ip].push(Date.now());
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email, role: user.role, name: user.full_name },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Audit Log
    logAudit(user.id, 'USER_LOGIN', `User ${user.username} logged in successfully.`, req);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        full_name: user.full_name,
        phone: user.phone,
        is_verified: user.is_verified
      }
    });
  });
});

app.post('/api/auth/register', (req, res) => {
  const { username, email, password, full_name, phone, role } = req.body;
  if (!username || !email || !password || !full_name || !role) {
    return res.status(400).json({ error: 'All fields (username, email, password, full_name, role) are required' });
  }
  const allowedRoles = ['Tenant', 'Landlord', 'Property Manager'];
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid registration role specified' });
  }

  db.serialize(() => {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    db.run(
      `INSERT INTO users (username, email, password_hash, role, full_name, phone, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [username.toLowerCase().trim(), email.toLowerCase().trim(), passwordHash, role, full_name, phone],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username or Email already registered' });
          }
          return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        const newUserId = this.lastID;

        // If registering as a Tenant, provision tenant profile
        if (role === 'Tenant') {
          db.run('INSERT INTO tenants (user_id) VALUES (?)', [newUserId], function(err) {
            if (err) {
              db.run('DELETE FROM users WHERE id = ?', [newUserId]);
              return res.status(500).json({ error: 'Failed to create tenant profile' });
            }
            completeRegistration();
          });
        } else {
          completeRegistration();
        }

        function completeRegistration() {
          logAudit(newUserId, 'USER_REGISTER', `User self-registered as ${role}.`, req);
          const token = jwt.sign(
            { id: newUserId, username: username.toLowerCase().trim(), email: email.toLowerCase().trim(), role, name: full_name },
            JWT_SECRET,
            { expiresIn: '8h' }
          );
          res.status(201).json({
            token,
            user: {
              id: newUserId,
              username: username.toLowerCase().trim(),
              email: email.toLowerCase().trim(),
              role,
              full_name,
              phone,
              is_verified: 1
            }
          });
        }
      }
    );
  });
});

app.post('/api/auth/google-login', (req, res) => {
  const { email, name } = req.body;
  if (!email || !name) {
    return res.status(400).json({ error: 'Google email and name are required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    if (user) {
      // User already exists - generate JWT and login
      const token = jwt.sign(
        { id: user.id, username: user.username, email: user.email, role: user.role, name: user.full_name },
        JWT_SECRET,
        { expiresIn: '8h' }
      );
      logAudit(user.id, 'USER_LOGIN_GOOGLE', `User logged in via Google OAuth (${normalizedEmail}).`, req);
      return res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          full_name: user.full_name,
          phone: user.phone,
          is_verified: user.is_verified
        }
      });
    } else {
      // User does not exist - Just-In-Time (JIT) provisioning as a Tenant
      const usernameBase = normalizedEmail.split('@')[0];
      // Append random characters to guarantee username uniqueness
      const uniqueUsername = `${usernameBase}_g${Math.floor(Math.random() * 1000)}`;
      const randomPassword = Math.random().toString(36).slice(-8);
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(randomPassword, salt);

      db.serialize(() => {
        db.run(
          `INSERT INTO users (username, email, password_hash, role, full_name, is_verified)
           VALUES (?, ?, ?, 'Tenant', ?, 1)`,
          [uniqueUsername, normalizedEmail, passwordHash, name],
          function(err) {
            if (err) {
              return res.status(500).json({ error: 'Failed to JIT provision Google user: ' + err.message });
            }
            const newUserId = this.lastID;

            db.run('INSERT INTO tenants (user_id) VALUES (?)', [newUserId], function(err) {
              if (err) {
                db.run('DELETE FROM users WHERE id = ?', [newUserId]);
                return res.status(500).json({ error: 'Failed to JIT provision tenant profile' });
              }

              logAudit(newUserId, 'USER_PROVISION_GOOGLE', `Account JIT provisioned via Google Sign-In (${normalizedEmail}).`, req);
              
              const token = jwt.sign(
                { id: newUserId, username: uniqueUsername, email: normalizedEmail, role: 'Tenant', name },
                JWT_SECRET,
                { expiresIn: '8h' }
              );

              res.status(201).json({
                token,
                user: {
                  id: newUserId,
                  username: uniqueUsername,
                  email: normalizedEmail,
                  role: 'Tenant',
                  full_name: name,
                  phone: null,
                  is_verified: 1
                }
              });
            });
          }
        );
      });
    }
  });
});

app.post('/api/auth/logout', authenticateToken, (req, res) => {
  logAudit(req.user.id, 'USER_LOGOUT', `User ${req.user.username} logged out.`, req);
  res.json({ message: 'Logged out successfully' });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!user) {
      // Security practice: do not reveal user existence
      return res.json({ message: 'If the email exists, a password reset link has been sent.' });
    }
    logAudit(user.id, 'FORGOT_PASSWORD', `Password reset requested for email ${email}.`, req);
    res.json({ message: 'If the email exists, a password reset link has been sent.' });
  });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });
  // Simulated token verification
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(newPassword, salt);
  db.run('UPDATE users SET password_hash = ? WHERE username = ?', [passwordHash, 'tenant1'], (err) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ message: 'Password reset successfully' });
  });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  db.get('SELECT id, username, email, role, full_name, phone, is_verified FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(user);
  });
});

// ==========================================
// API ROUTES: DASHBOARD STATS
// ==========================================

app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
  if (req.user.role === 'Tenant') {
    db.get('SELECT id FROM tenants WHERE user_id = ?', [req.user.id], (err, tenant) => {
      if (err || !tenant) {
        return res.status(500).json({ error: 'Failed to retrieve tenant profile' });
      }
      const tenantId = tenant.id;
      const stats = { isTenant: true };

      db.serialize(() => {
        // 1. Get Active Lease
        db.get(`
          SELECT l.*, un.unit_number, pr.name as property_name 
          FROM leases l 
          JOIN units un ON l.unit_id = un.id 
          JOIN properties pr ON un.property_id = pr.id 
          WHERE l.tenant_id = ? AND l.status = 'Active'
        `, [tenantId], (err, activeLease) => {
          stats.activeLease = activeLease || null;
        });

        // 2. Get Outstanding Rent
        db.get(`
          SELECT SUM(i.total_due - i.paid_amount) as total 
          FROM invoices i 
          JOIN leases l ON i.lease_id = l.id 
          WHERE l.tenant_id = ? AND i.status IN ('Unpaid', 'Partially Paid', 'Overdue')
        `, [tenantId], (err, row) => {
          stats.outstandingRent = row ? (row.total || 0) : 0;
        });

        // 3. Get Total Rent Paid
        db.get(`
          SELECT SUM(p.amount) as total 
          FROM payments p 
          JOIN invoices i ON p.invoice_id = i.id 
          JOIN leases l ON i.lease_id = l.id 
          WHERE l.tenant_id = ?
        `, [tenantId], (err, row) => {
          stats.totalPaid = row ? (row.total || 0) : 0;
        });

        // 4. Get Pending Maintenance count
        db.get(`
          SELECT COUNT(*) as count 
          FROM maintenance_requests 
          WHERE tenant_id = ? AND status IN ('Pending', 'Assigned', 'In Progress')
        `, [tenantId], (err, row) => {
          stats.pendingMaintenance = row ? (row.count || 0) : 0;
        });

        // 5. Get Recent Payments
        db.all(`
          SELECT p.*, i.invoice_number, pr.name as property_name, un.unit_number 
          FROM payments p 
          JOIN invoices i ON p.invoice_id = i.id 
          JOIN leases l ON i.lease_id = l.id 
          JOIN units un ON l.unit_id = un.id 
          JOIN properties pr ON un.property_id = pr.id 
          WHERE l.tenant_id = ? 
          ORDER BY p.payment_date DESC LIMIT 5
        `, [tenantId], (err, payments) => {
          stats.recentPayments = payments || [];
        });

        // 6. Get Unpaid Invoices
        db.all(`
          SELECT i.*, pr.name as property_name, un.unit_number 
          FROM invoices i 
          JOIN leases l ON i.lease_id = l.id 
          JOIN units un ON l.unit_id = un.id 
          JOIN properties pr ON un.property_id = pr.id 
          WHERE l.tenant_id = ? AND i.status != 'Paid' 
          ORDER BY i.due_date ASC LIMIT 5
        `, [tenantId], (err, invoices) => {
          stats.unpaidInvoices = invoices || [];
        });

        // 7. Get Notifications
        db.all(`
          SELECT i.invoice_number, i.total_due, i.paid_amount, i.due_date
          FROM invoices i
          JOIN leases l ON i.lease_id = l.id
          WHERE l.tenant_id = ? AND i.status IN ('Unpaid', 'Partially Paid', 'Overdue')
        `, [tenantId], (err, overdue) => {
          stats.notifications = [];
          if (!err && overdue) {
            overdue.forEach(item => {
              const balance = item.total_due - item.paid_amount;
              stats.notifications.push({
                type: 'Unpaid Rent',
                message: `Invoice ${item.invoice_number} has an outstanding balance of $${balance.toFixed(2)}. Due: ${item.due_date}`,
                date: item.due_date
              });
            });
          }

          db.all(`
            SELECT l.id, pr.name as property_name, un.unit_number 
            FROM leases l 
            JOIN units un ON l.unit_id = un.id 
            JOIN properties pr ON un.property_id = pr.id 
            WHERE l.tenant_id = ? AND l.status = 'Pending'
          `, [tenantId], (err, pendingLeases) => {
            if (!err && pendingLeases) {
              pendingLeases.forEach(item => {
                stats.notifications.push({
                  type: 'Signature Required',
                  message: `Your signature is required on the lease agreement for ${item.property_name} - Unit ${item.unit_number}.`,
                  date: new Date().toISOString().split('T')[0]
                });
              });
            }

            res.json(stats);
          });
        });
      });
    });
  } else {
    const stats = {};
    const queries = [
      // 0: Total Properties
      { key: 'totalProperties', sql: 'SELECT COUNT(*) as count FROM properties' },
      // 1: Total Units
      { key: 'totalUnits', sql: 'SELECT COUNT(*) as count FROM units' },
      // 2: Occupied Units
      { key: 'occupiedUnits', sql: "SELECT COUNT(*) as count FROM units WHERE status = 'Occupied'" },
      // 3: Vacant Units
      { key: 'vacantUnits', sql: "SELECT COUNT(*) as count FROM units WHERE status = 'Vacant'" },
      // 4: Under Maintenance Units
      { key: 'maintenanceUnits', sql: "SELECT COUNT(*) as count FROM units WHERE status = 'Under Maintenance'" },
      // 5: Reserved Units
      { key: 'reservedUnits', sql: "SELECT COUNT(*) as count FROM units WHERE status = 'Reserved'" },
      // 6: Total Tenants
      { key: 'totalTenants', sql: 'SELECT COUNT(*) as count FROM tenants' },
      // 7: Active Leases
      { key: 'activeLeases', sql: "SELECT COUNT(*) as count FROM leases WHERE status = 'Active'" },
      // 8: Monthly Revenue (payments in the current month)
      { key: 'monthlyRevenue', sql: "SELECT SUM(amount) as total FROM payments WHERE strftime('%Y-%m', payment_date) = strftime('%Y-%m', 'now')" },
      // 9: Outstanding Rent
      { key: 'outstandingRent', sql: "SELECT SUM(total_due - paid_amount) as total FROM invoices WHERE status IN ('Unpaid', 'Partially Paid', 'Overdue')" },
      // 10: Pending Maintenance
      { key: 'pendingMaintenance', sql: "SELECT COUNT(*) as count FROM maintenance_requests WHERE status IN ('Pending', 'Assigned', 'In Progress')" }
    ];

    let completed = 0;
    let hasError = false;

    queries.forEach((q, idx) => {
      db.get(q.sql, [], (err, row) => {
        if (hasError) return;
        if (err) {
          hasError = true;
          return res.status(500).json({ error: 'Database error in dashboard query: ' + q.key });
        }
        stats[q.key] = row.count !== undefined ? row.count : (row.total || 0);
        completed++;

        if (completed === queries.length) {
          // Now fetch recent payments
          db.all(`
            SELECT p.*, i.invoice_number, u.full_name as tenant_name, pr.name as property_name, un.unit_number
            FROM payments p
            JOIN invoices i ON p.invoice_id = i.id
            JOIN leases l ON i.lease_id = l.id
            JOIN tenants t ON l.tenant_id = t.id
            JOIN users u ON t.user_id = u.id
            JOIN units un ON l.unit_id = un.id
            JOIN properties pr ON un.property_id = pr.id
            ORDER BY p.payment_date DESC LIMIT 5
          `, [], (err, payments) => {
            if (err) return res.status(500).json({ error: 'Failed to fetch recent payments' });
            stats.recentPayments = payments;

            // Fetch expiring leases (next 90 days)
            db.all(`
              SELECT l.*, u.full_name as tenant_name, pr.name as property_name, un.unit_number
              FROM leases l
              JOIN tenants t ON l.tenant_id = t.id
              JOIN users u ON t.user_id = u.id
              JOIN units un ON l.unit_id = un.id
              JOIN properties pr ON un.property_id = pr.id
              WHERE l.status = 'Active' AND date(l.end_date) <= date('now', '+90 days')
              ORDER BY l.end_date ASC
            `, [], (err, leases) => {
              if (err) return res.status(500).json({ error: 'Failed to fetch expiring leases' });
              stats.expiringLeases = leases;

              // Fetch dynamic notifications list
              stats.notifications = [];
              // Overdue Invoices
              db.all(`
                SELECT i.invoice_number, i.total_due, i.paid_amount, u.full_name as tenant_name, i.due_date
                FROM invoices i
                JOIN leases l ON i.lease_id = l.id
                JOIN tenants t ON l.tenant_id = t.id
                JOIN users u ON t.user_id = u.id
                WHERE i.status = 'Overdue' OR (i.status = 'Unpaid' AND date(i.due_date) < date('now'))
                LIMIT 3
              `, [], (err, overdue) => {
                if (!err && overdue) {
                  overdue.forEach(item => {
                    stats.notifications.push({
                      type: 'Overdue Rent',
                      message: `Rent invoice ${item.invoice_number} for ${item.tenant_name} is overdue. Due: ${item.due_date}. Balance: $${item.total_due - item.paid_amount}`,
                      date: item.due_date
                    });
                  });
                }

                // Maintenance notifications
                db.all(`
                  SELECT m.id, m.category, m.priority, u.full_name as tenant_name
                  FROM maintenance_requests m
                  JOIN tenants t ON m.tenant_id = t.id
                  JOIN users u ON t.user_id = u.id
                  WHERE m.status = 'Pending'
                  LIMIT 3
                `, [], (err, maintenance) => {
                  if (!err && maintenance) {
                    maintenance.forEach(item => {
                      stats.notifications.push({
                        type: 'Maintenance Request',
                        message: `New ${item.priority} priority ${item.category} request submitted by ${item.tenant_name}.`,
                        date: new Date().toISOString().split('T')[0]
                      });
                    });
                  }

                  // Chart data: Monthly Revenue (past 6 months)
                  db.all(`
                    SELECT strftime('%Y-%m', payment_date) as month, SUM(amount) as revenue
                    FROM payments
                    WHERE date(payment_date) >= date('now', '-6 months')
                    GROUP BY month
                    ORDER BY month ASC
                  `, [], (err, revenueChart) => {
                    stats.revenueChart = revenueChart || [];

                    // Chart data: Property Occupancy
                    db.all(`
                      SELECT p.name, 
                             SUM(CASE WHEN u.status = 'Occupied' THEN 1 ELSE 0 END) as occupied,
                             SUM(CASE WHEN u.status = 'Vacant' THEN 1 ELSE 0 END) as vacant
                      FROM properties p
                      LEFT JOIN units u ON p.id = u.property_id
                      GROUP BY p.name
                    `, [], (err, occupancyChart) => {
                      stats.occupancyChart = occupancyChart || [];
                      res.json(stats);
                    });
                  });
                });
              });
            });
          });
        }
      });
    });
  }
});

// ==========================================
// API ROUTES: PROPERTIES
// ==========================================

app.get('/api/properties', authenticateToken, (req, res) => {
  const { search, type, city } = req.query;
  let sql = `
    SELECT p.*, u.full_name as owner_name, 
           COUNT(un.id) as total_units_db,
           SUM(CASE WHEN un.status = 'Occupied' THEN 1 ELSE 0 END) as occupied_units_db
    FROM properties p
    LEFT JOIN users u ON p.owner_id = u.id
    LEFT JOIN units un ON p.id = un.property_id
  `;
  const params = [];
  const clauses = [];

  if (search) {
    clauses.push('(p.name LIKE ? OR p.code LIKE ? OR p.address LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (type) {
    clauses.push('p.type = ?');
    params.push(type);
  }
  if (city) {
    clauses.push('p.city = ?');
    params.push(city);
  }

  if (clauses.length > 0) {
    sql += ' WHERE ' + clauses.join(' AND ');
  }
  sql += ' GROUP BY p.id';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.get('/api/properties/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.get(`
    SELECT p.*, u.full_name as owner_name
    FROM properties p
    LEFT JOIN users u ON p.owner_id = u.id
    WHERE p.id = ?
  `, [id], (err, property) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!property) return res.status(404).json({ error: 'Property not found' });

    // Fetch associated units
    db.all('SELECT * FROM units WHERE property_id = ?', [id], (err, units) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch property units' });
      property.units = units;
      res.json(property);
    });
  });
});

app.post('/api/properties', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord']), (req, res) => {
  const { name, code, type, address, city, state, country, description, owner_id, floors, units_count, gps_lat, gps_lng, amenities, images, videos, bank_name, bank_account, mobile_money_number, online_gateway_secret, online_gateway_publishable, online_gateway_type, credit_card_details } = req.body;
  if (!name || !code || !type || !address || !city || !state || !country || !floors || !units_count) {
    return res.status(400).json({ error: 'All fields (name, code, type, address, city, state, country, floors, units_count) are required' });
  }

  db.run(`
    INSERT INTO properties (name, code, type, address, city, state, country, description, owner_id, floors, units_count, gps_lat, gps_lng, amenities, images, videos, bank_name, bank_account, mobile_money_number, online_gateway_secret, online_gateway_publishable, online_gateway_type, credit_card_details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [name, code, type, address, city, state, country, description, owner_id || req.user.id, floors, units_count, gps_lat, gps_lng, amenities, images || '[]', videos || '[]', bank_name || null, bank_account || null, mobile_money_number || null, online_gateway_secret || null, online_gateway_publishable || null, online_gateway_type || 'stripe', credit_card_details || null], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Property Code already exists' });
      }
      return res.status(500).json({ error: 'Database error: ' + err.message });
    }
    logAudit(req.user.id, 'CREATE_PROPERTY', `Created property: ${name} (${code})`, req);
    res.status(201).json({ id: this.lastID, message: 'Property created successfully' });
  });
});

app.put('/api/properties/:id', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord']), (req, res) => {
  const { id } = req.params;
  const { name, code, type, address, city, state, country, description, owner_id, floors, units_count, gps_lat, gps_lng, amenities, images, videos, bank_name, bank_account, mobile_money_number, online_gateway_secret, online_gateway_publishable, online_gateway_type, credit_card_details } = req.body;

  db.run(`
    UPDATE properties
    SET name = ?, code = ?, type = ?, address = ?, city = ?, state = ?, country = ?, description = ?, owner_id = ?, floors = ?, units_count = ?, gps_lat = ?, gps_lng = ?, amenities = ?, images = ?, videos = ?, bank_name = ?, bank_account = ?, mobile_money_number = ?, online_gateway_secret = ?, online_gateway_publishable = ?, online_gateway_type = ?, credit_card_details = ?
    WHERE id = ?
  `, [name, code, type, address, city, state, country, description, owner_id, floors, units_count, gps_lat, gps_lng, amenities, images || '[]', videos || '[]', bank_name || null, bank_account || null, mobile_money_number || null, online_gateway_secret || null, online_gateway_publishable || null, online_gateway_type || 'stripe', credit_card_details || null, id], function(err) {
    if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Property not found' });
    logAudit(req.user.id, 'UPDATE_PROPERTY', `Updated property: ${name} (ID: ${id})`, req);
    res.json({ message: 'Property updated successfully' });
  });
});

app.delete('/api/properties/:id', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord']), (req, res) => {
  const { id } = req.params;
  // Check if properties have occupied units before deleting
  db.get("SELECT COUNT(*) as count FROM units WHERE property_id = ? AND status = 'Occupied'", [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (row.count > 0) {
      return res.status(400).json({ error: 'Cannot delete property. It has active occupied rental units.' });
    }

    db.run('DELETE FROM properties WHERE id = ?', [id], function(err) {
      if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Property not found' });
      logAudit(req.user.id, 'DELETE_PROPERTY', `Deleted property ID: ${id}`, req);
      res.json({ message: 'Property deleted successfully' });
    });
  });
});

app.post('/api/upload-media', authenticateToken, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const filepath = fileToBase64(req.file);
  res.json({ filepath });
});

// ==========================================
// API ROUTES: UNITS
// ==========================================

app.get('/api/units', authenticateToken, (req, res) => {
  const { property_id, status, search } = req.query;
  let sql = `
    SELECT u.*, p.name as property_name
    FROM units u
    JOIN properties p ON u.property_id = p.id
  `;
  const params = [];
  const clauses = [];

  if (property_id) {
    clauses.push('u.property_id = ?');
    params.push(property_id);
  }
  if (status) {
    clauses.push('u.status = ?');
    params.push(status);
  }
  if (search) {
    clauses.push('(u.unit_number LIKE ? OR p.name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  if (clauses.length > 0) {
    sql += ' WHERE ' + clauses.join(' AND ');
  }
  sql += ' ORDER BY p.name ASC, u.floor ASC, u.unit_number ASC';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.get('/api/units/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.get(`
    SELECT u.*, p.name as property_name, p.address as property_address
    FROM units u
    JOIN properties p ON u.property_id = p.id
    WHERE u.id = ?
  `, [id], (err, unit) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    // Fetch unit rental history
    db.all(`
      SELECT l.*, us.full_name as tenant_name, us.email as tenant_email
      FROM leases l
      JOIN tenants t ON l.tenant_id = t.id
      JOIN users us ON t.user_id = us.id
      WHERE l.unit_id = ?
      ORDER BY l.start_date DESC
    `, [id], (err, history) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch unit rental history' });
      unit.history = history;
      res.json(unit);
    });
  });
});

app.post('/api/units', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord']), (req, res) => {
  const { property_id, unit_number, floor, bedrooms, bathrooms, monthly_rent, deposit, service_charge, status } = req.body;
  if (!property_id || !unit_number || floor === undefined || !bedrooms || !bathrooms || !monthly_rent || !deposit) {
    return res.status(400).json({ error: 'Required fields: property_id, unit_number, floor, bedrooms, bathrooms, monthly_rent, deposit' });
  }

  db.run(`
    INSERT INTO units (property_id, unit_number, floor, bedrooms, bathrooms, monthly_rent, deposit, service_charge, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [property_id, unit_number, floor, bedrooms, bathrooms, monthly_rent, deposit, service_charge || 0, status || 'Vacant'], function(err) {
    if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
    logAudit(req.user.id, 'CREATE_UNIT', `Created unit: ${unit_number} (Property ID: ${property_id})`, req);
    res.status(201).json({ id: this.lastID, message: 'Unit created successfully' });
  });
});

app.put('/api/units/:id', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord']), (req, res) => {
  const { id } = req.params;
  const { unit_number, floor, bedrooms, bathrooms, monthly_rent, deposit, service_charge, status } = req.body;

  db.run(`
    UPDATE units
    SET unit_number = ?, floor = ?, bedrooms = ?, bathrooms = ?, monthly_rent = ?, deposit = ?, service_charge = ?, status = ?
    WHERE id = ?
  `, [unit_number, floor, bedrooms, bathrooms, monthly_rent, deposit, service_charge, status, id], function(err) {
    if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Unit not found' });
    logAudit(req.user.id, 'UPDATE_UNIT', `Updated unit: ${unit_number} (ID: ${id})`, req);
    res.json({ message: 'Unit updated successfully' });
  });
});

app.delete('/api/units/:id', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord']), (req, res) => {
  const { id } = req.params;
  db.get('SELECT status FROM units WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Unit not found' });
    if (row.status === 'Occupied') {
      return res.status(400).json({ error: 'Cannot delete unit. It is currently occupied.' });
    }

    db.run('DELETE FROM units WHERE id = ?', [id], function(err) {
      if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
      logAudit(req.user.id, 'DELETE_UNIT', `Deleted unit ID: ${id}`, req);
      res.json({ message: 'Unit deleted successfully' });
    });
  });
});

// ==========================================
// API ROUTES: TENANTS
// ==========================================

app.get('/api/tenants', authenticateToken, (req, res) => {
  const { search } = req.query;
  let sql = `
    SELECT t.*, u.full_name, u.email, u.phone, u.username,
           un.unit_number, pr.name as property_name, l.status as lease_status
    FROM tenants t
    JOIN users u ON t.user_id = u.id
    LEFT JOIN leases l ON t.id = l.tenant_id AND l.status = 'Active'
    LEFT JOIN units un ON l.unit_id = un.id
    LEFT JOIN properties pr ON un.property_id = pr.id
  `;
  const params = [];

  if (search) {
    sql += ' WHERE (u.full_name LIKE ? OR u.email LIKE ? OR t.national_id LIKE ? OR un.unit_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.get('/api/tenants/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.get(`
    SELECT t.*, u.full_name, u.email, u.phone, u.username, u.is_verified
    FROM tenants t
    JOIN users u ON t.user_id = u.id
    WHERE t.id = ?
  `, [id], (err, tenant) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // Fetch lease details
    db.get(`
      SELECT l.*, un.unit_number, pr.name as property_name
      FROM leases l
      JOIN units un ON l.unit_id = un.id
      JOIN properties pr ON un.property_id = pr.id
      WHERE l.tenant_id = ? AND l.status = 'Active'
    `, [id], (err, lease) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch lease details' });
      tenant.activeLease = lease || null;
      res.json(tenant);
    });
  });
});

app.post('/api/tenants', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Receptionist']), (req, res) => {
  const { username, email, password, full_name, phone, national_id, passport_number, dob, occupation, employer, emergency_contact, guarantor } = req.body;
  if (!username || !email || !password || !full_name) {
    return res.status(400).json({ error: 'Username, Email, Password, and Full Name are required' });
  }

  // Transaction-like execution
  db.serialize(() => {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    db.run(
      `INSERT INTO users (username, email, password_hash, role, full_name, phone, is_verified)
       VALUES (?, ?, ?, 'Tenant', ?, ?, 1)`,
      [username.toLowerCase().trim(), email.toLowerCase().trim(), passwordHash, full_name, phone],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username or Email already exists' });
          }
          return res.status(500).json({ error: 'Database error creating user: ' + err.message });
        }
        const newUserId = this.lastID;

        db.run(
          `INSERT INTO tenants (user_id, national_id, passport_number, dob, occupation, employer, emergency_contact, guarantor)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [newUserId, national_id, passport_number, dob, occupation, employer,
           typeof emergency_contact === 'object' ? JSON.stringify(emergency_contact) : emergency_contact,
           typeof guarantor === 'object' ? JSON.stringify(guarantor) : guarantor],
          function(err) {
            if (err) {
              // Rollback user
              db.run('DELETE FROM users WHERE id = ?', [newUserId]);
              return res.status(500).json({ error: 'Database error creating tenant profile: ' + err.message });
            }
            logAudit(req.user.id, 'CREATE_TENANT', `Created tenant: ${full_name} (User ID: ${newUserId}, Tenant ID: ${this.lastID})`, req);
            res.status(201).json({ id: this.lastID, userId: newUserId, message: 'Tenant created successfully' });
          }
        );
      }
    );
  });
});

app.put('/api/tenants/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { full_name, phone, email, national_id, passport_number, dob, occupation, employer, emergency_contact, guarantor } = req.body;

  // Verify access (Tenant can only edit their own profile, managers can edit anyone's)
  db.get('SELECT user_id FROM tenants WHERE id = ?', [id], (err, tenant) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    if (req.user.role === 'Tenant' && req.user.id !== tenant.user_id) {
      return res.status(403).json({ error: 'Unauthorized: You can only edit your own profile.' });
    }

    db.serialize(() => {
      db.run('UPDATE users SET full_name = ?, phone = ?, email = ? WHERE id = ?', [full_name, phone, email, tenant.user_id]);
      db.run(`
        UPDATE tenants
        SET national_id = ?, passport_number = ?, dob = ?, occupation = ?, employer = ?, emergency_contact = ?, guarantor = ?
        WHERE id = ?
      `, [national_id, passport_number, dob, occupation, employer,
          typeof emergency_contact === 'object' ? JSON.stringify(emergency_contact) : emergency_contact,
          typeof guarantor === 'object' ? JSON.stringify(guarantor) : guarantor,
          id], (err) => {
            if (err) return res.status(500).json({ error: 'Database error updating tenant profile: ' + err.message });
            logAudit(req.user.id, 'UPDATE_TENANT', `Updated profile for tenant ID: ${id}`, req);
            res.json({ message: 'Profile updated successfully' });
          });
    });
  });
});

// ==========================================
// API ROUTES: LEASES
// ==========================================

app.get('/api/leases', authenticateToken, (req, res) => {
  // Tenants can only see their own lease(s)
  let sql = `
    SELECT l.*, un.unit_number, pr.name as property_name, u.full_name as tenant_name
    FROM leases l
    JOIN units un ON l.unit_id = un.id
    JOIN properties pr ON un.property_id = pr.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN users u ON t.user_id = u.id
  `;
  const params = [];

  if (req.user.role === 'Tenant') {
    sql += ' WHERE t.user_id = ?';
    params.push(req.user.id);
  }
  sql += ' ORDER BY l.start_date DESC';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.get('/api/leases/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.get(`
    SELECT l.*, un.unit_number, pr.name as property_name, pr.address as property_address, pr.city as property_city, pr.state as property_state, pr.country as property_country,
           u.full_name as tenant_name, u.email as tenant_email, u.phone as tenant_phone
    FROM leases l
    JOIN units un ON l.unit_id = un.id
    JOIN properties pr ON un.property_id = pr.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN users u ON t.user_id = u.id
    WHERE l.id = ?
  `, [id], (err, lease) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!lease) return res.status(404).json({ error: 'Lease not found' });

    if (req.user.role === 'Tenant') {
      // Check ownership
      db.get('SELECT user_id FROM tenants WHERE id = ?', [lease.tenant_id], (err, tenant) => {
        if (req.user.id !== tenant.user_id) {
          return res.status(403).json({ error: 'Access denied to this lease agreement.' });
        }
        res.json(lease);
      });
    } else {
      res.json(lease);
    }
  });
});

app.post('/api/leases', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord']), (req, res) => {
  const { unit_id, tenant_id, start_date, end_date, rent_amount, deposit_amount, terms } = req.body;
  if (!unit_id || !tenant_id || !start_date || !end_date || !rent_amount || !deposit_amount) {
    return res.status(400).json({ error: 'Required fields: unit_id, tenant_id, start_date, end_date, rent_amount, deposit_amount' });
  }

  // Create lease with status 'Pending' (waiting for tenant signature)
  db.run(`
    INSERT INTO leases (unit_id, tenant_id, start_date, end_date, rent_amount, deposit_amount, status, terms)
    VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)
  `, [unit_id, tenant_id, start_date, end_date, rent_amount, deposit_amount, terms], function(err) {
    if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
    const leaseId = this.lastID;

    // Update unit status to Reserved (meaning waiting for final lease completion)
    db.run("UPDATE units SET status = 'Reserved' WHERE id = ?", [unit_id]);

    logAudit(req.user.id, 'CREATE_LEASE', `Created pending lease ID: ${leaseId} for Unit: ${unit_id}`, req);
    res.status(201).json({ id: leaseId, message: 'Lease created successfully. Awaiting tenant signature.' });
  });
});

app.post('/api/leases/apply', authenticateToken, requireRole(['Tenant']), (req, res) => {
  const { unit_id, start_date, end_date, terms } = req.body;
  if (!unit_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'Required fields: unit_id, start_date, end_date' });
  }

  db.get('SELECT id FROM tenants WHERE user_id = ?', [req.user.id], (err, tenant) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!tenant) return res.status(400).json({ error: 'Tenant profile not found for this user.' });

    db.get('SELECT * FROM units WHERE id = ?', [unit_id], (err, unit) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!unit) return res.status(404).json({ error: 'Unit not found.' });
      if (unit.status !== 'Vacant') {
        return res.status(400).json({ error: 'This unit is not vacant.' });
      }

      const tenant_id = tenant.id;
      const rent_amount = unit.monthly_rent;
      const deposit_amount = unit.deposit;

      db.run(`
        INSERT INTO leases (unit_id, tenant_id, start_date, end_date, rent_amount, deposit_amount, status, terms)
        VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)
      `, [unit_id, tenant_id, start_date, end_date, rent_amount, deposit_amount, terms], function(err) {
        if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
        const leaseId = this.lastID;

        db.run("UPDATE units SET status = 'Reserved' WHERE id = ?", [unit_id]);

        logAudit(req.user.id, 'APPLY_LEASE', `Tenant applied for lease ID: ${leaseId} for Unit: ${unit_id}`, req);
        res.status(201).json({ id: leaseId, message: 'Application submitted successfully. Awaiting your digital signature.' });
      });
    });
  });
});

app.post('/api/leases/:id/sign', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { signature_data } = req.body; // Base64 signature
  if (!signature_data) return res.status(400).json({ error: 'Signature image data is required' });

  db.get('SELECT l.*, t.user_id FROM leases l JOIN tenants t ON l.tenant_id = t.id WHERE l.id = ?', [id], (err, lease) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!lease) return res.status(404).json({ error: 'Lease not found' });

    if (req.user.role === 'Tenant' && req.user.id !== lease.user_id) {
      return res.status(403).json({ error: 'Unauthorized: You can only sign your own lease.' });
    }

    db.serialize(() => {
      // Update lease to Active and store signature path
      db.run(
        "UPDATE leases SET status = 'Active', signature_path = ? WHERE id = ?",
        [signature_data, id]
      );
      // Update unit to Occupied
      db.run("UPDATE units SET status = 'Occupied' WHERE id = ?", [lease.unit_id]);
      // Update tenant's profile digital signature
      db.run("UPDATE tenants SET digital_signature = ? WHERE id = ?", [signature_data, lease.tenant_id]);

      // Generate immediate first rent invoice
      const invNum = `INV-LSE-${id}-${Date.now().toString().slice(-4)}`;
      const billPeriod = new Date().toISOString().slice(0, 7);
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7); // Due in 7 days
      const dueDateStr = dueDate.toISOString().split('T')[0];
      const total = lease.rent_amount + lease.deposit_amount;

      db.run(`
        INSERT INTO invoices (lease_id, invoice_number, billing_period, rent_due, penalties, total_due, paid_amount, status, due_date)
        VALUES (?, ?, ?, ?, 0.0, ?, 0.0, 'Unpaid', ?)
      `, [id, invNum, billPeriod, lease.rent_amount, total, dueDateStr]);

      logAudit(req.user.id, 'SIGN_LEASE', `Lease signed and activated (ID: ${id})`, req);
      res.json({ message: 'Lease agreement signed and activated successfully. First invoice generated.' });
    });
  });
});

// ==========================================
// API ROUTES: INVOICES & UTILITY BILLING
// ==========================================

app.get('/api/invoices', authenticateToken, (req, res) => {
  let sql = `
    SELECT i.*, l.rent_amount, un.unit_number, pr.name as property_name, u.full_name as tenant_name, t.id as tenant_id
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN units un ON l.unit_id = un.id
    JOIN properties pr ON un.property_id = pr.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN users u ON t.user_id = u.id
  `;
  const params = [];

  if (req.user.role === 'Tenant') {
    sql += ' WHERE u.id = ?';
    params.push(req.user.id);
  }
  sql += ' ORDER BY i.due_date DESC';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.get('/api/invoices/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.get(`
    SELECT i.*, un.unit_number, pr.name as property_name, pr.address as property_address, pr.city as property_city, pr.state as property_state,
           u.full_name as tenant_name, u.email as tenant_email, u.phone as tenant_phone, l.rent_amount, l.deposit_amount
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN units un ON l.unit_id = un.id
    JOIN properties pr ON un.property_id = pr.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN users u ON t.user_id = u.id
    WHERE i.id = ?
  `, [id], (err, invoice) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  });
});

app.post('/api/invoices', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Accountant']), (req, res) => {
  const { lease_id, billing_period, rent_due, utilities_due, penalties, due_date } = req.body;
  if (!lease_id || !billing_period || rent_due === undefined || !due_date) {
    return res.status(400).json({ error: 'Required: lease_id, billing_period, rent_due, due_date' });
  }

  const invoice_number = `INV-GEN-${Date.now().toString().slice(-6)}`;
  const total_due = parseFloat(rent_due) + parseFloat(utilities_due || 0) + parseFloat(penalties || 0);

  db.run(`
    INSERT INTO invoices (lease_id, invoice_number, billing_period, rent_due, utilities_due, penalties, total_due, paid_amount, status, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0.0, 'Unpaid', ?)
  `, [lease_id, invoice_number, billing_period, rent_due, utilities_due || 0, penalties || 0, total_due, due_date], function(err) {
    if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
    logAudit(req.user.id, 'CREATE_INVOICE', `Generated invoice: ${invoice_number} (Lease ID: ${lease_id})`, req);
    res.status(201).json({ id: this.lastID, message: 'Invoice generated successfully' });
  });
});

app.put('/api/invoices/:id/late-fees', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Accountant']), (req, res) => {
  const { id } = req.params;
  const { penalties } = req.body;
  if (penalties === undefined) return res.status(400).json({ error: 'Penalties amount required' });

  db.get('SELECT * FROM invoices WHERE id = ?', [id], (err, invoice) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const diff = parseFloat(penalties) - invoice.penalties;
    const newTotal = invoice.total_due + diff;

    db.run(
      "UPDATE invoices SET penalties = ?, total_due = ? WHERE id = ?",
      [penalties, newTotal, id],
      function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        logAudit(req.user.id, 'APPLY_PENALTY', `Applied penalty to Invoice ID: ${id} ($${penalties})`, req);
        res.json({ message: 'Late fees/penalties updated successfully' });
      }
    );
  });
});

// ==========================================
// API ROUTES: PAYMENTS
// ==========================================

app.get('/api/payments', authenticateToken, (req, res) => {
  let sql = `
    SELECT p.*, i.invoice_number, u.full_name as tenant_name, pr.name as property_name, un.unit_number
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id
    JOIN leases l ON i.lease_id = l.id
    JOIN tenants t ON l.tenant_id = t.id
    JOIN users u ON t.user_id = u.id
    JOIN units un ON l.unit_id = un.id
    JOIN properties pr ON un.property_id = pr.id
  `;
  const params = [];

  if (req.user.role === 'Tenant') {
    sql += ' WHERE u.id = ?';
    params.push(req.user.id);
  }
  sql += ' ORDER BY p.payment_date DESC';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.post('/api/payments', authenticateToken, (req, res) => {
  const { invoice_id, payment_method, amount, transaction_reference } = req.body;
  if (!invoice_id || !payment_method || !amount) {
    return res.status(400).json({ error: 'Required fields: invoice_id, payment_method, amount' });
  }

  db.get('SELECT * FROM invoices WHERE id = ?', [invoice_id], (err, invoice) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    // Validate ownership if tenant
    if (req.user.role === 'Tenant') {
      // Fetch user ID of tenant linked to invoice
      db.get(`
        SELECT u.id as user_id FROM invoices i
        JOIN leases l ON i.lease_id = l.id
        JOIN tenants t ON l.tenant_id = t.id
        JOIN users u ON t.user_id = u.id
        WHERE i.id = ?
      `, [invoice_id], (err, owner) => {
        if (err || !owner || owner.user_id !== req.user.id) {
          return res.status(403).json({ error: 'Unauthorized: You can only pay invoices billed to you.' });
        }
        processPayment();
      });
    } else {
      processPayment();
    }

    function processPayment() {
      const payAmount = parseFloat(amount);
      const newPaid = invoice.paid_amount + payAmount;
      let status = 'Partially Paid';
      if (newPaid >= invoice.total_due) {
        status = 'Paid';
      }

      const receiptNumber = `REC-${Date.now().toString().slice(-6)}`;

      db.serialize(() => {
        // Record payment
        db.run(`
          INSERT INTO payments (invoice_id, payment_method, amount, transaction_reference, receipt_number)
          VALUES (?, ?, ?, ?, ?)
        `, [invoice_id, payment_method, payAmount, transaction_reference, receiptNumber]);

        // Update invoice paid amount and status
        db.run(
          'UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?',
          [newPaid, status, invoice_id]
        );

        logAudit(req.user.id, 'RECORD_PAYMENT', `Recorded payment $${payAmount} for Invoice ID: ${invoice_id}`, req);
        res.status(201).json({ receipt_number: receiptNumber, message: 'Payment recorded successfully' });
      });
    }
  });
});

app.post('/api/payments/checkout-session', authenticateToken, (req, res) => {
  const { invoice_id, amount } = req.body;
  if (!invoice_id) {
    return res.status(400).json({ error: 'invoice_id is required' });
  }

  db.get('SELECT * FROM invoices WHERE id = ?', [invoice_id], (err, invoice) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const outstanding = invoice.total_due - invoice.paid_amount;
    const payAmount = amount ? parseFloat(amount) : outstanding;

    if (payAmount <= 0) {
      return res.status(400).json({ error: 'Invoice is already fully paid or payment amount is invalid.' });
    }

    const processCheckout = () => {
      // Find the landlord's online gateway settings for this invoice
      db.get(`
        SELECT 
          CASE 
            WHEN p.online_gateway_secret IS NOT NULL THEN p.online_gateway_secret 
            ELSE lps.online_gateway_secret 
          END as online_gateway_secret,
          CASE 
            WHEN p.online_gateway_secret IS NOT NULL THEN p.online_gateway_type 
            ELSE lps.online_gateway_type 
          END as online_gateway_type
        FROM invoices i
        JOIN leases l ON i.lease_id = l.id
        JOIN units un ON l.unit_id = un.id
        JOIN properties p ON un.property_id = p.id
        LEFT JOIN landlord_payment_settings lps ON p.owner_id = lps.landlord_id
        WHERE i.id = ?
      `, [invoice_id], (err, settings) => {
        if (err) return res.status(500).json({ error: 'Database error fetching settings' });

        const gatewayType = (settings && settings.online_gateway_type) || 'stripe';

        // Determine origin/referer to redirect back correctly
        let origin = req.headers.origin || req.headers.referer;
        if (origin) {
          try {
            const parsedUrl = new URL(origin);
            origin = parsedUrl.origin;
          } catch (e) {
            origin = 'http://localhost:3000';
          }
        } else {
          origin = 'http://localhost:3000';
        }

        if (gatewayType === 'paystack') {
          const secretKey = (settings && settings.online_gateway_secret) || process.env.PAYSTACK_SECRET_KEY;
          if (!secretKey) {
            return res.status(501).json({ error: 'Paystack is not configured on this server.' });
          }

          if (process.env.NODE_ENV === 'test') {
            const mockRef = `paystack_mock_${Date.now()}`;
            return res.json({ url: `${origin}/payment-success.html?session_id=${mockRef}&invoice_id=${invoice_id}&gateway=paystack` });
          }

          // Fetch the tenant's email address
          db.get(`
            SELECT u.email FROM invoices i
            JOIN leases l ON i.lease_id = l.id
            JOIN tenants t ON l.tenant_id = t.id
            JOIN users u ON t.user_id = u.id
            WHERE i.id = ?
          `, [invoice_id], (err, tenantUser) => {
            if (err || !tenantUser) {
              return res.status(500).json({ error: 'Database error fetching tenant email' });
            }

            const reference = `paystack_${invoice_id}_${Date.now()}`;
            const paystackPayload = {
              email: tenantUser.email,
              amount: Math.round(payAmount * 100), // amount in kobo/cents
              callback_url: `${origin}/payment-success.html?session_id=${reference}&invoice_id=${invoice_id}&gateway=paystack`,
              reference: reference,
              metadata: {
                invoice_id: invoice_id.toString(),
                amount: payAmount.toFixed(2),
                user_id: req.user.id.toString(),
                gateway: 'paystack'
              }
            };

            // Call Paystack Initialize Transaction endpoint
            fetch('https://api.paystack.co/transaction/initialize', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${secretKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(paystackPayload)
            })
            .then(paystackRes => {
              if (!paystackRes.ok) {
                return paystackRes.text().then(text => {
                  throw new Error(`Paystack error: ${text}`);
                });
              }
              return paystackRes.json();
            })
            .then(paystackData => {
              if (paystackData.status && paystackData.data && paystackData.data.authorization_url) {
                res.json({ url: paystackData.data.authorization_url });
              } else {
                res.status(500).json({ error: 'Failed to initialize Paystack checkout' });
              }
            })
            .catch(paystackErr => {
              console.error('Paystack error:', paystackErr);
              res.status(500).json({ error: `Paystack Checkout creation failed: ${paystackErr.message}` });
            });
          });
        } else {
          let activeStripe = stripe;
          if (settings && settings.online_gateway_secret) {
            activeStripe = Stripe(settings.online_gateway_secret);
          }

          if (!activeStripe) {
            return res.status(501).json({ error: 'Stripe is not configured on this server.' });
          }

          activeStripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
              price_data: {
                currency: 'usd',
                product_data: {
                  name: `Rent Payment - Invoice ${invoice.invoice_number}`,
                  description: `Outstanding balance: $${outstanding.toFixed(2)}`,
                },
                unit_amount: Math.round(payAmount * 100), // amount in cents
              },
              quantity: 1,
            }],
            mode: 'payment',
            success_url: `${origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoice.id}`,
            cancel_url: `${origin}/index.html`,
            metadata: {
              invoice_id: invoice.id.toString(),
              amount: payAmount.toFixed(2),
              user_id: req.user.id.toString()
            }
          }).then(session => {
            res.json({ url: session.url });
          }).catch(stripeErr => {
            console.error('Stripe error:', stripeErr);
            res.status(500).json({ error: `Stripe Checkout Session creation failed: ${stripeErr.message}` });
          });
        }
      });
    };

    // Validate ownership if tenant
    if (req.user.role === 'Tenant') {
      db.get(`
        SELECT u.id as user_id FROM invoices i
        JOIN leases l ON i.lease_id = l.id
        JOIN tenants t ON l.tenant_id = t.id
        JOIN users u ON t.user_id = u.id
        WHERE i.id = ?
      `, [invoice_id], (err, owner) => {
        if (err || !owner || owner.user_id !== req.user.id) {
          return res.status(403).json({ error: 'Unauthorized: You can only pay invoices billed to you.' });
        }
        processCheckout();
      });
    } else {
      processCheckout();
    }
  });
});

app.post('/api/payments/verify-checkout-session', authenticateToken, (req, res) => {
  const { session_id, invoice_id } = req.body;
  if (!session_id) {
    return res.status(400).json({ error: 'session_id is required' });
  }

  // We need to fetch the gateway settings for this invoice (if invoice_id is provided)
  const getGatewaySettings = (callback) => {
    if (!invoice_id) {
      // Default fallback if no invoice ID is provided
      return callback(null, { online_gateway_type: 'stripe', online_gateway_secret: process.env.STRIPE_SECRET_KEY });
    }
    db.get(`
      SELECT 
        CASE 
          WHEN p.online_gateway_secret IS NOT NULL THEN p.online_gateway_secret 
          ELSE lps.online_gateway_secret 
        END as online_gateway_secret,
        CASE 
          WHEN p.online_gateway_secret IS NOT NULL THEN p.online_gateway_type 
          ELSE lps.online_gateway_type 
        END as online_gateway_type
      FROM invoices i
      JOIN leases l ON i.lease_id = l.id
      JOIN units un ON l.unit_id = un.id
      JOIN properties p ON un.property_id = p.id
      LEFT JOIN landlord_payment_settings lps ON p.owner_id = lps.landlord_id
      WHERE i.id = ?
    `, [invoice_id], (err, settings) => {
      if (err) return callback(err);
      callback(null, settings);
    });
  };

  const registerSuccessfulPayment = (inv_id, payAmount, txRef) => {
    db.get('SELECT * FROM payments WHERE transaction_reference = ?', [txRef], (err, existingPayment) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (existingPayment) {
        return res.json({
          receipt_number: existingPayment.receipt_number,
          message: 'Payment already registered previously.'
        });
      }

      db.get('SELECT * FROM invoices WHERE id = ?', [inv_id], (err, invoice) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

        const newPaid = invoice.paid_amount + payAmount;
        let status = 'Partially Paid';
        if (newPaid >= invoice.total_due) {
          status = 'Paid';
        }

        const receiptNumber = `REC-${Date.now().toString().slice(-6)}`;

        db.serialize(() => {
          db.run(`
            INSERT INTO payments (invoice_id, payment_method, amount, transaction_reference, receipt_number)
            VALUES (?, ?, ?, ?, ?)
          `, [inv_id, 'Online Payment Gateway', payAmount, txRef, receiptNumber]);

          db.run(
            'UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?',
            [newPaid, status, inv_id]
          );

          logAudit(req.user.id, 'RECORD_PAYMENT', `Online Payment $${payAmount} processed for Invoice ID: ${inv_id}`, req);
          res.status(201).json({ receipt_number: receiptNumber, message: 'Payment recorded successfully' });
        });
      });
    });
  };

  getGatewaySettings((err, settings) => {
    if (err) return res.status(500).json({ error: 'Database error fetching settings' });

    const gatewayType = (settings && settings.online_gateway_type) || 'stripe';

    if (gatewayType === 'paystack') {
      const secretKey = (settings && settings.online_gateway_secret) || process.env.PAYSTACK_SECRET_KEY;
      if (!secretKey) {
        return res.status(501).json({ error: 'Paystack is not configured on this server.' });
      }

      if (process.env.NODE_ENV === 'test') {
        const inv_id = parseInt(invoice_id || '1');
        const payAmount = 100.0;
        const txRef = `paystack_mock_${session_id}`;
        return registerSuccessfulPayment(inv_id, payAmount, txRef);
      }

      // Verify transaction with Paystack API
      fetch(`https://api.paystack.co/transaction/verify/${session_id}`, {
        headers: {
          'Authorization': `Bearer ${secretKey}`
        }
      })
      .then(paystackRes => {
        if (!paystackRes.ok) {
          return paystackRes.text().then(text => {
            throw new Error(`Paystack verification failed: ${text}`);
          });
        }
        return paystackRes.json();
      })
      .then(paystackData => {
        if (!paystackData.status || paystackData.data.status !== 'success') {
          return res.status(400).json({ error: 'Paystack transaction is not successful.' });
        }

        const inv_id = parseInt(paystackData.data.metadata.invoice_id);
        const payAmount = parseFloat(paystackData.data.metadata.amount);
        const txRef = `paystack_${paystackData.data.reference}`;

        registerSuccessfulPayment(inv_id, payAmount, txRef);
      })
      .catch(paystackErr => {
        console.error('Paystack verification error:', paystackErr);
        res.status(500).json({ error: `Failed to verify Paystack session: ${paystackErr.message}` });
      });

    } else {
      // Stripe flow
      const secretKey = (settings && settings.online_gateway_secret) || process.env.STRIPE_SECRET_KEY;
      let activeStripe = stripe;
      if (secretKey) {
        activeStripe = Stripe(secretKey);
      }

      if (!activeStripe) {
        return res.status(501).json({ error: 'Stripe is not configured on this server.' });
      }

      activeStripe.checkout.sessions.retrieve(session_id)
        .then(session => {
          if (session.payment_status !== 'paid') {
            return res.status(400).json({ error: 'Stripe Checkout Session is not completed/paid.' });
          }

          const inv_id = parseInt(session.metadata.invoice_id);
          const payAmount = parseFloat(session.metadata.amount);
          const txRef = `stripe_${session.id}`;

          registerSuccessfulPayment(inv_id, payAmount, txRef);
        })
        .catch(stripeErr => {
          console.error('Stripe retrieval error:', stripeErr);
          res.status(500).json({ error: `Failed to verify checkout session: ${stripeErr.message}` });
        });
    }
  });
});

// ==========================================
// API ROUTES: MAINTENANCE
// ==========================================

app.get('/api/maintenance', authenticateToken, (req, res) => {
  let sql = `
    SELECT m.*, un.unit_number, pr.name as property_name, u.full_name as tenant_name, t.id as tenant_id,
           mo.full_name as officer_name
    FROM maintenance_requests m
    JOIN units un ON m.unit_id = un.id
    JOIN properties pr ON un.property_id = pr.id
    JOIN tenants t ON m.tenant_id = t.id
    JOIN users u ON t.user_id = u.id
    LEFT JOIN users mo ON m.assigned_officer_id = mo.id
  `;
  const params = [];
  const clauses = [];

  if (req.user.role === 'Tenant') {
    clauses.push('u.id = ?');
    params.push(req.user.id);
  } else if (req.user.role === 'Maintenance Officer') {
    clauses.push('m.assigned_officer_id = ?');
    params.push(req.user.id);
  }

  const { status, priority, category } = req.query;
  if (status) {
    clauses.push('m.status = ?');
    params.push(status);
  }
  if (priority) {
    clauses.push('m.priority = ?');
    params.push(priority);
  }
  if (category) {
    clauses.push('m.category = ?');
    params.push(category);
  }

  if (clauses.length > 0) {
    sql += ' WHERE ' + clauses.join(' AND ');
  }
  sql += ' ORDER BY m.created_at DESC';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

// Create Maintenance Ticket (Tenants can upload image_before)
app.post('/api/maintenance', authenticateToken, upload.single('image_before'), (req, res) => {
  const { category, description, priority } = req.body;
  if (!category || !description) {
    return res.status(400).json({ error: 'Category and description are required' });
  }

  // Find tenant ID and Unit ID for logged in tenant
  db.get(`
    SELECT t.id as tenant_id, l.unit_id
    FROM tenants t
    JOIN leases l ON t.id = l.tenant_id AND l.status = 'Active'
    WHERE t.user_id = ?
  `, [req.user.id], (err, lease) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!lease) return res.status(400).json({ error: 'You must have an active lease to submit maintenance tickets.' });

    const filepath = fileToBase64(req.file);

    db.run(`
      INSERT INTO maintenance_requests (unit_id, tenant_id, category, description, priority, status, image_before)
      VALUES (?, ?, ?, ?, ?, 'Pending', ?)
    `, [lease.unit_id, lease.tenant_id, category, description, priority || 'Low', filepath], function(err) {
      if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
      logAudit(req.user.id, 'MAINTENANCE_SUBMIT', `Submitted maintenance ticket ID: ${this.lastID}`, req);
      res.status(201).json({ id: this.lastID, message: 'Maintenance request submitted successfully.' });
    });
  });
});

// Update Maintenance ticket status, assign officer, or add finished photo (image_after)
app.put('/api/maintenance/:id', authenticateToken, upload.single('image_after'), (req, res) => {
  const { id } = req.params;
  const { status, assigned_officer_id, priority, description } = req.body;

  db.get('SELECT * FROM maintenance_requests WHERE id = ?', [id], (err, request) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!request) return res.status(404).json({ error: 'Maintenance ticket not found' });

    // Validate role permissions
    // Maintenance Officer can only update Status to In Progress or Completed
    if (req.user.role === 'Maintenance Officer' && request.assigned_officer_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: You are not assigned to this ticket.' });
    }

    let query = 'UPDATE maintenance_requests SET status = ?';
    const params = [status || request.status];

    if (assigned_officer_id !== undefined) {
      query += ', assigned_officer_id = ?';
      params.push(assigned_officer_id || null);
    }
    if (priority !== undefined) {
      query += ', priority = ?';
      params.push(priority);
    }
    if (description !== undefined) {
      query += ', description = ?';
      params.push(description);
    }

    if (req.file) {
      query += ', image_after = ?';
      params.push(fileToBase64(req.file));
    }

    if (status === 'Completed') {
      query += ', completed_at = CURRENT_TIMESTAMP';
    }

    query += ' WHERE id = ?';
    params.push(id);

    db.run(query, params, function(err) {
      if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
      logAudit(req.user.id, 'MAINTENANCE_UPDATE', `Updated maintenance ticket ID: ${id} to ${status || request.status}`, req);
      res.json({ message: 'Maintenance request updated successfully' });
    });
  });
});

// ==========================================
// API ROUTES: EXPENSES
// ==========================================

app.get('/api/expenses', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord', 'Accountant']), (req, res) => {
  db.all(`
    SELECT e.*, p.name as property_name, u.full_name as recorded_by_name
    FROM expenses e
    JOIN properties p ON e.property_id = p.id
    JOIN users u ON e.recorded_by = u.id
    ORDER BY e.expense_date DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.post('/api/expenses', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord', 'Accountant']), upload.single('receipt'), (req, res) => {
  const { property_id, category, amount, description, expense_date } = req.body;
  if (!property_id || !category || !amount || !description || !expense_date) {
    return res.status(400).json({ error: 'Required fields: property_id, category, amount, description, expense_date' });
  }

  const filepath = fileToBase64(req.file);

  db.run(`
    INSERT INTO expenses (property_id, category, amount, description, expense_date, recorded_by, receipt_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [property_id, category, amount, description, expense_date, req.user.id, filepath], function(err) {
    if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
    logAudit(req.user.id, 'RECORD_EXPENSE', `Recorded expense $${amount} under ${category} for Property ID: ${property_id}`, req);
    res.status(201).json({ id: this.lastID, message: 'Expense logged successfully' });
  });
});

// ==========================================
// API ROUTES: UTILITIES
// ==========================================

app.get('/api/utilities', authenticateToken, (req, res) => {
  let sql = `
    SELECT ut.*, un.unit_number, pr.name as property_name, u.full_name as tenant_name, u.id as tenant_user_id
    FROM utilities ut
    JOIN units un ON ut.unit_id = un.id
    JOIN properties pr ON un.property_id = pr.id
    LEFT JOIN leases l ON un.id = l.unit_id AND l.status = 'Active'
    LEFT JOIN tenants t ON l.tenant_id = t.id
    LEFT JOIN users u ON t.user_id = u.id
  `;
  const params = [];

  if (req.user.role === 'Tenant') {
    sql += ' WHERE u.id = ?';
    params.push(req.user.id);
  }
  sql += ' ORDER BY ut.reading_date DESC';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.post('/api/utilities', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord', 'Accountant']), (req, res) => {
  const { unit_id, utility_type, reading_date, previous_reading, current_reading, rate } = req.body;
  if (!unit_id || !utility_type || !reading_date || previous_reading === undefined || current_reading === undefined || !rate) {
    return res.status(400).json({ error: 'Required fields: unit_id, utility_type, reading_date, previous_reading, current_reading, rate' });
  }

  const prev = parseFloat(previous_reading);
  const curr = parseFloat(current_reading);
  if (curr < prev) return res.status(400).json({ error: 'Current reading cannot be lower than previous reading' });

  const amount = (curr - prev) * parseFloat(rate);

  db.run(`
    INSERT INTO utilities (unit_id, utility_type, reading_date, previous_reading, current_reading, rate, amount, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')
  `, [unit_id, utility_type, reading_date, prev, curr, rate, amount], function(err) {
    if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
    logAudit(req.user.id, 'RECORD_UTILITY', `Logged utility reading for Unit: ${unit_id} ($${amount})`, req);
    res.status(201).json({ id: this.lastID, amount, message: 'Utility reading recorded' });
  });
});

// Bill a utility reading (generates an invoice for the tenant)
app.post('/api/utilities/:id/bill', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Accountant']), (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM utilities WHERE id = ?', [id], (err, util) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!util) return res.status(404).json({ error: 'Utility reading not found' });
    if (util.status === 'Billed') return res.status(400).json({ error: 'This reading has already been billed.' });

    // Fetch active lease for this unit
    db.get('SELECT * FROM leases WHERE unit_id = ? AND status = "Active"', [util.unit_id], (err, lease) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!lease) return res.status(400).json({ error: 'No active lease on this unit. Cannot bill.' });

      const invoice_number = `INV-UTIL-${Date.now().toString().slice(-6)}`;
      const billing_period = util.reading_date.slice(0, 7);
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7);
      const dueDateStr = dueDate.toISOString().split('T')[0];

      db.serialize(() => {
        // Create invoice
        db.run(`
          INSERT INTO invoices (lease_id, invoice_number, billing_period, rent_due, utilities_due, total_due, paid_amount, status, due_date)
          VALUES (?, ?, ?, 0.0, ?, ?, 0.0, 'Unpaid', ?)
        `, [lease.id, invoice_number, billing_period, util.amount, util.amount, dueDateStr]);

        // Mark utility status as Billed
        db.run('UPDATE utilities SET status = "Billed" WHERE id = ?', [id]);

        logAudit(req.user.id, 'BILL_UTILITY', `Billed utility reading ID ${id} to Invoice: ${invoice_number}`, req);
        res.json({ message: 'Utility billed successfully. Invoice generated.' });
      });
    });
  });
});

// ==========================================
// API ROUTES: VISITORS
// ==========================================

app.get('/api/visitors', authenticateToken, (req, res) => {
  let sql = `
    SELECT v.*, u.full_name as host_name, un.unit_number, pr.name as property_name, rec.full_name as created_by_name
    FROM visitor_log v
    JOIN tenants t ON v.host_tenant_id = t.id
    JOIN users u ON t.user_id = u.id
    JOIN leases l ON t.id = l.tenant_id AND l.status = 'Active'
    JOIN units un ON l.unit_id = un.id
    JOIN properties pr ON un.property_id = pr.id
    JOIN users rec ON v.created_by = rec.id
  `;
  const params = [];

  if (req.user.role === 'Tenant') {
    sql += ' WHERE u.id = ?';
    params.push(req.user.id);
  }
  sql += ' ORDER BY v.check_in DESC';

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.post('/api/visitors', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Receptionist']), (req, res) => {
  const { visitor_name, phone_number, host_tenant_id, purpose } = req.body;
  if (!visitor_name || !phone_number || !host_tenant_id || !purpose) {
    return res.status(400).json({ error: 'Required fields: visitor_name, phone_number, host_tenant_id, purpose' });
  }

  db.run(`
    INSERT INTO visitor_log (visitor_name, phone_number, host_tenant_id, purpose, check_in, created_by)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
  `, [visitor_name, phone_number, host_tenant_id, purpose, req.user.id], function(err) {
    if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
    logAudit(req.user.id, 'VISITOR_CHECKIN', `Checked in visitor: ${visitor_name} to Tenant ID: ${host_tenant_id}`, req);
    res.status(201).json({ id: this.lastID, message: 'Visitor checked in successfully.' });
  });
});

app.put('/api/visitors/:id/checkout', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Receptionist']), (req, res) => {
  const { id } = req.params;
  db.run('UPDATE visitor_log SET check_out = CURRENT_TIMESTAMP WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (this.changes === 0) return res.status(404).json({ error: 'Visitor record not found' });
    logAudit(req.user.id, 'VISITOR_CHECKOUT', `Checked out visitor log ID: ${id}`, req);
    res.json({ message: 'Visitor checked out successfully.' });
  });
});

// ==========================================
// API ROUTES: REPORTS
// ==========================================

app.get('/api/reports/revenue', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord', 'Accountant']), (req, res) => {
  db.all(`
    SELECT strftime('%Y-%m', payment_date) as month, payment_method, SUM(amount) as revenue
    FROM payments
    GROUP BY month, payment_method
    ORDER BY month DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.get('/api/reports/expenses', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord', 'Accountant']), (req, res) => {
  db.all(`
    SELECT strftime('%Y-%m', expense_date) as month, category, SUM(amount) as total
    FROM expenses
    GROUP BY month, category
    ORDER BY month DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.get('/api/reports/profit-loss', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord', 'Accountant']), (req, res) => {
  db.all(`
    SELECT strftime('%Y-%m', payment_date) as month, 'Revenue' as type, SUM(amount) as amount
    FROM payments
    GROUP BY month
    UNION ALL
    SELECT strftime('%Y-%m', expense_date) as month, 'Expense' as type, SUM(amount) as amount
    FROM expenses
    GROUP BY month
    ORDER BY month DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    // Pivot table month -> revenue/expense
    const summary = {};
    rows.forEach(r => {
      if (!summary[r.month]) {
        summary[r.month] = { month: r.month, revenue: 0, expenses: 0, net_profit: 0 };
      }
      if (r.type === 'Revenue') {
        summary[r.month].revenue = r.amount;
      } else {
        summary[r.month].expenses = r.amount;
      }
      summary[r.month].net_profit = summary[r.month].revenue - summary[r.month].expenses;
    });

    res.json(Object.values(summary));
  });
});

// ==========================================
// API ROUTES: AUDIT LOGS (Super Admin only)
// ==========================================

app.get('/api/audit-logs', authenticateToken, requireRole(['Super Admin']), (req, res) => {
  db.all(`
    SELECT a.*, u.username, u.role
    FROM audit_logs a
    LEFT JOIN users u ON a.user_id = u.id
    ORDER BY a.created_at DESC LIMIT 100
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

// ==========================================
// API ROUTES: GLOBAL SEARCH
// ==========================================

app.get('/api/search', authenticateToken, (req, res) => {
  const { query } = req.query;
  if (!query || query.trim() === '') {
    return res.json({ properties: [], units: [], tenants: [], leases: [], maintenance: [], expenses: [] });
  }

  const term = `%${query}%`;
  const results = {};
  let completed = 0;

  // Query 1: Properties
  db.all('SELECT id, name, code, type, city FROM properties WHERE name LIKE ? OR code LIKE ? OR city LIKE ? LIMIT 5', [term, term, term], (err, rows) => {
    results.properties = rows || [];
    checkFinish();
  });

  // Query 2: Units
  db.all(`
    SELECT u.id, u.unit_number, u.status, p.name as property_name 
    FROM units u 
    JOIN properties p ON u.property_id = p.id 
    WHERE u.unit_number LIKE ? OR p.name LIKE ? LIMIT 5
  `, [term, term], (err, rows) => {
    results.units = rows || [];
    checkFinish();
  });

  // Query 3: Tenants
  db.all(`
    SELECT t.id, us.full_name, us.email, t.national_id 
    FROM tenants t 
    JOIN users us ON t.user_id = us.id 
    WHERE us.full_name LIKE ? OR us.email LIKE ? OR t.national_id LIKE ? LIMIT 5
  `, [term, term, term], (err, rows) => {
    results.tenants = rows || [];
    checkFinish();
  });

  // Query 4: Leases
  db.all(`
    SELECT l.id, un.unit_number, us.full_name as tenant_name, l.status 
    FROM leases l 
    JOIN units un ON l.unit_id = un.id 
    JOIN tenants t ON l.tenant_id = t.id 
    JOIN users us ON t.user_id = us.id 
    WHERE us.full_name LIKE ? OR un.unit_number LIKE ? LIMIT 5
  `, [term, term], (err, rows) => {
    results.leases = rows || [];
    checkFinish();
  });

  // Query 5: Maintenance
  db.all(`
    SELECT m.id, m.category, m.priority, m.status, un.unit_number 
    FROM maintenance_requests m 
    JOIN units un ON m.unit_id = un.id 
    WHERE m.description LIKE ? OR m.category LIKE ? OR un.unit_number LIKE ? LIMIT 5
  `, [term, term, term], (err, rows) => {
    results.maintenance = rows || [];
    checkFinish();
  });

  // Query 6: Expenses (restricted roles only)
  if (['Super Admin', 'Property Manager', 'Landlord', 'Accountant'].includes(req.user.role)) {
    db.all(`
      SELECT e.id, e.category, e.amount, e.expense_date, p.name as property_name 
      FROM expenses e 
      JOIN properties p ON e.property_id = p.id 
      WHERE e.description LIKE ? OR e.category LIKE ? LIMIT 5
    `, [term, term], (err, rows) => {
      results.expenses = rows || [];
      checkFinish();
    });
  } else {
    results.expenses = [];
    checkFinish();
  }

  function checkFinish() {
    completed++;
    if (completed === 6) {
      res.json(results);
    }
  }
});

// ==========================================
// API ROUTES: LANDLORD PAYMENT SETTINGS
// ==========================================

app.get('/api/landlord/payment-settings', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord']), (req, res) => {
  db.get('SELECT * FROM landlord_payment_settings WHERE landlord_id = ?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(row || {});
  });
});

app.post('/api/landlord/payment-settings', authenticateToken, requireRole(['Super Admin', 'Property Manager', 'Landlord']), (req, res) => {
  const { bank_name, bank_account, mobile_money_number, online_gateway_secret, online_gateway_publishable, online_gateway_type, credit_card_details } = req.body;
  
  db.get('SELECT id FROM landlord_payment_settings WHERE landlord_id = ?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (row) {
      db.run(`
        UPDATE landlord_payment_settings
        SET bank_name = ?, bank_account = ?, mobile_money_number = ?, online_gateway_secret = ?, online_gateway_publishable = ?, online_gateway_type = ?, credit_card_details = ?
        WHERE landlord_id = ?
      `, [bank_name, bank_account, mobile_money_number, online_gateway_secret, online_gateway_publishable, online_gateway_type || 'stripe', credit_card_details, req.user.id], function(err) {
        if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
        res.json({ message: 'Payment settings updated successfully' });
      });
    } else {
      db.run(`
        INSERT INTO landlord_payment_settings (landlord_id, bank_name, bank_account, mobile_money_number, online_gateway_secret, online_gateway_publishable, online_gateway_type, credit_card_details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [req.user.id, bank_name, bank_account, mobile_money_number, online_gateway_secret, online_gateway_publishable, online_gateway_type || 'stripe', credit_card_details], function(err) {
        if (err) return res.status(500).json({ error: 'Database error: ' + err.message });
        res.status(201).json({ message: 'Payment settings created successfully' });
      });
    }
  });
});

app.get('/api/invoices/:id/landlord-payment-settings', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.get(`
    SELECT 
      COALESCE(p.bank_name, lps.bank_name) as bank_name,
      COALESCE(p.bank_account, lps.bank_account) as bank_account,
      COALESCE(p.mobile_money_number, lps.mobile_money_number) as mobile_money_number,
      COALESCE(p.online_gateway_publishable, lps.online_gateway_publishable) as online_gateway_publishable,
      CASE 
        WHEN p.online_gateway_publishable IS NOT NULL THEN p.online_gateway_type 
        ELSE lps.online_gateway_type 
      END as online_gateway_type,
      COALESCE(p.credit_card_details, lps.credit_card_details) as credit_card_details
    FROM invoices i
    JOIN leases l ON i.lease_id = l.id
    JOIN units un ON l.unit_id = un.id
    JOIN properties p ON un.property_id = p.id
    LEFT JOIN landlord_payment_settings lps ON p.owner_id = lps.landlord_id
    WHERE i.id = ?
  `, [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(row || {});
  });
});

// Fallback: serves index.html for any frontend SPA route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize database
initDatabase()
  .then(() => {
    console.log('Database initialized successfully.');
  })
  .catch((err) => {
    console.error('Database initialization failed:', err);
  });

// Start listening if not running in a serverless environment (like Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Rental Management System server is active at: http://localhost:${PORT}`);
  });
}

module.exports = app;
