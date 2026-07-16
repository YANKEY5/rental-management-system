// ==========================================================================
// AuraRent - Client Side SPA JavaScript Controller
// ==========================================================================

// Global Application State
const state = {
  token: localStorage.getItem('aura_token') || null,
  user: JSON.parse(localStorage.getItem('aura_user')) || null,
  activeView: 'dashboard',
  charts: {},
  map: null,
  toastTimeout: null
};

// Canvas Signature Pad state
let isDrawing = false;
let sigCanvas = null;
let sigCtx = null;

// Property Media Form State
let propertyFormMedia = {
  existingImages: [],
  existingVideos: [],
  newImages: [],
  newVideos: []
};

// Render media previews inside Property Modal
function renderPropertyMediaPreviews() {
  const imagesPreview = document.getElementById('prop-images-preview');
  const videosPreview = document.getElementById('prop-videos-preview');
  
  if (!imagesPreview || !videosPreview) return;
  
  imagesPreview.innerHTML = '';
  videosPreview.innerHTML = '';
  
  // Existing images
  propertyFormMedia.existingImages.forEach((imgSrc, index) => {
    const item = document.createElement('div');
    item.className = 'media-preview-item';
    item.style.cssText = 'position:relative; width:80px; height:80px; border-radius:4px; overflow:hidden; border:1px solid var(--border-color);';
    item.innerHTML = `
      <img src="${imgSrc}" style="width:100%; height:100%; object-fit:cover;">
      <button type="button" class="remove-btn" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.6); color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center;" onclick="removePropertyFormMedia('existingImages', ${index})">&times;</button>
    `;
    imagesPreview.appendChild(item);
  });
  
  // New images
  propertyFormMedia.newImages.forEach((file, index) => {
    const objectUrl = URL.createObjectURL(file);
    const item = document.createElement('div');
    item.className = 'media-preview-item';
    item.style.cssText = 'position:relative; width:80px; height:80px; border-radius:4px; overflow:hidden; border:1px solid var(--border-color);';
    item.innerHTML = `
      <img src="${objectUrl}" style="width:100%; height:100%; object-fit:cover;">
      <button type="button" class="remove-btn" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.6); color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center;" onclick="removePropertyFormMedia('newImages', ${index})">&times;</button>
    `;
    imagesPreview.appendChild(item);
  });
  
  // Existing videos
  propertyFormMedia.existingVideos.forEach((vidSrc, index) => {
    const item = document.createElement('div');
    item.className = 'media-preview-item';
    item.style.cssText = 'position:relative; width:80px; height:80px; border-radius:4px; overflow:hidden; border:1px solid var(--border-color); background:#000;';
    item.innerHTML = `
      <video src="${vidSrc}" style="width:100%; height:100%; object-fit:cover;"></video>
      <button type="button" class="remove-btn" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.6); color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center;" onclick="removePropertyFormMedia('existingVideos', ${index})">&times;</button>
    `;
    videosPreview.appendChild(item);
  });
  
  // New videos
  propertyFormMedia.newVideos.forEach((file, index) => {
    const objectUrl = URL.createObjectURL(file);
    const item = document.createElement('div');
    item.className = 'media-preview-item';
    item.style.cssText = 'position:relative; width:80px; height:80px; border-radius:4px; overflow:hidden; border:1px solid var(--border-color); background:#000;';
    item.innerHTML = `
      <video src="${objectUrl}" style="width:100%; height:100%; object-fit:cover;"></video>
      <button type="button" class="remove-btn" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.6); color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center;" onclick="removePropertyFormMedia('newVideos', ${index})">&times;</button>
    `;
    videosPreview.appendChild(item);
  });
}

window.removePropertyFormMedia = function(listKey, index) {
  propertyFormMedia[listKey].splice(index, 1);
  renderPropertyMediaPreviews();
};

// Lightbox for Property Gallery full-screen view
window.openMediaLightbox = function(src, type) {
  let lightbox = document.getElementById('media-lightbox');
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.id = 'media-lightbox';
    lightbox.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background-color:rgba(0,0,0,0.9); z-index:99999; display:flex; justify-content:center; align-items:center;';
    lightbox.onclick = () => lightbox.classList.add('hidden');
    
    const closeBtn = document.createElement('span');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = 'position:absolute; top:20px; right:30px; color:#fff; font-size:40px; cursor:pointer; font-family:sans-serif; line-height:1; font-weight:bold;';
    lightbox.appendChild(closeBtn);
    
    const content = document.createElement('div');
    content.id = 'media-lightbox-content';
    content.style.cssText = 'max-width:90%; max-height:90%; display:flex; justify-content:center; align-items:center;';
    lightbox.appendChild(content);
    
    document.body.appendChild(lightbox);
  }
  
  const content = document.getElementById('media-lightbox-content');
  content.innerHTML = '';
  if (type === 'image') {
    const img = document.createElement('img');
    img.src = src;
    img.style.cssText = 'max-width:100%; max-height:90vh; border-radius:8px;';
    content.appendChild(img);
  } else {
    const video = document.createElement('video');
    video.src = src;
    video.controls = true;
    video.autoplay = true;
    video.style.cssText = 'max-width:100%; max-height:90vh; border-radius:8px;';
    content.appendChild(video);
  }
  
  lightbox.classList.remove('hidden');
};

// ==========================================
// UTILITY FUNCTIONS & HELPERS
// ==========================================

// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconClass = 'fa-circle-check';
  if (type === 'danger') iconClass = 'fa-circle-xmark';
  if (type === 'warning') iconClass = 'fa-triangle-exclamation';
  if (type === 'info') iconClass = 'fa-circle-info';

  toast.innerHTML = `
    <i class="fa-solid ${iconClass}"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s forwards';
    toast.addEventListener('animationend', () => {
      toast.remove();
    });
  }, 4000);
}

// Global Loader Controls
function showLoader() {
  document.getElementById('global-loader').classList.remove('hidden');
}
function hideLoader() {
  document.getElementById('global-loader').classList.add('hidden');
}

// Global API Fetch wrapper
async function fetchApi(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  // Handle multipart form data
  if (options.body instanceof FormData) {
    delete headers['Content-Type']; // Let browser set boundaries
  }

  try {
    const res = await fetch(endpoint, { ...options, headers });
    
    if (res.status === 410 || res.status === 403 && state.token) {
      // Access expired / invalid
      showToast('Session expired or access denied.', 'danger');
      logout();
      throw new Error('Authentication failure');
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Server error occurred');
    }
    return data;
  } catch (error) {
    console.error('API Fetch Error:', error);
    showToast(error.message, 'danger');
    throw error;
  }
}

// Format numbers as currency
function formatCurrency(val) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
}

// Quick Fill Helper for Demo logins
window.quickFill = function(user, pass) {
  document.getElementById('login-username').value = user;
  document.getElementById('login-password').value = pass;
};

// ==========================================
// AUTHENTICATION & LOGIN FLOW
// ==========================================

function initAuth() {
  const loginForm = document.getElementById('login-form');
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    showLoader();
    try {
      const data = await fetchApi('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('aura_token', data.token);
      localStorage.setItem('aura_user', JSON.stringify(data.user));
      
      showToast(`Welcome back, ${state.user.full_name}!`);
      checkSession();
    } catch (err) {
      // Error shown by fetch wrapper
    } finally {
      hideLoader();
    }
  });

  // Toggle Password Visibility
  const togglePassBtn = document.getElementById('toggle-password-btn');
  togglePassBtn.addEventListener('click', () => {
    const passInput = document.getElementById('login-password');
    if (passInput.type === 'password') {
      passInput.type = 'text';
      togglePassBtn.innerHTML = '<i class="fa-regular fa-eye-slash"></i>';
    } else {
      passInput.type = 'password';
      togglePassBtn.innerHTML = '<i class="fa-regular fa-eye"></i>';
    }
  });

  // Forgot password
  document.getElementById('forgot-password-link').addEventListener('click', (e) => {
    e.preventDefault();
    const email = prompt('Enter your registered email:');
    if (email) {
      fetchApi('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email })
      }).then(data => showToast(data.message, 'info'));
    }
  });

  // Toggle to Registration view
  document.getElementById('show-register-link').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('register-view').classList.remove('hidden');
  });

  // Toggle back to Login view
  document.getElementById('show-login-link').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('register-view').classList.add('hidden');
    document.getElementById('login-view').classList.remove('hidden');
  });

  // Self-Registration Form Handler
  const registerForm = document.getElementById('register-form');
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullname = document.getElementById('reg-fullname').value;
    const username = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value;
    const phone = document.getElementById('reg-phone').value;
    const role = document.getElementById('reg-role').value;
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-confirm-password').value;

    if (password !== confirmPassword) {
      showToast('Passwords do not match.', 'danger');
      return;
    }

    showLoader();
    try {
      const data = await fetchApi('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, email, password, full_name: fullname, phone, role })
      });

      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('aura_token', data.token);
      localStorage.setItem('aura_user', JSON.stringify(data.user));

      showToast(`Registration successful! Welcome, ${state.user.full_name}.`);
      checkSession();
    } catch (err) {
      // Handled by fetchApi wrapper
    } finally {
      hideLoader();
    }
  });

  // Google Login button Trigger popup
  const googleBtn = document.getElementById('google-login-btn');
  googleBtn.addEventListener('click', () => {
    const width = 500;
    const height = 620;
    const left = (screen.width / 2) - (width / 2);
    const top = (screen.height / 2) - (height / 2);
    
    window.open(
      'google-oauth.html',
      'GoogleSignOnPopup',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes`
    );
  });

  // Listen for message from google-oauth.html popup window
  window.addEventListener('message', async (event) => {
    if (event.data && event.data.source === 'google-oauth-complete') {
      const { email, name } = event.data;
      
      showLoader();
      try {
        const data = await fetchApi('/api/auth/google-login', {
          method: 'POST',
          body: JSON.stringify({ email, name })
        });
        
        state.token = data.token;
        state.user = data.user;
        localStorage.setItem('aura_token', data.token);
        localStorage.setItem('aura_user', JSON.stringify(data.user));
        
        showToast(`Authenticated via Google as ${state.user.full_name}`);
        checkSession();
      } catch (err) {
        // Handled by fetchApi wrapper
      } finally {
        hideLoader();
      }
    }
  });

  // Logout trigger
  document.getElementById('logout-btn').addEventListener('click', () => {
    logout();
  });
}

function logout() {
  if (state.token) {
    fetchApi('/api/auth/logout', { method: 'POST' }).catch(() => {});
  }
  state.token = null;
  state.user = null;
  localStorage.removeItem('aura_token');
  localStorage.removeItem('aura_user');
  checkSession();
  showToast('Logged out successfully.', 'info');
}

function checkSession() {
  const loginView = document.getElementById('login-view');
  const registerView = document.getElementById('register-view');
  const mainView = document.getElementById('main-view');

  if (state.token && state.user) {
    loginView.classList.add('hidden');
    registerView.classList.add('hidden');
    mainView.classList.remove('hidden');
    
    // Update profile widgets
    document.getElementById('sidebar-user-name').innerText = state.user.full_name;
    document.getElementById('sidebar-user-role').innerText = state.user.role;
    document.getElementById('sidebar-avatar').innerText = state.user.full_name.charAt(0);
    document.getElementById('header-role-badge').innerText = state.user.role;

    // Apply role-based client routing filters
    applyRoleFilters();

    // Route to current view
    navigateTo(state.activeView);
  } else {
    loginView.classList.remove('hidden');
    registerView.classList.add('hidden');
    mainView.classList.add('hidden');
  }
}

function applyRoleFilters() {
  const role = state.user.role;

  // Reset visibility of all nav items
  const navItems = document.querySelectorAll('.sidebar-nav li');
  navItems.forEach(item => {
    item.classList.remove('hidden');
  });

  // Toggle sections
  document.querySelectorAll('.role-only').forEach(el => {
    el.classList.add('hidden');
  });

  if (role === 'Super Admin') {
    document.querySelectorAll('.super-admin-only').forEach(el => el.classList.remove('hidden'));
    document.querySelectorAll('.landlord-only').forEach(el => el.classList.remove('hidden'));
    document.querySelectorAll('.manager-only').forEach(el => el.classList.remove('hidden'));
  } else if (role === 'Landlord') {
    document.querySelectorAll('.landlord-only').forEach(el => el.classList.remove('hidden'));
  } else if (role === 'Property Manager') {
    document.querySelectorAll('.manager-only').forEach(el => el.classList.remove('hidden'));
  }

  // Filter sidebar items for Tenant and Maintenance Officer
  if (role === 'Tenant') {
    const allowedTargets = ['dashboard', 'properties', 'leases', 'invoices', 'payments', 'maintenance', 'utilities', 'visitors'];
    navItems.forEach(item => {
      const target = item.getAttribute('data-target');
      if (!allowedTargets.includes(target)) {
        item.classList.add('hidden');
      }
    });
  } else if (role === 'Maintenance Officer') {
    const allowedTargets = ['dashboard', 'maintenance'];
    navItems.forEach(item => {
      const target = item.getAttribute('data-target');
      if (!allowedTargets.includes(target)) {
        item.classList.add('hidden');
      }
    });
  } else {
    // Hide Audit Logs for non-Super Admins
    if (role !== 'Super Admin') {
      navItems.forEach(item => {
        if (item.getAttribute('data-target') === 'audit-logs') {
          item.classList.add('hidden');
        }
      });
    }
  }
}

// ==========================================
// SPA ROUTER
// ==========================================

function initRouter() {
  const navItems = document.querySelectorAll('.sidebar-nav li');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = item.getAttribute('data-target');
      
      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      navigateTo(target);
    });
  });

  // Mobile sidebar toggles
  const sidebar = document.querySelector('.sidebar');
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    sidebar.classList.toggle('show');
  });

  // Close sidebar on navigate (tablet/mobile view)
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
      if (!sidebar.contains(e.target) && e.target.id !== 'sidebar-toggle' && !document.getElementById('sidebar-toggle').contains(e.target)) {
        sidebar.classList.remove('show');
      }
    }
  });
}

function navigateTo(view) {
  state.activeView = view;
  
  // Format header title
  const titleMap = {
    'dashboard': 'Dashboard Overview',
    'properties': 'Properties Management',
    'units': 'Rental Units Listing',
    'tenants': 'Tenant Registry Profiles',
    'leases': 'Digital Lease Agreements',
    'invoices': 'Rent Invoices Billing',
    'payments': 'Payment History Receipts',
    'maintenance': 'Maintenance Service Tickets',
    'utilities': 'Utility Meters Reading',
    'expenses': 'Expense Bookkeeping',
    'visitors': 'Visitor Check-in Log',
    'audit-logs': 'System Activity History Logs',
    'reports': 'Financial & Analytics Reporting',
    'payment-settings': 'Payment Configurations'
  };
  document.getElementById('view-title').innerText = titleMap[view] || 'AuraRent';

  // Render view
  const contentPane = document.getElementById('main-content');
  
  // Clean charts and maps
  if (state.map) {
    state.map.remove();
    state.map = null;
  }
  Object.values(state.charts).forEach(c => c.destroy());
  state.charts = {};

  // Load and render view content
  renderView(view, contentPane);
}

// ==========================================
// VIEW RENDERING MODULES
// ==========================================

async function renderView(view, container) {
  showLoader();
  try {
    switch (view) {
      case 'dashboard':
        await renderDashboard(container);
        break;
      case 'properties':
        await renderProperties(container);
        break;
      case 'units':
        await renderUnits(container);
        break;
      case 'tenants':
        await renderTenants(container);
        break;
      case 'leases':
        await renderLeases(container);
        break;
      case 'invoices':
        await renderInvoices(container);
        break;
      case 'payments':
        await renderPayments(container);
        break;
      case 'maintenance':
        await renderMaintenance(container);
        break;
      case 'utilities':
        await renderUtilities(container);
        break;
      case 'expenses':
        await renderExpenses(container);
        break;
      case 'visitors':
        await renderVisitors(container);
        break;
      case 'audit-logs':
        await renderAuditLogs(container);
        break;
      case 'reports':
        await renderReports(container);
        break;
      case 'payment-settings':
        await renderPaymentSettings(container);
        break;
      default:
        container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-face-frown"></i><h2>View not found</h2></div>`;
    }
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <h2>Failed to load view</h2>
        <p>${err.message}</p>
        <button class="btn btn-primary btn-sm" onclick="navigateTo('${view}')"><i class="fa-solid fa-rotate"></i> Retry</button>
      </div>
    `;
  } finally {
    hideLoader();
  }
}

// ------------------------------------------
// VIEW: DASHBOARD
// ------------------------------------------
async function renderDashboard(container) {
  const stats = await fetchApi('/api/dashboard/stats');

  // Trigger Notifications updates
  updateNotificationsUI(stats.notifications);

  if (stats.isTenant) {
    container.innerHTML = `
      <!-- Metrics Grid -->
      <div class="metrics-grid">
        <div class="card metric-card">
          <div class="metric-info">
            <h3>Outstanding Balance</h3>
            <div class="number" style="color:var(--color-danger);">${formatCurrency(stats.outstandingRent)}</div>
          </div>
          <div class="metric-icon-box" style="color:var(--color-danger);"><i class="fa-solid fa-clock"></i></div>
        </div>
        <div class="card metric-card">
          <div class="metric-info">
            <h3>My Active Lease</h3>
            <div class="number" style="font-size:16px; margin-top:8px; line-height:1.4;">
              ${stats.activeLease ? `<strong>${stats.activeLease.property_name}</strong><br><span style="font-size:13px;color:var(--text-muted);">Unit ${stats.activeLease.unit_number}</span>` : '<span style="color:var(--text-muted);">No Active Lease</span>'}
            </div>
          </div>
          <div class="metric-icon-box"><i class="fa-solid fa-file-contract"></i></div>
        </div>
        <div class="card metric-card">
          <div class="metric-info">
            <h3>Total Rent Paid</h3>
            <div class="number" style="color:var(--color-success);">${formatCurrency(stats.totalPaid)}</div>
          </div>
          <div class="metric-icon-box" style="color:var(--color-success);"><i class="fa-solid fa-hand-holding-dollar"></i></div>
        </div>
        <div class="card metric-card">
          <div class="metric-info">
            <h3>Open Tickets</h3>
            <div class="number">${stats.pendingMaintenance}</div>
          </div>
          <div class="metric-icon-box"><i class="fa-solid fa-screwdriver-wrench"></i></div>
        </div>
      </div>

      <!-- Quick Actions Card -->
      <div class="card" style="margin-bottom:20px;">
        <h2><i class="fa-solid fa-bolt" style="color:var(--color-warning); margin-right:8px;"></i>Tenant Quick Actions</h2>
        <div class="quick-actions-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:15px; margin-top:15px;">
          <button class="btn btn-primary" onclick="navigateTo('properties')"><i class="fa-solid fa-magnifying-glass"></i> Browse Properties & Apply</button>
          <button class="btn btn-secondary" onclick="navigateTo('maintenance')"><i class="fa-solid fa-plus-circle"></i> Request Maintenance</button>
          <button class="btn btn-secondary" onclick="navigateTo('visitors')"><i class="fa-solid fa-id-badge"></i> Register Visitor</button>
          ${stats.activeLease ? `
            <button class="btn btn-secondary" onclick="viewLeaseAgreement(${stats.activeLease.id})"><i class="fa-solid fa-file-pdf"></i> View Signed Lease</button>
          ` : ''}
        </div>
      </div>

      <!-- Unpaid Invoices & Recent Payments -->
      <div class="dashboard-lists-grid">
        <div class="card list-card">
          <h3><i class="fa-solid fa-file-invoice-dollar"></i> Outstanding Invoices</h3>
          <div class="recent-list">
            ${stats.unpaidInvoices.length === 0 ? '<div class="empty-state">No outstanding invoices.</div>' : stats.unpaidInvoices.map(i => {
              const outstanding = i.total_due - i.paid_amount;
              return `
                <div class="recent-item" style="align-items:center;">
                  <div class="recent-item-meta">
                    <h4>${i.invoice_number}</h4>
                    <p>${i.property_name} - Unit ${i.unit_number}</p>
                    <p style="font-size:12px;color:var(--text-muted);">Period: ${i.billing_period} &bull; Due: ${i.due_date}</p>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-weight:700;color:var(--color-danger);margin-bottom:6px;">${formatCurrency(outstanding)}</div>
                    <button class="btn btn-primary btn-sm" onclick="openPaymentModal(${i.id}, '${i.invoice_number}', ${outstanding})"><i class="fa-solid fa-wallet"></i> Pay Now</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="card list-card">
          <h3><i class="fa-solid fa-receipt"></i> Recent Payments</h3>
          <div class="recent-list">
            ${stats.recentPayments.length === 0 ? '<div class="empty-state">No recent payments.</div>' : stats.recentPayments.map(p => `
              <div class="recent-item">
                <div class="recent-item-meta">
                  <h4>Receipt: ${p.receipt_number}</h4>
                  <p>${p.property_name} - Unit ${p.unit_number}</p>
                  <p style="font-size:11px;color:var(--text-muted);">Ref: ${p.transaction_reference || 'N/A'} &bull; ${p.payment_date.split(' ')[0]}</p>
                </div>
                <div class="recent-item-amount" style="color:var(--color-success);font-weight:700;">+ ${formatCurrency(p.amount)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <!-- Metrics Grid -->
    <div class="metrics-grid">
      <div class="card metric-card">
        <div class="metric-info">
          <h3>Total Properties</h3>
          <div class="number">${stats.totalProperties}</div>
        </div>
        <div class="metric-icon-box"><i class="fa-solid fa-building"></i></div>
      </div>
      <div class="card metric-card">
        <div class="metric-info">
          <h3>Occupied Units</h3>
          <div class="number">${stats.occupiedUnits} <span style="font-size:14px;color:var(--text-muted);">/ ${stats.totalUnits}</span></div>
        </div>
        <div class="metric-icon-box"><i class="fa-solid fa-door-open"></i></div>
      </div>
      <div class="card metric-card">
        <div class="metric-info">
          <h3>Monthly Revenue</h3>
          <div class="number">${formatCurrency(stats.monthlyRevenue)}</div>
        </div>
        <div class="metric-icon-box"><i class="fa-solid fa-hand-holding-dollar"></i></div>
      </div>
      <div class="card metric-card">
        <div class="metric-info">
          <h3>Outstanding Rent</h3>
          <div class="number" style="color:var(--color-danger);">${formatCurrency(stats.outstandingRent)}</div>
        </div>
        <div class="metric-icon-box"><i class="fa-solid fa-clock"></i></div>
      </div>
    </div>

    <!-- Charts -->
    <div class="charts-grid">
      <div class="card chart-card">
        <h3><i class="fa-solid fa-chart-simple"></i> Monthly Revenue (Last 6 Months)</h3>
        <div class="chart-container">
          <canvas id="revenue-chart-canvas"></canvas>
        </div>
      </div>
      <div class="card chart-card">
        <h3><i class="fa-solid fa-chart-pie"></i> Occupancy Ratio</h3>
        <div class="chart-container">
          <canvas id="occupancy-chart-canvas"></canvas>
        </div>
      </div>
    </div>

    <!-- Double Lists -->
    <div class="dashboard-lists-grid">
      <div class="card list-card">
        <h3><i class="fa-solid fa-money-bill-transfer"></i> Recent Payments</h3>
        <div class="recent-list">
          ${stats.recentPayments.length === 0 ? '<div class="empty-state">No recent payments.</div>' : stats.recentPayments.map(p => `
            <div class="recent-item">
              <div class="recent-item-meta">
                <h4>${p.tenant_name} (${p.property_name} - Unit ${p.unit_number})</h4>
                <p>Ref: ${p.transaction_reference || 'N/A'} &bull; ${p.payment_date.split(' ')[0]}</p>
              </div>
              <div class="recent-item-amount" style="color:var(--color-success);">+ ${formatCurrency(p.amount)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="card list-card">
        <h3><i class="fa-solid fa-hourglass-half"></i> Expiring Leases (Next 90 Days)</h3>
        <div class="recent-list">
          ${stats.expiringLeases.length === 0 ? '<div class="empty-state">No expiring leases in the next 90 days.</div>' : stats.expiringLeases.map(l => `
            <div class="recent-item">
              <div class="recent-item-meta">
                <h4>${l.tenant_name}</h4>
                <p>${l.property_name} - Unit ${l.unit_number} &bull; Ends: ${l.end_date}</p>
              </div>
              <div class="badge badge-warning">Expiring</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // Draw Revenue Chart
  const revCtx = document.getElementById('revenue-chart-canvas').getContext('2d');
  const revMonths = stats.revenueChart.map(r => r.month);
  const revAmounts = stats.revenueChart.map(r => r.revenue);
  
  state.charts.revenue = new Chart(revCtx, {
    type: 'bar',
    data: {
      labels: revMonths.length ? revMonths : ['No Data'],
      datasets: [{
        label: 'Revenue ($)',
        data: revAmounts.length ? revAmounts : [0],
        backgroundColor: 'hsl(255, 65%, 60%)',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'var(--border-color)' } },
        x: { grid: { display: false } }
      }
    }
  });

  // Draw Occupancy Chart
  const occCtx = document.getElementById('occupancy-chart-canvas').getContext('2d');
  state.charts.occupancy = new Chart(occCtx, {
    type: 'doughnut',
    data: {
      labels: ['Occupied', 'Vacant', 'Reserved', 'Maintenance'],
      datasets: [{
        data: [stats.occupiedUnits, stats.vacantUnits, stats.reservedUnits, stats.maintenanceUnits],
        backgroundColor: ['#10b981', '#94a3b8', '#f59e0b', '#ef4444']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-primary)' } } }
    }
  });
}

// ------------------------------------------
// VIEW: PROPERTIES
// ------------------------------------------
async function renderProperties(container) {
  const properties = await fetchApi('/api/properties');
  
  // Header Actions
  container.innerHTML = `
    <div class="view-actions">
      <div class="filters-bar">
        <div class="search-box">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" id="prop-filter-search" placeholder="Search properties...">
        </div>
      </div>
      ${['Super Admin', 'Property Manager', 'Landlord'].includes(state.user.role) ? `
        <button class="btn btn-primary" id="add-property-btn"><i class="fa-solid fa-plus"></i> Add Property</button>
      ` : ''}
    </div>
    
    <div class="properties-grid" id="properties-list-container">
      ${renderPropertyCards(properties)}
    </div>
  `;

  // Filter Search
  const searchInput = document.getElementById('prop-filter-search');
  searchInput.addEventListener('input', debounce(async () => {
    const q = searchInput.value;
    const filtered = await fetchApi(`/api/properties?search=${q}`);
    document.getElementById('properties-list-container').innerHTML = renderPropertyCards(filtered);
  }, 300));

  // Add Property Dialog Trigger
  if (document.getElementById('add-property-btn')) {
    document.getElementById('add-property-btn').addEventListener('click', () => {
      openPropertyModal();
    });
  }
}

function renderPropertyCards(properties) {
  if (properties.length === 0) {
    return `<div class="empty-state" style="grid-column: 1/-1;"><i class="fa-solid fa-building-circle-exclamation"></i><h2>No properties found</h2></div>`;
  }
  return properties.map(p => {
    let imageSrc = '';
    try {
      const imgs = JSON.parse(p.images || '[]');
      if (imgs && imgs.length > 0) {
        imageSrc = imgs[0];
      }
    } catch(e) {}

    return `
      <div class="card property-card card-hover">
        <div class="property-card-img">
          <span class="property-type-tag">${p.type}</span>
          ${imageSrc ? `<img src="${imageSrc}" alt="${p.name}">` : `<i class="fa-regular fa-building" style="font-size:48px;"></i>`}
        </div>
        <div class="property-card-content">
          <h3>${p.name}</h3>
          <p class="property-location"><i class="fa-solid fa-location-dot"></i> ${p.address}, ${p.city}</p>
          <div class="property-stats">
            <div class="prop-stat-item">
              <span class="prop-stat-label">Units</span>
              <span class="prop-stat-val">${p.units_count}</span>
            </div>
            <div class="prop-stat-item">
              <span class="prop-stat-label">Floors</span>
              <span class="prop-stat-val">${p.floors}</span>
            </div>
            <div class="prop-stat-item">
              <span class="prop-stat-label">Code</span>
              <span class="prop-stat-val">${p.code}</span>
            </div>
          </div>
          <div class="property-card-footer">
            <span class="badge badge-success">${p.occupied_units_db || 0} Occupied</span>
            <button class="btn btn-secondary btn-sm" onclick="viewPropertyDetail(${p.id})">Details <i class="fa-solid fa-arrow-right"></i></button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Details Page
window.viewPropertyDetail = async function(id) {
  showLoader();
  try {
    const p = await fetchApi(`/api/properties/${id}`);
    const contentPane = document.getElementById('main-content');
    document.getElementById('view-title').innerText = `Property: ${p.name}`;

    contentPane.innerHTML = `
      <div style="margin-bottom:20px;">
        <button class="btn btn-secondary btn-sm" onclick="navigateTo('properties')"><i class="fa-solid fa-arrow-left"></i> Back to Properties</button>
      </div>

      <div class="detail-layout">
        <div class="detail-main">
          <div class="card">
            <h2>About Property</h2>
            <p style="margin-top:10px;line-height:1.6;">${p.description || 'No description available for this property.'}</p>
            
            <h3 style="margin-top:20px;">Amenities Included</h3>
            <div class="amenities-list">
              ${p.amenities ? p.amenities.split(',').map(a => `<span class="amenity-tag"><i class="fa-solid fa-circle-check" style="color:var(--color-success)"></i> ${a.trim()}</span>`).join('') : '<p>No amenities logged.</p>'}
            </div>
          </div>

          ${(function() {
            let imgs = [];
            let vids = [];
            try {
              imgs = JSON.parse(p.images || '[]');
            } catch(e) {}
            try {
              vids = JSON.parse(p.videos || '[]');
            } catch(e) {}
            
            if (imgs.length === 0 && vids.length === 0) return '';
            
            return `
              <div class="card">
                <h2>Property Gallery</h2>
                <div class="property-gallery-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 15px; margin-top: 15px;">
                  ${imgs.map(img => `
                    <div class="gallery-item image-item" style="position: relative; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); aspect-ratio: 16/9; background: #000;">
                      <img src="${img}" style="width: 100%; height: 100%; object-fit: cover; cursor: pointer;" onclick="openMediaLightbox('${img}', 'image')">
                    </div>
                  `).join('')}
                  ${vids.map(vid => `
                    <div class="gallery-item video-item" style="position: relative; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); aspect-ratio: 16/9; background: #000;">
                      <video src="${vid}" style="width: 100%; height: 100%; object-fit: cover; cursor: pointer;" onclick="openMediaLightbox('${vid}', 'video')"></video>
                      <div class="video-play-overlay" style="position: absolute; top:0; left:0; width:100%; height:100%; display:flex; justify-content:center; align-items:center; background: rgba(0,0,0,0.3); pointer-events: none;">
                        <i class="fa-solid fa-circle-play" style="font-size: 32px; color: #fff; opacity: 0.8;"></i>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          })()}

          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
              <h2>Property Units (${p.units.length})</h2>
              ${['Super Admin', 'Property Manager', 'Landlord'].includes(state.user.role) ? `
                <button class="btn btn-primary btn-sm" onclick="openUnitModal(${p.id})"><i class="fa-solid fa-plus"></i> Add Unit</button>
              ` : ''}
            </div>
            <div class="table-responsive">
              <table class="table-custom">
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Floor</th>
                    <th>Bedrooms</th>
                    <th>Rent</th>
                    <th>Deposit</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${p.units.length === 0 ? '<tr><td colspan="7" class="text-center">No units registered.</td></tr>' : p.units.map(u => `
                    <tr>
                      <td><strong>${u.unit_number}</strong></td>
                      <td>Floor ${u.floor}</td>
                      <td>${u.bedrooms} Bed / ${u.bathrooms} Bath</td>
                      <td>${formatCurrency(u.monthly_rent)}</td>
                      <td>${formatCurrency(u.deposit)}</td>
                      <td><span class="badge badge-${getUnitStatusBadgeClass(u.status)}">${u.status}</span></td>
                      <td class="actions-cell">
                        <button class="btn btn-secondary btn-icon" onclick="viewUnitDetail(${u.id})" title="View Details"><i class="fa-solid fa-eye"></i></button>
                        ${['Super Admin', 'Property Manager', 'Landlord'].includes(state.user.role) ? `
                          <button class="btn btn-secondary btn-icon" onclick="editUnit(${u.id})" title="Edit Unit"><i class="fa-solid fa-pen"></i></button>
                        ` : ''}
                        ${state.user.role === 'Tenant' && u.status === 'Vacant' ? `
                          <button class="btn btn-primary btn-sm" onclick="openApplyModal(${u.id}, '${u.unit_number}', ${u.monthly_rent}, ${u.deposit})" style="margin-left: 5px;"><i class="fa-solid fa-file-signature"></i> Apply</button>
                        ` : ''}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="detail-sidebar">
          <div class="card">
            <h2>Location & Coordinates</h2>
            <p style="font-size:13px;margin:8px 0;"><i class="fa-solid fa-location-dot"></i> ${p.address}, ${p.city}, ${p.state}, ${p.country}</p>
            ${p.gps_lat && p.gps_lng ? `
              <p style="font-size:11px;color:var(--text-muted);">GPS Lat: ${p.gps_lat}, Lng: ${p.gps_lng}</p>
              <div class="map-card">
                <div id="property-map"></div>
              </div>
            ` : '<div class="empty-state"><i class="fa-solid fa-map-location"></i><p>GPS mapping not configured.</p></div>'}
          </div>

          ${['Super Admin', 'Property Manager', 'Landlord'].includes(state.user.role) ? `
            <div class="card" style="margin-top:20px;">
              <h2>Property Payment Settings</h2>
              <ul style="list-style:none; padding:0; margin:10px 0 0 0; font-size:13px; display:flex; flex-direction:column; gap:6px;">
                <li><strong>Bank Name:</strong> ${p.bank_name || '<em style="color:var(--text-muted);">None (uses default)</em>'}</li>
                <li><strong>Account:</strong> ${p.bank_account || '<em style="color:var(--text-muted);">None (uses default)</em>'}</li>
                <li><strong>Mobile Money:</strong> ${p.mobile_money_number || '<em style="color:var(--text-muted);">None (uses default)</em>'}</li>
                <li><strong>Gateway Descriptor:</strong> ${p.credit_card_details || '<em style="color:var(--text-muted);">None (uses default)</em>'}</li>
                <li><strong>Gateway Type:</strong> ${(p.online_gateway_type || 'stripe').toUpperCase()}</li>
                <li><strong>Gateway Pub Key:</strong> ${p.online_gateway_publishable ? p.online_gateway_publishable.substring(0, 15) + '...' : '<em style="color:var(--text-muted);">None (uses default)</em>'}</li>
              </ul>
            </div>
          ` : ''}

          ${['Super Admin', 'Property Manager', 'Landlord'].includes(state.user.role) ? `
            <div class="card" style="margin-top:20px;display:flex;flex-direction:column;gap:10px;">
              <h2>Property Actions</h2>
              <button class="btn btn-secondary btn-block" onclick="editProperty(${p.id})"><i class="fa-solid fa-pen"></i> Edit Property Details</button>
              <button class="btn btn-danger btn-block" onclick="deleteProperty(${p.id})"><i class="fa-solid fa-trash"></i> Delete Property</button>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // Initialize map if lat/lng are set
    if (p.gps_lat && p.gps_lng) {
      setTimeout(() => {
        state.map = L.map('property-map').setView([p.gps_lat, p.gps_lng], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(state.map);
        L.marker([p.gps_lat, p.gps_lng]).addTo(state.map)
          .bindPopup(`<strong>${p.name}</strong><br/>${p.address}`)
          .openPopup();
      }, 200);
    }

  } catch (err) {}
  hideLoader();
};

function getUnitStatusBadgeClass(status) {
  if (status === 'Occupied') return 'success';
  if (status === 'Vacant') return 'info';
  if (status === 'Reserved') return 'warning';
  return 'danger'; // Maintenance
}

// ------------------------------------------
// VIEW: UNITS
// ------------------------------------------
async function renderUnits(container) {
  const units = await fetchApi('/api/units');
  container.innerHTML = `
    <div class="view-actions">
      <div class="filters-bar">
        <div class="search-box">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" id="unit-filter-search" placeholder="Search units...">
        </div>
      </div>
    </div>
    
    <div class="table-responsive">
      <table class="table-custom">
        <thead>
          <tr>
            <th>Property</th>
            <th>Unit</th>
            <th>Floor</th>
            <th>Rooms</th>
            <th>Monthly Rent</th>
            <th>Deposit</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="units-table-body">
          ${renderUnitRows(units)}
        </tbody>
      </table>
    </div>
  `;

  const searchInput = document.getElementById('unit-filter-search');
  searchInput.addEventListener('input', debounce(async () => {
    const q = searchInput.value;
    const filtered = await fetchApi(`/api/units?search=${q}`);
    document.getElementById('units-table-body').innerHTML = renderUnitRows(filtered);
  }, 300));
}

function renderUnitRows(units) {
  if (units.length === 0) return '<tr><td colspan="8" class="text-center">No units matches search terms.</td></tr>';
  return units.map(u => `
    <tr>
      <td>${u.property_name}</td>
      <td><strong>${u.unit_number}</strong></td>
      <td>Floor ${u.floor}</td>
      <td>${u.bedrooms} Bed / ${u.bathrooms} Bath</td>
      <td>${formatCurrency(u.monthly_rent)}</td>
      <td>${formatCurrency(u.deposit)}</td>
      <td><span class="badge badge-${getUnitStatusBadgeClass(u.status)}">${u.status}</span></td>
      <td class="actions-cell">
        <button class="btn btn-secondary btn-icon" onclick="viewUnitDetail(${u.id})" title="View Detail"><i class="fa-solid fa-eye"></i></button>
        ${['Super Admin', 'Property Manager', 'Landlord'].includes(state.user.role) ? `
          <button class="btn btn-secondary btn-icon" onclick="editUnit(${u.id})" title="Edit Unit"><i class="fa-solid fa-pen"></i></button>
        ` : ''}
      </td>
    </tr>
  `).join('');
}

window.viewUnitDetail = async function(id) {
  showLoader();
  try {
    const u = await fetchApi(`/api/units/${id}`);
    const contentPane = document.getElementById('main-content');
    document.getElementById('view-title').innerText = `Unit Details: ${u.unit_number}`;

    contentPane.innerHTML = `
      <div style="margin-bottom:20px;">
        <button class="btn btn-secondary btn-sm" onclick="viewPropertyDetail(${u.property_id})"><i class="fa-solid fa-arrow-left"></i> Back to Property Details</button>
      </div>

      <div class="detail-layout">
        <div class="detail-main">
          <div class="card">
            <h2>Rental Metrics Configuration</h2>
            <div class="profile-fields-grid" style="margin-top:15px;">
              <div>
                <span class="profile-field-label">Unit Number</span>
                <div class="profile-field-val">${u.unit_number}</div>
              </div>
              <div>
                <span class="profile-field-label">Floor Level</span>
                <div class="profile-field-val">Floor ${u.floor}</div>
              </div>
              <div>
                <span class="profile-field-label">Layout Configuration</span>
                <div class="profile-field-val">${u.bedrooms} Bedroom / ${u.bathrooms} Bathroom</div>
              </div>
              <div>
                <span class="profile-field-label">Monthly Rent Amount</span>
                <div class="profile-field-val">${formatCurrency(u.monthly_rent)}</div>
              </div>
              <div>
                <span class="profile-field-label">Assigned Deposit</span>
                <div class="profile-field-val">${formatCurrency(u.deposit)}</div>
              </div>
              <div>
                <span class="profile-field-label">Service Fee Charge</span>
                <div class="profile-field-val">${formatCurrency(u.service_charge)}</div>
              </div>
            </div>
          </div>

          <div class="card">
            <h2>Rental and Agreement History</h2>
            <div class="table-responsive" style="margin-top:15px;">
              <table class="table-custom">
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Email</th>
                    <th>Start Date</th>
                    <th>End Date</th>
                    <th>Agreement Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${u.history.length === 0 ? '<tr><td colspan="6" class="text-center">No leases registered on this unit.</td></tr>' : u.history.map(h => `
                    <tr>
                      <td><strong>${h.tenant_name}</strong></td>
                      <td>${h.tenant_email}</td>
                      <td>${h.start_date}</td>
                      <td>${h.end_date}</td>
                      <td>${formatCurrency(h.rent_amount)} / mo</td>
                      <td><span class="badge badge-${h.status === 'Active' ? 'success' : 'danger'}">${h.status}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="detail-sidebar">
          <div class="card">
            <h2>Parent Property Profile</h2>
            <h3 style="margin-top:10px;">${u.property_name}</h3>
            <p style="font-size:13px;color:var(--text-muted);margin:8px 0;"><i class="fa-solid fa-location-dot"></i> ${u.property_address}</p>
            <button class="btn btn-secondary btn-block btn-sm" onclick="viewPropertyDetail(${u.property_id})">Go To Property Profile</button>
          </div>

          <div class="card" style="margin-top:20px;">
            <h2>Unit Status Control</h2>
            <div style="margin:15px 0;">
              <span class="badge badge-${getUnitStatusBadgeClass(u.status)}" style="padding: 8px 16px; font-size:13px;">${u.status}</span>
            </div>
            ${['Super Admin', 'Property Manager', 'Landlord'].includes(state.user.role) ? `
              <button class="btn btn-danger btn-block" onclick="deleteUnit(${u.id})"><i class="fa-solid fa-trash"></i> Remove Unit</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;

  } catch (err) {}
  hideLoader();
};

// ------------------------------------------
// VIEW: TENANTS
// ------------------------------------------
async function renderTenants(container) {
  const tenants = await fetchApi('/api/tenants');
  container.innerHTML = `
    <div class="view-actions">
      <div class="filters-bar">
        <div class="search-box">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" id="tenant-filter-search" placeholder="Search tenants...">
        </div>
      </div>
      ${['Super Admin', 'Property Manager', 'Receptionist'].includes(state.user.role) ? `
        <button class="btn btn-primary" id="add-tenant-btn"><i class="fa-solid fa-user-plus"></i> Register Tenant</button>
      ` : ''}
    </div>
    
    <div class="table-responsive">
      <table class="table-custom">
        <thead>
          <tr>
            <th>Name</th>
            <th>Contact Email</th>
            <th>Phone</th>
            <th>Location Unit</th>
            <th>ID / National ID</th>
            <th>Lease Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="tenants-table-body">
          ${renderTenantRows(tenants)}
        </tbody>
      </table>
    </div>
  `;

  const searchInput = document.getElementById('tenant-filter-search');
  searchInput.addEventListener('input', debounce(async () => {
    const q = searchInput.value;
    const filtered = await fetchApi(`/api/tenants?search=${q}`);
    document.getElementById('tenants-table-body').innerHTML = renderTenantRows(filtered);
  }, 300));

  if (document.getElementById('add-tenant-btn')) {
    document.getElementById('add-tenant-btn').addEventListener('click', () => {
      openTenantModal();
    });
  }
}

function renderTenantRows(tenants) {
  if (tenants.length === 0) return '<tr><td colspan="7" class="text-center">No tenants found.</td></tr>';
  return tenants.map(t => `
    <tr>
      <td><strong>${t.full_name}</strong></td>
      <td>${t.email}</td>
      <td>${t.phone || 'N/A'}</td>
      <td>${t.unit_number ? `${t.property_name} - Unit ${t.unit_number}` : '<span style="color:var(--text-muted);">Unleased</span>'}</td>
      <td>${t.national_id || 'N/A'}</td>
      <td><span class="badge badge-${t.lease_status === 'Active' ? 'success' : 'danger'}">${t.lease_status || 'Inactive'}</span></td>
      <td class="actions-cell">
        <button class="btn btn-secondary btn-icon" onclick="viewTenantDetail(${t.id})" title="View Tenant details"><i class="fa-solid fa-user-gear"></i></button>
      </td>
    </tr>
  `).join('');
}

window.viewTenantDetail = async function(id) {
  showLoader();
  try {
    const tenant = await fetchApi(`/api/tenants/${id}`);
    const contentPane = document.getElementById('main-content');
    document.getElementById('view-title').innerText = `Tenant: ${tenant.full_name}`;

    const emergency = tenant.emergency_contact ? JSON.parse(tenant.emergency_contact) : null;
    const guarantor = tenant.guarantor ? JSON.parse(tenant.guarantor) : null;

    contentPane.innerHTML = `
      <div style="margin-bottom:20px;">
        <button class="btn btn-secondary btn-sm" onclick="navigateTo('tenants')"><i class="fa-solid fa-arrow-left"></i> Back to List</button>
      </div>

      <div class="detail-layout">
        <div class="detail-main">
          <div class="card">
            <div class="tenant-profile-card">
              <div class="tenant-big-avatar">${tenant.full_name.charAt(0)}</div>
              <div class="tenant-profile-info">
                <h2>${tenant.full_name}</h2>
                <p style="color:var(--text-muted);"><i class="fa-solid fa-envelope"></i> ${tenant.email} &bull; <i class="fa-solid fa-phone"></i> ${tenant.phone || 'N/A'}</p>
              </div>
            </div>

            <h2>Personal & Profile Credentials</h2>
            <div class="profile-fields-grid" style="margin-top:15px; margin-bottom:25px;">
              <div>
                <span class="profile-field-label">Date of Birth</span>
                <div class="profile-field-val">${tenant.dob || 'N/A'}</div>
              </div>
              <div>
                <span class="profile-field-label">National ID</span>
                <div class="profile-field-val">${tenant.national_id || 'N/A'}</div>
              </div>
              <div>
                <span class="profile-field-label">Passport Number</span>
                <div class="profile-field-val">${tenant.passport_number || 'N/A'}</div>
              </div>
              <div>
                <span class="profile-field-label">Occupation</span>
                <div class="profile-field-val">${tenant.occupation || 'N/A'}</div>
              </div>
              <div>
                <span class="profile-field-label">Employer Name</span>
                <div class="profile-field-val">${tenant.employer || 'N/A'}</div>
              </div>
            </div>
            
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
              <div class="nested-fields">
                <h3>Emergency Contact</h3>
                ${emergency ? `
                  <p><strong>Name:</strong> ${emergency.name}</p>
                  <p><strong>Phone:</strong> ${emergency.phone}</p>
                  <p><strong>Relation:</strong> ${emergency.relation}</p>
                ` : '<p>No emergency contact logged.</p>'}
              </div>
              <div class="nested-fields">
                <h3>Financial Guarantor</h3>
                ${guarantor ? `
                  <p><strong>Name:</strong> ${guarantor.name}</p>
                  <p><strong>Phone:</strong> ${guarantor.phone}</p>
                  <p><strong>Income:</strong> ${formatCurrency(guarantor.income)} / yr</p>
                ` : '<p>No guarantor logged.</p>'}
              </div>
            </div>
          </div>
        </div>

        <div class="detail-sidebar">
          <div class="card">
            <h2>Current Lease Contract</h2>
            ${tenant.activeLease ? `
              <h3 style="margin-top:10px;">${tenant.activeLease.property_name}</h3>
              <p>Unit ${tenant.activeLease.unit_number}</p>
              <p style="font-size:12px;color:var(--text-muted);margin:8px 0;">Lease End Date: ${tenant.activeLease.end_date}</p>
              <button class="btn btn-primary btn-block btn-sm" onclick="viewLeaseAgreement(${tenant.activeLease.id})">View Lease Terms</button>
            ` : `
              <p style="margin:15px 0;color:var(--text-muted);">No active lease contract.</p>
              ${['Super Admin', 'Property Manager', 'Landlord'].includes(state.user.role) ? `
                <button class="btn btn-primary btn-block btn-sm" onclick="openLeaseModal(${tenant.id})"><i class="fa-solid fa-file-contract"></i> Draft Lease Agreement</button>
              ` : ''}
            `}
          </div>

          <div class="card" style="margin-top:20px;">
            <h2>Digital Sign-Off File</h2>
            <div class="signature-display-box">
              ${tenant.digital_signature ? `<img src="${tenant.digital_signature}" alt="Digital Signature">` : '<span style="color:var(--text-muted);">No digital signature on file</span>'}
            </div>
          </div>
        </div>
      </div>
    `;

  } catch (err) {}
  hideLoader();
};

// ------------------------------------------
// VIEW: LEASES
// ------------------------------------------
async function renderLeases(container) {
  const leases = await fetchApi('/api/leases');
  container.innerHTML = `
    <div class="view-actions">
      <div class="filters-bar">
        <h2>System Digital Lease Agreements</h2>
      </div>
      ${['Super Admin', 'Property Manager', 'Landlord'].includes(state.user.role) ? `
        <button class="btn btn-primary" id="add-lease-btn"><i class="fa-solid fa-file-signature"></i> Draft New Lease</button>
      ` : ''}
    </div>
    
    <div class="table-responsive">
      <table class="table-custom">
        <thead>
          <tr>
            <th>Property & Unit</th>
            <th>Tenant Name</th>
            <th>Start Date</th>
            <th>End Date</th>
            <th>Monthly Rent</th>
            <th>Security Deposit</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${leases.length === 0 ? '<tr><td colspan="8" class="text-center">No lease contracts registered.</td></tr>' : leases.map(l => `
            <tr>
              <td>${l.property_name} - Unit ${l.unit_number}</td>
              <td><strong>${l.tenant_name}</strong></td>
              <td>${l.start_date}</td>
              <td>${l.end_date}</td>
              <td>${formatCurrency(l.rent_amount)}</td>
              <td>${formatCurrency(l.deposit_amount)}</td>
              <td><span class="badge badge-${l.status === 'Active' ? 'success' : (l.status === 'Pending' ? 'warning' : 'danger')}">${l.status}</span></td>
              <td class="actions-cell">
                <button class="btn btn-secondary btn-icon" onclick="viewLeaseAgreement(${l.id})" title="Print / Print to PDF"><i class="fa-solid fa-file-pdf"></i></button>
                ${l.status === 'Pending' && (state.user.role === 'Tenant' || ['Super Admin', 'Property Manager'].includes(state.user.role)) ? `
                  <button class="btn btn-primary btn-sm" onclick="openSignatureModal(${l.id})" title="Sign Contract"><i class="fa-solid fa-signature"></i> Sign</button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  if (document.getElementById('add-lease-btn')) {
    document.getElementById('add-lease-btn').addEventListener('click', () => {
      openLeaseModal();
    });
  }
}

window.viewLeaseAgreement = async function(id) {
  showLoader();
  try {
    const l = await fetchApi(`/api/leases/${id}`);
    
    document.getElementById('print-area').innerHTML = `
      <div class="document-header">
        <div class="doc-company">
          <h2>AuraRent Property Management</h2>
          <p>100 Executive Boulevard, Suite 500</p>
          <p>Austin, Texas, USA</p>
        </div>
        <div class="doc-title">
          <h1>LEASE AGREEMENT</h1>
          <p><strong>Agreement Number:</strong> LSE-AGR-${l.id}</p>
          <p><strong>Status:</strong> ${l.status.toUpperCase()}</p>
        </div>
      </div>

      <div class="doc-parties">
        <div class="doc-party">
          <h3>Landlord / Authority</h3>
          <p><strong>AuraRent System Authority</strong></p>
          <p>Representing: ${l.property_name}</p>
          <p>Location: ${l.property_address}, ${l.property_city}</p>
        </div>
        <div class="doc-party">
          <h3>Lessee / Tenant</h3>
          <p><strong>${l.tenant_name}</strong></p>
          <p>Email: ${l.tenant_email}</p>
          <p>Phone: ${l.tenant_phone}</p>
        </div>
      </div>

      <h3>1. RENTAL PREMISES & CONTRACT TERM</h3>
      <table class="doc-details-table">
        <thead>
          <tr>
            <th>Property Name</th>
            <th>Unit ID</th>
            <th>Commencement Date</th>
            <th>Expiration Date</th>
            <th>Monthly Rent Amount</th>
            <th>Required Security Deposit</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${l.property_name}</td>
            <td>Unit ${l.unit_number}</td>
            <td>${l.start_date}</td>
            <td>${l.end_date}</td>
            <td><strong>${formatCurrency(l.rent_amount)}</strong></td>
            <td><strong>${formatCurrency(l.deposit_amount)}</strong></td>
          </tr>
        </tbody>
      </table>

      <div class="doc-terms">
        <h3>2. AGREEMENT TERMS & COVENANTS</h3>
        <p>${l.terms || 'This document serves as a legally binding lease agreement between the landlord and the tenant. The tenant agrees to pay the monthly rental fee on or before the 5th business day of each month. Subletting is strictly prohibited. Noise regulations are enforced between 10:00 PM and 7:00 AM.'}</p>
      </div>

      <div class="doc-signatures">
        <div class="signature-box">
          <p style="margin-bottom:40px;"><strong>Landlord Signature</strong></p>
          <p>AuraRent Management Team</p>
        </div>
        <div class="signature-box">
          <p style="margin-bottom:10px;"><strong>Tenant Digital Signature</strong></p>
          ${l.signature_path ? `
            <img class="signature-img-print" src="${l.signature_path}" alt="Tenant Digital Signature">
            <p>${l.tenant_name}</p>
          ` : '<p style="color:var(--color-danger);font-style:italic;">Awaiting Signature</p>'}
        </div>
      </div>
    `;

    document.getElementById('modal-container').classList.remove('hidden');
    document.getElementById('print-view-modal').classList.remove('hidden');

  } catch (err) {}
  hideLoader();
};

// ------------------------------------------
// VIEW: INVOICES
// ------------------------------------------
async function renderInvoices(container) {
  const invoices = await fetchApi('/api/invoices');
  container.innerHTML = `
    <div class="view-actions">
      <div class="filters-bar">
        <h2>Invoices & Rent Billings Log</h2>
      </div>
      ${['Super Admin', 'Property Manager', 'Accountant'].includes(state.user.role) ? `
        <button class="btn btn-primary" id="add-invoice-btn"><i class="fa-solid fa-plus-circle"></i> Generate Custom Invoice</button>
      ` : ''}
    </div>
    
    <div class="table-responsive">
      <table class="table-custom">
        <thead>
          <tr>
            <th>Invoice ID</th>
            <th>Property & Unit</th>
            <th>Tenant Name</th>
            <th>Period</th>
            <th>Rent Due</th>
            <th>Utilities</th>
            <th>Total Due</th>
            <th>Paid</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${invoices.length === 0 ? '<tr><td colspan="10" class="text-center">No invoices generated.</td></tr>' : invoices.map(i => `
            <tr>
              <td><strong>${i.invoice_number}</strong></td>
              <td>${i.property_name} - Unit ${i.unit_number}</td>
              <td>${i.tenant_name}</td>
              <td>${i.billing_period}</td>
              <td>${formatCurrency(i.rent_due)}</td>
              <td>${formatCurrency(i.utilities_due)}</td>
              <td><strong>${formatCurrency(i.total_due)}</strong></td>
              <td style="color:var(--color-success);">${formatCurrency(i.paid_amount)}</td>
              <td><span class="badge badge-${i.status === 'Paid' ? 'success' : (i.status === 'Partially Paid' ? 'info' : (i.status === 'Overdue' ? 'danger' : 'warning'))}">${i.status}</span></td>
              <td class="actions-cell">
                <button class="btn btn-secondary btn-icon" onclick="viewInvoiceReceipt(${i.id})" title="Print invoice"><i class="fa-solid fa-receipt"></i></button>
                ${i.status !== 'Paid' ? `
                  <button class="btn btn-primary btn-sm" onclick="openPaymentModal(${i.id}, '${i.invoice_number}', ${i.total_due - i.paid_amount})"><i class="fa-solid fa-wallet"></i> Pay</button>
                ` : ''}
                ${['Super Admin', 'Property Manager', 'Accountant'].includes(state.user.role) && i.status !== 'Paid' ? `
                  <button class="btn btn-secondary btn-sm" onclick="chargePenalties(${i.id})" title="Charge Penalty"><i class="fa-solid fa-triangle-exclamation"></i> Late Fee</button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  if (document.getElementById('add-invoice-btn')) {
    document.getElementById('add-invoice-btn').addEventListener('click', () => {
      openInvoiceModal();
    });
  }
}

window.viewInvoiceReceipt = async function(id) {
  showLoader();
  try {
    const inv = await fetchApi(`/api/invoices/${id}`);
    
    document.getElementById('print-area').innerHTML = `
      <div class="document-header">
        <div class="doc-company">
          <h2>AuraRent Properties Ltd</h2>
          <p>${inv.property_address}</p>
          <p>${inv.property_city}, ${inv.property_state}</p>
        </div>
        <div class="doc-title">
          <h1>RENT INVOICE</h1>
          <p><strong>Invoice Number:</strong> ${inv.invoice_number}</p>
          <p><strong>Issue Date:</strong> ${inv.created_at.split(' ')[0]}</p>
          <p><strong>Due Date:</strong> ${inv.due_date}</p>
        </div>
      </div>

      <div class="doc-parties">
        <div class="doc-party">
          <h3>Billed To (Tenant)</h3>
          <p><strong>${inv.tenant_name}</strong></p>
          <p>Location: ${inv.property_name} - Unit ${inv.unit_number}</p>
          <p>Phone: ${inv.tenant_phone}</p>
        </div>
        <div class="doc-party">
          <h3>Payment Instructions</h3>
          <p>Please complete payment on the portal or wire funds to:</p>
          <p>Bank: Chase Bank Corporate</p>
          <p>Account Number: 9876-5432-1000</p>
        </div>
      </div>

      <table class="doc-details-table">
        <thead>
          <tr>
            <th>Billing Item Description</th>
            <th class="text-right">Charges</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Base Monthly Rent due for period: ${inv.billing_period}</td>
            <td class="text-right">${formatCurrency(inv.rent_due)}</td>
          </tr>
          <tr>
            <td>Accumulated Utility bills (Water, Electricity, Gas, Waste)</td>
            <td class="text-right">${formatCurrency(inv.utilities_due)}</td>
          </tr>
          <tr>
            <td>Assessed Penalties & Late payment charges</td>
            <td class="text-right" style="color:var(--color-danger);">${formatCurrency(inv.penalties)}</td>
          </tr>
          <tr style="border-top:2px solid #000;">
            <td><strong>Grand Total Due</strong></td>
            <td class="text-right"><strong>${formatCurrency(inv.total_due)}</strong></td>
          </tr>
          <tr>
            <td>Amount Settled / Paid to Date</td>
            <td class="text-right" style="color:var(--color-success);">${formatCurrency(inv.paid_amount)}</td>
          </tr>
          <tr style="background-color:#f9f9f9;">
            <td><strong>Outstanding Balance</strong></td>
            <td class="text-right"><strong>${formatCurrency(inv.total_due - inv.paid_amount)}</strong></td>
          </tr>
        </tbody>
      </table>

      <div class="doc-terms" style="margin-top:40px; border-top:1px dashed #ccc; padding-top:20px;">
        <p class="text-center" style="font-size:12px; color:var(--text-muted);">Thank you for choosing AuraRent. Please settle outstanding balances before the due date to avoid automated late fee penalties.</p>
      </div>
    `;

    document.getElementById('modal-container').classList.remove('hidden');
    document.getElementById('print-view-modal').classList.remove('hidden');

  } catch (err) {}
  hideLoader();
};

window.chargePenalties = async function(id) {
  const amount = prompt("Enter late fee penalty amount to apply ($):");
  if (amount !== null && !isNaN(amount)) {
    showLoader();
    try {
      await fetchApi(`/api/invoices/${id}/late-fees`, {
        method: 'PUT',
        body: JSON.stringify({ penalties: parseFloat(amount) })
      });
      showToast('Late fee penalties applied.');
      navigateTo('invoices');
    } catch (err) {}
    hideLoader();
  }
};

// ------------------------------------------
// VIEW: PAYMENTS
// ------------------------------------------
async function renderPayments(container) {
  const payments = await fetchApi('/api/payments');
  container.innerHTML = `
    <div class="view-actions">
      <h2>Rent Payment Transactions Logs</h2>
    </div>
    
    <div class="table-responsive">
      <table class="table-custom">
        <thead>
          <tr>
            <th>Receipt ID</th>
            <th>Invoice Ref</th>
            <th>Property & Unit</th>
            <th>Tenant Name</th>
            <th>Payment Date</th>
            <th>Payment Method</th>
            <th>Transaction Ref</th>
            <th>Amount Paid</th>
          </tr>
        </thead>
        <tbody>
          ${payments.length === 0 ? '<tr><td colspan="8" class="text-center">No payment transactions recorded.</td></tr>' : payments.map(p => `
            <tr>
              <td><strong>${p.receipt_number}</strong></td>
              <td>${p.invoice_number}</td>
              <td>${p.property_name} - Unit ${p.unit_number}</td>
              <td>${p.tenant_name}</td>
              <td>${p.payment_date.split(' ')[0]}</td>
              <td>${p.payment_method}</td>
              <td><code>${p.transaction_reference || 'N/A'}</code></td>
              <td style="color:var(--color-success);font-weight:700;">${formatCurrency(p.amount)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ------------------------------------------
// VIEW: MAINTENANCE
// ------------------------------------------
async function renderMaintenance(container) {
  const tickets = await fetchApi('/api/maintenance');
  container.innerHTML = `
    <div class="view-actions">
      <div class="filters-bar">
        <h2>Maintenance Work Orders</h2>
      </div>
      ${state.user.role === 'Tenant' ? `
        <button class="btn btn-primary" id="add-maint-btn"><i class="fa-solid fa-file-circle-plus"></i> Submit Request</button>
      ` : ''}
    </div>
    
    <div class="table-responsive">
      <table class="table-custom">
        <thead>
          <tr>
            <th>Ticket ID</th>
            <th>Property & Unit</th>
            <th>Category</th>
            <th>Details Description</th>
            <th>Priority</th>
            <th>Assigned Officer</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${tickets.length === 0 ? '<tr><td colspan="8" class="text-center">No maintenance requests logged.</td></tr>' : tickets.map(t => `
            <tr>
              <td><strong>TKT-${t.id}</strong></td>
              <td>${t.property_name} - Unit ${t.unit_number}</td>
              <td>${t.category}</td>
              <td>${t.description.length > 55 ? t.description.slice(0,55)+'...' : t.description}</td>
              <td><span class="badge badge-${t.priority === 'Emergency' || t.priority === 'High' ? 'danger' : 'warning'}">${t.priority}</span></td>
              <td>${t.officer_name || '<span style="color:var(--text-muted);">Unassigned</span>'}</td>
              <td><span class="badge badge-${t.status === 'Completed' ? 'success' : (t.status === 'Pending' ? 'danger' : 'info')}">${t.status}</span></td>
              <td class="actions-cell">
                <button class="btn btn-secondary btn-icon" onclick="viewMaintenanceDetail(${t.id})" title="View Details"><i class="fa-solid fa-eye"></i></button>
                ${['Super Admin', 'Property Manager', 'Maintenance Officer'].includes(state.user.role) ? `
                  <button class="btn btn-secondary btn-icon" onclick="editMaintenanceStatus(${t.id})" title="Update Status"><i class="fa-solid fa-pen-to-square"></i></button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  if (document.getElementById('add-maint-btn')) {
    document.getElementById('add-maint-btn').addEventListener('click', () => {
      openMaintenanceModal();
    });
  }
}

window.viewMaintenanceDetail = async function(id) {
  showLoader();
  try {
    const list = await fetchApi('/api/maintenance');
    const ticket = list.find(x => x.id === id);
    const contentPane = document.getElementById('main-content');
    document.getElementById('view-title').innerText = `Ticket: TKT-${id}`;

    contentPane.innerHTML = `
      <div style="margin-bottom:20px;">
        <button class="btn btn-secondary btn-sm" onclick="navigateTo('maintenance')"><i class="fa-solid fa-arrow-left"></i> Back to Tickets</button>
      </div>

      <div class="detail-layout">
        <div class="detail-main">
          <div class="card">
            <h2>Ticket Details</h2>
            <div class="profile-fields-grid" style="margin-top:15px; margin-bottom:20px;">
              <div>
                <span class="profile-field-label">Ticket ID</span>
                <div class="profile-field-val">TKT-${ticket.id}</div>
              </div>
              <div>
                <span class="profile-field-label">Category</span>
                <div class="profile-field-val">${ticket.category}</div>
              </div>
              <div>
                <span class="profile-field-label">Priority</span>
                <div class="profile-field-val">${ticket.priority}</div>
              </div>
              <div>
                <span class="profile-field-label">Date Submitted</span>
                <div class="profile-field-val">${ticket.created_at.split(' ')[0]}</div>
              </div>
            </div>
            <div class="form-group">
              <label>Work Order Description</label>
              <div class="nested-fields" style="background-color:var(--bg-primary);">
                ${ticket.description}
              </div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
            <div class="card">
              <h3>Image Before Repair</h3>
              <div style="margin-top:10px;text-align:center;">
                ${ticket.image_before ? `<img src="${ticket.image_before}" style="max-width:100%;max-height:220px;object-fit:contain;border-radius:6px;">` : '<p style="color:var(--text-muted);">No picture submitted.</p>'}
              </div>
            </div>
            <div class="card">
              <h3>Image After Repair</h3>
              <div style="margin-top:10px;text-align:center;">
                ${ticket.image_after ? `<img src="${ticket.image_after}" style="max-width:100%;max-height:220px;object-fit:contain;border-radius:6px;">` : '<p style="color:var(--text-muted);">No resolution picture submitted.</p>'}
              </div>
            </div>
          </div>
        </div>

        <div class="detail-sidebar">
          <div class="card">
            <h2>Location & Unit</h2>
            <h3 style="margin-top:10px;">Unit ${ticket.unit_number}</h3>
            <p>${ticket.property_name}</p>
          </div>

          <div class="card" style="margin-top:20px;">
            <h2>Assignment</h2>
            <p style="margin:10px 0;"><strong>Assigned Personnel:</strong> ${ticket.officer_name || 'Not assigned yet'}</p>
            <p><strong>Ticket Status:</strong> <span class="badge badge-${ticket.status === 'Completed' ? 'success' : 'danger'}">${ticket.status}</span></p>
          </div>
        </div>
      </div>
    `;
  } catch (err) {}
  hideLoader();
};

window.editMaintenanceStatus = async function(id) {
  const status = prompt("Update Ticket status (Pending, Assigned, In Progress, Completed, Cancelled):");
  if (!status) return;
  const officer = prompt("Assign Officer ID (User ID):");

  showLoader();
  try {
    await fetchApi(`/api/maintenance/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        status,
        assigned_officer_id: officer ? parseInt(officer) : undefined
      })
    });
    showToast('Maintenance ticket updated successfully.');
    navigateTo('maintenance');
  } catch (err) {}
  hideLoader();
};

// ------------------------------------------
// VIEW: UTILITIES
// ------------------------------------------
async function renderUtilities(container) {
  const readings = await fetchApi('/api/utilities');
  container.innerHTML = `
    <div class="view-actions">
      <div class="filters-bar">
        <h2>Utility Billing Meters Logs</h2>
      </div>
      ${['Super Admin', 'Property Manager', 'Accountant'].includes(state.user.role) ? `
        <button class="btn btn-primary" id="add-utility-btn"><i class="fa-solid fa-plus-circle"></i> Log Meter Reading</button>
      ` : ''}
    </div>
    
    <div class="table-responsive">
      <table class="table-custom">
        <thead>
          <tr>
            <th>Property & Unit</th>
            <th>Utility Type</th>
            <th>Reading Date</th>
            <th>Previous Reading</th>
            <th>Current Reading</th>
            <th>Units Used</th>
            <th>Rate</th>
            <th>Charged Value</th>
            <th>Invoice Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${readings.length === 0 ? '<tr><td colspan="10" class="text-center">No utility readings logged.</td></tr>' : readings.map(r => `
            <tr>
              <td>${r.property_name} - Unit ${r.unit_number}</td>
              <td><strong>${r.utility_type}</strong></td>
              <td>${r.reading_date}</td>
              <td>${r.previous_reading}</td>
              <td>${r.current_reading}</td>
              <td><strong>${(r.current_reading - r.previous_reading).toFixed(2)}</strong></td>
              <td>${formatCurrency(r.rate)}</td>
              <td><strong>${formatCurrency(r.amount)}</strong></td>
              <td><span class="badge badge-${r.status === 'Billed' ? 'success' : 'warning'}">${r.status}</span></td>
              <td class="actions-cell">
                ${r.status === 'Pending' && ['Super Admin', 'Property Manager', 'Accountant'].includes(state.user.role) ? `
                  <button class="btn btn-primary btn-sm" onclick="billUtility(${r.id})"><i class="fa-solid fa-file-invoice"></i> Bill Tenant</button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  if (document.getElementById('add-utility-btn')) {
    document.getElementById('add-utility-btn').addEventListener('click', () => {
      openUtilityModal();
    });
  }
}

window.billUtility = async function(id) {
  showLoader();
  try {
    await fetchApi(`/api/utilities/${id}/bill`, { method: 'POST' });
    showToast('Utility reading billed successfully. Invoice generated.');
    navigateTo('utilities');
  } catch (err) {}
  hideLoader();
};

// ------------------------------------------
// VIEW: EXPENSES
// ------------------------------------------
async function renderExpenses(container) {
  const expenses = await fetchApi('/api/expenses');
  container.innerHTML = `
    <div class="view-actions">
      <div class="filters-bar">
        <h2>Corporate Bookkeeping Expenses</h2>
      </div>
      <button class="btn btn-primary" id="add-expense-btn"><i class="fa-solid fa-plus-circle"></i> Log Expense</button>
    </div>
    
    <div class="table-responsive">
      <table class="table-custom">
        <thead>
          <tr>
            <th>Date</th>
            <th>Property Reference</th>
            <th>Expense Category</th>
            <th>Description / Memo</th>
            <th>Log Agent</th>
            <th>Receipt File</th>
            <th>Value ($)</th>
          </tr>
        </thead>
        <tbody>
          ${expenses.length === 0 ? '<tr><td colspan="7" class="text-center">No corporate expenses logged.</td></tr>' : expenses.map(e => `
            <tr>
              <td>${e.expense_date}</td>
              <td>${e.property_name}</td>
              <td><strong>${e.category}</strong></td>
              <td>${e.description}</td>
              <td>${e.recorded_by_name}</td>
              <td>${e.receipt_path ? `<a href="${e.receipt_path}" target="_blank"><i class="fa-solid fa-file-image"></i> View Receipt</a>` : 'None'}</td>
              <td style="color:var(--color-danger);font-weight:700;">- ${formatCurrency(e.amount)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('add-expense-btn').addEventListener('click', () => {
    openExpenseModal();
  });
}

// ------------------------------------------
// VIEW: VISITORS
// ------------------------------------------
async function renderVisitors(container) {
  const visitors = await fetchApi('/api/visitors');
  container.innerHTML = `
    <div class="view-actions">
      <div class="filters-bar">
        <h2>Reception Gate Check-in Pass Logs</h2>
      </div>
      ${['Super Admin', 'Property Manager', 'Receptionist'].includes(state.user.role) ? `
        <button class="btn btn-primary" id="add-visitor-btn"><i class="fa-solid fa-user-shield"></i> Check-in Visitor</button>
      ` : ''}
    </div>
    
    <div class="table-responsive">
      <table class="table-custom">
        <thead>
          <tr>
            <th>Visitor Name</th>
            <th>Contact Phone</th>
            <th>Property & Unit</th>
            <th>Host Resident</th>
            <th>Purpose</th>
            <th>Check-in Time</th>
            <th>Check-out Time</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${visitors.length === 0 ? '<tr><td colspan="8" class="text-center">No visitors registered.</td></tr>' : visitors.map(v => `
            <tr>
              <td><strong>${v.visitor_name}</strong></td>
              <td>${v.phone_number}</td>
              <td>${v.property_name} - Unit ${v.unit_number}</td>
              <td>${v.host_name}</td>
              <td>${v.purpose}</td>
              <td>${v.check_in.split(' ')[1] || v.check_in}</td>
              <td>${v.check_out ? v.check_out.split(' ')[1] : '<span style="color:var(--color-danger);">Active Check-in</span>'}</td>
              <td class="actions-cell">
                ${!v.check_out && ['Super Admin', 'Property Manager', 'Receptionist'].includes(state.user.role) ? `
                  <button class="btn btn-danger btn-sm" onclick="checkoutVisitor(${v.id})"><i class="fa-solid fa-right-from-bracket"></i> Check-out</button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  if (document.getElementById('add-visitor-btn')) {
    document.getElementById('add-visitor-btn').addEventListener('click', () => {
      openVisitorModal();
    });
  }
}

window.checkoutVisitor = async function(id) {
  showLoader();
  try {
    await fetchApi(`/api/visitors/${id}/checkout`, { method: 'PUT' });
    showToast('Visitor checked out successfully.');
    navigateTo('visitors');
  } catch (err) {}
  hideLoader();
};

// ------------------------------------------
// VIEW: AUDIT LOGS (Super Admin only)
// ------------------------------------------
async function renderAuditLogs(container) {
  const logs = await fetchApi('/api/audit-logs');
  container.innerHTML = `
    <div class="view-actions">
      <h2>Security and System Audit Logging Records</h2>
    </div>
    
    <div class="table-responsive">
      <table class="table-custom">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Trigger Agent</th>
            <th>Role</th>
            <th>Security Event/Action</th>
            <th>Details Description</th>
            <th>IP Address</th>
          </tr>
        </thead>
        <tbody>
          ${logs.length === 0 ? '<tr><td colspan="6" class="text-center">No system audits recorded.</td></tr>' : logs.map(l => `
            <tr>
              <td><code>${l.created_at}</code></td>
              <td><strong>${l.username || 'System'}</strong></td>
              <td>${l.role || 'N/A'}</td>
              <td><span class="badge badge-info">${l.action}</span></td>
              <td>${l.details}</td>
              <td><code>${l.ip_address}</code></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ------------------------------------------
// VIEW: REPORTS (Revenues, Expenses, P&L, Occupancy)
// ------------------------------------------
async function renderReports(container) {
  const plData = await fetchApi('/api/reports/profit-loss');
  container.innerHTML = `
    <div class="view-actions">
      <div class="filters-bar">
        <h2>Financial and Occupancy Reports Center</h2>
      </div>
      <button class="btn btn-secondary" onclick="exportPLToCSV()"><i class="fa-solid fa-file-csv"></i> Export Profit & Loss (CSV)</button>
    </div>

    <div class="card" style="margin-bottom:30px;">
      <h3><i class="fa-solid fa-scale-balanced"></i> Corporate Profit & Loss Statement</h3>
      <div class="table-responsive" style="margin-top:15px;">
        <table class="table-custom">
          <thead>
            <tr>
              <th>Month</th>
              <th>Revenue Collected</th>
              <th>Expenses Booked</th>
              <th>Net Operating Profit</th>
            </tr>
          </thead>
          <tbody>
            ${plData.length === 0 ? '<tr><td colspan="4" class="text-center">No operating history found.</td></tr>' : plData.map(d => `
              <tr>
                <td><strong>${d.month}</strong></td>
                <td style="color:var(--color-success);font-weight:600;">+ ${formatCurrency(d.revenue)}</td>
                <td style="color:var(--color-danger);">- ${formatCurrency(d.expenses)}</td>
                <td style="font-weight:700;color:${d.net_profit >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};">
                  ${formatCurrency(d.net_profit)}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  window.exportPLToCSV = function() {
    let csv = 'Month,Revenue,Expenses,Net Profit\n';
    plData.forEach(row => {
      csv += `${row.month},${row.revenue},${row.expenses},${row.net_profit}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `profit_loss_report_${Date.now()}.csv`;
    link.click();
    showToast('Report exported successfully.');
  };
}

// ==========================================
// NOTIFICATIONS BELL & UTILS
// ==========================================
function updateNotificationsUI(notifications) {
  const countSpan = document.getElementById('notification-badge-count');
  const dropdown = document.getElementById('notifications-list');
  
  if (!notifications || notifications.length === 0) {
    countSpan.classList.add('hidden');
    dropdown.innerHTML = '<div class="empty-state">No notifications.</div>';
    return;
  }

  countSpan.classList.remove('hidden');
  countSpan.innerText = notifications.length;

  dropdown.innerHTML = notifications.map(n => `
    <div class="notification-item">
      <span class="notif-title">${n.type}</span>
      <span class="notif-msg">${n.message}</span>
      <span class="notif-time">${n.date}</span>
    </div>
  `).join('');
}

function initNotificationsDropdown() {
  const bell = document.getElementById('notifications-bell');
  const dropdown = document.getElementById('notifications-dropdown');
  
  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
  });

  document.getElementById('clear-notifications').addEventListener('click', () => {
    updateNotificationsUI([]);
    showToast('Notifications cleared');
  });

  document.addEventListener('click', () => {
    dropdown.classList.add('hidden');
  });
}

// ==========================================
// MODALS TRIGGER LOGIC & FORMS
// ==========================================

function closeAllModals() {
  document.getElementById('modal-container').classList.add('hidden');
  document.getElementById('property-modal').classList.add('hidden');
  document.getElementById('unit-modal').classList.add('hidden');
  document.getElementById('tenant-modal').classList.add('hidden');
  document.getElementById('lease-modal').classList.add('hidden');
  document.getElementById('signature-modal').classList.add('hidden');
  document.getElementById('payment-modal').classList.add('hidden');
  document.getElementById('utility-modal').classList.add('hidden');
  document.getElementById('expense-modal').classList.add('hidden');
  document.getElementById('visitor-modal').classList.add('hidden');
  document.getElementById('print-view-modal').classList.add('hidden');
}

// Close Triggers
document.querySelectorAll('.close-modal-btn, .btn-close-modal').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    closeAllModals();
  });
});

document.getElementById('modal-container').addEventListener('click', (e) => {
  if (e.target.id === 'modal-container') {
    closeAllModals();
  }
});

async function openPropertyModal() {
  document.getElementById('property-form').reset();
  document.getElementById('prop-id').value = '';
  document.getElementById('property-modal-title').innerText = 'Add Property';
  
  // Clear payment fields
  document.getElementById('prop-bank-name').value = '';
  document.getElementById('prop-bank-account').value = '';
  document.getElementById('prop-mobile-money').value = '';
  document.getElementById('prop-credit-card').value = '';
  document.getElementById('prop-gateway-type').value = 'stripe';
  document.getElementById('prop-stripe-secret').value = '';
  document.getElementById('prop-stripe-publishable').value = '';

  propertyFormMedia = {
    existingImages: [],
    existingVideos: [],
    newImages: [],
    newVideos: []
  };
  renderPropertyMediaPreviews();
  
  document.getElementById('modal-container').classList.remove('hidden');
  document.getElementById('property-modal').classList.remove('hidden');
}

window.editProperty = async function(id) {
  showLoader();
  try {
    const p = await fetchApi(`/api/properties/${id}`);
    
    document.getElementById('prop-id').value = p.id;
    document.getElementById('prop-name').value = p.name;
    document.getElementById('prop-code').value = p.code;
    document.getElementById('prop-type').value = p.type;
    document.getElementById('prop-owner').value = p.owner_id || 3;
    document.getElementById('prop-address').value = p.address;
    document.getElementById('prop-city').value = p.city;
    document.getElementById('prop-state').value = p.state;
    document.getElementById('prop-country').value = p.country;
    document.getElementById('prop-floors').value = p.floors;
    document.getElementById('prop-units').value = p.units_count;
    document.getElementById('prop-lat').value = p.gps_lat || '';
    document.getElementById('prop-lng').value = p.gps_lng || '';
    document.getElementById('prop-amenities').value = p.amenities || '';
    document.getElementById('prop-description').value = p.description || '';

    // Populate payment fields
    document.getElementById('prop-bank-name').value = p.bank_name || '';
    document.getElementById('prop-bank-account').value = p.bank_account || '';
    document.getElementById('prop-mobile-money').value = p.mobile_money_number || '';
    document.getElementById('prop-credit-card').value = p.credit_card_details || '';
    document.getElementById('prop-gateway-type').value = p.online_gateway_type || 'stripe';
    document.getElementById('prop-stripe-secret').value = p.online_gateway_secret || '';
    document.getElementById('prop-stripe-publishable').value = p.online_gateway_publishable || '';

    let existingImgs = [];
    let existingVids = [];
    try {
      existingImgs = JSON.parse(p.images || '[]');
    } catch(e) {}
    try {
      existingVids = JSON.parse(p.videos || '[]');
    } catch(e) {}

    propertyFormMedia = {
      existingImages: existingImgs,
      existingVideos: existingVids,
      newImages: [],
      newVideos: []
    };
    renderPropertyMediaPreviews();

    document.getElementById('property-modal-title').innerText = 'Edit Property';
    document.getElementById('modal-container').classList.remove('hidden');
    document.getElementById('property-modal').classList.remove('hidden');
  } catch (err) {}
  hideLoader();
};

document.getElementById('property-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('prop-id').value;

  showLoader();
  try {
    // Upload new images
    const uploadedImages = [];
    for (const file of propertyFormMedia.newImages) {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetchApi('/api/upload-media', {
        method: 'POST',
        body: formData
      });
      if (res && res.filepath) {
        uploadedImages.push(res.filepath);
      }
    }

    // Upload new videos
    const uploadedVideos = [];
    for (const file of propertyFormMedia.newVideos) {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetchApi('/api/upload-media', {
        method: 'POST',
        body: formData
      });
      if (res && res.filepath) {
        uploadedVideos.push(res.filepath);
      }
    }

    const finalImages = [...propertyFormMedia.existingImages, ...uploadedImages];
    const finalVideos = [...propertyFormMedia.existingVideos, ...uploadedVideos];

    const payload = {
      name: document.getElementById('prop-name').value,
      code: document.getElementById('prop-code').value,
      type: document.getElementById('prop-type').value,
      owner_id: parseInt(document.getElementById('prop-owner').value),
      address: document.getElementById('prop-address').value,
      city: document.getElementById('prop-city').value,
      state: document.getElementById('prop-state').value,
      country: document.getElementById('prop-country').value,
      floors: parseInt(document.getElementById('prop-floors').value),
      units_count: parseInt(document.getElementById('prop-units').value),
      gps_lat: parseFloat(document.getElementById('prop-lat').value) || null,
      gps_lng: parseFloat(document.getElementById('prop-lng').value) || null,
      amenities: document.getElementById('prop-amenities').value,
      description: document.getElementById('prop-description').value,
      images: JSON.stringify(finalImages),
      videos: JSON.stringify(finalVideos),
      bank_name: document.getElementById('prop-bank-name').value || null,
      bank_account: document.getElementById('prop-bank-account').value || null,
      mobile_money_number: document.getElementById('prop-mobile-money').value || null,
      credit_card_details: document.getElementById('prop-credit-card').value || null,
      online_gateway_type: document.getElementById('prop-gateway-type').value || 'stripe',
      online_gateway_secret: document.getElementById('prop-stripe-secret').value || null,
      online_gateway_publishable: document.getElementById('prop-stripe-publishable').value || null
    };

    if (id) {
      await fetchApi(`/api/properties/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      showToast('Property updated successfully');
      viewPropertyDetail(id);
    } else {
      await fetchApi('/api/properties', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast('Property created successfully');
      navigateTo('properties');
    }
    closeAllModals();
  } catch (err) {
    console.error(err);
  }
  hideLoader();
});

window.deleteProperty = async function(id) {
  if (confirm('Are you sure you want to permanently delete this property? This action is irreversible.')) {
    showLoader();
    try {
      await fetchApi(`/api/properties/${id}`, { method: 'DELETE' });
      showToast('Property deleted successfully.');
      navigateTo('properties');
    } catch (err) {}
    hideLoader();
  }
};

// 2. Unit Modal Form
window.openUnitModal = async function(propId = null) {
  document.getElementById('unit-form').reset();
  document.getElementById('unit-id').value = '';
  document.getElementById('unit-modal-title').innerText = 'Add Unit';

  // Populates property options
  const props = await fetchApi('/api/properties');
  const select = document.getElementById('unit-property-id');
  select.innerHTML = props.map(p => `<option value="${p.id}" ${propId && p.id === propId ? 'selected':''}>${p.name}</option>`).join('');

  document.getElementById('modal-container').classList.remove('hidden');
  document.getElementById('unit-modal').classList.remove('hidden');
};

window.editUnit = async function(id) {
  showLoader();
  try {
    const u = await fetchApi(`/api/units/${id}`);
    const props = await fetchApi('/api/properties');
    
    const select = document.getElementById('unit-property-id');
    select.innerHTML = props.map(p => `<option value="${p.id}" ${p.id === u.property_id ? 'selected':''}>${p.name}</option>`).join('');

    document.getElementById('unit-id').value = u.id;
    document.getElementById('unit-number').value = u.unit_number;
    document.getElementById('unit-floor').value = u.floor;
    document.getElementById('unit-bedrooms').value = u.bedrooms;
    document.getElementById('unit-bathrooms').value = u.bathrooms;
    document.getElementById('unit-rent').value = u.monthly_rent;
    document.getElementById('unit-deposit').value = u.deposit;
    document.getElementById('unit-service').value = u.service_charge;
    document.getElementById('unit-status').value = u.status;

    document.getElementById('unit-modal-title').innerText = 'Edit Unit';
    document.getElementById('modal-container').classList.remove('hidden');
    document.getElementById('unit-modal').classList.remove('hidden');
  } catch (err) {}
  hideLoader();
};

document.getElementById('unit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('unit-id').value;
  const payload = {
    property_id: parseInt(document.getElementById('unit-property-id').value),
    unit_number: document.getElementById('unit-number').value,
    floor: parseInt(document.getElementById('unit-floor').value),
    bedrooms: parseInt(document.getElementById('unit-bedrooms').value),
    bathrooms: parseFloat(document.getElementById('unit-bathrooms').value),
    monthly_rent: parseFloat(document.getElementById('unit-rent').value),
    deposit: parseFloat(document.getElementById('unit-deposit').value),
    service_charge: parseFloat(document.getElementById('unit-service').value) || 0,
    status: document.getElementById('unit-status').value
  };

  showLoader();
  try {
    if (id) {
      await fetchApi(`/api/units/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      showToast('Unit settings updated');
      viewUnitDetail(id);
    } else {
      await fetchApi('/api/units', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast('Unit added successfully');
      viewPropertyDetail(payload.property_id);
    }
    closeAllModals();
  } catch (err) {}
  hideLoader();
});

window.deleteUnit = async function(id) {
  if (confirm('Delete this unit?')) {
    showLoader();
    try {
      const u = await fetchApi(`/api/units/${id}`);
      await fetchApi(`/api/units/${id}`, { method: 'DELETE' });
      showToast('Unit deleted');
      viewPropertyDetail(u.property_id);
    } catch (err) {}
    hideLoader();
  }
};

// 3. Tenant Register Modal Form
async function openTenantModal() {
  document.getElementById('tenant-form').reset();
  document.getElementById('modal-container').classList.remove('hidden');
  document.getElementById('tenant-modal').classList.remove('hidden');
}

document.getElementById('tenant-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    username: document.getElementById('tenant-username').value,
    email: document.getElementById('tenant-email').value,
    password: document.getElementById('tenant-password').value,
    full_name: document.getElementById('tenant-fullname').value,
    phone: document.getElementById('tenant-phone').value,
    national_id: document.getElementById('tenant-nid').value,
    passport_number: document.getElementById('tenant-passport').value,
    dob: document.getElementById('tenant-dob').value,
    occupation: document.getElementById('tenant-occupation').value,
    employer: document.getElementById('tenant-employer').value,
    emergency_contact: {
      name: document.getElementById('tenant-emergency-name').value,
      phone: document.getElementById('tenant-emergency-phone').value,
      relation: document.getElementById('tenant-emergency-relation').value
    },
    guarantor: {
      name: document.getElementById('tenant-guarantor-name').value,
      phone: document.getElementById('tenant-guarantor-phone').value,
      income: parseFloat(document.getElementById('tenant-guarantor-income').value) || 0
    }
  };

  showLoader();
  try {
    await fetchApi('/api/tenants', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    showToast('Tenant registered successfully.');
    closeAllModals();
    navigateTo('tenants');
  } catch (err) {}
  hideLoader();
});

// 4. Lease Create Modal
window.openLeaseModal = async function(tenantId = null) {
  document.getElementById('lease-form').reset();
  
  // Populate vacant units
  const units = await fetchApi('/api/units');
  const unitSelect = document.getElementById('lease-unit-id');
  const vacant = units.filter(u => u.status === 'Vacant');
  unitSelect.innerHTML = vacant.map(u => `<option value="${u.id}" data-rent="${u.monthly_rent}" data-dep="${u.deposit}">${u.property_name} - Unit ${u.unit_number}</option>`).join('');

  // Populate tenants
  const tenants = await fetchApi('/api/tenants');
  const tenantSelect = document.getElementById('lease-tenant-id');
  tenantSelect.innerHTML = tenants.map(t => `<option value="${t.id}" ${tenantId && t.id === tenantId ? 'selected':''}>${t.full_name}</option>`).join('');

  // Auto populate values from unit settings
  const updateRentDep = () => {
    const selected = unitSelect.options[unitSelect.selectedIndex];
    if (selected) {
      document.getElementById('lease-rent').value = selected.getAttribute('data-rent');
      document.getElementById('lease-deposit').value = selected.getAttribute('data-dep');
    }
  };
  unitSelect.onchange = updateRentDep;
  updateRentDep();

  document.getElementById('modal-container').classList.remove('hidden');
  document.getElementById('lease-modal').classList.remove('hidden');
};

document.getElementById('lease-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    unit_id: parseInt(document.getElementById('lease-unit-id').value),
    tenant_id: parseInt(document.getElementById('lease-tenant-id').value),
    start_date: document.getElementById('lease-start').value,
    end_date: document.getElementById('lease-end').value,
    rent_amount: parseFloat(document.getElementById('lease-rent').value),
    deposit_amount: parseFloat(document.getElementById('lease-deposit').value),
    terms: document.getElementById('lease-terms').value
  };

  showLoader();
  try {
    await fetchApi('/api/leases', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    showToast('Lease drafted successfully. Signature requested.');
    closeAllModals();
    navigateTo('leases');
  } catch (err) {}
  hideLoader();
});

// 5. Signature Draw Canvas Modal
window.openSignatureModal = function(leaseId) {
  document.getElementById('sign-lease-id').value = leaseId;
  document.getElementById('modal-container').classList.remove('hidden');
  document.getElementById('signature-modal').classList.remove('hidden');

  // Initialize Canvas Context
  sigCanvas = document.getElementById('signature-pad');
  sigCtx = sigCanvas.getContext('2d');
  sigCtx.strokeStyle = '#000000';
  sigCtx.lineWidth = 2;
  
  // Clear canvas
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
};

// Canvas drawing events listener
document.addEventListener('DOMContentLoaded', () => {
  const pad = document.getElementById('signature-pad');
  if (!pad) return;

  const getPos = (e) => {
    const rect = pad.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDraw = (e) => {
    isDrawing = true;
    const pos = getPos(e);
    sigCtx.beginPath();
    sigCtx.moveTo(pos.x, pos.y);
    e.preventDefault();
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const pos = getPos(e);
    sigCtx.lineTo(pos.x, pos.y);
    sigCtx.stroke();
    e.preventDefault();
  };

  const stopDraw = () => {
    isDrawing = false;
  };

  pad.addEventListener('mousedown', startDraw);
  pad.addEventListener('mousemove', draw);
  window.addEventListener('mouseup', stopDraw);

  pad.addEventListener('touchstart', startDraw);
  pad.addEventListener('touchmove', draw);
  window.addEventListener('touchend', stopDraw);

  document.getElementById('clear-sig-btn').addEventListener('click', () => {
    sigCtx.clearRect(0, 0, pad.width, pad.height);
  });
});

document.getElementById('signature-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const leaseId = document.getElementById('sign-lease-id').value;
  const signature_data = sigCanvas.toDataURL('image/png');

  showLoader();
  try {
    await fetchApi(`/api/leases/${leaseId}/sign`, {
      method: 'POST',
      body: JSON.stringify({ signature_data })
    });
    showToast('Lease signed and activated.');
    closeAllModals();
    navigateTo('leases');
  } catch (err) {}
  hideLoader();
});

// 6. Payment Modal Form
window.currentLandlordSettings = null;

function updateLandlordPaymentInfoText() {
  const method = document.getElementById('pay-method').value;
  const infoBox = document.getElementById('landlord-payment-info');
  const detailsText = document.getElementById('landlord-payment-details-text');
  if (!infoBox || !detailsText) return;

  const settings = window.currentLandlordSettings;
  if (!settings) {
    infoBox.classList.add('hidden');
    return;
  }

  let html = '';
  if (method === 'Bank Transfer') {
    if (settings.bank_name && settings.bank_account) {
      html = `Transfer to Bank: <strong>${settings.bank_name}</strong><br>Account Number: <strong>${settings.bank_account}</strong>`;
    } else {
      html = `<em>Bank Transfer details are not configured by the Landlord. Please contact management.</em>`;
    }
  } else if (method === 'Mobile Money') {
    if (settings.mobile_money_number) {
      html = `Pay to Mobile Money Number: <strong>${settings.mobile_money_number}</strong>`;
    } else {
      html = `<em>Mobile Money details are not configured by the Landlord. Please contact management.</em>`;
    }
  } else if (method === 'Online Payment Gateway' || method === 'Credit Card') {
    const gwName = (settings.online_gateway_type || 'stripe').toUpperCase();
    if (settings.online_gateway_publishable || settings.credit_card_details) {
      html = `Secure online card payment using landlord gateway (${gwName}) credentials.`;
    } else {
      html = `Secure online card payment using default portal gateway (${gwName}).`;
    }
  } else if (method === 'Cash') {
    html = `Please make cash payment directly to the property management office.`;
  }

  if (html) {
    detailsText.innerHTML = html;
    infoBox.classList.remove('hidden');
  } else {
    infoBox.classList.add('hidden');
  }
}

window.openPaymentModal = async function(invoiceId, number, outstanding) {
  document.getElementById('pay-invoice-id').value = invoiceId;
  document.getElementById('pay-details-number').innerText = number;
  document.getElementById('pay-details-amount').innerText = `${formatCurrency(outstanding)} Outstanding`;
  document.getElementById('pay-amount').value = outstanding;
  
  // Clear and hide landlord info by default
  const infoBox = document.getElementById('landlord-payment-info');
  if (infoBox) infoBox.classList.add('hidden');

  // Fetch landlord payment details
  window.currentLandlordSettings = null;
  try {
    const settings = await fetchApi(`/api/invoices/${invoiceId}/landlord-payment-settings`);
    window.currentLandlordSettings = settings;
  } catch (err) {
    console.error('Failed to load landlord payment settings', err);
  }
  
  // Trigger update info text
  updateLandlordPaymentInfoText();

  document.getElementById('modal-container').classList.remove('hidden');
  document.getElementById('payment-modal').classList.remove('hidden');
};

document.getElementById('payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const invoice_id = parseInt(document.getElementById('pay-invoice-id').value);
  const payment_method = document.getElementById('pay-method').value;
  const amount = parseFloat(document.getElementById('pay-amount').value);
  const transaction_reference = document.getElementById('pay-ref').value;

  showLoader();
  try {
    if (payment_method === 'Online Payment Gateway' || payment_method === 'Credit Card') {
      const res = await fetchApi('/api/payments/checkout-session', {
        method: 'POST',
        body: JSON.stringify({ invoice_id, amount })
      });
      if (res && res.url) {
        window.location.href = res.url;
        return; // Navigate to Stripe Checkout
      } else {
        throw new Error('No redirect URL returned by Stripe.');
      }
    } else {
      const res = await fetchApi('/api/payments', {
        method: 'POST',
        body: JSON.stringify({ invoice_id, payment_method, amount, transaction_reference })
      });
      showToast(`Payment registered. Receipt: ${res.receipt_number}`);
      closeAllModals();
      navigateTo('invoices');
    }
  } catch (err) {}
  hideLoader();
});

// 6.5 Tenant Application Modal Form
window.openApplyModal = function(unitId, unitNumber, rent, deposit) {
  document.getElementById('apply-unit-id').value = unitId;
  document.getElementById('apply-details-unit').innerText = `Unit ${unitNumber}`;
  document.getElementById('apply-details-pricing').innerText = `${formatCurrency(rent)}/mo (${formatCurrency(deposit)} Deposit)`;

  const today = new Date();
  document.getElementById('apply-start-date').value = today.toISOString().split('T')[0];

  const nextYear = new Date();
  nextYear.setFullYear(today.getFullYear() + 1);
  document.getElementById('apply-end-date').value = nextYear.toISOString().split('T')[0];

  document.getElementById('apply-terms').value = '';

  document.getElementById('modal-container').classList.remove('hidden');
  document.getElementById('apply-modal').classList.remove('hidden');
};

document.getElementById('apply-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    unit_id: parseInt(document.getElementById('apply-unit-id').value),
    start_date: document.getElementById('apply-start-date').value,
    end_date: document.getElementById('apply-end-date').value,
    terms: document.getElementById('apply-terms').value
  };

  showLoader();
  try {
    const res = await fetchApi('/api/leases/apply', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    showToast(res.message);
    closeAllModals();
    navigateTo('leases');
  } catch (err) {}
  hideLoader();
});

// 7. Utility Meter Reading Modal
async function openUtilityModal() {
  document.getElementById('utility-form').reset();
  
  // Populate units
  const units = await fetchApi('/api/units');
  const select = document.getElementById('util-unit-id');
  select.innerHTML = units.map(u => `<option value="${u.id}">${u.property_name} - Unit ${u.unit_number}</option>`).join('');

  document.getElementById('modal-container').classList.remove('hidden');
  document.getElementById('utility-modal').classList.remove('hidden');
}

document.getElementById('utility-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    unit_id: parseInt(document.getElementById('util-unit-id').value),
    utility_type: document.getElementById('util-type').value,
    reading_date: document.getElementById('util-date').value,
    previous_reading: parseFloat(document.getElementById('util-prev').value),
    current_reading: parseFloat(document.getElementById('util-curr').value),
    rate: parseFloat(document.getElementById('util-rate').value)
  };

  showLoader();
  try {
    await fetchApi('/api/utilities', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    showToast('Utility reading logged successfully.');
    closeAllModals();
    navigateTo('utilities');
  } catch (err) {}
  hideLoader();
});

// 8. Expense Form Modal
async function openExpenseModal() {
  document.getElementById('expense-form').reset();

  const props = await fetchApi('/api/properties');
  const select = document.getElementById('exp-property-id');
  select.innerHTML = props.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

  document.getElementById('modal-container').classList.remove('hidden');
  document.getElementById('expense-modal').classList.remove('hidden');
}

document.getElementById('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData();
  formData.append('property_id', document.getElementById('exp-property-id').value);
  formData.append('category', document.getElementById('exp-category').value);
  formData.append('expense_date', document.getElementById('exp-date').value);
  formData.append('amount', document.getElementById('exp-amount').value);
  formData.append('description', document.getElementById('exp-description').value);
  
  const fileInput = document.getElementById('exp-receipt');
  if (fileInput.files.length > 0) {
    formData.append('receipt', fileInput.files[0]);
  }

  showLoader();
  try {
    await fetchApi('/api/expenses', {
      method: 'POST',
      body: formData
    });
    showToast('Expense transaction recorded.');
    closeAllModals();
    navigateTo('expenses');
  } catch (err) {}
  hideLoader();
});

// 9. Visitor Check-in Modal
async function openVisitorModal() {
  document.getElementById('visitor-form').reset();

  // Populate active residents tenants
  const tenants = await fetchApi('/api/tenants');
  const active = tenants.filter(t => t.lease_status === 'Active');
  const select = document.getElementById('vis-host-id');
  select.innerHTML = active.map(t => `<option value="${t.id}">${t.full_name} (${t.property_name} - ${t.unit_number})</option>`).join('');

  document.getElementById('modal-container').classList.remove('hidden');
  document.getElementById('visitor-modal').classList.remove('hidden');
}

document.getElementById('visitor-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    visitor_name: document.getElementById('vis-name').value,
    phone_number: document.getElementById('vis-phone').value,
    host_tenant_id: parseInt(document.getElementById('vis-host-id').value),
    purpose: document.getElementById('vis-purpose').value
  };

  showLoader();
  try {
    await fetchApi('/api/visitors', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    showToast('Visitor registered at reception gate.');
    closeAllModals();
    navigateTo('visitors');
  } catch (err) {}
  hideLoader();
});

// 10. Maintenance ticket creation modal
async function openMaintenanceModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-card';
  modal.id = 'temp-maint-modal';
  modal.innerHTML = `
    <div class="modal-header">
      <h2>Log Maintenance Request</h2>
      <button class="close-modal-btn" onclick="closeTempModal()">&times;</button>
    </div>
    <form id="temp-maint-form" enctype="multipart/form-data" style="padding:24px;">
      <div class="form-group">
        <label for="maint-category">Issue Category *</label>
        <select id="maint-category" required>
          <option value="Plumbing">Plumbing</option>
          <option value="Electrical">Electrical</option>
          <option value="Carpentry">Carpentry</option>
          <option value="Painting">Painting</option>
          <option value="Roofing">Roofing</option>
          <option value="Cleaning">Cleaning</option>
          <option value="Security">Security</option>
        </select>
      </div>
      <div class="form-group">
        <label for="maint-priority">Severity Priority *</label>
        <select id="maint-priority" required>
          <option value="Low">Low - Normal Repair</option>
          <option value="Medium">Medium - Standard Repair</option>
          <option value="High">High - Urgent Repair</option>
          <option value="Emergency">Emergency - Immediate Threat</option>
        </select>
      </div>
      <div class="form-group">
        <label for="maint-desc">Details of Issue *</label>
        <textarea id="maint-desc" required placeholder="State exact leakage location or electrical fault..."></textarea>
      </div>
      <div class="form-group">
        <label for="maint-image">Attach Ticket Picture (Issue Before)</label>
        <input type="file" id="maint-image" accept="image/*">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeTempModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">File Ticket</button>
      </div>
    </form>
  `;

  document.getElementById('modal-container').appendChild(modal);
  document.getElementById('modal-container').classList.remove('hidden');

  window.closeTempModal = () => {
    modal.remove();
    closeAllModals();
  };

  document.getElementById('temp-maint-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('category', document.getElementById('maint-category').value);
    formData.append('priority', document.getElementById('maint-priority').value);
    formData.append('description', document.getElementById('maint-desc').value);
    
    const file = document.getElementById('maint-image').files[0];
    if (file) formData.append('image_before', file);

    showLoader();
    try {
      await fetchApi('/api/maintenance', {
        method: 'POST',
        body: formData
      });
      showToast('Maintenance request filed.');
      closeTempModal();
      navigateTo('maintenance');
    } catch (err) {}
    hideLoader();
  });
}

// 11. Invoice Modal Form
async function openInvoiceModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-card';
  modal.id = 'temp-invoice-modal';
  
  // Fetch active leases
  const leases = await fetchApi('/api/leases');
  const active = leases.filter(l => l.status === 'Active');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Generate Rent Invoice</h2>
      <button class="close-modal-btn" onclick="closeTempInvoiceModal()">&times;</button>
    </div>
    <form id="temp-invoice-form" style="padding:24px;">
      <div class="form-group">
        <label for="inv-lease-id">Select Active Lease *</label>
        <select id="inv-lease-id" required>
          ${active.map(l => `<option value="${l.id}" data-rent="${l.rent_amount}">${l.tenant_name} (${l.property_name} - Unit ${l.unit_number})</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group col-6">
          <label for="inv-period">Billing Period (YYYY-MM) *</label>
          <input type="text" id="inv-period" required placeholder="e.g. 2026-07">
        </div>
        <div class="form-group col-6">
          <label for="inv-date">Due Date *</label>
          <input type="date" id="inv-date" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group col-6">
          <label for="inv-rent">Rent Amount ($) *</label>
          <input type="number" id="inv-rent" required>
        </div>
        <div class="form-group col-6">
          <label for="inv-utils">Utility Charges ($)</label>
          <input type="number" id="inv-utils" value="0">
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeTempInvoiceModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Generate Invoice</button>
      </div>
    </form>
  `;

  document.getElementById('modal-container').appendChild(modal);
  document.getElementById('modal-container').classList.remove('hidden');

  window.closeTempInvoiceModal = () => {
    modal.remove();
    closeAllModals();
  };

  const leaseSelect = document.getElementById('inv-lease-id');
  const updateRent = () => {
    const selected = leaseSelect.options[leaseSelect.selectedIndex];
    if (selected) {
      document.getElementById('inv-rent').value = selected.getAttribute('data-rent');
    }
  };
  leaseSelect.addEventListener('change', updateRent);
  updateRent();

  document.getElementById('temp-invoice-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      lease_id: parseInt(document.getElementById('inv-lease-id').value),
      billing_period: document.getElementById('inv-period').value,
      rent_due: parseFloat(document.getElementById('inv-rent').value),
      utilities_due: parseFloat(document.getElementById('inv-utils').value) || 0,
      due_date: document.getElementById('inv-date').value
    };

    showLoader();
    try {
      await fetchApi('/api/invoices', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast('Invoice generated successfully.');
      closeTempInvoiceModal();
      navigateTo('invoices');
    } catch (err) {}
    hideLoader();
  });
}

// Print Handler for preview area
document.getElementById('modal-print-btn').addEventListener('click', () => {
  window.print();
});

// ==========================================
// THEME & CORE APPLICATION INIT
// ==========================================

function initTheme() {
  const themeToggle = document.getElementById('theme-toggle');
  const body = document.body;

  // Load theme preference
  const currentTheme = localStorage.getItem('aura_theme') || 'light-theme';
  body.className = currentTheme;
  updateThemeIcon(currentTheme);

  themeToggle.addEventListener('click', () => {
    if (body.classList.contains('light-theme')) {
      body.classList.replace('light-theme', 'dark-theme');
      localStorage.setItem('aura_theme', 'dark-theme');
      updateThemeIcon('dark-theme');
      showToast('Theme set to dark mode', 'info');
    } else {
      body.classList.replace('dark-theme', 'light-theme');
      localStorage.setItem('aura_theme', 'light-theme');
      updateThemeIcon('light-theme');
      showToast('Theme set to light mode', 'info');
    }
  });

  function updateThemeIcon(theme) {
    themeToggle.innerHTML = theme === 'dark-theme' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
  }
}

// Global search function
function initGlobalSearch() {
  const input = document.getElementById('global-search-input');
  const resultsDropdown = document.getElementById('global-search-results');

  input.addEventListener('input', debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) {
      resultsDropdown.classList.add('hidden');
      return;
    }

    try {
      const res = await fetchApi(`/api/search?query=${q}`);
      
      let html = '';
      let hasResults = false;

      if (res.properties && res.properties.length > 0) {
        hasResults = true;
        html += `
          <div class="search-results-section">
            <h4>Properties</h4>
            ${res.properties.map(p => `
              <a href="#" class="search-result-item" onclick="handleSearchClick(event, 'properties', ${p.id})">
                <strong>${p.name}</strong> - Code: ${p.code} (${p.city})
              </a>
            `).join('')}
          </div>
        `;
      }

      if (res.units && res.units.length > 0) {
        hasResults = true;
        html += `
          <div class="search-results-section">
            <h4>Units</h4>
            ${res.units.map(u => `
              <a href="#" class="search-result-item" onclick="handleSearchClick(event, 'units', ${u.id})">
                <strong>Unit ${u.unit_number}</strong> (${u.property_name}) - ${u.status}
              </a>
            `).join('')}
          </div>
        `;
      }

      if (res.tenants && res.tenants.length > 0) {
        hasResults = true;
        html += `
          <div class="search-results-section">
            <h4>Tenants</h4>
            ${res.tenants.map(t => `
              <a href="#" class="search-result-item" onclick="handleSearchClick(event, 'tenants', ${t.id})">
                <strong>${t.full_name}</strong> - ID: ${t.national_id || 'N/A'} (${t.email})
              </a>
            `).join('')}
          </div>
        `;
      }

      if (res.leases && res.leases.length > 0) {
        hasResults = true;
        html += `
          <div class="search-results-section">
            <h4>Leases</h4>
            ${res.leases.map(l => `
              <a href="#" class="search-result-item" onclick="handleSearchClick(event, 'leases', ${l.id})">
                Lease #${l.id} - ${l.tenant_name} (Unit: ${l.unit_number}) [${l.status}]
              </a>
            `).join('')}
          </div>
        `;
      }

      if (res.maintenance && res.maintenance.length > 0) {
        hasResults = true;
        html += `
          <div class="search-results-section">
            <h4>Maintenance Tickets</h4>
            ${res.maintenance.map(m => `
              <a href="#" class="search-result-item" onclick="handleSearchClick(event, 'maintenance', ${m.id})">
                Ticket #${m.id} (${m.category}) - Unit: ${m.unit_number} [${m.status}]
              </a>
            `).join('')}
          </div>
        `;
      }

      if (!hasResults) {
        html = '<div class="empty-state">No matching entities found.</div>';
      }

      resultsDropdown.innerHTML = html;
      resultsDropdown.classList.remove('hidden');

    } catch (err) {}
  }, 300));

  window.handleSearchClick = (event, type, id) => {
    event.preventDefault();
    input.value = '';
    resultsDropdown.classList.add('hidden');
    
    if (type === 'properties') viewPropertyDetail(id);
    else if (type === 'units') viewUnitDetail(id);
    else if (type === 'tenants') viewTenantDetail(id);
    else if (type === 'leases') viewLeaseAgreement(id);
    else if (type === 'maintenance') viewMaintenanceDetail(id);
  };

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !resultsDropdown.contains(e.target)) {
      resultsDropdown.classList.add('hidden');
    }
  });
}

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function initPropertyMediaUploads() {
  const imagesUpload = document.getElementById('prop-images-upload');
  const videosUpload = document.getElementById('prop-videos-upload');
  
  if (imagesUpload) {
    imagesUpload.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      propertyFormMedia.newImages.push(...files);
      renderPropertyMediaPreviews();
      e.target.value = '';
    });
  }
  
  if (videosUpload) {
    videosUpload.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      propertyFormMedia.newVideos.push(...files);
      renderPropertyMediaPreviews();
      e.target.value = '';
    });
  }
}

function initPaymentModalHandlers() {
  const payMethodSelect = document.getElementById('pay-method');
  if (payMethodSelect) {
    payMethodSelect.addEventListener('change', updateLandlordPaymentInfoText);
  }
}

async function renderPaymentSettings(container) {
  const settings = await fetchApi('/api/landlord/payment-settings');

  container.innerHTML = `
    <div class="payment-settings-wrapper" style="animation: fadeIn 0.4s ease forwards; padding: 20px 0;">
      <div class="card" style="max-width: 800px; margin: 0 auto; padding: 30px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2); border-radius: 12px; background: rgba(17, 24, 39, 0.6); backdrop-filter: blur(10px); border: 1px solid var(--border-color);">
        <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 25px; border-bottom: 1px solid var(--border-color); padding-bottom: 15px;">
          <div style="width: 50px; height: 50px; border-radius: 10px; background: linear-gradient(135deg, var(--primary) 0%, #4f46e5 100%); display: flex; align-items: center; justify-content: center; font-size: 24px; color: white;">
            <i class="fa-solid fa-credit-card"></i>
          </div>
          <div>
            <h2 style="margin: 0; font-family: 'Outfit', sans-serif; font-size: 22px;">Configure Payment Channels</h2>
            <p style="margin: 5px 0 0 0; color: var(--text-muted); font-size: 13px;">Specify details for all supported payment methods. Tenants will make payments directly through these channels.</p>
          </div>
        </div>

        <form id="landlord-payment-settings-form">
          <!-- Section 1: Bank Transfer Details -->
          <div class="form-section-card" style="margin-bottom: 25px; padding: 20px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 8px;">
            <h3 style="margin-top: 0; margin-bottom: 15px; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 10px; color: var(--primary);">
              <i class="fa-solid fa-building-columns"></i> Bank Account Information
            </h3>
            <div class="form-row">
              <div class="form-group col-6" style="margin-bottom: 0;">
                <label for="settings-bank-name" style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px; display: block;">Bank Name</label>
                <input type="text" id="settings-bank-name" value="${settings.bank_name || ''}" placeholder="e.g. Chase Bank, Bank of America" style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: rgba(0, 0, 0, 0.2); color: white; outline: none;">
              </div>
              <div class="form-group col-6" style="margin-bottom: 0;">
                <label for="settings-bank-account" style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px; display: block;">Bank Account Number</label>
                <input type="text" id="settings-bank-account" value="${settings.bank_account || ''}" placeholder="e.g. 1234567890" style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: rgba(0, 0, 0, 0.2); color: white; outline: none;">
              </div>
            </div>
          </div>

          <!-- Section 2: Mobile Money Details -->
          <div class="form-section-card" style="margin-bottom: 25px; padding: 20px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 8px;">
            <h3 style="margin-top: 0; margin-bottom: 15px; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 10px; color: var(--primary);">
              <i class="fa-solid fa-mobile-screen-button"></i> Mobile Money Channels
            </h3>
            <div class="form-group" style="margin-bottom: 0;">
              <label for="settings-mobile-money" style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px; display: block;">Mobile Money Number</label>
              <input type="text" id="settings-mobile-money" value="${settings.mobile_money_number || ''}" placeholder="e.g. +15550199 or carrier details" style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: rgba(0, 0, 0, 0.2); color: white; outline: none;">
            </div>
          </div>

          <!-- Section 3: Online Payment Gateway Configurations -->
          <div class="form-section-card" style="margin-bottom: 25px; padding: 20px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 8px;">
            <h3 style="margin-top: 0; margin-bottom: 15px; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 10px; color: var(--primary);">
              <i class="fa-solid fa-globe"></i> Online Payment Gateway Configurations
            </h3>
            <div class="form-group" style="margin-bottom: 15px;">
              <label for="settings-gateway-type" style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px; display: block;">Gateway Provider</label>
              <select id="settings-gateway-type" style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: rgba(0, 0, 0, 0.2); color: white; outline: none;">
                <option value="stripe" ${settings.online_gateway_type === 'stripe' ? 'selected' : ''}>Stripe</option>
                <option value="paystack" ${settings.online_gateway_type === 'paystack' ? 'selected' : ''}>Paystack</option>
              </select>
            </div>
            <div class="form-row">
              <div class="form-group col-6" style="margin-bottom: 0;">
                <label for="settings-gateway-publishable" style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px; display: block;">Publishable Key</label>
                <input type="text" id="settings-gateway-publishable" value="${settings.online_gateway_publishable || ''}" placeholder="pk_test_..." style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: rgba(0, 0, 0, 0.2); color: white; outline: none;">
              </div>
              <div class="form-group col-6" style="margin-bottom: 0;">
                <label for="settings-gateway-secret" style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px; display: block;">Secret Key</label>
                <input type="password" id="settings-gateway-secret" value="${settings.online_gateway_secret || ''}" placeholder="sk_test_..." style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: rgba(0, 0, 0, 0.2); color: white; outline: none;">
              </div>
            </div>
          </div>

          <!-- Section 4: Credit Card settings -->
          <div class="form-section-card" style="margin-bottom: 30px; padding: 20px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-color); border-radius: 8px;">
            <h3 style="margin-top: 0; margin-bottom: 15px; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 10px; color: var(--primary);">
              <i class="fa-solid fa-credit-card"></i> Credit Card Setup details
            </h3>
            <div class="form-group" style="margin-bottom: 0;">
              <label for="settings-credit-card" style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px; display: block;">Credit Card Details / Descriptor</label>
              <input type="text" id="settings-credit-card" value="${settings.credit_card_details || ''}" placeholder="e.g. Stripe custom statement descriptor, merchant details" style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: rgba(0, 0, 0, 0.2); color: white; outline: none;">
            </div>
          </div>

          <div style="text-align: right;">
            <button type="submit" class="btn btn-primary" style="padding: 12px 30px; font-size: 14px;"><i class="fa-solid fa-floppy-disk" style="margin-right: 8px;"></i> Save Settings</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('landlord-payment-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      bank_name: document.getElementById('settings-bank-name').value.trim(),
      bank_account: document.getElementById('settings-bank-account').value.trim(),
      mobile_money_number: document.getElementById('settings-mobile-money').value.trim(),
      online_gateway_type: document.getElementById('settings-gateway-type').value,
      online_gateway_publishable: document.getElementById('settings-gateway-publishable').value.trim(),
      online_gateway_secret: document.getElementById('settings-gateway-secret').value.trim(),
      credit_card_details: document.getElementById('settings-credit-card').value.trim()
    };

    showLoader();
    try {
      await fetchApi('/api/landlord/payment-settings', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast('Payment settings saved successfully.');
      navigateTo('dashboard');
    } catch (err) {
      console.error('Failed to save payment settings', err);
    }
    hideLoader();
  });
}

// App bootstrapping
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initRouter();
  initTheme();
  initGlobalSearch();
  initNotificationsDropdown();
  initPropertyMediaUploads();
  initPaymentModalHandlers();
  
  // Verify token session
  checkSession();
});
