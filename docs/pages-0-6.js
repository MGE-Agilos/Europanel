/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Page Renderers: Pages 0–6
   ══════════════════════════════════════════════════════════════════════ */

'use strict';

// ─── Shared helpers ────────────────────────────────────────────────────────
function v(data, name, fallback = '') {
  const val = data[name];
  return (val !== undefined && val !== null) ? val : fallback;
}
function sel(data, name, val) { return v(data, name) === val ? 'selected' : ''; }
function chk(data, name, val) { return v(data, name) === val ? 'checked' : ''; }
function ynSel(data, name) {
  return `<select class="form-select form-select-yn" name="${name}">
    <option value="">—</option>
    <option value="y" ${sel(data, name, 'y')}>Yes</option>
    <option value="n" ${sel(data, name, 'n')}>No</option>
  </select>`;
}
function numUnit(name, val, unit, extra = '') {
  return `<div class="form-input-with-unit">
    <input class="form-input" type="number" min="0" step="any" name="${name}" value="${val}" ${extra}>
    <span class="form-unit">${unit}</span>
  </div>`;
}
function navFooter(pageId) {
  const prev = pageId > 0  ? `<button type="button" id="btn-back" class="btn btn-secondary">← Back</button>` : `<div></div>`;
  const next = pageId < 12 ? `<button type="button" id="btn-save-continue" class="btn btn-primary">Save &amp; Continue →</button>` : `<div></div>`;
  return `<footer class="page-nav">
    <div class="page-nav-inner">
      ${prev}
      <span id="save-status" class="save-status" aria-live="polite"></span>
      ${next}
    </div>
  </footer>`;
}
function refYearRadios(data) {
  return ['2009','2010','2011'].map(yr =>
    `<label class="form-radio-label">
      <input class="form-radio-input" type="radio" name="ref_year" value="${yr}" ${chk(data,'ref_year',yr) || (yr==='2010' && !data.ref_year ? 'checked' : '')}>
      ${yr}${yr==='2010' ? ' <span class="form-hint">(preferred)</span>' : ''}
    </label>`
  ).join('');
}

/* ══════════════════════════════════════════════════════════════════════
   PAGE 0 — Cover & Contact
   ══════════════════════════════════════════════════════════════════════ */
function renderPage0(data) {
  const d = name => v(data, name);
  return `
<header class="page-header">
  <div class="page-header-meta">Page 0 of 12 · Sheet: Introduction</div>
  <h1 class="page-title">Cover &amp; Contact</h1>
  <p class="page-subtitle">Identify the person completing this questionnaire and any assisting TWG members.</p>
</header>
<div class="page-content">

  <!-- Context accordion -->
  <div class="form-section" style="margin-bottom:var(--space-6)">
    <div class="form-section-header">
      <div class="doc-header-identity">
        <div class="doc-header-issuer">
          <span class="doc-header-issuer-org">Joint Research Centre · European Commission</span>
          <span class="doc-header-issuer-unit">Institute for Prospective Technological Studies (Seville) · European IPPC Bureau</span>
        </div>
        <span class="doc-header-date">Seville, 27 July 2012</span>
      </div>
      <div class="doc-header-title-block">
        <p class="doc-header-title">Questionnaire for Collecting Plant-Specific Data for the Drafting of the BAT Reference Document (BREF) for the Production of Wood-Based Panels (WBP)</p>
        <p class="doc-header-legal">IED 2010/75/EU · Activity 6.1(c), Annex I · Reference year: 2010</p>
      </div>
    </div>
    <div style="padding:var(--space-4) var(--space-6)">
      <div class="doc-notice doc-notice-deadline">
        <span class="doc-notice-icon">📅</span>
        <p><strong>Submission deadline:</strong> Submit to your Member State representative by <strong>Thursday 27 September 2012</strong>.</p>
      </div>
      <div class="doc-notice doc-notice-confidential">
        <span class="doc-notice-icon">🔒</span>
        <p><strong>Confidentiality:</strong> Information considered business sensitive will be aggregated and/or anonymised if used in the BREF.</p>
      </div>
      <details class="doc-accordion-item"><summary class="doc-accordion-summary">About the Industrial Emissions Directive and BREFs</summary>
        <div class="doc-accordion-body"><p>The IED (2010/75/EU) progressively replaces the IPPC Directive. BAT Reference Documents (BREFs) determine Best Available Techniques through a transparent process. BAT conclusions are adopted through committee procedure and serve as references for setting permit conditions.</p></div>
      </details>
      <details class="doc-accordion-item"><summary class="doc-accordion-summary">Purpose of this questionnaire</summary>
        <div class="doc-accordion-body"><p>This questionnaire collects plant-specific environmental performance data from WBP manufacturers in European Member States. Data covers all operations from the logyard to the finished raw board, including energy-producing units technically integrated in the process.</p></div>
      </details>
    </div>
  </div>

  <form id="page-form" data-page-id="0" novalidate>

    <!-- Section 1: Contact person -->
    <section class="form-section">
      <div class="form-section-header">
        <h2 class="form-section-title">Section 1 — Contact Person</h2>
        <p class="form-section-desc">Contact completing this questionnaire. Will only be contacted if further clarification is needed.</p>
      </div>
      <div class="form-section-body">
        <div class="form-group">
          <label class="form-label form-label-required" for="contact_company">Company name</label>
          <input class="form-input" type="text" id="contact_company" name="contact_company" required value="${d('contact_company')}" autocomplete="organization">
        </div>
        <div class="form-group">
          <label class="form-label form-label-required" for="contact_name">Name</label>
          <input class="form-input" type="text" id="contact_name" name="contact_name" required value="${d('contact_name')}" autocomplete="name">
        </div>
        <div class="form-group">
          <label class="form-label" for="contact_job_title">Job title</label>
          <input class="form-input" type="text" id="contact_job_title" name="contact_job_title" value="${d('contact_job_title')}">
        </div>
        <div class="form-group">
          <label class="form-label form-label-required" for="contact_email">E-mail</label>
          <input class="form-input" type="email" id="contact_email" name="contact_email" required value="${d('contact_email')}" autocomplete="email">
        </div>
        <div class="form-group">
          <label class="form-label" for="contact_telephone">Telephone</label>
          <input class="form-input" type="tel" id="contact_telephone" name="contact_telephone" value="${d('contact_telephone')}" placeholder="+xx xxx xxx xxxx">
        </div>
        <div class="form-group form-group-wide">
          <label class="form-label" for="contact_comments">Comments</label>
          <textarea class="form-textarea" id="contact_comments" name="contact_comments" rows="3">${d('contact_comments')}</textarea>
        </div>
      </div>
    </section>

    <!-- Section 2: TWG Member State -->
    <section class="form-section">
      <div class="form-section-header">
        <h2 class="form-section-title">Section 2 — TWG Assistance: Member State Representative</h2>
        <p class="form-section-desc">All fields optional.</p>
      </div>
      <div class="form-section-body">
        <div class="form-group"><label class="form-label" for="twg_ms_state">Member State</label>
          <input class="form-input" type="text" id="twg_ms_state" name="twg_ms_state" value="${d('twg_ms_state')}" placeholder="e.g. Ireland"></div>
        <div class="form-group"><label class="form-label" for="twg_ms_organisation">Organisation</label>
          <input class="form-input" type="text" id="twg_ms_organisation" name="twg_ms_organisation" value="${d('twg_ms_organisation')}"></div>
        <div class="form-group"><label class="form-label" for="twg_ms_name">Name</label>
          <input class="form-input" type="text" id="twg_ms_name" name="twg_ms_name" value="${d('twg_ms_name')}"></div>
        <div class="form-group"><label class="form-label" for="twg_ms_job_title">Job title</label>
          <input class="form-input" type="text" id="twg_ms_job_title" name="twg_ms_job_title" value="${d('twg_ms_job_title')}"></div>
        <div class="form-group"><label class="form-label" for="twg_ms_email">E-mail</label>
          <input class="form-input" type="email" id="twg_ms_email" name="twg_ms_email" value="${d('twg_ms_email')}"></div>
        <div class="form-group"><label class="form-label" for="twg_ms_telephone">Telephone</label>
          <input class="form-input" type="tel" id="twg_ms_telephone" name="twg_ms_telephone" value="${d('twg_ms_telephone')}" placeholder="+xx xxx xxx xxxx"></div>
      </div>
    </section>

    <!-- Section 3: TWG Industry NGO -->
    <section class="form-section">
      <div class="form-section-header">
        <h2 class="form-section-title">Section 3 — TWG Assistance: Industry / Environmental NGO</h2>
        <p class="form-section-desc">All fields optional.</p>
      </div>
      <div class="form-section-body">
        <div class="form-group"><label class="form-label" for="twg_ngo_company">Company / Organisation</label>
          <input class="form-input" type="text" id="twg_ngo_company" name="twg_ngo_company" value="${d('twg_ngo_company')}"></div>
        <div class="form-group"><label class="form-label" for="twg_ngo_name">Name</label>
          <input class="form-input" type="text" id="twg_ngo_name" name="twg_ngo_name" value="${d('twg_ngo_name')}"></div>
        <div class="form-group"><label class="form-label" for="twg_ngo_job_title">Job title</label>
          <input class="form-input" type="text" id="twg_ngo_job_title" name="twg_ngo_job_title" value="${d('twg_ngo_job_title')}"></div>
        <div class="form-group"><label class="form-label" for="twg_ngo_email">E-mail</label>
          <input class="form-input" type="email" id="twg_ngo_email" name="twg_ngo_email" value="${d('twg_ngo_email')}"></div>
        <div class="form-group"><label class="form-label" for="twg_ngo_telephone">Telephone</label>
          <input class="form-input" type="tel" id="twg_ngo_telephone" name="twg_ngo_telephone" value="${d('twg_ngo_telephone')}" placeholder="+xx xxx xxx xxxx"></div>
      </div>
    </section>

    <div class="form-footer-note">
      In case of doubts, contact the European IPPC Bureau:
      <a href="mailto:JRC-IPTS-EIPPCB@ec.europa.eu">JRC-IPTS-EIPPCB@ec.europa.eu</a> · Tel: +34 954 488 192
    </div>
  </form>
</div>
${navFooter(0)}`;
}

/* ══════════════════════════════════════════════════════════════════════
   PAGE 1 — General Information
   ══════════════════════════════════════════════════════════════════════ */
function renderPage1(data) {
  const COUNTRIES = ['Austria','Belgium','Bulgaria','Croatia','Cyprus','Czech Republic','Denmark','Estonia','Finland','France','Germany','Greece','Hungary','Ireland','Italy','Latvia','Lithuania','Luxembourg','Malta','Netherlands','Norway','Poland','Portugal','Romania','Slovakia','Slovenia','Spain','Sweden','Turkey','United Kingdom','Other'];
  const WBP_TYPES = [{v:'',l:'— select type —'},{v:'OSB',l:'OSB Oriented Strand Board'},{v:'PB',l:'PB Particle board'},{v:'MDF',l:'MDF (dry process)'},{v:'HDF',l:'HDF (dry process)'},{v:'SB',l:'SB Softboard'},{v:'HB',l:'HB Hardboard'},{v:'MBH',l:'MBH high density medium board'},{v:'Other',l:'Other'}];
  const UNITS = ['— select unit —','m³ of product produced / year','tonnes of dried material / year','t/h (throughput)','Other unit'];
  const OTHER_ACT = [
    {key:'sawmill',         label:'Sawmill',                          unit:'Tonne'},
    {key:'glue',            label:'Glue production',                  unit:'Tonne'},
    {key:'impreg_paper',    label:'Production of impregnated paper',  unit:'m² paper/year'},
    {key:'paper_lam',       label:'Paper Lamination',                 unit:'m² laminated board'},
    {key:'other_value',     label:'Other value added production',     unit:'Tonne product'},
    {key:'combustion',      label:'Combustion plants',                unit:'Total aggregated thermal input MW'},
    {key:'incineration',    label:'Waste incineration plants',        unit:'Total aggregated thermal input MW'},
    {key:'ww_treatment',    label:'Waste water treatment facilities', unit:'Treatment capacity m³ water'},
    {key:'landfill',        label:'Landfill',                         unit:'Tonne'},
    {key:'other_activities',label:'Other activities',                 unit:''},
    {key:'other_specify',   label:'Please specify other activity',    unit:'', freetext:true},
  ];

  const countryOpts = COUNTRIES.map(c => `<option value="${c}" ${sel(data,'location_country',c)}>${c}</option>`).join('');
  const prodRows = [1,2,3,4].map(p => {
    const typeOpts = WBP_TYPES.map(t => `<option value="${t.v}" ${sel(data,`prod_${p}_type`,t.v)}>${t.l}</option>`).join('');
    const unitOpts = UNITS.map(u => `<option value="${u==='— select unit —'?'':u}" ${sel(data,`prod_${p}_unit`,u)}>${u}</option>`).join('');
    return `<tr class="prod-row">
      <td class="prod-td">
        <span class="prod-num">Product ${p}</span>
        <select class="form-select" name="prod_${p}_type">${typeOpts}</select>
        <div class="prod-addinfo-row">
          <label class="form-label form-label-sub">Additional info</label>
          <input class="form-input form-input-sm" type="text" name="prod_${p}_addinfo" value="${v(data,`prod_${p}_addinfo`)}">
        </div>
      </td>
      <td class="prod-td"><input class="form-input" type="number" min="0" step="any" name="prod_${p}_qty" value="${v(data,`prod_${p}_qty`)}"></td>
      <td class="prod-td"><select class="form-select" name="prod_${p}_unit">${unitOpts}</select></td>
      <td class="prod-td">${numUnit(`prod_${p}_daily`, v(data,`prod_${p}_daily`), 'm³/day')}</td>
    </tr>`;
  }).join('');

  const actRows = OTHER_ACT.map(a => `<tr class="prod-row">
    <td class="prod-td">${a.freetext ? `<input class="form-input form-input-sm" type="text" name="act_${a.key}_label" placeholder="Specify…" value="${v(data,`act_${a.key}_label`)}">` : a.label}</td>
    <td class="prod-td">${ynSel(data,`act_${a.key}_present`)}</td>
    <td class="prod-td">${ynSel(data,`act_${a.key}_ippc`)}</td>
    <td class="prod-td"><input class="form-input" type="number" min="0" step="any" name="act_${a.key}_capacity" value="${v(data,`act_${a.key}_capacity`)}"></td>
    <td class="prod-td">${a.unit ? `<span class="prod-unit-label">${a.unit}</span>` : `<input class="form-input form-input-sm" type="text" name="act_${a.key}_unit" value="${v(data,`act_${a.key}_unit`)}">`}</td>
  </tr>`).join('');

  return `
<header class="page-header">
  <div class="page-header-meta">Page 1 of 12 · Sheet: 1. General Information</div>
  <h1 class="page-title">General Information</h1>
  <p class="page-subtitle">Identifies the site and the main productions.</p>
</header>
<div class="page-content">
<form id="page-form" data-page-id="1" novalidate>

  <!-- 1.1–1.5 -->
  <section class="form-section">
    <div class="form-section-body grid-sheet">
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num">1.1</span><label class="form-label form-label-required" for="plant_name">Name of the WBP plant</label></div>
        <div class="sheet-field"><input class="form-input" type="text" id="plant_name" name="plant_name" required value="${v(data,'plant_name')}"></div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num">1.2</span><label class="form-label" for="production_started">Production started in year</label></div>
        <div class="sheet-field"><input class="form-input form-input-narrow" type="number" id="production_started" name="production_started" min="1900" max="2030" placeholder="e.g. 1987" value="${v(data,'production_started')}"></div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num">1.3</span><span class="form-label">Location of the installation</span></div>
        <div class="sheet-field sheet-field-subgrid">
          <div class="form-group"><label class="form-label form-label-sub" for="location_city">City</label>
            <input class="form-input" type="text" id="location_city" name="location_city" value="${v(data,'location_city')}"></div>
          <div class="form-group"><label class="form-label form-label-sub" for="location_country">Country</label>
            <select class="form-select" id="location_country" name="location_country"><option value="">— select country —</option>${countryOpts}</select></div>
        </div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num">1.4</span><label class="form-label" for="company">Company</label></div>
        <div class="sheet-field"><input class="form-input" type="text" id="company" name="company" value="${v(data,'company')}"></div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num">1.5</span><label class="form-label">Reference year <span class="form-hint">(prefer 2010)</span></label></div>
        <div class="sheet-field"><div class="form-radio-group">${refYearRadios(data)}</div></div>
      </div>
    </div>
  </section>

  <!-- 1.6 Production table -->
  <section class="form-section">
    <div class="form-section-header">
      <h2 class="form-section-title">1.6 — Production of WBP main types</h2>
      <p class="form-section-desc">Up to 4 product types produced during the reference year.</p>
    </div>
    <div class="prod-table-wrap">
      <table class="prod-table">
        <thead><tr>
          <th class="prod-th" style="min-width:220px">Product type</th>
          <th class="prod-th">Yearly permitted quantity</th>
          <th class="prod-th">Unit</th>
          <th class="prod-th">Daily capacity</th>
        </tr></thead>
        <tbody>${prodRows}</tbody>
      </table>
    </div>
  </section>

  <!-- 1.7 Other activities -->
  <section class="form-section">
    <div class="form-section-header">
      <h2 class="form-section-title">1.7 — Other activities within the borders of the site</h2>
    </div>
    <div class="prod-table-wrap">
      <table class="prod-table">
        <thead><tr>
          <th class="prod-th" style="min-width:220px">Activity</th>
          <th class="prod-th" style="width:90px">Present?</th>
          <th class="prod-th" style="width:90px">IPPC permit?</th>
          <th class="prod-th">Yearly capacity</th>
          <th class="prod-th">Unit</th>
        </tr></thead>
        <tbody>${actRows}</tbody>
      </table>
    </div>
  </section>

  <!-- Comments -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">Comments</h2></div>
    <div class="form-section-body">
      <div class="form-group form-group-wide">
        <textarea class="form-textarea" name="comments" rows="4" placeholder="Additional context, deviations from the reference year…">${v(data,'comments')}</textarea>
      </div>
    </div>
  </section>

</form>
</div>
${navFooter(1)}`;
}

/* ══════════════════════════════════════════════════════════════════════
   PAGE 2 — Plant Layout
   ══════════════════════════════════════════════════════════════════════ */
function renderPage2(data) {
  const CHIP_ROWS = [
    {key:'process_desc', label:'Describe processes and units/facilities', type:'text'},
    {key:'prod_t_batch',  label:'Tonnes of production equipment (batches/h)', unit:'batches/h'},
    {key:'wood_dry',      label:'Tonnes of wood (dry batches/h)', unit:'t dry/h'},
    {key:'airflow',       label:'Airflow', unit:'Nm³/h'},
    {key:'chan_air',       label:'Total channelled air', unit:'Nm³/h'},
    {key:'chan_treated',   label:'Channelled air treated?', type:'yn'},
    {key:'emit_limit',    label:'Emission limit in permit?', type:'yn'},
    {key:'dust_method',   label:'Indicate method of dust abatement', type:'text'},
    {key:'monitoring',    label:'Describe monitoring or controls', type:'text'},
  ];
  const chipRows = CHIP_ROWS.map(row => {
    const cols = ['debark','chip','other_chip'].map(col => {
      if (row.type === 'yn') return `<td class="prod-td">${ynSel(data, `s22_${col}_${row.key}`)}</td>`;
      return `<td class="prod-td"><input class="form-input form-input-sm" type="text" name="s22_${col}_${row.key}" value="${v(data,`s22_${col}_${row.key`)}"></td>`;
    }).join('');
    return `<tr class="prod-row"><td class="prod-td cu-td-label">${row.label}${row.unit?` <span class="form-hint">(${row.unit})</span>`:''}</td>${cols}
      <td class="prod-td"><input class="form-input form-input-sm" type="text" name="s22_comments_${row.key}" value="${v(data,`s22_comments_${row.key}`)}"></td></tr>`;
  }).join('');

  return `
<header class="page-header">
  <div class="page-header-meta">Page 2 of 12 · Sheet: 2. WBP Plant Layout</div>
  <h1 class="page-title">WBP Plant Layout</h1>
  <p class="page-subtitle">Processes and associated activities: drying, pressing, energy, storage, and waste water systems.</p>
</header>
<div class="page-content">
<form id="page-form" data-page-id="2" novalidate>

  <!-- Reference year -->
  <section class="form-section">
    <div class="form-section-body grid-sheet">
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Reference year</label></div>
        <div class="sheet-field"><div class="form-radio-group">${refYearRadios(data)}</div></div>
      </div>
    </div>
  </section>

  <!-- 2.1 Storage -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">2.1 — Storage of raw materials and wet chipped material</h2></div>
    <div class="prod-table-wrap">
      <table class="prod-table">
        <thead><tr>
          <th class="prod-th" style="min-width:220px">Storage type</th>
          <th class="prod-th">% of total material</th>
          <th class="prod-th">Capacity (tonnes)</th>
          <th class="prod-th">Area (m²)</th>
        </tr></thead>
        <tbody>
          ${[{key:'outdoor',label:'Outdoor storage of raw materials'},{key:'indoor',label:'Indoor storage of raw materials'},{key:'silos',label:'Closed silos for raw materials before chipping'}].map(r => `
          <tr class="prod-row">
            <td class="prod-td">${r.label}</td>
            <td class="prod-td">${numUnit(`stor_${r.key}_pct`, v(data,`stor_${r.key}_pct`), '%', 'max="100"')}</td>
            <td class="prod-td">${numUnit(`stor_${r.key}_cap`, v(data,`stor_${r.key}_cap`), 't')}</td>
            <td class="prod-td">${numUnit(`stor_${r.key}_area`, v(data,`stor_${r.key}_area`), 'm²')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="section-comments-row">
      <label class="form-label form-label-sub">Comments</label>
      <textarea class="form-textarea" name="s21_comments" rows="2">${v(data,'s21_comments')}</textarea>
    </div>
  </section>

  <!-- 2.2 Chipping/refining -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">2.2 — Chipping/refining stage and related dust abatement</h2></div>
    <div class="prod-table-wrap">
      <table class="prod-table">
        <thead><tr>
          <th class="prod-th" style="min-width:220px">Field</th>
          <th class="prod-th">Debarking</th>
          <th class="prod-th">Plating &amp; Chipping</th>
          <th class="prod-th">Other</th>
          <th class="prod-th">Comments</th>
        </tr></thead>
        <tbody>${chipRows}</tbody>
      </table>
    </div>
    <div class="section-comments-row">
      <label class="form-label form-label-sub">General comments</label>
      <textarea class="form-textarea" name="s22_comments" rows="2">${v(data,'s22_comments')}</textarea>
    </div>
  </section>

  <!-- 2.3 Recycled wood chipping -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">2.3 — Chipping plant for recycled wood and related dust abatement</h2></div>
    <div class="form-section-body grid-sheet">
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label" for="s23_present">If present, describe which</label></div>
        <div class="sheet-field"><input class="form-input" type="text" id="s23_present" name="s23_present" value="${v(data,'s23_present')}"></div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Production hours in reference year</label></div>
        <div class="sheet-field">${numUnit('s23_hours', v(data,'s23_hours'), 'h', 'max="8784"')}</div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Capacity</label></div>
        <div class="sheet-field">${numUnit('s23_capacity', v(data,'s23_capacity'), 't/h')}</div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Total channelled air</label></div>
        <div class="sheet-field">${numUnit('s23_chan_air', v(data,'s23_chan_air'), 'Nm³/h')}</div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Channelled air treated?</label></div>
        <div class="sheet-field">${ynSel(data,'s23_chan_treated')}</div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Emission limit in permit?</label></div>
        <div class="sheet-field">${ynSel(data,'s23_emit_limit')}</div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Dust abatement method</label></div>
        <div class="sheet-field"><input class="form-input" type="text" name="s23_dust_method" value="${v(data,'s23_dust_method')}"></div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Monitoring / controls</label></div>
        <div class="sheet-field"><input class="form-input" type="text" name="s23_monitoring" value="${v(data,'s23_monitoring')}"></div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Comments</label></div>
        <div class="sheet-field"><textarea class="form-textarea" name="s23_comments" rows="2">${v(data,'s23_comments')}</textarea></div>
      </div>
    </div>
  </section>

  <!-- 2.4 & 2.5 Air graders/screening -->
  ${[{num:'2.4',key:'s24',title:'Air graders/screening before drying'},{num:'2.5',key:'s25',title:'Air graders/screening after drying'}].map(sec => `
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">${sec.num} — ${sec.title}</h2></div>
    <div class="form-section-body grid-sheet">
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Description of processes</label></div>
        <div class="sheet-field"><textarea class="form-textarea" name="${sec.key}_desc" rows="2">${v(data,`${sec.key}_desc`)}</textarea></div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Total channelled air</label></div>
        <div class="sheet-field">${numUnit(`${sec.key}_chan_air`, v(data,`${sec.key}_chan_air`), 'Nm³/h')}</div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Channelled air treated?</label></div>
        <div class="sheet-field">${ynSel(data,`${sec.key}_chan_treated`)}</div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Dust abatement method</label></div>
        <div class="sheet-field"><input class="form-input" type="text" name="${sec.key}_dust_method" value="${v(data,`${sec.key}_dust_method`)}"></div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Comments</label></div>
        <div class="sheet-field"><textarea class="form-textarea" name="${sec.key}_comments" rows="2">${v(data,`${sec.key}_comments`)}</textarea></div>
      </div>
    </div>
  </section>`).join('')}

</form>
</div>
${navFooter(2)}`;
}

/* ══════════════════════════════════════════════════════════════════════
   PAGE 3 — Raw Materials
   ══════════════════════════════════════════════════════════════════════ */
function renderPage3(data) {
  const RAW_MATS = [
    {key:'roundwood',    label:'Roundwood',                          speciesLabel:'Indicate species used'},
    {key:'vir_forest',   label:'Virgin wood forest residues',        speciesLabel:'Indicate species used'},
    {key:'sawdust',      label:'Sawdust',                            speciesLabel:'Indicate species used'},
    {key:'ext_prod_res', label:'External delivered production residues', speciesLabel:'Indicate species used'},
    {key:'ext_recycled', label:'External collected recycled wood',   speciesLabel:'Describe the source'},
    {key:'nonwood',      label:'Non-wood plant material (specify):',  speciesLabel:'Indicate species used', specify:true},
    {key:'other',        label:'Other (specify):',                   speciesLabel:'Indicate species used', specify:true},
  ];
  const RESIN_TYPES = [{v:'',l:'— select type —'},{v:'UF',l:'UF (Urea-Formaldehyde)'},{v:'MF',l:'MF (Melamine-Formaldehyde)'},{v:'MUF',l:'MUF (Melamine-Urea-Formaldehyde)'},{v:'PF',l:'PF (Phenol-Formaldehyde)'},{v:'pMDI',l:'pMDI (polymeric MDI)'},{v:'Other',l:'Other'}];

  const matRows = RAW_MATS.map(r => `<tr class="prod-row">
    <td class="prod-td">
      <div class="rm-label-wrap">
        <span class="rm-main-label">${r.specify ? `<input class="form-input form-input-sm" type="text" name="rm_${r.key}_specify" placeholder="${r.label}" value="${v(data,`rm_${r.key}_specify`)}">` : r.label}</span>
        <span class="rm-sub-label"><label class="form-label form-label-sub">${r.speciesLabel}</label>
          <input class="form-input form-input-sm" type="text" name="rm_${r.key}_species" value="${v(data,`rm_${r.key}_species`)}"></span>
      </div>
    </td>
    <td class="prod-td">${numUnit(`rm_${r.key}_pct`, v(data,`rm_${r.key}_pct`), '%', 'max="100"')}</td>
    <td class="prod-td"><input class="form-input" type="text" name="rm_${r.key}_source" value="${v(data,`rm_${r.key}_source`)}"></td>
  </tr>`).join('');

  const resinTypeOpts = t => RESIN_TYPES.map(rt => `<option value="${rt.v}" ${sel(data,`resin_${t}_type`,rt.v)}>${rt.l}</option>`).join('');

  return `
<header class="page-header">
  <div class="page-header-meta">Page 3 of 12 · Sheet: 3. Raw Materials</div>
  <h1 class="page-title">Raw Materials for panel production</h1>
  <p class="page-subtitle">Data reported here correspond to raw materials used in the production of panels.</p>
</header>
<div class="page-content">
<form id="page-form" data-page-id="3" novalidate>

  <!-- Reference year -->
  <section class="form-section">
    <div class="form-section-body grid-sheet">
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Reference year</label></div>
        <div class="sheet-field"><div class="form-radio-group">${refYearRadios(data)}</div></div>
      </div>
    </div>
  </section>

  <!-- 3.1 Main raw materials -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">3.1 — Main raw materials</h2></div>
    <div class="prod-table-wrap">
      <table class="prod-table">
        <thead><tr>
          <th class="prod-th" style="min-width:260px">Raw material</th>
          <th class="prod-th">Distribution in reference year (%)</th>
          <th class="prod-th">Species / source</th>
        </tr></thead>
        <tbody>
          ${matRows}
          <tr class="prod-row-total">
            <td class="prod-td"><strong>Total</strong></td>
            <td class="prod-td">${numUnit('', '', '%').replace('<input', '<input id="rm_total_pct" readonly placeholder="auto" style="background:var(--color-bg)"')}</td>
            <td class="prod-td"></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- 3.2 Resin and additives -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">3.2 — Resin and additives used</h2></div>
    <div class="prod-table-wrap">
      <table class="prod-table">
        <thead><tr>
          <th class="prod-th" style="width:160px">Item</th>
          <th class="prod-th" style="width:220px">Type</th>
          <th class="prod-th" style="width:180px">% of total resin consumption</th>
          <th class="prod-th">Comments</th>
        </tr></thead>
        <tbody>
          ${[1,2,3,4].map(r => `<tr class="prod-row">
            <td class="prod-td"><strong>Resin ${r}</strong></td>
            <td class="prod-td"><select class="form-select" name="resin_${r}_type">${resinTypeOpts(r)}</select></td>
            <td class="prod-td">${numUnit(`resin_${r}_pct`, v(data,`resin_${r}_pct`), '%', 'max="100"')}</td>
            <td class="prod-td"><input class="form-input" type="text" name="resin_${r}_comments" value="${v(data,`resin_${r}_comments`)}"></td>
          </tr>`).join('')}
          ${[1,2].map(n => `<tr class="prod-row">
            <td class="prod-td"><strong>Hardening agent ${n}</strong></td>
            <td class="prod-td"><input class="form-input" type="text" name="hard_${n}_type" value="${v(data,`hard_${n}_type`)}"></td>
            <td class="prod-td"></td>
            <td class="prod-td"><input class="form-input" type="text" name="hard_${n}_comments" value="${v(data,`hard_${n}_comments`)}"></td>
          </tr>`).join('')}
          <tr class="prod-row-subheader"><td colspan="4">Additives</td></tr>
          ${[{k:'wax',l:'Wax'},{k:'other_add',l:'Other'}].map(a => `<tr class="prod-row">
            <td class="prod-td" style="padding-left:var(--space-6)">${a.l}</td>
            <td class="prod-td"><input class="form-input" type="text" name="add_${a.k}_type" value="${v(data,`add_${a.k}_type`)}"></td>
            <td class="prod-td"></td>
            <td class="prod-td"><input class="form-input" type="text" name="add_${a.k}_comments" value="${v(data,`add_${a.k}_comments`)}"></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="section-comments-row">
      <label class="form-label form-label-sub">Comments</label>
      <textarea class="form-textarea" name="s32_comments" rows="3" placeholder="Details concerning use of resins for different panel products…">${v(data,'s32_comments')}</textarea>
    </div>
  </section>

</form>
</div>
${navFooter(3)}`;
}

/* ══════════════════════════════════════════════════════════════════════
   PAGE 4 — Energy Production
   ══════════════════════════════════════════════════════════════════════ */
function renderPage4(data) {
  const cuCount = Math.max(4, parseInt(v(data,'cu_count','4'), 10));
  const EQUIP = [{v:'',l:'— select —'},{v:'boiler',l:'Boiler'},{v:'engine',l:'Engine'},{v:'turbine',l:'Turbine'},{v:'incinerator',l:'Waste wood incinerator'},{v:'other',l:'Other'}];
  const BOILER = [{v:'',l:'— select —'},{v:'nat',l:'Natural circulation'},{v:'forc',l:'Forced circulation'},{v:'once',l:'Once-through'},{v:'fbb',l:'Fluidized bed (bubbling)'},{v:'fbc',l:'Fluidized bed (circulating)'},{v:'other',l:'Other'}];
  const IGNITION = [{v:'',l:'— select —'},{v:'spark',l:'Spark ignition'},{v:'comp',l:'Compression ignition'},{v:'dual',l:'Dual fuel'}];
  const FUELS = [{k:'prod_res',l:'Production residues'},{k:'liquid',l:'Liquid fuel'},{k:'natgas',l:'Natural gas'},{k:'rec_ext',l:'Recycled wood (external)'},{k:'rec_waste',l:'Recycled wood (waste)'},{k:'biomass',l:'Biomass'},{k:'other',l:'Other fuels'}];

  const cus = Array.from({length:cuCount},(_,i)=>i+1);
  const cuCols = cus.map(ci => `<th class="prod-th cu-th-col" data-cu="${ci}">CU${ci}${ci>4?`<button type="button" class="cu-remove-btn" data-cu="${ci}" aria-label="Remove CU${ci}">✕</button>`:''}</th>`).join('');

  function cuRow(label, unit, field) {
    return `<tr class="prod-row"><td class="prod-td cu-td-label">${label}</td><td class="prod-td cu-td-unit">${unit}</td>${cus.map(ci=>`<td class="prod-td"><input class="form-input" type="number" min="0" step="any" name="cu_${ci}_${field}" value="${v(data,`cu_${ci}_${field`)}"></td>`).join('')}</tr>`;
  }
  function cuRowText(label, field, placeholder='') {
    return `<tr class="prod-row"><td class="prod-td cu-td-label">${label}</td><td class="prod-td cu-td-unit"></td>${cus.map(ci=>`<td class="prod-td"><input class="form-input form-input-sm" type="text" name="cu_${ci}_${field}" value="${v(data,`cu_${ci}_${field}`)}" placeholder="${placeholder}"></td>`).join('')}</tr>`;
  }
  function cuRowSelect(label, field, opts) {
    return `<tr class="prod-row"><td class="prod-td cu-td-label">${label}</td><td class="prod-td cu-td-unit"></td>${cus.map(ci=>`<td class="prod-td"><select class="form-select" name="cu_${ci}_${field}">${opts.map(o=>`<option value="${o.v}" ${sel(data,`cu_${ci}_${field}`,o.v)}>${o.l}</option>`).join('')}</select></td>`).join('')}</tr>`;
  }
  function cuRowYN(label, field) {
    return `<tr class="prod-row"><td class="prod-td cu-td-label">${label}</td><td class="prod-td cu-td-unit"></td>${cus.map(ci=>`<td class="prod-td">${ynSel(data,`cu_${ci}_${field}`)}</td>`).join('')}</tr>`;
  }

  const fuelRows = FUELS.map(f => `
    ${cuRow(`${f.l} — %`, '%', `fuel_${f.k}_pct`)}
    ${cuRowText(`${f.l} — description`, `fuel_${f.k}_desc`, 'describe…')}`).join('');

  return `
<header class="page-header">
  <div class="page-header-meta">Page 4 of 12 · Sheet: 4. Energy Production</div>
  <h1 class="page-title">Operating information for combustion/incineration plants</h1>
  <p class="page-subtitle">Data correspond to combustion units or incinerators producing energy for WBP production.</p>
</header>
<div class="page-content">
<form id="page-form" data-page-id="4" novalidate>
  <input type="hidden" name="cu_count" id="cu_count" value="${cuCount}">

  <!-- Reference year -->
  <section class="form-section">
    <div class="form-section-body grid-sheet">
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Reference year</label></div>
        <div class="sheet-field"><div class="form-radio-group">${refYearRadios(data)}</div></div>
      </div>
    </div>
  </section>

  <!-- 4.1 Flow diagram -->
  <section class="form-section">
    <div class="form-section-body grid-sheet">
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num">4.1</span><label class="form-label">Flow diagram attachment</label></div>
        <div class="sheet-field">
          <div class="instr-callout instr-callout-warning">Please attach (as annex) a flow diagram showing connections between combustion units and processes on the WBP site.</div>
          <input class="form-input" type="text" name="s41_diagram_ref" placeholder="e.g. Annex A — CU flow diagram.pdf" value="${v(data,'s41_diagram_ref')}">
        </div>
      </div>
    </div>
  </section>

  <!-- 4.2 CU configuration -->
  <section class="form-section">
    <div class="form-section-header" style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-4)">
      <div>
        <h2 class="form-section-title">4.2 — Combustion unit configuration characteristics</h2>
        <p class="form-section-desc">One column per combustion unit. Minimum 4 columns.</p>
      </div>
      <button type="button" id="btn-add-cu" class="btn btn-secondary" style="flex-shrink:0">+ Add CU</button>
    </div>
    <div class="prod-table-wrap">
      <table class="prod-table cu-table" id="cu-table">
        <thead><tr>
          <th class="prod-th cu-th-label">Parameter</th>
          <th class="prod-th cu-th-unit">Unit</th>
          ${cuCols}
        </tr></thead>
        <tbody>
          ${cuRow('Total rated thermal input', 'MW<sub>th</sub>', 'thermal_input')}
          ${cuRow('Energy output used on site', 'MW<sub>th</sub>', 'energy_output')}
          ${cuRowText('General process description', 'general_process', 'e.g. steam generation, direct drying…')}
          ${[1,2,3,4,5].map(oi => cuRow(`Output ${oi}`, 'MW', `output_${oi}`)).join('')}
          <tr class="cu-row-subheader"><td colspan="${cuCount+2}">Fuel composition (% of total fuel input per CU)</td></tr>
          ${fuelRows}
          <tr class="cu-row-subheader"><td colspan="${cuCount+2}">Equipment type &amp; configuration</td></tr>
          ${cuRowSelect('Equipment type', 'equip_type', EQUIP)}
          ${cuRow('Installation year', '', 'install_year')}
          ${cuRowSelect('Boiler detail (if boiler)', 'boiler_detail', BOILER)}
          ${cuRowSelect('Engine ignition (if engine)', 'engine_ignition', IGNITION)}
          ${cuRowYN('Dual fuel?', 'dual_fuel')}
          ${cuRowYN('CHP (combined heat & power)?', 'chp')}
          ${cuRowYN('Supplementary firing?', 'suppl_fire')}
          ${cuRow('Operating hours — normal', 'h/year', 'hours_normal')}
          ${cuRow('Operating hours — start-up/shutdown', 'h/year', 'hours_special')}
        </tbody>
      </table>
    </div>
  </section>

  <!-- 4.3 Energy data -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">4.3 — Energy data for specific processes</h2></div>
    <div class="form-section-body">
      <div class="form-group"><label class="form-label">Steam generation</label>${numUnit('s43_steam', v(data,'s43_steam'), 'MWh<sub>th</sub>')}</div>
      <div class="form-group"><label class="form-label">Hot oil / thermal oil</label>${numUnit('s43_hot_oil', v(data,'s43_hot_oil'), 'MWh<sub>th</sub>')}</div>
      <div class="form-group"><label class="form-label">Flue gas (direct drying)</label>${numUnit('s43_fluegas', v(data,'s43_fluegas'), 'MWh<sub>th</sub>')}</div>
      <div class="form-group"><label class="form-label">Other energy output</label>${numUnit('s43_other', v(data,'s43_other'), 'MWh<sub>th</sub>')}</div>
      <div class="form-group"><label class="form-label">Cold start-ups (per year)</label><input class="form-input form-input-narrow" type="number" min="0" name="s43_cold_startups" value="${v(data,'s43_cold_startups')}"></div>
      <div class="form-group"><label class="form-label">Warm start-ups (per year)</label><input class="form-input form-input-narrow" type="number" min="0" name="s43_warm_startups" value="${v(data,'s43_warm_startups')}"></div>
      <div class="form-group form-group-wide"><label class="form-label">Maintenance description</label>
        <textarea class="form-textarea" name="s43_maintenance_desc" rows="2">${v(data,'s43_maintenance_desc')}</textarea></div>
      <div class="form-group form-group-wide"><label class="form-label">Comments</label>
        <textarea class="form-textarea" name="comments" rows="3">${v(data,'comments')}</textarea></div>
    </div>
  </section>

</form>
</div>
${navFooter(4)}`;
}

/* ══════════════════════════════════════════════════════════════════════
   PAGE 5 — Dryer & Press Line
   ══════════════════════════════════════════════════════════════════════ */
function renderPage5(data) {
  const dryerCount = Math.max(1, parseInt(v(data,'dryer_count','1'), 10));
  const pressCount  = Math.max(1, parseInt(v(data,'press_count','1'),  10));
  const DRYER_TYPES = [{v:'',l:'— select —'},{v:'single',l:'Single stage drum dryer'},{v:'three',l:'Three stage drum dryer'},{v:'tubular',l:'Tubular bundle dryer'},{v:'double',l:'Double rotation tube dryer'},{v:'utws',l:'UTWS dryer'},{v:'flash_pre',l:'Flash tube pre-dryer'},{v:'blowline',l:'Blowline flash dryer (fibres)'},{v:'indirect',l:'Indirect heated dryer'},{v:'other',l:'Other'}];
  const PRESS_TYPES  = [{v:'',l:'— select —'},{v:'continuous',l:'Continuous press'},{v:'single_opening',l:'Single opening press'},{v:'multi_opening',l:'Multi-opening press'},{v:'other',l:'Other'}];
  const RES_UNITS    = [{v:'',l:'— select —'},{v:'min',l:'minutes'},{v:'sec',l:'seconds'}];

  function dryerBlock(di) {
    const d = name => v(data, `dryer_${di}_${name}`);
    const typeOpts = DRYER_TYPES.map(t => `<option value="${t.v}" ${sel(data,`dryer_${di}_main_type`,t.v)}>${t.l}</option>`).join('');
    const resOpts  = RES_UNITS.map(t => `<option value="${t.v}" ${sel(data,`dryer_${di}_residence_unit`,t.v)}>${t.l}</option>`).join('');
    return `
    <div class="repeating-instance" id="dryer-instance-${di}">
      <div class="repeating-instance-header">
        <h2 class="repeating-instance-title">Dryer ${di}</h2>
        ${di>1?`<button type="button" class="instance-remove-btn" data-type="dryer" data-index="${di}">Remove ✕</button>`:''}
      </div>
      <!-- 5.1 General -->
      <section class="form-section" style="border-radius:0;border-top:none;margin-bottom:0">
        <div class="form-section-header"><h3 class="form-section-title">5.1 — General information on dryer</h3></div>
        <div class="prod-table-wrap">
          <table class="prod-table"><tbody>
            <tr class="prod-row"><td class="prod-td cu-td-label" style="width:340px">Reference year</td>
              <td class="prod-td"><div class="form-radio-group">${['2009','2010','2011'].map(yr=>`<label class="form-radio-label"><input class="form-radio-input" type="radio" name="dryer_${di}_ref_year" value="${yr}" ${chk(data,`dryer_${di}_ref_year`,yr)||(yr==='2010'&&!data[`dryer_${di}_ref_year`]?'checked':'')}> ${yr}</label>`).join('')}</div></td></tr>
            <tr class="prod-row"><td class="prod-td cu-td-label">Main type of dryer</td>
              <td class="prod-td"><select class="form-select" name="dryer_${di}_main_type">${typeOpts}</select></td></tr>
            <tr class="prod-row"><td class="prod-td cu-td-label">Describe the dryer type and system set-up</td>
              <td class="prod-td"><textarea class="form-textarea" name="dryer_${di}_system_desc" rows="2">${d('system_desc')}</textarea></td></tr>
            <tr class="prod-row"><td class="prod-td cu-td-label">Product to be dried and end-product</td>
              <td class="prod-td"><input class="form-input" type="text" name="dryer_${di}_product" value="${d('product')}"></td></tr>
            <tr class="prod-row"><td class="prod-td cu-td-label">Installation year</td>
              <td class="prod-td"><input class="form-input form-input-narrow" type="number" min="1900" max="2030" name="dryer_${di}_install_year" value="${d('install_year')}"></td></tr>
          </tbody></table>
        </div>
      </section>
      <!-- 5.2 Performance -->
      <section class="form-section" style="border-radius:0;border-top:none;margin-bottom:0">
        <div class="form-section-header"><h3 class="form-section-title">5.2 — Dryer performance</h3></div>
        <div class="prod-table-wrap">
          <table class="prod-table">
            <thead><tr><th class="prod-th" style="width:340px">Parameter</th><th class="prod-th" style="width:120px">Unit</th><th class="prod-th">Value</th></tr></thead>
            <tbody>
              <tr class="prod-row"><td class="prod-td">Temperature range for drying</td><td class="prod-td cu-td-unit">°C</td>
                <td class="prod-td"><div style="display:flex;gap:8px;align-items:center">
                  <input class="form-input form-input-narrow" type="number" step="any" name="dryer_${di}_temp_min" placeholder="min" value="${d('temp_min')}">
                  <span style="color:var(--color-text-muted)">–</span>
                  <input class="form-input form-input-narrow" type="number" step="any" name="dryer_${di}_temp_max" placeholder="max" value="${d('temp_max')}">
                  <span class="form-unit" style="border-left:1px solid var(--color-border);border-radius:0 6px 6px 0">°C</span>
                </div></td></tr>
              <tr class="prod-row"><td class="prod-td">Outlet temperature</td><td class="prod-td cu-td-unit">°C</td>
                <td class="prod-td">${numUnit(`dryer_${di}_outlet_temp`,d('outlet_temp'),'°C')}</td></tr>
              <tr class="prod-row"><td class="prod-td">Tonnes of product dried per year</td><td class="prod-td cu-td-unit">t/year</td>
                <td class="prod-td"><input class="form-input" type="number" min="0" step="any" name="dryer_${di}_product_dried" value="${d('product_dried')}"></td></tr>
              <tr class="prod-row"><td class="prod-td">Moisture content before drying</td><td class="prod-td cu-td-unit">%</td>
                <td class="prod-td">${numUnit(`dryer_${di}_mc_before`,d('mc_before'),'%','max="100"')}</td></tr>
              <tr class="prod-row"><td class="prod-td">Moisture content after drying</td><td class="prod-td cu-td-unit">%</td>
                <td class="prod-td">${numUnit(`dryer_${di}_mc_after`,d('mc_after'),'%','max="100"')}</td></tr>
              <tr class="prod-row"><td class="prod-td">Drying rate</td><td class="prod-td cu-td-unit">kg/h</td>
                <td class="prod-td"><input class="form-input" type="number" min="0" step="any" name="dryer_${di}_drying_rate" value="${d('drying_rate')}"></td></tr>
              <tr class="prod-row"><td class="prod-td">Residence time</td><td class="prod-td cu-td-unit"></td>
                <td class="prod-td"><div style="display:flex;gap:8px">
                  <input class="form-input form-input-narrow" type="number" min="0" step="any" name="dryer_${di}_residence_val" value="${d('residence_val')}">
                  <select class="form-select" name="dryer_${di}_residence_unit" style="max-width:120px">${resOpts}</select>
                </div></td></tr>
              <tr class="prod-row"><td class="prod-td">Recirculation of dryer exhaust gas?</td><td class="prod-td"></td>
                <td class="prod-td">${ynSel(data,`dryer_${di}_recirculation`)}</td></tr>
              <tr class="prod-row"><td class="prod-td">Heat regained from dryer exhaust?</td><td class="prod-td"></td>
                <td class="prod-td">${ynSel(data,`dryer_${di}_heat_regained`)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>`;
  }

  function pressBlock(pi) {
    const pd = name => v(data, `press_${pi}_${name}`);
    const typeOpts = PRESS_TYPES.map(t => `<option value="${t.v}" ${sel(data,`press_${pi}_main_type`,t.v)}>${t.l}</option>`).join('');
    return `
    <div class="repeating-instance" id="press-instance-${pi}">
      <div class="repeating-instance-header">
        <h2 class="repeating-instance-title">Press Line ${pi}</h2>
        ${pi>1?`<button type="button" class="instance-remove-btn" data-type="press" data-index="${pi}">Remove ✕</button>`:''}
      </div>
      <section class="form-section" style="border-radius:0;border-top:none;margin-bottom:0">
        <div class="form-section-header"><h3 class="form-section-title">5.3 — Press line general information</h3></div>
        <div class="prod-table-wrap">
          <table class="prod-table"><tbody>
            <tr class="prod-row"><td class="prod-td cu-td-label" style="width:340px">Reference year</td>
              <td class="prod-td"><div class="form-radio-group">${['2009','2010','2011'].map(yr=>`<label class="form-radio-label"><input class="form-radio-input" type="radio" name="press_${pi}_ref_year" value="${yr}" ${chk(data,`press_${pi}_ref_year`,yr)||(yr==='2010'&&!data[`press_${pi}_ref_year`]?'checked':'')}> ${yr}</label>`).join('')}</div></td></tr>
            <tr class="prod-row"><td class="prod-td cu-td-label">Main type of press</td>
              <td class="prod-td"><select class="form-select" name="press_${pi}_main_type">${typeOpts}</select></td></tr>
            <tr class="prod-row"><td class="prod-td cu-td-label">Describe the press line set-up</td>
              <td class="prod-td"><textarea class="form-textarea" name="press_${pi}_system_desc" rows="2">${pd('system_desc')}</textarea></td></tr>
            <tr class="prod-row"><td class="prod-td cu-td-label">Product pressed</td>
              <td class="prod-td"><input class="form-input" type="text" name="press_${pi}_product" value="${pd('product')}"></td></tr>
            <tr class="prod-row"><td class="prod-td cu-td-label">Installation year</td>
              <td class="prod-td"><input class="form-input form-input-narrow" type="number" min="1900" max="2030" name="press_${pi}_install_year" value="${pd('install_year')}"></td></tr>
          </tbody></table>
        </div>
      </section>
      <section class="form-section" style="border-radius:0;border-top:none;margin-bottom:0">
        <div class="form-section-header"><h3 class="form-section-title">5.4 — Press line performance</h3></div>
        <div class="prod-table-wrap">
          <table class="prod-table">
            <thead><tr><th class="prod-th" style="width:340px">Parameter</th><th class="prod-th" style="width:120px">Unit</th><th class="prod-th">Value</th></tr></thead>
            <tbody>
              <tr class="prod-row"><td class="prod-td">Press temperature</td><td class="prod-td cu-td-unit">°C</td>
                <td class="prod-td">${numUnit(`press_${pi}_temp`,pd('temp'),'°C')}</td></tr>
              <tr class="prod-row"><td class="prod-td">Press pressure</td><td class="prod-td cu-td-unit">N/mm²</td>
                <td class="prod-td">${numUnit(`press_${pi}_pressure`,pd('pressure'),'N/mm²')}</td></tr>
              <tr class="prod-row"><td class="prod-td">Production output</td><td class="prod-td cu-td-unit">m³/year</td>
                <td class="prod-td"><input class="form-input" type="number" min="0" step="any" name="press_${pi}_output" value="${pd('output')}"></td></tr>
              <tr class="prod-row"><td class="prod-td">Press factor (specific pressing time)</td><td class="prod-td cu-td-unit">s/mm</td>
                <td class="prod-td"><input class="form-input" type="number" min="0" step="any" name="press_${pi}_factor" value="${pd('factor')}"></td></tr>
              <tr class="prod-row"><td class="prod-td">Exhaust gas collected?</td><td class="prod-td"></td>
                <td class="prod-td">${ynSel(data,`press_${pi}_exhaust_collected`)}</td></tr>
              <tr class="prod-row"><td class="prod-td">Air abatement applied?</td><td class="prod-td"></td>
                <td class="prod-td">${ynSel(data,`press_${pi}_abatement`)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>`;
  }

  return `
<header class="page-header">
  <div class="page-header-meta">Page 5 of 12 · Sheet: 5. Dryer and Press Line</div>
  <h1 class="page-title">Dryer and press line performance</h1>
</header>
<div class="page-content">
  <div class="multi-instance-notice">
    <div class="doc-notice doc-notice-deadline"><span class="doc-notice-icon">📋</span>
      <p>Sections 5.1–5.2 correspond to <strong>one dryer type</strong>. Use <em>Add another dryer</em> for additional dryers operating under different conditions.</p></div>
    <div class="doc-notice doc-notice-confidential"><span class="doc-notice-icon">📋</span>
      <p>Sections 5.3–5.4 correspond to <strong>one press line</strong>. Use <em>Add another press line</em> for multiple lines.</p></div>
  </div>
<form id="page-form" data-page-id="5" novalidate>
  <input type="hidden" name="dryer_count" id="dryer_count" value="${dryerCount}">
  <input type="hidden" name="press_count"  id="press_count"  value="${pressCount}">

  <!-- Dryer instances -->
  <div id="dryer-instances">
    ${Array.from({length:dryerCount},(_,i)=>dryerBlock(i+1)).join('')}
  </div>
  <div class="add-instance-btn">
    <button type="button" id="btn-add-dryer" class="btn btn-secondary">+ Add another dryer</button>
  </div>

  <!-- Press instances -->
  <div id="press-instances">
    ${Array.from({length:pressCount},(_,i)=>pressBlock(i+1)).join('')}
  </div>
  <div class="add-instance-btn">
    <button type="button" id="btn-add-press" class="btn btn-secondary">+ Add another press line</button>
  </div>

  <!-- General comments -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">Comments</h2></div>
    <div class="form-section-body">
      <div class="form-group form-group-wide">
        <textarea class="form-textarea" name="comments" rows="3">${v(data,'comments')}</textarea>
      </div>
    </div>
  </section>

</form>
</div>
${navFooter(5)}`;
}

/* ══════════════════════════════════════════════════════════════════════
   PAGE 6 — Air Abatement
   ══════════════════════════════════════════════════════════════════════ */
function renderPage6(data) {
  const techCount = Math.max(1, parseInt(v(data,'tech_count','1'), 10));
  const WG_SOURCES = [{k:'dryer',l:'Dryer exhaust'},{k:'press',l:'Press exhaust'},{k:'paper',l:'Impreg. paper production'},{k:'other',l:'Other (specify)'}];

  function techBlock(ti) {
    const td = name => v(data, `tech_${ti}_${name}`);
    const srcRows = WG_SOURCES.map(s => `<tr class="prod-row">
      <td class="prod-td cu-td-label">${s.l}</td>
      <td class="prod-td">${ynSel(data,`tech_${ti}_src_${s.k}_yn`)}</td>
      <td class="prod-td"><input class="form-input" type="text" name="tech_${ti}_src_${s.k}_spec" value="${v(data,`tech_${ti}_src_${s.k}_spec`)}" placeholder="Specify source…"></td>
    </tr>`).join('');

    return `
    <div class="repeating-instance" id="tech-instance-${ti}">
      <div class="repeating-instance-header">
        <h2 class="repeating-instance-title">Abatement Technique ${ti}</h2>
        ${ti>1?`<button type="button" class="instance-remove-btn" data-type="tech" data-index="${ti}">Remove ✕</button>`:''}
      </div>
      <section class="form-section" style="border-radius:0;border-top:none;margin-bottom:0">
        <div class="form-section-body grid-sheet">
          <div class="sheet-row">
            <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Name / type of technique</label></div>
            <div class="sheet-field"><input class="form-input" type="text" name="tech_${ti}_name" value="${td('name')}" placeholder="e.g. ESP, wet scrubber, RTO…"></div>
          </div>
          <div class="sheet-row">
            <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Installation year</label></div>
            <div class="sheet-field"><input class="form-input form-input-narrow" type="number" min="1900" max="2030" name="tech_${ti}_install_year" value="${td('install_year')}"></div>
          </div>
          <div class="sheet-row">
            <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Reference to flow diagram (annex)</label></div>
            <div class="sheet-field"><input class="form-input" type="text" name="tech_${ti}_annex_ref" value="${td('annex_ref')}"></div>
          </div>
          <div class="sheet-row">
            <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Design features and operational parameters</label></div>
            <div class="sheet-field"><textarea class="form-textarea" name="tech_${ti}_design_features" rows="2">${td('design_features')}</textarea></div>
          </div>
          <div class="sheet-row">
            <div class="sheet-label"><span class="sheet-row-num"></span><label class="form-label">Removal efficiency</label></div>
            <div class="sheet-field"><textarea class="form-textarea" name="tech_${ti}_removal_efficiency" rows="2" placeholder="e.g. PM: 98%, SO2: 60%…">${td('removal_efficiency')}</textarea></div>
          </div>
        </div>
        <!-- Waste gas sources table -->
        <div style="padding:0 var(--space-6) var(--space-4)">
          <h4 style="font-size:var(--font-size-sm);font-weight:600;margin-bottom:var(--space-3)">Waste gas sources treated by this technique</h4>
          <div class="prod-table-wrap">
            <table class="prod-table">
              <thead><tr><th class="prod-th">Source</th><th class="prod-th" style="width:90px">Included?</th><th class="prod-th">Specification</th></tr></thead>
              <tbody>${srcRows}</tbody>
            </table>
          </div>
        </div>
        <!-- Mass flows -->
        <div style="padding:0 var(--space-6) var(--space-4)">
          <h4 style="font-size:var(--font-size-sm);font-weight:600;margin-bottom:var(--space-3)">Mass flows (t/year)</h4>
          <div class="prod-table-wrap">
            <table class="prod-table">
              <thead><tr><th class="prod-th">Flow</th><th class="prod-th" style="width:180px">Value (t/year)</th><th class="prod-th">Comments</th></tr></thead>
              <tbody>
                ${[{k:'intake',l:'Total gas intake'},{k:'recycled',l:'Gas recycled to process'},{k:'discharge',l:'Gas discharged to atmosphere'},{k:'waste_res',l:'Residues generated (waste)'}].map(f=>`<tr class="prod-row">
                  <td class="prod-td">${f.l}</td>
                  <td class="prod-td"><input class="form-input" type="number" min="0" step="any" name="tech_${ti}_${f.k}_val" value="${v(data,`tech_${ti}_${f.k}_val`)}"></td>
                  <td class="prod-td"><input class="form-input" type="text" name="tech_${ti}_${f.k}_comment" value="${v(data,`tech_${ti}_${f.k}_comment`)}"></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="section-comments-row">
          <label class="form-label form-label-sub">Comments</label>
          <textarea class="form-textarea" name="tech_${ti}_comments" rows="2">${td('comments')}</textarea>
        </div>
      </section>
    </div>`;
  }

  return `
<header class="page-header">
  <div class="page-header-meta">Page 6 of 12 · Sheet: 6. Air Abatement</div>
  <h1 class="page-title">Air abatement techniques</h1>
  <p class="page-subtitle">Techniques applied to treat dryer, press, and other exhaust gas streams.</p>
</header>
<div class="page-content">
<form id="page-form" data-page-id="6" novalidate>
  <input type="hidden" name="tech_count" id="tech_count" value="${techCount}">

  <!-- Techniques -->
  <div id="tech-instances">
    ${Array.from({length:techCount},(_,i)=>techBlock(i+1)).join('')}
  </div>
  <div class="add-instance-btn">
    <button type="button" id="btn-add-tech" class="btn btn-secondary">+ Add abatement technique</button>
  </div>

  <!-- 6.2 Minor sources -->
  <section class="form-section">
    <div class="form-section-header">
      <h2 class="form-section-title">6.2 — Minor / diffuse sources</h2>
      <p class="form-section-desc">Fugitive or minor channelled sources not covered by the abatement techniques above.</p>
    </div>
    <div class="form-section-body">
      <div class="form-group form-group-wide"><label class="form-label">Description of equipment / sources</label>
        <textarea class="form-textarea" name="s62_equip_desc" rows="2">${v(data,'s62_equip_desc')}</textarea></div>
      <div class="form-group"><label class="form-label">Collected dust</label>${numUnit('s62_collected_dust',v(data,'s62_collected_dust'),'t/year')}</div>
      <div class="form-group"><label class="form-label">Energy recovery from collected dust</label>${numUnit('s62_energy_recovery_pct',v(data,'s62_energy_recovery_pct'),'%','max="100"')}</div>
      <div class="form-group form-group-wide"><label class="form-label">Fate of collected dust</label>
        <textarea class="form-textarea" name="s62_dust_fate" rows="2">${v(data,'s62_dust_fate')}</textarea></div>
      <div class="form-group form-group-wide"><label class="form-label">Monitoring</label>
        <textarea class="form-textarea" name="s62_monitoring" rows="2">${v(data,'s62_monitoring')}</textarea></div>
      <div class="form-group form-group-wide"><label class="form-label">Control measures</label>
        <textarea class="form-textarea" name="s62_control_measures" rows="2">${v(data,'s62_control_measures')}</textarea></div>
      <div class="form-group form-group-wide"><label class="form-label">Comments</label>
        <textarea class="form-textarea" name="s62_comments" rows="2">${v(data,'s62_comments')}</textarea></div>
    </div>
  </section>

</form>
</div>
${navFooter(6)}`;
}
