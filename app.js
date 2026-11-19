(() => {
  'use strict';

  const DB_NAME = 'mai-dabino-atelier';
  const DB_VERSION = 1;
  const STORE_NAMES = ['customers', 'orders'];
  const FORM_DRAFT_KEY = 'mai-dabino-measurement-draft';
  const MEASUREMENTS = {
    upper: ['Shoulder', 'Back', 'Sleeve Length', 'Bicep', 'Sleeve Width', 'Neck', 'Belly', 'Chest', 'Chest In', 'Top Length'],
    lower: ['Waist', 'Hip', 'Lap (Thigh)', 'Knee', 'Ankle', 'Trouser Length']
  };
  const root = document.querySelector('#view-root');
  const dialog = document.querySelector('#app-dialog');
  const dialogContent = document.querySelector('#dialog-content');
  const state = { page: 'dashboard', search: '', orderFilter: 'all', customerFilter: 'all', editOrderId: null, database: null, printRecord: null };
  let toastTimer;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const today = () => {
    const date = new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 10);
  };
  const formatDate = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const formatMoney = value => `${getPrefs().currency || '₦'}${Number(value || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const isMatchingCustomer = (customer, name, phone) => {
    if (String(customer.name || '').trim().toLowerCase() !== name.trim().toLowerCase()) return false;
    const savedPhone = String(customer.phone || '').replace(/\s+/g, '');
    const enteredPhone = String(phone || '').replace(/\s+/g, '');
    return enteredPhone ? savedPhone === enteredPhone : !savedPhone;
  };
  const getPrefs = () => {
    try { return { unit: 'in', currency: '₦', ...(JSON.parse(localStorage.getItem('mai-dabino-preferences') || '{}')) }; }
    catch (error) { console.error('Could not read preferences:', error); return { unit: 'in', currency: '₦' }; }
  };
  const savePrefs = prefs => {
    try { localStorage.setItem('mai-dabino-preferences', JSON.stringify(prefs)); return true; }
    catch (error) { console.error('Could not save preferences:', error); toast('Preferences could not be saved in this browser.', 'error'); return false; }
  };
  const convert = (value, from, to) => {
    if (value === '' || value === null || value === undefined) return '';
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    const inches = from === 'cm' ? number / 2.54 : number;
    return Number((to === 'cm' ? inches * 2.54 : inches).toFixed(2)).toString();
  };
  const dbReady = () => state.database || openDatabase();

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB is unavailable in this browser.')); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('customers')) {
          const customers = db.createObjectStore('customers', { keyPath: 'id' });
          customers.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('orders')) {
          const orders = db.createObjectStore('orders', { keyPath: 'id' });
          orders.createIndex('customerId', 'customerId', { unique: false });
          orders.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      request.onsuccess = () => { state.database = request.result; resolve(state.database); };
      request.onerror = () => reject(request.error || new Error('Could not open local database.'));
      request.onblocked = () => reject(new Error('Database upgrade is blocked by another open tab. Close other app tabs and try again.'));
    });
  }

  async function getAll(storeName) {
    const db = await dbReady();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Could not read local records.'));
    });
  }

  async function putRecord(storeName, record) {
    const db = await dbReady();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(record);
      transaction.oncomplete = () => resolve(record);
      transaction.onerror = () => reject(transaction.error || new Error('Could not save record.'));
      transaction.onabort = () => reject(transaction.error || new Error('Save was cancelled by the browser.'));
    });
  }

  async function removeRecord(storeName, id) {
    const db = await dbReady();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not delete record.'));
    });
  }

  function toast(message, type = 'success') {
    const region = document.querySelector('#toast-region');
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.textContent = message;
    region.append(item);
    window.setTimeout(() => item.remove(), 3700);
  }

  function showDialog() {
    if (!dialog.open) dialog.showModal();
  }

  function setPage(page) {
    state.page = page;
    state.search = '';
    state.editOrderId = null;
    document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
    render().catch(showError);
  }

  async function render() {
    const renderers = { dashboard: renderDashboard, customers: renderCustomers, orders: renderOrders, payments: renderPayments, settings: renderSettings };
    if (state.page === 'measurement') {
      await renderOrderForm(state.editOrderId);
      root.setAttribute('aria-busy', 'false');
      return;
    }
    await renderers[state.page]();
    root.setAttribute('aria-busy', 'false');
  }

  function pageHeader(eyebrow, title, description, button = '') {
    return `<div class="page-header"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${button}</div>`;
  }

  function emptyState(icon, title, copy, button = '') {
    return `<div class="empty-state"><div class="empty-state-mark">${icon}</div><h2>${title}</h2><p>${copy}</p>${button}</div>`;
  }

  async function renderDashboard() {
    const [customers, orders] = await Promise.all([getAll('customers'), getAll('orders')]);
    const pending = orders.filter(order => order.status !== 'Completed').length;
    const completed = orders.filter(order => order.status === 'Completed').length;
    const outstanding = orders.reduce((sum, order) => sum + Math.max(0, Number(order.totalAmount || 0) - Number(order.amountPaid || 0)), 0);
    const customerMap = new Map(customers.map(customer => [customer.id, customer]));
    const recent = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
    const recentCustomers = [...customers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
    const deliveries = orders.filter(order => order.deliveryDate && order.status !== 'Completed' && order.deliveryDate >= today())
      .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)).slice(0, 4);
    const stats = [
      ['Customers', customers.length, 'Profiles in your atelier', '♙'],
      ['Total orders', orders.length, 'Measurement sheets saved', '▤'],
      ['In progress', pending, 'Orders to finish', '◷'],
      ['Completed', completed, 'Ready for collection', '✓'],
      ['Outstanding', formatMoney(outstanding), 'Across all open balances', '₦']
    ];
    root.innerHTML = `
      <section class="welcome">
        <div class="welcome-copy"><span class="eyebrow">YOUR ATELIER, IN GOOD ORDER</span><h1>We sew excellence.<br>We deliver confidence.</h1><p>A considered space for every client, fitting and finished piece.</p></div>
        <div class="welcome-aside"><img src="assets/Vintage.png" alt="Mai-Dabino Clothing sewing-machine logo"><span><strong>MAI-DABINO CLOTHING</strong>Thoughtfully tailored since 2020</span></div>
      </section>
      <div class="section-heading"><div><span class="eyebrow">AT A GLANCE</span><h2>Today at the atelier</h2></div></div>
      <section class="stats-grid">${stats.map((item, index) => `<article class="stat-card" style="--i:${index}"><div class="stat-head">${item[0]}<span class="stat-mark">${item[3]}</span></div><strong class="stat-value">${esc(item[1])}</strong><span class="stat-sub">${item[2]}</span></article>`).join('')}</section>
      <div class="section-heading"><div><span class="eyebrow">YOUR WORK, AT A GLANCE</span><h2>Atelier activity</h2></div></div>
      <div class="dashboard-grid">
        <section class="panel"><div class="panel-title"><h3>Recent orders</h3><button class="text-button" data-page="orders">View all →</button></div><div class="record-list">${recent.length ? recent.map(order => {
          const customer = customerMap.get(order.customerId);
          return `<div class="record-row"><div class="person"><div class="avatar">${esc((customer?.name || '?').slice(0, 1).toUpperCase())}</div><div><span class="person-name">${esc(customer?.name || 'Unknown customer')}</span><span class="person-sub">${esc(order.orderNumber || 'Order')} · ${formatDate(order.date)}</span></div></div><div class="row-meta"><strong>${esc(order.garmentType || 'Custom garment')}</strong><span class="status-pill ${order.status === 'Completed' ? 'status-completed' : 'status-pending'}">${esc(order.status)}</span></div></div>`;
        }).join('') : '<div class="empty-inline">Your first order will appear here.</div>'}</div></section>
        <div>
          <section class="panel"><div class="panel-title"><h3>Recent customers</h3><button class="text-button" data-page="customers">View all →</button></div><div class="record-list">${recentCustomers.length ? recentCustomers.map(customer => `<div class="record-row"><div class="person"><div class="avatar">${esc(customer.name.slice(0, 1).toUpperCase())}</div><div><span class="person-name">${esc(customer.name)}</span><span class="person-sub">${esc(customer.phone || 'New customer')}</span></div></div><button class="icon-button" data-view-customer="${esc(customer.id)}" aria-label="View ${esc(customer.name)}">↗</button></div>`).join('') : '<div class="empty-inline">Your first client will appear here.</div>'}</div></section>
          <section class="panel" style="margin-top:13px"><div class="panel-title"><h3>Quick actions</h3><span>Make a little progress</span></div><div class="quick-actions">
            <button class="quick-action" data-action="new-order">Take new measurements<span>↗</span></button>
            <button class="quick-action" data-action="new-customer">Add a customer<span>↗</span></button>
            <button class="quick-action" data-page="payments">Review payments<span>↗</span></button>
          </div></section>
          <section class="panel" style="margin-top:13px"><div class="panel-title"><h3>Upcoming deliveries</h3><span>Next due</span></div><div class="delivery-list">${deliveries.length ? deliveries.map(order => `<div class="delivery-row"><div class="delivery-date">${new Date(`${order.deliveryDate}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }).toUpperCase()}</div><div><span class="person-name">${esc(customerMap.get(order.customerId)?.name || 'Customer')}</span><span class="person-sub">${esc(order.garmentType || 'Custom order')}</span></div><button class="icon-button" data-view-order="${esc(order.id)}" aria-label="View order">↗</button></div>`).join('') : '<div class="empty-inline">No upcoming deliveries on the books.</div>'}</div></section>
        </div>
      </div>`;
  }

  async function renderCustomers() {
    const customers = await getAll('customers');
    const orders = await getAll('orders');
    const query = state.search.toLowerCase();
    const filtered = customers.filter(customer => `${customer.name} ${customer.phone} ${customer.reference}`.toLowerCase().includes(query));
    root.innerHTML = `${pageHeader('PEOPLE FIRST', 'Customers', 'Get to know the people behind every piece.', '<button class="button button-dark" data-action="new-customer"><span class="button-plus">＋</span> Add customer</button>')}
      <div class="toolbar"><div class="search-box"><input data-search="customers" placeholder="Search name, phone or reference…" value="${esc(state.search)}" aria-label="Search customers"></div><span class="muted" style="font-size:9px">${filtered.length} ${filtered.length === 1 ? 'customer' : 'customers'}</span></div>
      ${filtered.length ? `<div class="customer-grid">${filtered.map((customer, i) => {
        const count = orders.filter(order => order.customerId === customer.id).length;
        return `<article class="customer-card" style="animation-delay:${i * 35}ms"><div class="customer-card-head"><div class="person"><div class="avatar">${esc(customer.name.slice(0, 1).toUpperCase())}</div><div><h3>${esc(customer.name)}</h3><p>${esc(customer.phone || 'No phone added')}</p></div></div><button class="icon-button" data-customer-menu="${esc(customer.id)}" aria-label="Customer actions">···</button></div><div class="customer-card-foot"><span>${esc(customer.reference || 'No reference')}</span><span><strong>${count}</strong> ${count === 1 ? 'order' : 'orders'}</span></div><div style="display:flex;gap:7px;margin-top:12px"><button class="button button-light button-small" data-view-customer="${esc(customer.id)}">View profile</button><button class="button button-light button-small" data-new-for-customer="${esc(customer.id)}">New order</button></div></article>`;
      }).join('')}</div>` : emptyState('♙', query ? 'No matching customers' : 'Your client book begins here', query ? 'Try another name, phone number or reference.' : 'Add a customer to keep their details, measurements and order history together.', '<button class="button button-green" data-action="new-customer">Add first customer</button>')}`;
  }

  async function renderOrders() {
    const [orders, customers] = await Promise.all([getAll('orders'), getAll('customers')]);
    const customerMap = new Map(customers.map(customer => [customer.id, customer]));
    const query = state.search.toLowerCase();
    let rows = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter(order => {
      const customer = customerMap.get(order.customerId);
      return `${customer?.name || ''} ${order.orderNumber || ''} ${order.garmentType || ''}`.toLowerCase().includes(query);
    });
    if (state.orderFilter !== 'all') rows = rows.filter(order => order.status === state.orderFilter);
    root.innerHTML = `${pageHeader('THE WORKROOM', 'Orders & history', 'Every fitting, faithfully recorded.', '<button class="button button-dark" data-action="new-order"><span class="button-plus">＋</span> New measurement</button>')}
      <div class="toolbar"><div class="search-box"><input data-search="orders" placeholder="Search customer, order or garment…" value="${esc(state.search)}" aria-label="Search orders"></div><select class="filter-select" data-filter="orders" aria-label="Filter orders"><option value="all">All order statuses</option><option value="In progress">In progress</option><option value="Completed">Completed</option><option value="Pending">Pending</option></select><span class="muted" style="font-size:9px">${rows.length} records</span></div>
      ${rows.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Order / client</th><th>Garment</th><th>Order date</th><th>Delivery</th><th>Balance</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(order => `<tr><td><span class="table-main">${esc(order.orderNumber || 'Measurement')}</span><span class="table-sub">${esc(customerMap.get(order.customerId)?.name || 'Unknown customer')}</span></td><td>${esc(order.garmentType || 'Custom garment')}</td><td>${formatDate(order.date)}</td><td>${formatDate(order.deliveryDate)}</td><td>${formatMoney(Math.max(0, order.totalAmount - order.amountPaid))}</td><td><span class="status-pill ${order.status === 'Completed' ? 'status-completed' : 'status-pending'}">${esc(order.status)}</span></td><td><div class="row-actions"><button class="icon-button" data-view-order="${esc(order.id)}" aria-label="View order">↗</button><button class="icon-button" data-edit-order="${esc(order.id)}" aria-label="Edit order">✎</button></div></td></tr>`).join('')}</tbody></table></div>` : emptyState('▤', query || state.orderFilter !== 'all' ? 'No orders found' : 'A record for every fitting', 'Create a measurement sheet and it will be kept here as part of your order history.', '<button class="button button-green" data-action="new-order">Create an order</button>')}`;
    const filter = root.querySelector('[data-filter="orders"]');
    if (filter) filter.value = state.orderFilter;
  }

  async function renderPayments() {
    const [orders, customers] = await Promise.all([getAll('orders'), getAll('customers')]);
    const map = new Map(customers.map(customer => [customer.id, customer]));
    const outstanding = orders.reduce((sum, order) => sum + Math.max(0, order.totalAmount - order.amountPaid), 0);
    const rows = [...orders].filter(order => Number(order.totalAmount) > 0).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    root.innerHTML = `${pageHeader('THE ACCOUNTS BOOK', 'Payments', 'Clear balances, calm mind.', '')}
      <section class="stats-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:20px"><article class="stat-card"><div class="stat-head">Total order value<span class="stat-mark">₦</span></div><strong class="stat-value">${formatMoney(orders.reduce((sum, order) => sum + order.totalAmount, 0))}</strong><span class="stat-sub">Across recorded orders</span></article><article class="stat-card"><div class="stat-head">Received<span class="stat-mark">✓</span></div><strong class="stat-value">${formatMoney(orders.reduce((sum, order) => sum + order.amountPaid, 0))}</strong><span class="stat-sub">Payments recorded</span></article><article class="stat-card"><div class="stat-head">Outstanding<span class="stat-mark">◷</span></div><strong class="stat-value">${formatMoney(outstanding)}</strong><span class="stat-sub">Still to be collected</span></article></section>
      <div class="section-heading"><div><span class="eyebrow">ORDER LEDGER</span><h2>Payment records</h2></div></div>
      ${rows.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Order / client</th><th>Total</th><th>Received</th><th>Balance</th><th>Payment status</th><th></th></tr></thead><tbody>${rows.map(order => { const balance = Math.max(0, order.totalAmount - order.amountPaid); return `<tr><td><span class="table-main">${esc(order.orderNumber || 'Measurement')}</span><span class="table-sub">${esc(map.get(order.customerId)?.name || 'Unknown customer')}</span></td><td>${formatMoney(order.totalAmount)}</td><td>${formatMoney(order.amountPaid)}</td><td>${formatMoney(balance)}</td><td><span class="status-pill ${balance === 0 ? 'status-paid' : 'status-pending'}">${balance === 0 ? 'Paid in full' : 'Balance due'}</span></td><td><button class="button button-light button-small" data-add-payment="${esc(order.id)}">Add payment</button></td></tr>`; }).join('')}</tbody></table></div>` : emptyState('₦', 'No payments to track yet', 'Payment summaries appear here when an order amount is added.')}`;
  }

  async function renderSettings() {
    const prefs = getPrefs();
    root.innerHTML = `${pageHeader('YOUR WORKSPACE', 'Settings', 'A few details to make the atelier yours.', '')}
      <div class="settings-grid">
        <section class="settings-card"><span class="eyebrow">PREFERENCES</span><h2>Atelier details</h2><p>Your choices are saved in this browser and used for new measurement sheets.</p>
          <div class="setting-row"><div><strong>Measurement unit</strong><small>Default display for new measurements</small></div><select data-setting="unit"><option value="in">Inches (in)</option><option value="cm">Centimetres (cm)</option></select></div>
          <div class="setting-row"><div><strong>Currency symbol</strong><small>Used for order totals and balances</small></div><select data-setting="currency"><option value="₦">Nigerian naira (₦)</option><option value="$">US dollar ($)</option><option value="£">Pound sterling (£)</option><option value="€">Euro (€)</option></select></div>
          <div class="setting-row"><div><strong>Brand</strong><small>Mai-Dabino Clothing · Est. 2020</small></div><span class="status-pill status-completed">ACTIVE</span></div>
        </section>
        <section class="settings-card"><span class="eyebrow">YOUR RECORDS</span><h2>Back up with care</h2><p>Keep a copy of your customer book and order history somewhere safe. Backups are plain JSON and can be restored here.</p>
          <div class="setting-row"><div><strong>Export backup</strong><small>Download all local records</small></div><button class="button button-light button-small" data-action="export-backup">Download JSON</button></div>
          <div class="setting-row"><div><strong>Restore backup</strong><small>Merge records from a JSON file</small></div><label class="button button-light button-small" for="backup-file">Choose file</label><input id="backup-file" class="sr-only" type="file" accept="application/json,.json"></div>
        </section>
        <section class="settings-card danger-zone"><span class="eyebrow" style="color:var(--red)">BE CAREFUL</span><h2>Clear local data</h2><p>This permanently removes all customers, measurement sheets, orders and payments from this browser. Export a backup first if you may need these records.</p><button class="button button-danger" data-action="clear-data">Delete all local records</button></section>
      </div>`;
    root.querySelector('[data-setting="unit"]').value = prefs.unit;
    root.querySelector('[data-setting="currency"]').value = prefs.currency;
  }

  function section(title, content, suffix = '') {
    return `<section class="form-card"><div class="form-section-head"><h2>${title}</h2>${suffix}</div>${content}</section>`;
  }

  function field(name, options = {}) {
    const { type = 'text', value = '', placeholder = '', required = false, hint = '', min, step, autocomplete, idPrefix = 'field' } = options;
    const id = `${idPrefix}-${slug(name)}`;
    return `<div class="field"><label for="${id}">${name}${required ? ' <span style="color:var(--red)">*</span>' : ''}${hint ? ` <span class="optional">${hint}</span>` : ''}</label><input id="${id}" name="${esc(name)}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${min !== undefined ? `min="${min}"` : ''} ${step ? `step="${step}"` : ''} ${autocomplete ? `autocomplete="${autocomplete}"` : ''}></div>`;
  }

  function measurementFields(values = {}, unit = 'in') {
    return Object.entries(MEASUREMENTS).map(([group, names]) => {
      const heading = group === 'upper' ? 'Upper body · Top / Kaftan' : 'Lower body · Trouser';
      const fields = names.map(name => `<div class="field"><label for="measure-${slug(name)}">${name}</label><div class="measure-input"><input inputmode="decimal" type="number" step="0.01" min="0" max="300" id="measure-${slug(name)}" name="measure-${slug(name)}" data-measure="${esc(name)}" value="${esc(values[name] ?? '')}" placeholder="—"><span>${unit}</span></div></div>`).join('');
      return section(heading, `<div class="form-grid measurement-grid">${fields}</div>`);
    }).join('');
  }
  const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  async function renderOrderForm(orderId = null, customerId = null) {
    const [customers, orders] = await Promise.all([getAll('customers'), getAll('orders')]);
    const order = orderId ? orders.find(record => record.id === orderId) : null;
    if (orderId && !order) throw new Error('That measurement sheet could not be found.');
    const customer = order ? customers.find(item => item.id === order.customerId) : (customerId ? customers.find(item => item.id === customerId) : null);
    state.page = 'measurement';
    let unit = order?.unit || getPrefs().unit || 'in';
    const measurements = order?.measurements || {};
    const customerOptions = customers.map(item => `<option value="${esc(item.id)}" ${customer?.id === item.id ? 'selected' : ''}>${esc(item.name)}${item.phone ? ` · ${esc(item.phone)}` : ''}</option>`).join('');
    root.innerHTML = `<div class="form-shell">
      <div class="form-top"><button class="back-button" data-page="orders">← Back to orders</button><span class="unit-control">Measurements in <select id="measurement-unit" aria-label="Measurement unit"><option value="in" ${unit === 'in' ? 'selected' : ''}>Inches</option><option value="cm" ${unit === 'cm' ? 'selected' : ''}>Centimetres</option></select></span></div>
      <div class="form-title"><span class="eyebrow">MAI-DABINO CLOTHING · EST. 2020</span><h1>${order ? 'Refine this measurement' : 'A new piece begins'}</h1><p>Take your time. Every detail is saved as its own order snapshot.</p></div>
      <div class="progress-track"><span id="form-progress" style="width:0%"></span></div>
      <form id="order-form" novalidate>
        ${section('01 · Client & fitting', `<div class="form-grid">
          <div class="field"><label for="customer-select">Existing customer</label><select name="customerId" id="customer-select"><option value="">Choose a customer…</option>${customerOptions}<option value="__new__">＋ Add a new customer</option></select></div>
          ${field('Name', { value: customer?.name || '', required: true, autocomplete: 'name' })}
          ${field('Phone / WhatsApp', { value: customer?.phone || '', placeholder: '+234…', autocomplete: 'tel' })}
          ${field('Customer reference', { value: customer?.reference || '', placeholder: 'Optional identifier' })}
          ${field('Date', { type: 'date', value: order?.date || today(), required: true })}
          ${field('Order number', { value: order?.orderNumber || '', placeholder: 'e.g. MD-024' })}
          ${field('Delivery date', { type: 'date', value: order?.deliveryDate || '' })}
        </div><div class="progress-track"><span class="form-progress-sub" style="display:block;width:25%;height:3px;background:var(--green)"></span></div>`)}
        ${measurementFields(measurements, unit)}
        ${section('Garment & finishing', `<div class="form-grid two">
          <div class="field"><label for="garment-type">Garment type <span style="color:var(--red)">*</span></label><select name="garmentType" id="garment-type" required><option value="">Choose garment type…</option>${['Kaftan','Agbada','Shirt','Trousers','Dress','Skirt','Suit','Traditional wear','Other'].map(type => `<option ${order?.garmentType === type ? 'selected' : ''}>${type}</option>`).join('')}</select></div>
          ${field('Custom garment description', { value: order?.customGarment || '', placeholder: 'If other, describe the garment' })}
          ${field('Fabric / colour', { value: order?.fabric || '', placeholder: 'Fabric, colour or pattern' })}
          <div class="field"><label for="styleNotes">Style / design notes</label><textarea id="styleNotes" name="styleNotes" placeholder="Cut, style, trims and design details…">${esc(order?.styleNotes || '')}</textarea></div>
          <div class="field"><label for="instructions">Special instructions</label><textarea id="instructions" name="instructions" placeholder="Any fitting or finishing notes…">${esc(order?.instructions || '')}</textarea></div>
        </div>`)}
        ${section('Payment', `<div class="form-grid two">
          ${field('Total order amount', { type: 'number', value: order?.totalAmount ?? '', placeholder: '0.00', min: 0, step: '0.01', hint: `(${getPrefs().currency})` })}
          ${field('Amount paid', { type: 'number', value: order?.amountPaid ?? '', placeholder: '0.00', min: 0, step: '0.01', hint: `(${getPrefs().currency})` })}
          <div class="field"><label for="order-status">Order status</label><select name="status" id="order-status">${['In progress','Pending','Completed'].map(status => `<option ${order?.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></div>
          <div class="payment-summary"><span>Outstanding balance<strong id="balance-preview">${formatMoney(Math.max(0, (order?.totalAmount || 0) - (order?.amountPaid || 0)))}</strong></span><span>Payment status<strong id="payment-status">${(order?.totalAmount || 0) > 0 && order?.totalAmount === order?.amountPaid ? 'Paid' : 'Awaiting payment'}</strong></span></div>
        </div>`)}
        ${section('Fitting notes', `<div class="form-grid"><div class="field" style="grid-column:1/-1"><label for="notes">Notes & alterations <span class="optional">Optional</span></label><textarea id="notes" name="notes" placeholder="Add fitting history, alterations or anything to remember…">${esc(order?.notes || '')}</textarea></div></div>`)}
        <div class="form-footer"><span>Fields marked <span style="color:var(--red)">*</span> are required · All measurements optional</span><div class="form-footer-actions"><button type="button" class="button button-light" data-page="orders">Cancel</button><button type="submit" class="button button-green">${order ? 'Save changes' : 'Save measurement sheet'}</button></div></div>
      </form>
    </div>`;
    const form = root.querySelector('#order-form');
    let draft = null;
    try { draft = JSON.parse(sessionStorage.getItem(FORM_DRAFT_KEY) || 'null'); }
    catch (error) { console.error('Could not read the measurement draft:', error); }
    const draftMatches = draft && draft.orderId === (order?.id || null) && (!customerId || draft.values?.customerId === customerId);
    if (draftMatches) {
      for (const [name, value] of Object.entries(draft.values || {})) {
        const control = form.elements.namedItem(name);
        if (control) control.value = value;
      }
      if (!order && draft.unit && ['in', 'cm'].includes(draft.unit)) {
        unit = draft.unit;
        root.querySelector('#measurement-unit').value = unit;
        root.querySelectorAll('[data-measure]').forEach(input => { input.nextElementSibling.textContent = unit; });
      }
    }

    function persistDraft() {
      try {
        sessionStorage.setItem(FORM_DRAFT_KEY, JSON.stringify({
          orderId: order?.id || null,
          unit,
          values: Object.fromEntries(new FormData(form).entries())
        }));
      } catch (error) { console.error('Could not preserve the measurement draft:', error); }
    }
    root.querySelector('#customer-select').addEventListener('change', event => {
      if (event.target.value === '__new__') {
        openCustomerDialog({
          name: form.elements.Name.value,
          phone: form.elements['Phone / WhatsApp'].value,
          reference: form.elements['Customer reference'].value
        }, true);
        event.target.value = '';
      }
      else if (event.target.value) {
        const selected = customers.find(item => item.id === event.target.value);
        if (selected) {
          form.elements.Name.value = selected.name || '';
          form.elements['Phone / WhatsApp'].value = selected.phone || '';
          form.elements['Customer reference'].value = selected.reference || '';
        }
      }
      persistDraft();
    });
    root.querySelector('#measurement-unit').addEventListener('change', event => {
      const newUnit = event.target.value;
      root.querySelectorAll('[data-measure]').forEach(input => {
        input.value = convert(input.value, unit, newUnit);
        input.nextElementSibling.textContent = newUnit;
      });
      unit = newUnit;
      updateProgress();
      persistDraft();
    });
    form.addEventListener('input', () => { updateProgress(); persistDraft(); });
    form.addEventListener('change', persistDraft);
    function updateProgress() {
      const all = [...form.querySelectorAll('[data-measure]')];
      const entered = all.filter(input => input.value !== '').length;
      root.querySelector('#form-progress').style.width = `${Math.round(entered / all.length * 100)}%`;
      const total = Number(form.elements['Total order amount'].value || 0);
      const paid = Number(form.elements['Amount paid'].value || 0);
      root.querySelector('#balance-preview').textContent = formatMoney(Math.max(0, total - paid));
      root.querySelector('#payment-status').textContent = total > 0 && total <= paid ? 'Paid' : total > 0 && paid > 0 ? 'Part-paid' : 'Awaiting payment';
    }
    form.addEventListener('submit', event => saveOrder(event, order, unit, customer).catch(showError));
    updateProgress();
  }

  async function saveOrder(event, existingOrder, unit, originalCustomer) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const name = String(data.get('Name') || '').trim();
    const phone = String(data.get('Phone / WhatsApp') || '').trim();
    const reference = String(data.get('Customer reference') || '').trim();
    const total = Number(data.get('Total order amount') || 0);
    const paid = Number(data.get('Amount paid') || 0);
    if (!Number.isFinite(total) || !Number.isFinite(paid) || total < 0 || paid < 0 || paid > total) {
      toast('Enter valid non-negative order amounts. Amount paid cannot exceed the total.', 'error');
      return;
    }
    let customerId = String(data.get('customerId') || '');
    if (customerId === '__new__') customerId = '';
    const customers = await getAll('customers');
    if (customerId) {
      const savedCustomer = customers.find(customer => customer.id === customerId);
      if (!savedCustomer) { toast('That customer no longer exists. Choose another or create a profile.', 'error'); return; }
      await putRecord('customers', { ...savedCustomer, name, phone, reference, updatedAt: new Date().toISOString() });
    } else {
      const duplicate = customers.find(customer => isMatchingCustomer(customer, name, phone));
      if (duplicate) {
        const reuse = window.confirm(`${duplicate.name} already has a profile with this phone number. Use their existing profile?`);
        if (!reuse) { openCustomerDialog({ name, phone, reference }, true); return; }
        customerId = duplicate.id;
        await putRecord('customers', { ...duplicate, name, phone, reference, updatedAt: new Date().toISOString() });
      } else {
        const customer = { id: originalCustomer?.id || crypto.randomUUID(), name, phone, reference, notes: originalCustomer?.notes || '', createdAt: originalCustomer?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
        customerId = customer.id;
        await putRecord('customers', customer);
      }
    }
    const measurements = {};
    form.querySelectorAll('[data-measure]').forEach(input => {
      if (input.value !== '') {
        const number = Number(input.value);
        if (Number.isFinite(number) && number >= 0) measurements[input.dataset.measure] = number;
      }
    });
    const id = existingOrder?.id || crypto.randomUUID();
    const paymentHistory = existingOrder?.paymentHistory || [];
    if (paid > Number(existingOrder?.amountPaid || 0)) paymentHistory.push({ amount: paid - Number(existingOrder?.amountPaid || 0), date: today(), note: 'Payment recorded with order' });
    const record = {
      ...existingOrder, id, customerId, orderNumber: String(data.get('Order number') || '').trim() || `MD-${today().replace(/-/g, '').slice(2)}-${id.slice(0, 6).toUpperCase()}`,
      date: String(data.get('Date') || today()), deliveryDate: String(data.get('Delivery date') || ''),
      measurements, unit, garmentType: String(data.get('garmentType') || ''), customGarment: String(data.get('Custom garment description') || '').trim(),
      fabric: String(data.get('Fabric / colour') || '').trim(), styleNotes: String(data.get('styleNotes') || '').trim(),
      instructions: String(data.get('instructions') || '').trim(), notes: String(data.get('notes') || '').trim(),
      totalAmount: total, amountPaid: paid, paymentHistory, status: String(data.get('status') || 'In progress'),
      createdAt: existingOrder?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    try {
      await putRecord('orders', record);
      try {
        const draft = JSON.parse(sessionStorage.getItem(FORM_DRAFT_KEY) || 'null');
        if (!draft || draft.orderId === (existingOrder?.id ?? null)) sessionStorage.removeItem(FORM_DRAFT_KEY);
      } catch (error) { console.error('Could not clear the saved measurement draft:', error); }
      toast(existingOrder ? 'Measurement sheet updated.' : 'Measurement sheet saved.', 'success');
      setPage('orders');
    } catch (error) { showError(error); }
  }

  function openCustomerDialog(customer = null, returnToOrder = false) {
    const current = customer || {};
    dialogContent.innerHTML = `<div class="dialog-inner"><div class="dialog-head"><div><h2>${current.id ? 'Edit customer' : 'A new client'}</h2><p>Keep their details close for the next fitting.</p></div><button class="dialog-close" data-close-dialog aria-label="Close">×</button></div><form id="customer-form"><div class="dialog-body"><div class="form-grid two" style="padding:0">${field('Name', { value: current.name || '', required: true, autocomplete: 'name', idPrefix: 'customer-field' })}${field('Phone / WhatsApp', { value: current.phone || '', placeholder: '+234…', autocomplete: 'tel', idPrefix: 'customer-field' })}${field('Customer reference', { value: current.reference || '', placeholder: 'Optional identifier', idPrefix: 'customer-field' })}<div class="field" style="grid-column:1/-1"><label for="customer-notes">Notes</label><textarea id="customer-notes" name="notes" placeholder="Preferences, fitting notes…">${esc(current.notes || '')}</textarea></div></div></div><div class="dialog-actions"><button type="button" class="button button-light" data-close-dialog>Cancel</button><button class="button button-green" type="submit">${current.id ? 'Save changes' : 'Save customer'}</button></div></form></div>`;
    showDialog();
    dialogContent.querySelector('#customer-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      try {
        const data = new FormData(form);
        const name = String(data.get('Name') || '').trim();
        const phone = String(data.get('Phone / WhatsApp') || '').trim();
        const all = await getAll('customers');
        const duplicate = all.find(item => item.id !== current.id && isMatchingCustomer(item, name, phone));
        if (duplicate && !window.confirm(`${duplicate.name} already has a profile with these details. Save a separate profile anyway?`)) return;
        const saved = { ...current, id: current.id || crypto.randomUUID(), name, phone, reference: String(data.get('Customer reference') || '').trim(), notes: String(data.get('notes') || '').trim(), createdAt: current.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
        await putRecord('customers', saved);
        dialog.close();
        toast(current.id ? 'Customer details updated.' : 'Customer profile saved.');
        if (returnToOrder) {
          const select = root.querySelector('#customer-select');
          const option = document.createElement('option');
          option.value = saved.id;
          option.textContent = `${saved.name}${saved.phone ? ` · ${saved.phone}` : ''}`;
          select.append(option);
          select.value = saved.id;
          const form = root.querySelector('#order-form');
          form.elements.Name.value = saved.name;
          form.elements['Phone / WhatsApp'].value = saved.phone;
          form.elements['Customer reference'].value = saved.reference;
          form.dispatchEvent(new Event('input', { bubbles: true }));
        }
        else render().catch(showError);
      } catch (error) { showError(error); }
    });
  }

  async function showCustomer(customerId) {
    const [customers, orders] = await Promise.all([getAll('customers'), getAll('orders')]);
    const customer = customers.find(item => item.id === customerId);
    if (!customer) { toast('Customer could not be found.', 'error'); return; }
    const history = orders.filter(order => order.customerId === customerId).sort((a, b) => b.date.localeCompare(a.date));
    dialogContent.innerHTML = `<div class="dialog-inner"><div class="dialog-head"><div><span class="eyebrow">CUSTOMER PROFILE</span><h2>${esc(customer.name)}</h2><p>${esc(customer.phone || 'No phone number')} · ${esc(customer.reference || 'No reference')}</p></div><button class="dialog-close" data-close-dialog aria-label="Close">×</button></div><div class="dialog-body"><section class="form-card"><div class="form-section-head"><h2>Notes</h2><button class="text-button" data-edit-customer="${esc(customer.id)}">Edit profile</button></div><div class="form-grid"><div class="detail-value">${esc(customer.notes || 'No customer notes yet.')}</div></div></section><section class="form-card"><div class="form-section-head"><h2>Measurement & order history</h2><span>${history.length} records</span></div>${history.length ? `<div class="timeline">${history.map(order => `<div class="timeline-item"><strong>${esc(order.orderNumber)} · ${esc(order.garmentType)}</strong><span>${formatDate(order.date)}${order.deliveryDate ? ` · Due ${formatDate(order.deliveryDate)}` : ''} · ${esc(order.status)}</span><button class="text-button" data-view-order="${esc(order.id)}">Open measurement sheet →</button></div>`).join('')}</div>` : '<div class="empty-inline">No fitting history recorded yet.</div>'}</section></div><div class="dialog-actions"><button class="button button-light" data-new-for-customer="${esc(customer.id)}">New order</button><button class="button button-green" data-close-dialog>Done</button></div></div>`;
    showDialog();
  }

  async function showOrder(orderId) {
    const [orders, customers] = await Promise.all([getAll('orders'), getAll('customers')]);
    const order = orders.find(item => item.id === orderId);
    const customer = order && customers.find(item => item.id === order.customerId);
    if (!order || !customer) { toast('This order could not be found.', 'error'); return; }
    state.printRecord = { order, customer };
    const measureCells = Object.entries(order.measurements || {}).map(([label, value]) => `<div class="measurement-cell"><span>${esc(label)}</span><strong>${esc(value)} ${esc(order.unit)}</strong></div>`).join('');
    const history = order.paymentHistory || [];
    dialogContent.innerHTML = `<div class="dialog-inner"><div class="dialog-head"><div><span class="eyebrow">${esc(order.orderNumber)} · ${formatDate(order.date)}</span><h2>${esc(customer.name)}</h2><p>${esc(order.garmentType)}${order.fabric ? ` · ${esc(order.fabric)}` : ''}</p></div><button class="dialog-close" data-close-dialog aria-label="Close">×</button></div><div class="dialog-body">
      <section class="form-card"><div class="form-section-head"><h2>Measurements</h2><span>${esc(order.unit)} · ${esc(order.status)}</span></div>${measureCells ? `<div class="measurement-summary">${measureCells}</div>` : '<div class="empty-inline">No measurements were entered.</div>'}</section>
      <div class="detail-grid"><section class="form-card"><div class="form-section-head"><h2>Garment & notes</h2></div><div class="form-grid"><div class="detail-value">${esc(order.customGarment || order.garmentType)}<br>${esc(order.fabric || 'No fabric details') }<br>${esc(order.styleNotes || order.instructions || 'No design notes')}</div></div></section><section class="form-card"><div class="form-section-head"><h2>Payment</h2></div><div class="form-grid"><div class="detail-value">Total: ${formatMoney(order.totalAmount)}<br>Paid: ${formatMoney(order.amountPaid)}<br>Balance: ${formatMoney(Math.max(0, order.totalAmount - order.amountPaid))}</div>${history.map(item => `<div class="person-sub">${formatMoney(item.amount)} · ${formatDate(item.date)}</div>`).join('')}</div></section></div>
      <section class="form-card"><div class="form-section-head"><h2>Fitting notes</h2></div><div class="form-grid"><div class="detail-value">${esc(order.notes || 'No fitting notes.')}</div></div></section>
    </div><div class="dialog-actions"><button class="button button-danger" data-delete-order="${esc(order.id)}">Delete</button><button class="button button-light" data-duplicate-order="${esc(order.id)}">Duplicate</button><button class="button button-light" data-print-order="${esc(order.id)}">Print / save PDF</button><button class="button button-light" data-edit-order="${esc(order.id)}">Edit</button><button class="button button-green" data-close-dialog>Done</button></div></div>`;
    showDialog();
  }

  async function duplicateOrder(orderId) {
    const orders = await getAll('orders');
    const order = orders.find(item => item.id === orderId);
    if (!order) throw new Error('Order to duplicate was not found.');
    const copy = { ...order, id: crypto.randomUUID(), orderNumber: '', date: today(), deliveryDate: '', status: 'In progress', totalAmount: 0, amountPaid: 0, paymentHistory: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    dialog.close();
    state.editOrderId = null;
    renderOrderForm(null, order.customerId).then(() => {
      const form = root.querySelector('#order-form');
      form.elements['Order number'].value = '';
      form.elements['Total order amount'].value = '';
      form.elements['Amount paid'].value = '';
      form.elements.status.value = copy.status;
      form.elements['Date'].value = today();
      form.elements['Delivery date'].value = '';
      for (const [label, value] of Object.entries(order.measurements || {})) {
        const input = form.querySelector(`[data-measure="${CSS.escape(label)}"]`);
        if (input) input.value = convert(value, order.unit, root.querySelector('#measurement-unit').value);
      }
      form.elements.garmentType.value = order.garmentType;
      form.elements['Custom garment description'].value = order.customGarment || '';
      form.elements['Fabric / colour'].value = order.fabric || '';
      form.elements.styleNotes.value = order.styleNotes || '';
      form.elements.instructions.value = order.instructions || '';
      form.elements.notes.value = order.notes || '';
      form.dispatchEvent(new Event('input', { bubbles: true }));
    }).catch(showError);
  }

  async function addPayment(orderId) {
    const orders = await getAll('orders');
    const order = orders.find(item => item.id === orderId);
    if (!order) { toast('Order not found.', 'error'); return; }
    const remaining = Math.max(0, order.totalAmount - order.amountPaid);
    dialogContent.innerHTML = `<div class="dialog-inner"><div class="dialog-head"><div><h2>Record a payment</h2><p>${esc(order.orderNumber)} · Balance ${formatMoney(remaining)}</p></div><button class="dialog-close" data-close-dialog aria-label="Close">×</button></div><form id="payment-form"><div class="dialog-body"><div class="form-grid two" style="padding:0">${field('Payment amount', { type: 'number', required: true, min: 0.01, step: '0.01', placeholder: '0.00', idPrefix: 'payment-field' })}${field('Payment date', { type: 'date', value: today(), required: true, idPrefix: 'payment-field' })}<div class="field" style="grid-column:1/-1"><label for="payment-note">Note <span class="optional">Optional</span></label><input id="payment-note" name="note" placeholder="Cash, transfer or other note"></div></div></div><div class="dialog-actions"><button type="button" class="button button-light" data-close-dialog>Cancel</button><button class="button button-green" type="submit">Save payment</button></div></form></div>`;
    showDialog();
    dialogContent.querySelector('#payment-form').addEventListener('submit', async event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const amount = Number(data.get('Payment amount'));
      if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) { toast(`Enter an amount above zero and no greater than ${formatMoney(remaining)}.`, 'error'); return; }
      const updated = { ...order, amountPaid: order.amountPaid + amount, paymentHistory: [...(order.paymentHistory || []), { amount, date: data.get('Payment date'), note: String(data.get('note') || '').trim() }], updatedAt: new Date().toISOString() };
      try { await putRecord('orders', updated); dialog.close(); toast('Payment recorded.'); await renderPayments(); }
      catch (error) { showError(error); }
    });
  }

  function printOrder(order, customer) {
    const measurementTable = Object.entries(MEASUREMENTS).map(([group, labels]) => `<section><h2>${group === 'upper' ? 'Upper Body · Top / Kaftan' : 'Lower Body · Trouser'}</h2><table><tbody>${labels.map(label => `<tr><th>${esc(label)}</th><td>${esc(order.measurements?.[label] ?? '—')} ${order.measurements?.[label] != null ? esc(order.unit) : ''}</td></tr>`).join('')}</tbody></table></section>`).join('');
    const printRoot = document.querySelector('#print-root');
    printRoot.innerHTML = `<header class="print-header"><img src="assets/mai-dabino-logo.jpeg" alt="Mai-Dabino Clothing logo"><div><h1>MAI-DABINO CLOTHING</h1><p>We sew excellence. We deliver confidence.</p></div><aside>EST. 2020<br>${esc(order.orderNumber)}</aside></header>
      <div class="print-details"><div><span>Customer</span><strong>${esc(customer.name)}</strong></div><div><span>Phone / WhatsApp</span><strong>${esc(customer.phone || '—')}</strong></div><div><span>Order date</span><strong>${formatDate(order.date)}</strong></div><div><span>Delivery date</span><strong>${formatDate(order.deliveryDate)}</strong></div><div><span>Customer reference</span><strong>${esc(customer.reference || '—')}</strong></div><div><span>Status</span><strong>${esc(order.status)}</strong></div></div>
      <main class="print-main">${measurementTable}<section><h2>Garment details</h2><table><tbody><tr><th>Garment</th><td>${esc(order.customGarment || order.garmentType)}</td></tr><tr><th>Fabric / colour</th><td>${esc(order.fabric || '—')}</td></tr></tbody></table><h2>Payment</h2><table><tbody><tr><th>Total amount</th><td>${formatMoney(order.totalAmount)}</td></tr><tr><th>Amount paid</th><td>${formatMoney(order.amountPaid)}</td></tr><tr><th>Balance</th><td>${formatMoney(Math.max(0, order.totalAmount - order.amountPaid))}</td></tr></tbody></table></section><section class="print-wide"><h2>Style, instructions & fitting notes</h2><div class="print-notes">${esc([order.styleNotes, order.instructions, order.notes].filter(Boolean).join(' · ') || '—')}</div></section></main>
      <footer class="print-footer">MAI-DABINO CLOTHING · We sew excellence. We deliver confidence. · EST. 2020</footer>`;
    window.addEventListener('afterprint', () => { printRoot.innerHTML = ''; }, { once: true });
    window.print();
    toast('Your A4 measurement sheet is ready to print or save as PDF.');
  }

  async function exportBackup() {
    const [customers, orders] = await Promise.all([getAll('customers'), getAll('orders')]);
    const data = { format: 'mai-dabino-backup', version: 1, exportedAt: new Date().toISOString(), preferences: getPrefs(), customers, orders };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `mai-dabino-backup-${today()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast('Your backup has been downloaded.');
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== 'mai-dabino-backup' || !Array.isArray(data.customers) || !Array.isArray(data.orders)) throw new Error('This file is not a valid Mai-Dabino backup.');
      if (!window.confirm(`Restore ${data.customers.length} customers and ${data.orders.length} orders? Existing records with matching IDs will be updated; other records will remain.`)) return;
      const db = await dbReady();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAMES, 'readwrite');
        data.customers.forEach(customer => transaction.objectStore('customers').put(customer));
        data.orders.forEach(order => transaction.objectStore('orders').put(order));
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error('Backup records could not be restored.'));
        transaction.onabort = () => reject(transaction.error || new Error('Backup restore was cancelled.'));
      });
      if (data.preferences && typeof data.preferences === 'object') savePrefs({ ...getPrefs(), ...data.preferences });
      toast('Backup restored successfully.');
      await render();
    } catch (error) { showError(error); }
  }

  async function clearAllData() {
    if (!window.confirm('Delete every customer and order stored in this browser? This cannot be undone.')) return;
    const db = await dbReady();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAMES, 'readwrite');
      STORE_NAMES.forEach(name => transaction.objectStore(name).clear());
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Local data could not be cleared.'));
    });
    toast('All local customer and order records have been deleted.');
    setPage('dashboard');
  }

  async function deleteCustomer(customerId) {
    const orders = await getAll('orders');
    const count = orders.filter(order => order.customerId === customerId).length;
    const message = count ? `This customer has ${count} order record(s). Deleting the profile will also delete those orders. Continue?` : 'Delete this customer profile? This cannot be undone.';
    if (!window.confirm(message)) return;
    const db = await dbReady();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAMES, 'readwrite');
      transaction.objectStore('customers').delete(customerId);
      orders.filter(order => order.customerId === customerId).forEach(order => transaction.objectStore('orders').delete(order.id));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Customer could not be deleted.'));
    });
    dialog.close();
    toast('Customer and associated orders deleted.');
    await renderCustomers();
  }

  async function deleteOrder(orderId) {
    if (!window.confirm('Delete this order and its payment history? This cannot be undone.')) return;
    await removeRecord('orders', orderId);
    dialog.close();
    toast('Order deleted.');
    await renderOrders();
  }

  function showError(error) {
    console.error(error);
    root.setAttribute('aria-busy', 'false');
    toast(error?.message || 'Something went wrong. Your changes may not have been saved.', 'error');
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button,[data-view-order],[data-view-customer],[data-edit-order],[data-edit-customer],[data-delete-customer],[data-delete-order],[data-add-payment],[data-new-for-customer],[data-duplicate-order],[data-print-order],[data-customer-menu]');
    if (!button) return;
    if (button.dataset.page) { setPage(button.dataset.page); return; }
    if (button.dataset.action === 'new-order') { state.page = 'measurement'; state.editOrderId = null; renderOrderForm().catch(showError); return; }
    if (button.dataset.action === 'new-customer') { openCustomerDialog(); return; }
    if (button.dataset.action === 'export-backup') { exportBackup().catch(showError); return; }
    if (button.dataset.action === 'clear-data') { clearAllData().catch(showError); return; }
    if (button.dataset.viewOrder) { showOrder(button.dataset.viewOrder).catch(showError); return; }
    if (button.dataset.editOrder) { dialog.close(); state.page = 'measurement'; state.editOrderId = button.dataset.editOrder; renderOrderForm(button.dataset.editOrder).catch(showError); return; }
    if (button.dataset.viewCustomer) { showCustomer(button.dataset.viewCustomer).catch(showError); return; }
    if (button.dataset.editCustomer) {
      getAll('customers').then(customers => openCustomerDialog(customers.find(customer => customer.id === button.dataset.editCustomer))).catch(showError);
      return;
    }
    if (button.dataset.deleteCustomer) { deleteCustomer(button.dataset.deleteCustomer).catch(showError); return; }
    if (button.dataset.deleteOrder) { deleteOrder(button.dataset.deleteOrder).catch(showError); return; }
    if (button.dataset.addPayment) { addPayment(button.dataset.addPayment).catch(showError); return; }
    if (button.dataset.newForCustomer) { dialog.close(); state.page = 'measurement'; state.editOrderId = null; renderOrderForm(null, button.dataset.newForCustomer).catch(showError); return; }
    if (button.dataset.duplicateOrder) { duplicateOrder(button.dataset.duplicateOrder).catch(showError); return; }
    if (button.dataset.printOrder) {
      if (!state.printRecord || state.printRecord.order.id !== button.dataset.printOrder) {
        toast('Measurement sheet is no longer available. Reopen the order and try again.', 'error');
        return;
      }
      printOrder(state.printRecord.order, state.printRecord.customer);
      return;
    }
    if (button.dataset.customerMenu) {
      getAll('customers').then(customers => {
        const customer = customers.find(item => item.id === button.dataset.customerMenu);
        if (!customer) return;
        dialogContent.innerHTML = `<div class="dialog-inner"><div class="dialog-head"><div><h2>${esc(customer.name)}</h2><p>Manage this customer profile.</p></div><button class="dialog-close" data-close-dialog aria-label="Close">×</button></div><div class="dialog-body"><div style="display:grid;gap:8px"><button class="button button-light" data-view-customer="${esc(customer.id)}">View profile & history</button><button class="button button-light" data-edit-customer="${esc(customer.id)}">Edit customer details</button><button class="button button-danger" data-delete-customer="${esc(customer.id)}">Delete customer</button></div></div></div>`;
        showDialog();
      }).catch(showError);
      return;
    }
    if (button.hasAttribute('data-close-dialog')) { dialog.close(); return; }
  });

  document.addEventListener('input', event => {
    const input = event.target;
    if (input.matches('[data-search]')) {
      state.search = input.value;
      const selection = [input.selectionStart, input.selectionEnd];
      render().then(() => {
        const fresh = root.querySelector(`[data-search="${input.dataset.search}"]`);
        if (fresh) { fresh.focus(); fresh.setSelectionRange(selection[0], selection[1]); }
      }).catch(showError);
    }
  });

  document.addEventListener('change', event => {
    const target = event.target;
    if (target.matches('[data-filter="orders"]')) { state.orderFilter = target.value; renderOrders().catch(showError); }
    if (target.matches('[data-setting]')) {
      const prefs = { ...getPrefs(), [target.dataset.setting]: target.value };
      savePrefs(prefs);
      if (target.dataset.setting === 'currency') toast('Currency preference saved.');
      if (target.dataset.setting === 'unit') toast('Default measurement unit saved.');
    }
    if (target.matches('#backup-file') && target.files[0]) importBackup(target.files[0]).finally(() => { target.value = ''; });
  });

  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  document.querySelector('#today-label').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  openDatabase().then(() => render()).catch(error => {
    root.innerHTML = emptyState('!', 'Local storage unavailable', 'This atelier needs browser storage to save your records. Please enable IndexedDB and reload the page.');
    showError(error);
  });
})();
