/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Page Renderers: Pages 7–12
   ══════════════════════════════════════════════════════════════════════ */

'use strict';

/* ══════════════════════════════════════════════════════════════════════
   PAGE 7 — Air Emissions
   ══════════════════════════════════════════════════════════════════════ */
function renderPage7(data) {
  const epCount = Math.max(1, parseInt(v(data,'ep_count','1'), 10));

  const POLLUTANTS = [
    {key:'pm',           label:'PM'},
    {key:'so2',          label:'SO₂'},
    {key:'nox',          label:'NOₓ'},
    {key:'co',           label:'CO'},
    {key:'nh3',          label:'NH₃'},
    {key:'hcho',         label:'Formaldehyde'},
    {key:'nmvoc',        label:'NMVOC'},
    {key:'toc',          label:'TOC'},
    {key:'voc',          label:'VOC'},
    {key:'cvoc',         label:'CVOC'},
    {key:'terpene',      label:'Terpene'},
    {key:'org_acids',    label:'Organic acids', parent:true},
    {key:'formic',       label:'Formic acid',   child:true},
    {key:'acetic',       label:'Acetic acid',   child:true},
    {key:'propionic',    label:'Propionic acid',child:true},
    {key:'aldehydes',    label:'Aldehydes',     parent:true},
    {key:'acetaldehyde', label:'Acetaldehyde',  child:true},
    {key:'phenol',       label:'Phenol'},
    {key:'pmdi',         label:'pMDI'},
    {key:'as',           label:'As'},
    {key:'pb',           label:'Pb'},
    {key:'cr',           label:'Cr'},
    {key:'hcl',          label:'HCl'},
    {key:'hf',           label:'HF'},
    {key:'cd',           label:'Cd', heavy:true},
    {key:'co_hm',        label:'Co', heavy:true},
    {key:'cr_hm',        label:'Cr', heavy:true},
    {key:'cu',           label:'Cu', heavy:true},
    {key:'hg',           label:'Hg', heavy:true},
    {key:'ni',           label:'Ni', heavy:true},
    {key:'sb',           label:'Sb', heavy:true},
    {key:'tl',           label:'Tl', heavy:true},
    {key:'v',            label:'V',  heavy:true},
    {key:'methanol',     label:'Methanol'},
    {key:'odour',        label:'Odour'},
    {key:'others_1',     label:'Others (specify)'},
    {key:'pcdd',         label:'PCDD/PCDF'},
  ];

  const METHODS = [{v:'',l:'— ▼'},{v:'cem',l:'CEM'},{v:'pems',l:'PEMS'},{v:'periodic',l:'Periodic'},{v:'calc',l:'Calculation'},{v:'na',l:'N/A'}];
  const SHORT_AVG = [{v:'',l:'— ▼'},{v:'h',l:'Hourly'},{v:'30min',l:'30 min'},{v:'daily',l:'Daily'},{v:'other',l:'Other'}];

  const EXH_PARAMS = [
    {key:'cross_section', label:'Cross-section area', unit:'m²'},
    {key:'air_pressure',  label:'Air pressure at measurement', unit:'hPa'},
    {key:'temp_dry',      label:'Dry temperature', unit:'°C'},
    {key:'temp_wet',      label:'Wet temperature', unit:'°C'},
    {key:'o2',            label:'O₂ content', unit:'vol-%'},
    {key:'co2',           label:'CO₂ content', unit:'vol-%'},
    {key:'co_gas',        label:'CO content (exhaust)', unit:'vol-%'},
    {key:'inert',         label:'Inert gas (N₂+Ar)', unit:'vol-%'},
    {key:'moisture',      label:'Moisture content', unit:'kg/m³'},
    {key:'density_std',   label:'Density at standard conditions', unit:'kg/m³'},
    {key:'flow_actual',   label:'Actual volume flow', unit:'m³/h'},
    {key:'flow_std',      label:'Standard volume flow (dry)', unit:'Nm³/h'},
  ];

  function epBlock(ei) {
    const ed = name => v(data, `ep_${ei}_${name}`);
    const methodOpts = m => METHODS.map(x=>`<option value="${x.v}" ${v(data,`ep_${ei}_poll_${m}_method`)===x.v?'selected':''}>${x.l}</option>`).join('');
    const shortOpts  = m => SHORT_AVG.map(x=>`<option value="${x.v}" ${v(data,`ep_${ei}_poll_${m}_short_term`)===x.v?'selected':''}>${x.l}</option>`).join('');

    const pollRows = POLLUTANTS.map(p => {
      if (p.parent) return `<tr class="prod-row-subheader"><td colspan="7" style="padding-left:${p.child?'var(--space-8)':'var(--space-4)'}">${p.label}</td></tr>`;
      const indent = p.child ? 'style="padding-left:var(--space-8)"' : '';
      return `<tr class="prod-row">
        <td class="prod-td cu-td-label" ${indent}>${p.label}${p.heavy?'<span class="form-hint"> (heavy metal)</span>':''}</td>
        <td class="prod-td"><input class="form-input" type="number" step="any" min="0" name="ep_${ei}_poll_${p.key}_conc" value="${v(data,`ep_${ei}_poll_${p.key}_conc`)}"></td>
        <td class="prod-td"><select class="form-select" name="ep_${ei}_poll_${p.key}_method">${methodOpts(p.key)}</select></td>
        <td class="prod-td"><input class="form-input" type="number" step="any" min="0" name="ep_${ei}_poll_${p.key}_t_year" value="${v(data,`ep_${ei}_poll_${p.key}_t_year`)}"></td>
        <td class="prod-td"><select class="form-select" name="ep_${ei}_poll_${p.key}_short_term">${shortOpts(p.key)}</select></td>
        <td class="prod-td"><input class="form-input" type="number" step="any" min="0" name="ep_${ei}_poll_${p.key}_short_val" value="${v(data,`ep_${ei}_poll_${p.key}_short_val`)}"></td>
        <td class="prod-td"><input class="form-input" type="text" name="ep_${ei}_poll_${p.key}_limit" value="${v(data,`ep_${ei}_poll_${p.key}_limit`)}"></td>
      </tr>`;
    }).join('');

    const exhRows = EXH_PARAMS.map(p => `<div class="form-group">
      <label class="form-label form-label-sub">${p.label}</label>
      <div class="form-input-with-unit">
        <input class="form-input" type="number" step="any" min="0" name="ep_${ei}_${p.key}" value="${v(data,`ep_${ei}_${p.key}`)}">
        <span class="form-unit">${p.unit}</span>
      </div>
    </div>`).join('');

    const refcondOpts = ['K','L','M','N'].map(c => {
      const labels = {K:'K — Fresh in (no corrections made)',L:'L — Already corrected to standard conditions',M:'M — Fresh in; correction possible using measured parameters',N:'N — Other conditions (explain in comments)'};
      return `<label class="refcond-option"><input type="radio" name="ep_${ei}_refcond" value="${c}" ${v(data,`ep_${ei}_refcond`)===c?'checked':''}> <span>${labels[c]}</span></label>`;
    }).join('');

    return `
    <div class="repeating-instance" id="ep-instance-${ei}">
      <div class="repeating-instance-header">
        <h3 class="repeating-instance-title">Emission Point ${ei}</h3>
        ${ei>1?`<button type="button" class="instance-remove-btn" data-type="ep" data-index="${ei}">✕ Remove</button>`:''}
      </div>

      <!-- 7.1 Emission point details -->
      <section class="form-section" style="border-radius:0;border-top:none;margin-bottom:0">
        <div class="form-section-header"><h4 class="form-section-title">7.1 — Details on the emission point</h4></div>
        <div class="form-section-body">
          <div class="form-group"><label class="form-label">Emission point ID</label>
            <input class="form-input" type="text" name="ep_${ei}_id" value="${ed('id')}" placeholder="e.g. EP-01"></div>
          <div class="form-group"><label class="form-label">Reference year</label>
            <input class="form-input" type="text" name="ep_${ei}_ref_year" value="${ed('ref_year')}" placeholder="e.g. 2010"></div>
          <div class="form-group form-group-wide"><label class="form-label">Waste gas streams channelled to this emission point</label>
            <textarea class="form-textarea" name="ep_${ei}_waste_gas_desc" rows="2" placeholder="Describe sources/streams, reference to Sheet 6 technique IDs…">${ed('waste_gas_desc')}</textarea></div>
          <div class="form-group form-group-wide"><label class="form-label">Reference conditions for values entered</label>
            <div class="refcond-group">${refcondOpts}</div></div>
        </div>

        <!-- Exhaust gas parameters -->
        <details class="params-accordion">
          <summary>▶ Exhaust gas parameters (optional — expand to fill)</summary>
          <div class="params-accordion-body">${exhRows}</div>
        </details>
      </section>

      <!-- 7.2 Pollutant measurements -->
      <section class="form-section" style="border-radius:0;border-top:none;margin-bottom:0">
        <div class="form-section-header"><h4 class="form-section-title">7.2 — Pollutant measurements (annual averages)</h4></div>
        <div class="prod-table-wrap">
          <table class="prod-table">
            <thead><tr>
              <th class="prod-th" style="min-width:160px">Pollutant</th>
              <th class="prod-th">Conc. (mg/Nm³)</th>
              <th class="prod-th" style="width:120px">Method</th>
              <th class="prod-th">t/year</th>
              <th class="prod-th" style="width:100px">Short-term avg</th>
              <th class="prod-th">Short-term value</th>
              <th class="prod-th">Permit limit</th>
            </tr></thead>
            <tbody>${pollRows}</tbody>
          </table>
        </div>
        <div class="section-comments-row">
          <label class="form-label form-label-sub">Comments for this emission point</label>
          <textarea class="form-textarea" name="ep_${ei}_comments" rows="2">${ed('comments')}</textarea>
        </div>
      </section>
    </div>`;
  }

  return `
<header class="page-header">
  <div class="page-header-meta">Page 7 of 12 · Sheet: 7. Air Emissions</div>
  <h1 class="page-title">Air emissions — channelled</h1>
  <p class="page-subtitle">One block per emission point. Report annual averages for the reference year, corrected to reference conditions.</p>
</header>
<div class="page-content">
<form id="page-form" data-page-id="7" novalidate>
  <input type="hidden" name="ep_count" id="ep_count" value="${epCount}">

  <div id="ep-instances">
    ${Array.from({length:epCount},(_,i)=>epBlock(i+1)).join('')}
  </div>
  <div class="add-instance-btn">
    <button type="button" id="btn-add-ep" class="btn btn-secondary">+ Add emission point</button>
  </div>
</form>
</div>
${navFooter(7)}`;
}

/* ══════════════════════════════════════════════════════════════════════
   PAGE 8 — Water Emissions
   ══════════════════════════════════════════════════════════════════════ */
function renderPage8(data) {
  const wwCount = Math.max(1, parseInt(v(data,'ww_count','1'), 10));

  const WW_SOURCES = [
    {k:'refining',     l:'Wood refining'},
    {k:'cleaning',     l:'Cleaning activities'},
    {k:'manuf',        l:'Manufacturing process water'},
    {k:'runoff_pond',  l:'Run-off from wood storage ponds'},
    {k:'runoff_other', l:'Run-off from other storage'},
    {k:'abatement',    l:'Air abatement water'},
    {k:'firefighting', l:'Firefighting water'},
    {k:'open',         l:'Other (specify)'},
  ];

  const WW_POLLS = [
    {k:'flow', l:'Flow', unit:'m³/year'},
    {k:'ph',   l:'pH', unit:'—'},
    {k:'tss',  l:'TSS', unit:'mg/L'},
    {k:'bod5', l:'BOD₅', unit:'mg/L'},
    {k:'cod',  l:'COD', unit:'mg/L'},
    {k:'toc',  l:'TOC', unit:'mg/L'},
    {k:'thc',  l:'THC', unit:'mg/L'},
    {k:'total_n',l:'Total N', unit:'mg/L'},
    {k:'tan',  l:'TAN', unit:'mg/L'},
    {k:'nh4',  l:'NH₄-N', unit:'mg/L'},
    {k:'other_1',l:'Other 1', unit:'mg/L'},
    {k:'other_2',l:'Other 2', unit:'mg/L'},
    {k:'other_3',l:'Other 3', unit:'mg/L'},
  ];

  const FREQ = [{v:'',l:'—'},{v:'cont',l:'Continuous'},{v:'daily',l:'Daily'},{v:'weekly',l:'Weekly'},{v:'monthly',l:'Monthly'},{v:'quarterly',l:'Quarterly'},{v:'2year',l:'2/year'},{v:'1year',l:'1/year'},{v:'na',l:'N/A'}];
  const POS  = [{v:'',l:'—'},{v:'discharge',l:'Discharge point'},{v:'wwtp_out',l:'WWTP outlet'},{v:'wwtp_in',l:'WWTP inlet'},{v:'upstream',l:'Upstream'},{v:'downstream',l:'Downstream'},{v:'other',l:'Other'}];
  const SLUDGE_FATE = [{v:'',l:'—'},{v:'incinerate',l:'Incinerate'},{v:'reuse_site',l:'Reuse on-site'},{v:'reuse_off',l:'Reuse off-site'},{v:'landfill',l:'Landfill'},{v:'agri',l:'Agriculture'},{v:'other',l:'Other'}];

  function wwBlock(wi) {
    const wd = name => v(data, `ww_${wi}_${name}`);
    const srcRows = WW_SOURCES.map(s => `<tr class="prod-row">
      <td class="prod-td">${s.l}</td>
      <td class="prod-td"><input class="form-input" type="number" min="0" step="any" name="ww_${wi}_src_${s.k}_vol" value="${v(data,`ww_${wi}_src_${s.k}_vol`)}"></td>
      <td class="prod-td"><input class="form-input" type="text" name="ww_${wi}_src_${s.k}_comment" value="${v(data,`ww_${wi}_src_${s.k}_comment`)}"></td>
    </tr>`).join('');

    const pollRows = WW_POLLS.map(p => {
      const freqOpts = FREQ.map(x=>`<option value="${x.v}" ${v(data,`ww_${wi}_poll_${p.k}_freq`)===x.v?'selected':''}>${x.l}</option>`).join('');
      const posOpts  = POS.map(x=>`<option value="${x.v}" ${v(data,`ww_${wi}_poll_${p.k}_pos`)===x.v?'selected':''}>${x.l}</option>`).join('');
      return `<tr class="prod-row">
        <td class="prod-td cu-td-label">${p.l} <span class="form-hint">${p.unit}</span></td>
        <td class="prod-td"><input class="form-input" type="number" step="any" min="0" name="ww_${wi}_poll_${p.k}_conc" value="${v(data,`ww_${wi}_poll_${p.k}_conc`)}"></td>
        <td class="prod-td"><select class="form-select" name="ww_${wi}_poll_${p.k}_freq">${freqOpts}</select></td>
        <td class="prod-td"><select class="form-select" name="ww_${wi}_poll_${p.k}_pos">${posOpts}</select></td>
        <td class="prod-td"><input class="form-input" type="text" name="ww_${wi}_poll_${p.k}_comments" value="${v(data,`ww_${wi}_poll_${p.k}_comments`)}"></td>
      </tr>`;
    }).join('');

    const sludgeOpts = SLUDGE_FATE.map(x=>`<option value="${x.v}" ${v(data,`ww_${wi}_sludge_fate`)===x.v?'selected':''}>${x.l}</option>`).join('');

    return `
    <div class="repeating-instance" id="ww-instance-${wi}">
      <div class="repeating-instance-header">
        <h3 class="repeating-instance-title">Discharge Point ${wi}</h3>
        ${wi>1?`<button type="button" class="instance-remove-btn" data-type="ww" data-index="${wi}">✕ Remove</button>`:''}
      </div>

      <!-- 8.1 Discharge info -->
      <section class="form-section" style="border-radius:0;border-top:none;margin-bottom:0">
        <div class="form-section-header"><h4 class="form-section-title">8.1 — Discharge point details</h4></div>
        <div class="form-section-body">
          <div class="form-group"><label class="form-label">Discharge point ID</label>
            <input class="form-input" type="text" name="ww_${wi}_discharge_id" value="${wd('discharge_id')}" placeholder="e.g. DP-01"></div>
          <div class="form-group"><label class="form-label">Reference year</label>
            <input class="form-input" type="text" name="ww_${wi}_ref_year" value="${wd('ref_year')}" placeholder="e.g. 2010"></div>
        </div>

        <!-- Waste water sources -->
        <div style="padding:0 var(--space-6) var(--space-4)">
          <h4 style="font-size:var(--font-size-sm);font-weight:600;margin-bottom:var(--space-3)">Waste water sources</h4>
          <div class="prod-table-wrap">
            <table class="prod-table">
              <thead><tr><th class="prod-th" style="min-width:200px">Source</th><th class="prod-th">Volume (m³/year)</th><th class="prod-th">Comments</th></tr></thead>
              <tbody>${srcRows}</tbody>
            </table>
          </div>
        </div>

        <!-- WWTP -->
        <div class="form-section-body">
          <div class="form-group"><label class="form-label">Waste water treated before discharge?</label>${ynSel(data,`ww_${wi}_treated`)}</div>
          <div class="form-group form-group-wide"><label class="form-label">WWTP description</label>
            <textarea class="form-textarea" name="ww_${wi}_wwtp_desc" rows="2">${wd('wwtp_desc')}</textarea></div>
        </div>
      </section>

      <!-- 8.2–8.4 Pollutant measurements -->
      <section class="form-section" style="border-radius:0;border-top:none;margin-bottom:0">
        <div class="form-section-header"><h4 class="form-section-title">8.3–8.4 — Water pollutant measurements</h4></div>
        <div class="prod-table-wrap">
          <table class="prod-table">
            <thead><tr>
              <th class="prod-th" style="min-width:140px">Pollutant</th>
              <th class="prod-th">Concentration</th>
              <th class="prod-th" style="width:110px">Frequency</th>
              <th class="prod-th" style="width:130px">Measurement position</th>
              <th class="prod-th">Comments</th>
            </tr></thead>
            <tbody>${pollRows}</tbody>
          </table>
        </div>
      </section>

      <!-- 8.5 Sludge -->
      <section class="form-section" style="border-radius:0;border-top:none;margin-bottom:0">
        <div class="form-section-body grid-sheet">
          <div class="sheet-row">
            <div class="sheet-label"><span class="sheet-row-num">8.5</span><label class="form-label">Fate of WWTP sludge</label></div>
            <div class="sheet-field"><select class="form-select" name="ww_${wi}_sludge_fate">${sludgeOpts}</select></div>
          </div>
        </div>
      </section>
    </div>`;
  }

  return `
<header class="page-header">
  <div class="page-header-meta">Page 8 of 12 · Sheet: 8. Water Emissions</div>
  <h1 class="page-title">Water emissions</h1>
  <p class="page-subtitle">One block per discharge point. Include all waste water streams discharged to surface water or sewer.</p>
</header>
<div class="page-content">
<form id="page-form" data-page-id="8" novalidate>
  <input type="hidden" name="ww_count" id="ww_count" value="${wwCount}">

  <div id="ww-instances">
    ${Array.from({length:wwCount},(_,i)=>wwBlock(i+1)).join('')}
  </div>
  <div class="add-instance-btn">
    <button type="button" id="btn-add-ww" class="btn btn-secondary">+ Add discharge point</button>
  </div>
</form>
</div>
${navFooter(8)}`;
}

/* ══════════════════════════════════════════════════════════════════════
   PAGE 9 — Solid Residues & Wastes
   ══════════════════════════════════════════════════════════════════════ */
function renderPage9(data) {
  const rowCount = Math.max(12, parseInt(v(data,'waste_row_count','12'), 10));
  const SOURCES = [{v:'',l:'—'},{v:'dryer',l:'Dryer'},{v:'press',l:'Press'},{v:'sander',l:'Sander/finishing'},{v:'abatement',l:'Air abatement'},{v:'wwtp',l:'WWTP'},{v:'rawmat',l:'Raw material handling'},{v:'combustion',l:'Combustion'},{v:'maintenance',l:'Maintenance'},{v:'other',l:'Other'}];
  const DESTS   = [{v:'',l:'—'},{v:'reuse_site',l:'Reuse on-site'},{v:'recycling',l:'Recycling off-site'},{v:'energy',l:'Energy recovery'},{v:'incineration',l:'Incineration'},{v:'landfill',l:'Landfill'},{v:'other',l:'Other'}];

  const wasteRows = Array.from({length:rowCount},(_,i) => {
    const n = i+1;
    const srcOpts = SOURCES.map(x=>`<option value="${x.v}" ${v(data,`waste_${n}_source`)===x.v?'selected':''}>${x.l}</option>`).join('');
    const dstOpts = DESTS.map(x=>`<option value="${x.v}" ${v(data,`waste_${n}_dest`)===x.v?'selected':''}>${x.l}</option>`).join('');
    return `<tr class="prod-row">
      <td class="prod-td"><span class="prod-num">${n}</span>
        <input class="form-input form-input-sm" type="text" name="waste_${n}_desc" value="${v(data,`waste_${n}_desc`)}" placeholder="Describe waste…"></td>
      <td class="prod-td"><input class="form-input form-input-sm" type="text" name="waste_${n}_ewc" value="${v(data,`waste_${n}_ewc`)}" placeholder="xx xx xx"></td>
      <td class="prod-td"><select class="form-select" name="waste_${n}_source">${srcOpts}</select></td>
      <td class="prod-td"><input class="form-input" type="number" min="0" step="any" name="waste_${n}_qty" value="${v(data,`waste_${n}_qty`)}"></td>
      <td class="prod-td"><select class="form-select" name="waste_${n}_dest">${dstOpts}</select></td>
    </tr>`;
  }).join('');

  return `
<header class="page-header">
  <div class="page-header-meta">Page 9 of 12 · Sheet: 9. Solid Residues</div>
  <h1 class="page-title">Solid residues and wastes</h1>
  <p class="page-subtitle">All solid waste streams generated in the WBP production process during the reference year.</p>
</header>
<div class="page-content">
<form id="page-form" data-page-id="9" novalidate>
  <input type="hidden" name="waste_row_count" id="waste_row_count" value="${rowCount}">

  <!-- 9.1 Waste table -->
  <section class="form-section">
    <div class="form-section-header" style="display:flex;align-items:center;justify-content:space-between">
      <h2 class="form-section-title">9.1 — Waste characteristics and quantities</h2>
      <button type="button" id="btn-add-waste" class="btn btn-secondary">+ Add row</button>
    </div>
    <div class="prod-table-wrap">
      <table class="prod-table">
        <thead><tr>
          <th class="prod-th" style="min-width:180px">Waste description</th>
          <th class="prod-th" style="width:120px">EWC code</th>
          <th class="prod-th" style="width:150px">Source process</th>
          <th class="prod-th" style="width:120px">Quantity (t/year)</th>
          <th class="prod-th" style="width:160px">Destination</th>
        </tr></thead>
        <tbody>${wasteRows}</tbody>
      </table>
    </div>
  </section>

  <!-- 9.2 BAT techniques -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">9.2 — BAT candidate techniques for waste</h2></div>
    <div class="form-section-body">
      <div class="form-group form-group-wide">
        <textarea class="form-textarea" name="waste_bat_techniques" rows="3" placeholder="Describe any BAT candidate techniques related to waste management…">${v(data,'waste_bat_techniques')}</textarea>
      </div>
    </div>
  </section>

  <!-- Comments -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">Comments</h2></div>
    <div class="form-section-body">
      <div class="form-group form-group-wide">
        <textarea class="form-textarea" name="waste_comments" rows="3">${v(data,'waste_comments')}</textarea>
      </div>
    </div>
  </section>
</form>
</div>
${navFooter(9)}`;
}

/* ══════════════════════════════════════════════════════════════════════
   PAGE 10 — Water Consumption
   ══════════════════════════════════════════════════════════════════════ */
function renderPage10(data) {
  return `
<header class="page-header">
  <div class="page-header-meta">Page 10 of 12 · Sheet: 10. Water Consumption</div>
  <h1 class="page-title">Water consumption</h1>
  <p class="page-subtitle">Total water intake and usage on site during the reference year.</p>
</header>
<div class="page-content">
<form id="page-form" data-page-id="10" novalidate>

  <!-- 10.1 Total consumption -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">10.1 — Total water consumption by use</h2></div>
    <div class="form-section-body">
      <div class="form-group"><label class="form-label">Process water</label>
        <div class="form-input-with-unit"><input class="form-input" type="number" min="0" step="any" name="wc_process" value="${v(data,'wc_process')}"><span class="form-unit">1000 m³/year</span></div></div>
      <div class="form-group"><label class="form-label">Steam generation</label>
        <div class="form-input-with-unit"><input class="form-input" type="number" min="0" step="any" name="wc_steam" value="${v(data,'wc_steam')}"><span class="form-unit">1000 m³/year</span></div></div>
      <div class="form-group"><label class="form-label">Cooling</label>
        <div class="form-input-with-unit"><input class="form-input" type="number" min="0" step="any" name="wc_cooling" value="${v(data,'wc_cooling')}"><span class="form-unit">1000 m³/year</span></div></div>
      <div class="form-group"><label class="form-label">Sanitary / domestic</label>
        <div class="form-input-with-unit"><input class="form-input" type="number" min="0" step="any" name="wc_sanitary" value="${v(data,'wc_sanitary')}"><span class="form-unit">1000 m³/year</span></div></div>
      <div class="form-group"><label class="form-label">Other uses</label>
        <div class="form-input-with-unit"><input class="form-input" type="number" min="0" step="any" name="wc_other" value="${v(data,'wc_other')}"><span class="form-unit">1000 m³/year</span></div></div>
    </div>
  </section>

  <!-- 10.2 Refining water -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">10.2 — Refining / fibre production water</h2></div>
    <div class="form-section-body">
      <div class="form-group"><label class="form-label">Total refining water used</label>
        <div class="form-input-with-unit"><input class="form-input" type="number" min="0" step="any" name="wc_refining_total" value="${v(data,'wc_refining_total')}"><span class="form-unit">m³/year</span></div></div>
      <div class="form-group"><label class="form-label">Refining water recycled</label>
        <div class="form-input-with-unit"><input class="form-input" type="number" min="0" step="any" name="wc_refining_recycled" value="${v(data,'wc_refining_recycled')}"><span class="form-unit">m³/year</span></div></div>
    </div>
  </section>

  <!-- 10.3 Recycling savings -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">10.3 — Water saving through recycling/recirculation</h2></div>
    <div class="form-section-body">
      <div class="form-group"><label class="form-label">Total water savings through recycling</label>
        <div class="form-input-with-unit"><input class="form-input" type="number" min="0" step="any" name="wc_recycling_savings" value="${v(data,'wc_recycling_savings')}"><span class="form-unit">m³/year</span></div></div>
    </div>
  </section>

  <!-- 10.4 BAT -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">10.4 — BAT candidate techniques for water</h2></div>
    <div class="form-section-body">
      <div class="form-group form-group-wide">
        <textarea class="form-textarea" name="wc_bat_techniques" rows="3" placeholder="Describe any BAT candidate techniques related to water consumption…">${v(data,'wc_bat_techniques')}</textarea>
      </div>
    </div>
  </section>

  <!-- Comments -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">Comments</h2></div>
    <div class="form-section-body">
      <div class="form-group form-group-wide">
        <textarea class="form-textarea" name="wc_comments" rows="4">${v(data,'wc_comments')}</textarea>
      </div>
    </div>
  </section>

</form>
</div>
${navFooter(10)}`;
}

/* ══════════════════════════════════════════════════════════════════════
   PAGE 11 — BAT Candidate Technique (Optional)
   ══════════════════════════════════════════════════════════════════════ */
function renderPage11(data) {
  const RD_LEVELS = [{v:'',l:'— select —'},{v:'rd',l:'R&D / lab stage'},{v:'pilot',l:'Pilot / demonstration'},{v:'full',l:'Full-scale commercial'},{v:'bat',l:'BAT candidate'}];
  const cats = [
    {key:'energy',    label:'Energy efficiency',      group:'primary'},
    {key:'rawmat',    label:'Raw material management', group:'primary'},
    {key:'water',     label:'Water management',        group:'primary'},
    {key:'emissions', label:'Emission prevention',     group:'primary'},
    {key:'primary_other', label:'Other primary measure', group:'primary'},
    {key:'air',       label:'Air emission abatement',  group:'secondary'},
    {key:'ww',        label:'Waste water treatment',   group:'secondary'},
    {key:'solid',     label:'Solid waste management',  group:'secondary'},
    {key:'secondary_other', label:'Other secondary measure', group:'secondary'},
  ];
  const primary   = cats.filter(c=>c.group==='primary');
  const secondary = cats.filter(c=>c.group==='secondary');
  const rdOpts = RD_LEVELS.map(x=>`<option value="${x.v}" ${v(data,'bat_rd_level')===x.v?'selected':''}>${x.l}</option>`).join('');

  return `
<header class="page-header">
  <div class="page-header-meta">Page 11 of 12 · Sheet: 11. BAT Candidate — Optional</div>
  <h1 class="page-title">BAT candidate technique description</h1>
  <p class="page-subtitle">
    <span class="badge badge-purple">Optional</span>
    If your plant uses a technique that could be a BAT candidate, describe it here using the standard structure.
  </p>
</header>
<div class="page-content">
<form id="page-form" data-page-id="11" novalidate>

  <!-- Section 1: Name -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">1 — Identification</h2></div>
    <div class="form-section-body">
      <div class="form-group form-group-wide"><label class="form-label">Name of the technique</label>
        <input class="form-input" type="text" name="bat_name" value="${v(data,'bat_name')}" placeholder="e.g. Wet electrostatic precipitator (WESP)"></div>
      <div class="form-group form-group-wide"><label class="form-label">Plant name (optional, may be anonymised)</label>
        <input class="form-input" type="text" name="bat_plant_name" value="${v(data,'bat_plant_name')}"></div>
    </div>
  </section>

  <!-- Section 2: Category -->
  <section class="form-section">
    <div class="form-section-header">
      <h2 class="form-section-title">2 — Category</h2>
      <p class="form-section-desc">Select all categories that apply to this technique.</p>
    </div>
    <div class="form-section-body">
      <div class="form-group">
        <label class="form-label">Primary measures</label>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          ${primary.map(c=>`<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
            <input type="checkbox" name="bat_cat_${c.key}" ${v(data,`bat_cat_${c.key}`)===('on')?'checked':''} style="accent-color:var(--color-accent);width:16px;height:16px">
            ${c.label}</label>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Secondary / abatement measures</label>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          ${secondary.map(c=>`<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
            <input type="checkbox" name="bat_cat_${c.key}" ${v(data,`bat_cat_${c.key}`)===('on')?'checked':''} style="accent-color:var(--color-accent);width:16px;height:16px">
            ${c.label}</label>`).join('')}
        </div>
      </div>
    </div>
  </section>

  <!-- Section 3: Technical description -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">3 — Technical description</h2></div>
    <div class="form-section-body">
      <div class="form-group form-group-wide"><label class="form-label">Description of the technique</label>
        <textarea class="form-textarea" name="bat_tech_desc" rows="5" placeholder="Describe how the technique works, its main components, operational parameters…">${v(data,'bat_tech_desc')}</textarea></div>
      <div class="form-group form-group-wide"><label class="form-label">Reference plants / installations</label>
        <textarea class="form-textarea" name="bat_reference_plants" rows="3" placeholder="List installations where this technique is applied…">${v(data,'bat_reference_plants')}</textarea></div>
      <div class="form-group"><label class="form-label">Installation / commissioning year</label>
        <input class="form-input" type="text" name="bat_install_year" value="${v(data,'bat_install_year')}"></div>
      <div class="form-group"><label class="form-label">R&amp;D / implementation level</label>
        <select class="form-select" name="bat_rd_level">${rdOpts}</select></div>
      <div class="form-group form-group-wide"><label class="form-label">Additional technical comments</label>
        <textarea class="form-textarea" name="bat_tech_comments" rows="2">${v(data,'bat_tech_comments')}</textarea></div>
    </div>
  </section>

  <!-- Section 4: Environmental benefits -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">4 — Environmental benefits</h2></div>
    <div class="form-section-body">
      <div class="form-group form-group-wide"><label class="form-label">Air emission reductions</label>
        <textarea class="form-textarea" name="bat_env_air" rows="2" placeholder="e.g. PM reduction: 95%, dust from 50 to 2.5 mg/Nm³…">${v(data,'bat_env_air')}</textarea></div>
      <div class="form-group form-group-wide"><label class="form-label">Water emission reductions</label>
        <textarea class="form-textarea" name="bat_env_water" rows="2">${v(data,'bat_env_water')}</textarea></div>
      <div class="form-group form-group-wide"><label class="form-label">Energy efficiency improvements</label>
        <textarea class="form-textarea" name="bat_env_energy" rows="2">${v(data,'bat_env_energy')}</textarea></div>
      <div class="form-group form-group-wide"><label class="form-label">Other environmental benefits</label>
        <textarea class="form-textarea" name="bat_env_other" rows="2">${v(data,'bat_env_other')}</textarea></div>
    </div>
  </section>

  <!-- Section 5: Economics -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">5 — Economic information</h2></div>
    <div class="form-section-body">
      <div class="form-group form-group-wide"><label class="form-label">Investment cost (approximate)</label>
        <input class="form-input" type="text" name="bat_invest_cost" value="${v(data,'bat_invest_cost')}" placeholder="e.g. €2–5 million"></div>
      <div class="form-group form-group-wide"><label class="form-label">Operating cost (approximate, annual)</label>
        <input class="form-input" type="text" name="bat_oper_cost" value="${v(data,'bat_oper_cost')}" placeholder="e.g. €150,000/year"></div>
      <div class="form-group form-group-wide"><label class="form-label">Cost effectiveness / payback</label>
        <textarea class="form-textarea" name="bat_cost_effectiveness" rows="2">${v(data,'bat_cost_effectiveness')}</textarea></div>
    </div>
  </section>

  <!-- Section 6: Cross-media & applicability -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">6 — Cross-media effects &amp; applicability</h2></div>
    <div class="form-section-body">
      <div class="form-group form-group-wide"><label class="form-label">Potential cross-media effects</label>
        <textarea class="form-textarea" name="bat_cross_media" rows="2" placeholder="e.g. increased water use, secondary waste generated…">${v(data,'bat_cross_media')}</textarea></div>
      <div class="form-group form-group-wide"><label class="form-label">Applicability / limitations</label>
        <textarea class="form-textarea" name="bat_applicability" rows="2" placeholder="When is this technique applicable? Are there limitations?">${v(data,'bat_applicability')}</textarea></div>
      <div class="form-group form-group-wide"><label class="form-label">Additional references</label>
        <textarea class="form-textarea" name="bat_references" rows="2">${v(data,'bat_references')}</textarea></div>
    </div>
  </section>

</form>
</div>
${navFooter(11)}`;
}

/* ══════════════════════════════════════════════════════════════════════
   PAGE 12 — Review & Submit
   ══════════════════════════════════════════════════════════════════════ */
function renderPage12(data) {
  // Pull from state (available globally in app.js context)
  const pd  = typeof state !== 'undefined' ? state.pageData  : {};
  const ps  = typeof state !== 'undefined' ? state.pageStatus: {};
  const sub = typeof state !== 'undefined' ? state.submission : null;
  const alreadySubmitted = sub?.status === 'submitted';

  const REQUIRED_PAGES = [0,1,2,3,4,5,6,7,8,9,10];

  const rows = PAGES.slice(0,12).map(p => {
    const status = ps[p.id] || 'empty';
    const isRequired = p.required;
    let badge, action;
    if (p.id === 11) {
      badge  = `<span class="badge badge-purple">Optional</span>`;
      action = `<button type="button" class="btn btn-secondary" onclick="navigate(${p.id})">Go to page</button>`;
    } else if (status === 'complete') {
      badge  = `<span class="badge badge-success">Complete</span>`;
      action = `<button type="button" class="btn btn-secondary" onclick="navigate(${p.id})">Edit</button>`;
    } else if (isRequired) {
      badge  = `<span class="badge badge-danger">Required — incomplete</span>`;
      action = `<button type="button" class="btn btn-primary" onclick="navigate(${p.id})">Complete now</button>`;
    } else {
      badge  = `<span class="badge badge-muted">Not started</span>`;
      action = `<button type="button" class="btn btn-secondary" onclick="navigate(${p.id})">Go to page</button>`;
    }
    return `<tr>
      <td style="padding:var(--space-3) var(--space-4);border:1px solid var(--color-border)"><strong>${p.id}</strong></td>
      <td style="padding:var(--space-3) var(--space-4);border:1px solid var(--color-border)">${p.title}</td>
      <td style="padding:var(--space-3) var(--space-4);border:1px solid var(--color-border)">${badge}</td>
      <td style="padding:var(--space-3) var(--space-4);border:1px solid var(--color-border)">${action}</td>
    </tr>`;
  }).join('');

  const missingRequired = REQUIRED_PAGES.filter(id => (ps[id]||'empty') !== 'complete');
  const canSubmit = missingRequired.length === 0 && !alreadySubmitted;

  const companyName = pd[0]?.contact_company || pd[1]?.plant_name || '—';
  const refYear     = pd[1]?.ref_year || pd[0]?.ref_year || '—';

  return `
<header class="page-header">
  <div class="page-header-meta">Page 12 of 12 · Review &amp; Submit</div>
  <h1 class="page-title">Review &amp; Submit</h1>
  <p class="page-subtitle">Review completeness of all pages before final submission.</p>
</header>
<div class="page-content">
<form id="page-form" data-page-id="12" novalidate>

  ${alreadySubmitted ? `<div class="doc-notice doc-notice-confidential" style="margin-bottom:var(--space-6)">
    <span class="doc-notice-icon">✓</span>
    <p><strong>This questionnaire has already been submitted.</strong> Thank you for your contribution to the WBP BREF process. You can start a new submission below.</p>
  </div>` : ''}

  <!-- Summary -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">Submission summary</h2></div>
    <div class="form-section-body grid-sheet" style="padding:var(--space-4) var(--space-6)">
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><span class="form-label">Company / Plant</span></div>
        <div class="sheet-field"><strong>${companyName}</strong></div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><span class="form-label">Reference year</span></div>
        <div class="sheet-field">${refYear}</div>
      </div>
      <div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><span class="form-label">Submission status</span></div>
        <div class="sheet-field">${alreadySubmitted ? `<span class="badge badge-success">Submitted</span>` : `<span class="badge badge-warning">Draft — not yet submitted</span>`}</div>
      </div>
      ${sub?.submitted_at ? `<div class="sheet-row">
        <div class="sheet-label"><span class="sheet-row-num"></span><span class="form-label">Submitted at</span></div>
        <div class="sheet-field">${new Date(sub.submitted_at).toLocaleString()}</div>
      </div>` : ''}
    </div>
  </section>

  <!-- Completeness table -->
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">Page completion status</h2></div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:var(--font-size-sm)">
        <thead><tr>
          <th style="background:var(--color-bg);border:1px solid var(--color-border);padding:var(--space-3) var(--space-4);text-align:left;font-weight:600;color:var(--color-text-muted)">Page</th>
          <th style="background:var(--color-bg);border:1px solid var(--color-border);padding:var(--space-3) var(--space-4);text-align:left;font-weight:600;color:var(--color-text-muted)">Title</th>
          <th style="background:var(--color-bg);border:1px solid var(--color-border);padding:var(--space-3) var(--space-4);text-align:left;font-weight:600;color:var(--color-text-muted)">Status</th>
          <th style="background:var(--color-bg);border:1px solid var(--color-border);padding:var(--space-3) var(--space-4);text-align:left;font-weight:600;color:var(--color-text-muted)">Action</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>

  <!-- Submit section -->
  ${!alreadySubmitted ? `
  <section class="form-section">
    <div class="form-section-header">
      <h2 class="form-section-title">Submit questionnaire</h2>
      <p class="form-section-desc">Once submitted, the questionnaire status will be locked. Make sure all required pages are complete before submitting.</p>
    </div>
    <div class="form-section-body">
      ${missingRequired.length > 0 ? `<div class="doc-notice doc-notice-deadline form-group-wide" style="grid-column:1/-1">
        <span class="doc-notice-icon">⚠️</span>
        <p><strong>${missingRequired.length} required page(s) still incomplete:</strong> ${missingRequired.map(id=>PAGES[id].title).join(', ')}</p>
      </div>` : `<div class="doc-notice doc-notice-confidential form-group-wide" style="grid-column:1/-1">
        <span class="doc-notice-icon">✓</span>
        <p><strong>All required pages are complete.</strong> You can now submit the questionnaire.</p>
      </div>`}
      <div style="grid-column:1/-1;display:flex;gap:var(--space-4);align-items:center;flex-wrap:wrap">
        <button type="button" id="btn-submit" class="btn btn-success" ${!canSubmit?'disabled':''}>
          Submit questionnaire →
        </button>
        <span style="font-size:var(--font-size-xs);color:var(--color-text-muted)">
          This action cannot be undone. A new submission can be started separately.
        </span>
      </div>
    </div>
  </section>` : `
  <section class="form-section">
    <div class="form-section-header"><h2 class="form-section-title">Start a new submission</h2></div>
    <div class="form-section-body">
      <div style="grid-column:1/-1">
        <button type="button" id="btn-new-submission" class="btn btn-secondary">
          + Start new submission
        </button>
      </div>
    </div>
  </section>`}

</form>
</div>
<footer class="page-nav">
  <div class="page-nav-inner">
    <button type="button" id="btn-back" class="btn btn-secondary">← Back</button>
    <span id="save-status" class="save-status" aria-live="polite"></span>
    <div></div>
  </div>
</footer>`;
}
