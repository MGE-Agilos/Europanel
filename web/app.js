/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — WBP BREF Data Collection  ·  Core Application
   Supabase project: vxwmhsgxoomcbiukeinp  ·  Schema: europanel
   ══════════════════════════════════════════════════════════════════════ */

'use strict';

// ─── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://vxwmhsgxoomcbiukeinp.supabase.co';
// Publishable / anon key — find it in: Dashboard → Project Settings → API
const SUPABASE_KEY = 'sb_publishable_UR56UpHfs2xsBvv0gqpL7g_ItlxKh6c';

// ─── Page manifest ────────────────────────────────────────────────────────────
const PAGES = [
  { id:  0, title: 'Cover & Contact',       sheet: 'Introduction',       required: true  },
  { id:  1, title: 'General Information',   sheet: '1. General Info',    required: true  },
  { id:  2, title: 'Plant Layout',          sheet: '2. Plant Layout',    required: true  },
  { id:  3, title: 'Raw Materials',         sheet: '3. Raw Materials',   required: true  },
  { id:  4, title: 'Energy Production',     sheet: '4. Energy',          required: true  },
  { id:  5, title: 'Dryer & Press Line',    sheet: '5. Dryer & Press',   required: true  },
  { id:  6, title: 'Air Abatement',         sheet: '6. Abatement',       required: true  },
  { id:  7, title: 'Air Emissions',         sheet: '7. Air Emissions',   required: true  },
  { id:  8, title: 'Water Emissions',       sheet: '8. Water Emissions', required: true  },
  { id:  9, title: 'Solid Residues',        sheet: '9. Solid Residues',  required: true  },
  { id: 10, title: 'Water Consumption',     sheet: '10. Water Use',      required: true  },
  { id: 11, title: 'BAT Candidate',         sheet: '11. BAT Candidate',  required: false },
  { id: 12, title: 'Review & Submit',       sheet: 'Submit',             required: false },
];

// Page renderers — defined in pages-0-6.js and pages-7-12.js
const PAGE_RENDERERS = [
  renderPage0, renderPage1, renderPage2, renderPage3,
  renderPage4, renderPage5, renderPage6, renderPage7,
  renderPage8, renderPage9, renderPage10, renderPage11, renderPage12,
];

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  user:        null,
  submission:  null,   // { id, status, ... }
  pageData:    {},     // { pageId: { fieldName: value } }
  pageStatus:  {},     // { pageId: 'complete'|'partial'|'empty' }
  currentPage: null,
  saveTimer:   null,
  authMode:    'login',
};

// ─── Supabase client ─────────────────────────────────────────────────────────
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: 'europanel' },
});

/* ══════════════════════════════════════════════════════════════════════
   AUTH
   ══════════════════════════════════════════════════════════════════════ */
async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function signOut() {
  await sb.auth.signOut();
  state.user = null;
  state.submission = null;
  state.pageData = {};
  state.pageStatus = {};
  showAuthScreen();
}

/* ══════════════════════════════════════════════════════════════════════
   SUBMISSION MANAGEMENT
   ══════════════════════════════════════════════════════════════════════ */
async function loadOrCreateSubmission() {
  // Try to load existing draft
  const { data: subs, error } = await sb
    .from('submissions')
    .select('*')
    .eq('user_id', state.user.id)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;

  if (subs && subs.length > 0) {
    state.submission = subs[0];
  } else {
    // Create new submission
    const { data: newSub, error: insErr } = await sb
      .from('submissions')
      .insert({ user_id: state.user.id, status: 'draft' })
      .select()
      .single();
    if (insErr) throw insErr;
    state.submission = newSub;
  }

  await loadAllPageData();
}

async function loadAllPageData() {
  const { data, error } = await sb
    .from('page_data')
    .select('page_id, data, saved_at')
    .eq('submission_id', state.submission.id);
  if (error) throw error;

  state.pageData = {};
  state.pageStatus = {};
  (data || []).forEach(row => {
    state.pageData[row.page_id] = row.data || {};
    state.pageStatus[row.page_id] = hasContent(row.data) ? 'complete' : 'empty';
  });
}

async function savePageData(pageId, data) {
  setSaveStatus('saving');
  try {
    const { error } = await sb
      .from('page_data')
      .upsert(
        { submission_id: state.submission.id, page_id: pageId, data, saved_at: new Date().toISOString() },
        { onConflict: 'submission_id,page_id' }
      );
    if (error) throw error;
    state.pageData[pageId] = data;
    state.pageStatus[pageId] = hasContent(data) ? 'complete' : 'empty';
    updateSidebarItem(pageId);
    setSaveStatus('saved');
  } catch (err) {
    setSaveStatus('error');
    toast('Save failed: ' + err.message, 'error');
  }
}

async function submitFinal() {
  // Check required pages are filled
  const missing = PAGES.filter(p => p.required && p.id < 12 && !hasContent(state.pageData[p.id]));
  if (missing.length > 0) {
    toast(`Please complete: ${missing.map(p => p.title).join(', ')}`, 'error');
    return;
  }
  const companyName = state.pageData[0]?.contact_company || state.pageData[1]?.plant_name || 'Unknown plant';
  // Upsert company
  const { data: company, error: cErr } = await sb
    .from('companies')
    .insert({ name: companyName, country: state.pageData[1]?.location_country || '' })
    .select().single();
  if (cErr) { toast('Submit error: ' + cErr.message, 'error'); return; }

  const { error } = await sb
    .from('submissions')
    .update({ status: 'submitted', submitted_at: new Date().toISOString(), company_id: company.id })
    .eq('id', state.submission.id);
  if (error) { toast('Submit error: ' + error.message, 'error'); return; }

  state.submission.status = 'submitted';
  toast('Questionnaire submitted successfully!', 'success');
  navigate(12);
}

function hasContent(data) {
  if (!data) return false;
  return Object.values(data).some(v => v !== null && v !== undefined && v !== '');
}

/* ══════════════════════════════════════════════════════════════════════
   SIDEBAR
   ══════════════════════════════════════════════════════════════════════ */
function renderSidebar() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = PAGES.map(p => {
    const status = state.pageStatus[p.id] || 'empty';
    const isOptional = !p.required && p.id !== 12;
    const statusClass = state.currentPage === p.id ? 'active' :
                        isOptional ? 'status-optional' :
                        status === 'complete' ? 'status-complete' :
                        status === 'partial'  ? 'status-partial'  : '';
    const dotLabel = p.id === 12 ? '✓' : String(p.id);
    const subText  = state.currentPage === p.id ? 'Current' :
                     isOptional && status === 'empty' ? 'Optional' :
                     status === 'complete' ? 'Saved ✓' : '';
    return `<button class="sidebar-nav-item ${statusClass}" data-page="${p.id}">
      <span class="sidebar-nav-dot">${dotLabel}</span>
      <span class="sidebar-nav-text">
        <span class="sidebar-nav-label">${p.title}</span>
        ${subText ? `<span class="sidebar-nav-sub">${subText}</span>` : ''}
      </span>
    </button>`;
  }).join('');

  updateProgressBar();
  document.getElementById('sidebar-user').textContent = state.user?.email || '';
}

function updateSidebarItem(pageId) {
  const btn = document.querySelector(`.sidebar-nav-item[data-page="${pageId}"]`);
  if (!btn) return;
  const p = PAGES[pageId];
  const status = state.pageStatus[pageId] || 'empty';
  const isOptional = !p.required && pageId !== 12;
  btn.className = 'sidebar-nav-item ' +
    (pageId === state.currentPage ? 'active' :
     isOptional ? 'status-optional' :
     status === 'complete' ? 'status-complete' : '');
  const sub = btn.querySelector('.sidebar-nav-sub');
  if (sub) sub.textContent = status === 'complete' ? 'Saved ✓' : '';
  updateProgressBar();
}

function updateProgressBar() {
  const required = PAGES.filter(p => p.required && p.id < 12);
  const done     = required.filter(p => state.pageStatus[p.id] === 'complete').length;
  const pct      = Math.round((done / required.length) * 100);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent = `${done} / ${required.length} complete`;
}

/* ══════════════════════════════════════════════════════════════════════
   ROUTER
   ══════════════════════════════════════════════════════════════════════ */
function navigate(pageId) {
  pageId = parseInt(pageId, 10);
  if (isNaN(pageId) || pageId < 0 || pageId > 12) pageId = 0;

  // Cancel pending auto-save from previous page
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }

  state.currentPage = pageId;
  renderSidebar();
  renderCurrentPage();
  window.scrollTo(0, 0);
}

function renderCurrentPage() {
  const pageId   = state.currentPage;
  const data     = state.pageData[pageId] || {};
  const renderer = PAGE_RENDERERS[pageId];
  const html     = renderer ? renderer(data) : `<p>Page ${pageId} not found.</p>`;

  document.getElementById('page-container').innerHTML = html;
  attachPageEvents(pageId);
}

/* ══════════════════════════════════════════════════════════════════════
   SAVE ENGINE
   ══════════════════════════════════════════════════════════════════════ */
function collectFormData() {
  const form = document.getElementById('page-form');
  if (!form) return {};
  const fd  = new FormData(form);
  const obj = {};
  // Collect all named elements (handles radios, checkboxes correctly)
  form.querySelectorAll('[name]').forEach(el => {
    const name = el.name;
    if (!name) return;
    if (el.type === 'radio') {
      if (el.checked) obj[name] = el.value;
    } else if (el.type === 'checkbox') {
      if (el.checked) obj[name] = 'on';
    } else {
      obj[name] = el.value;
    }
  });
  return obj;
}

function scheduleSave(pageId) {
  setSaveStatus('saving');
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    const data = collectFormData();
    await savePageData(pageId, data);
  }, 1800);
}

function setSaveStatus(status) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.className = 'save-status ' + status;
  el.textContent = status === 'saving' ? '⏳ Saving…' :
                   status === 'saved'  ? '✓ Saved'   :
                   status === 'error'  ? '✗ Save failed' : '';
}

function attachPageEvents(pageId) {
  const form = document.getElementById('page-form');
  if (!form) return;

  // Auto-save on any input change
  form.addEventListener('input',  () => scheduleSave(pageId));
  form.addEventListener('change', () => scheduleSave(pageId));

  // Save & Continue button
  const btnNext = document.getElementById('btn-save-continue');
  if (btnNext) {
    btnNext.addEventListener('click', async () => {
      if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
      const data = collectFormData();
      await savePageData(pageId, data);
      navigate(pageId + 1);
    });
  }

  // Back button
  const btnBack = document.getElementById('btn-back');
  if (btnBack) {
    btnBack.addEventListener('click', () => navigate(pageId - 1));
  }

  // Page-specific: add/remove instances, submit, etc.
  attachDynamicEvents(pageId);
}

function attachDynamicEvents(pageId) {
  // Page 4: add/remove CU columns
  if (pageId === 4) {
    document.getElementById('btn-add-cu')?.addEventListener('click', () => addCUColumn());
    document.querySelectorAll('.cu-remove-btn').forEach(btn => {
      btn.addEventListener('click', e => removeCUColumn(parseInt(e.target.dataset.cu)));
    });
  }
  // Page 5: add dryer/press instances
  if (pageId === 5) {
    document.getElementById('btn-add-dryer')?.addEventListener('click', () => addInstance('dryer'));
    document.getElementById('btn-add-press')?.addEventListener('click', () => addInstance('press'));
    document.querySelectorAll('.instance-remove-btn').forEach(btn => {
      btn.addEventListener('click', e => removeInstance(e.target.dataset.type, parseInt(e.target.dataset.index)));
    });
  }
  // Page 6: add abatement technique
  if (pageId === 6) {
    document.getElementById('btn-add-tech')?.addEventListener('click', () => addInstance('tech'));
    document.querySelectorAll('.instance-remove-btn').forEach(btn => {
      btn.addEventListener('click', e => removeInstance('tech', parseInt(e.target.dataset.index)));
    });
  }
  // Page 7: add emission point
  if (pageId === 7) {
    document.getElementById('btn-add-ep')?.addEventListener('click', () => addInstance('ep'));
    document.querySelectorAll('.instance-remove-btn').forEach(btn => {
      btn.addEventListener('click', e => removeInstance('ep', parseInt(e.target.dataset.index)));
    });
  }
  // Page 8: add discharge point
  if (pageId === 8) {
    document.getElementById('btn-add-ww')?.addEventListener('click', () => addInstance('ww'));
    document.querySelectorAll('.instance-remove-btn').forEach(btn => {
      btn.addEventListener('click', e => removeInstance('ww', parseInt(e.target.dataset.index)));
    });
  }
  // Page 9: add waste row
  if (pageId === 9) {
    document.getElementById('btn-add-waste')?.addEventListener('click', () => addWasteRow());
  }
  // Page 12: submit button
  if (pageId === 12) {
    document.getElementById('btn-submit')?.addEventListener('click', submitFinal);
    document.getElementById('btn-new-submission')?.addEventListener('click', async () => {
      if (!confirm('Start a new submission? Current data will be kept separately.')) return;
      state.submission = null;
      state.pageData = {};
      state.pageStatus = {};
      await loadOrCreateSubmission();
      navigate(0);
    });
  }
  // Page 3: auto-total for raw material percentages
  if (pageId === 3) {
    function updateTotal() {
      const keys = ['roundwood','vir_forest','sawdust','ext_prod_res','ext_recycled','nonwood','other'];
      const total = keys.reduce((s, k) => s + (parseFloat(document.querySelector(`[name="rm_${k}_pct"]`)?.value || 0)), 0);
      const el = document.getElementById('rm_total_pct');
      if (el) el.value = total.toFixed(1);
    }
    document.querySelectorAll('[name$="_pct"]').forEach(el => el.addEventListener('input', updateTotal));
    updateTotal();
  }
}

/* ─── Dynamic instance helpers ───────────────────────────────────────────── */
function getCount(type) {
  const el = document.getElementById(`${type}_count`);
  return el ? parseInt(el.value, 10) : 1;
}
function setCount(type, n) {
  const el = document.getElementById(`${type}_count`);
  if (el) el.value = n;
}

function addInstance(type) {
  const current = getCount(type);
  const next = current + 1;
  setCount(type, next);
  // Re-save data, then re-render
  const data = collectFormData();
  data[`${type}_count`] = next;
  state.pageData[state.currentPage] = data;
  renderCurrentPage();
}

function removeInstance(type, index) {
  const current = getCount(type);
  if (current <= 1) { toast('At least one ' + type + ' is required.', 'info'); return; }
  const data = collectFormData();
  // Shift field values down
  for (let i = index; i < current; i++) {
    const el = document.querySelectorAll(`[name^="${type}_${i}_"]`);
    el.forEach(input => {
      const nextName = input.name.replace(`${type}_${i}_`, `${type}_${i + 1}_`);
      const nextEl   = document.querySelector(`[name="${nextName}"]`);
      if (nextEl) data[input.name] = nextEl.value;
      else        delete data[input.name];
    });
  }
  data[`${type}_count`] = current - 1;
  state.pageData[state.currentPage] = data;
  renderCurrentPage();
}

function addCUColumn() {
  const data = collectFormData();
  const current = parseInt(data.cu_count || 4, 10);
  data.cu_count = current + 1;
  state.pageData[4] = data;
  renderCurrentPage();
}

function removeCUColumn(ci) {
  if (ci <= 4) { toast('Cannot remove the first 4 combustion units.', 'info'); return; }
  const data = collectFormData();
  const current = parseInt(data.cu_count || 4, 10);
  // Remove this CU's fields
  Object.keys(data).forEach(k => { if (k.startsWith(`cu_${ci}_`)) delete data[k]; });
  data.cu_count = current - 1;
  state.pageData[4] = data;
  renderCurrentPage();
}

function addWasteRow() {
  const data = collectFormData();
  const current = parseInt(data.waste_row_count || 12, 10);
  data.waste_row_count = current + 1;
  state.pageData[9] = data;
  renderCurrentPage();
}

/* ══════════════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ══════════════════════════════════════════════════════════════════════ */
function toast(message, type = 'info') {
  const icons = { success: '✓', error: '✗', info: 'ℹ' };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/* ══════════════════════════════════════════════════════════════════════
   UI SCREENS
   ══════════════════════════════════════════════════════════════════════ */
function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  renderSidebar();
  navigate(0);
}

/* ══════════════════════════════════════════════════════════════════════
   AUTH UI EVENTS
   ══════════════════════════════════════════════════════════════════════ */
function setupAuthUI() {
  const tabs    = document.querySelectorAll('.auth-tab');
  const form    = document.getElementById('auth-form');
  const errDiv  = document.getElementById('auth-error');
  const submit  = document.getElementById('auth-submit');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      state.authMode = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('auth-tab-active', t === tab));
      submit.textContent = state.authMode === 'login' ? 'Sign in' : 'Create account';
      errDiv.classList.add('hidden');
    });
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email    = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    errDiv.classList.add('hidden');
    submit.disabled = true;
    submit.textContent = '…';

    try {
      if (state.authMode === 'login') {
        await signIn(email, password);
      } else {
        const { data } = await signUp(email, password);
        if (data?.user && !data?.session) {
          errDiv.textContent = 'Check your email to confirm your account, then sign in.';
          errDiv.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = 'Create account';
          return;
        }
      }
      // Auth state change will handle the rest
    } catch (err) {
      errDiv.textContent = err.message || 'Authentication failed.';
      errDiv.classList.remove('hidden');
      submit.disabled = false;
      submit.textContent = state.authMode === 'login' ? 'Sign in' : 'Create account';
    }
  });
}

/* ══════════════════════════════════════════════════════════════════════
   SIDEBAR CLICK EVENTS
   ══════════════════════════════════════════════════════════════════════ */
function setupSidebarEvents() {
  document.getElementById('sidebar-nav').addEventListener('click', e => {
    const btn = e.target.closest('.sidebar-nav-item');
    if (!btn) return;
    navigate(parseInt(btn.dataset.page, 10));
  });
  document.getElementById('btn-signout').addEventListener('click', signOut);
}

/* ══════════════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════════════ */
async function init() {
  setupAuthUI();
  setupSidebarEvents();

  // Listen for auth state changes
  sb.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      state.user = session.user;
      try {
        await loadOrCreateSubmission();
        showApp();
      } catch (err) {
        toast('Failed to load submission: ' + err.message, 'error');
        showAuthScreen();
      }
    } else {
      showAuthScreen();
    }
  });

  // Check existing session
  const { data: { session } } = await sb.auth.getSession();
  if (!session) showAuthScreen();
}

// Bootstrap
document.addEventListener('DOMContentLoaded', init);
