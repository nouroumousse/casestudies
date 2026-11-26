/* Case Study Studio — local-first brand case study builder. */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const view = $('#view');
const root = $('#app');
const dbName = 'case-study-studio';
let dbPromise;
let projects = [];
let currentProject = null;
let screen = 'projects';
let setupStep = 1;
let activeDirection = 'editorial';
let viewport = 'desktop';
let editorTab = 'content';
let selectedSection = 'opening';
let visitorMode = false;
let aiAvailable = false;
let saveTimer;
let undoStack = [];
let redoStack = [];
let isRendering = false;

const DIRECTIONS = {
  editorial: {label:'Editorial / Studio', note:'Typography-led, measured and precise'},
  immersive: {label:'Immersive / Art-directed', note:'Expressive, atmospheric and image-led'}
};
const DEFAULT_COLORS = [
  {name:'Primary', hex:'#20211F'},
  {name:'Secondary', hex:'#D9DFCB'},
  {name:'Accent', hex:'#C6F05E'},
  {name:'Background', hex:'#F4F3EF'}
];

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('projects')) database.createObjectStore('projects', {keyPath:'id'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local database'));
  });
  return dbPromise;
}
async function dbGetAll() {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const request = database.transaction('projects', 'readonly').objectStore('projects').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
async function dbPut(project) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(project);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDelete(id) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('projects', 'readwrite');
    tx.objectStore('projects').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function loadProjects() {
  try {
    projects = await dbGetAll();
  } catch (error) {
    try { projects = JSON.parse(localStorage.getItem('case-study-studio-projects') || '[]'); }
    catch { projects = []; }
  }
  projects.sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  $('#project-count').textContent = String(projects.length);
}
async function persistProject(showState = true, project = currentProject) {
  if (!project) return;
  project.updatedAt = new Date().toISOString();
  if (project === currentProject) $('#save-state').innerHTML = '<span class="save-dot" style="background:#d3a24e"></span> Saving…';
  try {
    try { await dbPut(project); }
    catch (error) {
      const list = projects.filter(p => p.id !== project.id).concat(project);
      localStorage.setItem('case-study-studio-projects', JSON.stringify(list));
    }
    const index = projects.findIndex(p => p.id === project.id);
    if (index < 0) projects.unshift(project); else projects[index] = project;
    projects.sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    $('#project-count').textContent = String(projects.length);
    if (showState && project === currentProject) $('#save-state').innerHTML = '<span class="save-dot"></span> All changes saved';
  } catch (error) {
    if (project === currentProject) $('#save-state').innerHTML = '<span class="save-dot" style="background:#c96b55"></span> Save failed';
    toast('Could not save locally. The asset may be too large for this browser.', true);
  }
}
function scheduleSave() {
  if (!currentProject) return;
  $('#save-state').innerHTML = '<span class="save-dot" style="background:#d3a24e"></span> Unsaved changes';
  clearTimeout(saveTimer);
  const targetProject = currentProject;
  saveTimer = setTimeout(() => persistProject(true, targetProject), 320);
}
function toast(message, isError = false) {
  const node = document.createElement('div');
  node.className = `toast${isError ? ' error' : ''}`;
  node.textContent = message;
  $('#toast-region').append(node);
  setTimeout(() => node.remove(), 3400);
}
function setBreadcrumb(parts) {
  $('#breadcrumb').innerHTML = parts.map((part, i) => `${i ? '<b>/</b>' : ''}<${part.strong ? 'strong' : 'span'}>${esc(part.label)}</${part.strong ? 'strong' : 'span'}>`).join('');
}
function blankProject() {
  return {
    id: uid(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title:'Untitled case study',
    brandType:'logo',
    svgText:'', svgOriginalText:'', svgName:'',
    brandName:'', clientName:'', sameClient:false,
    colors:[],
    fontFamily:'', fontDataUrl:'', fontFileName:'', fontLicense:false,
    website:'', websiteNote:'Website links are reference-only. This browser workspace does not scrape or analyze the site.',
    year:'', location:'', designer:'', projectType:'Brand identity',
    context:{description:'',challenge:'',audience:'',deliverables:'',idea:'',results:'',avoid:''},
    images:[],
    sections:[],
    direction:'editorial', directionRevision:{editorial:0,immersive:0}
  };
}
function showProjects() {
  screen = 'projects'; currentProject = null; visitorMode = false;
  setBreadcrumb([{label:'Workspace'},{label:'Projects',strong:true}]);
  $('#save-state').innerHTML = '<span class="save-dot"></span> Local workspace';
  renderProjects();
}
function renderProjects() {
  const cards = projects.map(project => {
    const direction = project.direction || 'editorial';
    const hasMark = !!project.svgText;
    const title = project.title || project.brandName || 'Untitled case study';
    const subtitle = project.clientName || 'Draft project';
    const palette = project.colors?.find(c => /background|secondary/i.test(c.name))?.hex || project.colors?.[1]?.hex || '#D9DFCB';
    return `<article class="project-card" tabindex="0" role="button" data-action="open-project" data-id="${esc(project.id)}" aria-label="Open ${esc(title)}">
      <div class="project-art ${direction === 'immersive' ? 'immersive':''}" style="background:${direction === 'immersive' ? '#252b22' : esc(palette)}">
        <span class="art-blob"></span>
        <div class="art-mark">${hasMark ? '✳' : esc(title.slice(0,1).toUpperCase())}</div>
        <span class="art-sub">${direction === 'immersive' ? 'Art direction 02' : 'Editorial direction 01'}</span>
      </div>
      <div class="project-card-actions">
        <button class="icon-action" data-action="rename-project" data-id="${esc(project.id)}" title="Rename project" aria-label="Rename project">✎</button>
        <button class="icon-action" data-action="duplicate-project" data-id="${esc(project.id)}" title="Duplicate project" aria-label="Duplicate project">＋</button>
        <button class="icon-action" data-action="delete-project" data-id="${esc(project.id)}" title="Delete project" aria-label="Delete project">×</button>
      </div>
      <div class="project-card-meta"><div><h3>${esc(title)}</h3><p>${esc(subtitle)} · ${relativeDate(project.updatedAt)}</p></div><div class="project-kind">${esc(project.projectType || 'Case study')}</div></div>
    </article>`;
  }).join('');
  view.innerHTML = `
    <div class="page-heading"><div><div class="eyebrow">YOUR WORKSPACE / ${String(projects.length).padStart(2,'0')} PROJECTS</div><h1>Good work deserves<br>good presentation.</h1><p>Build thoughtful, art-directed case studies from the identity assets you already have.</p></div><button class="primary-button" data-action="new-project"><span class="plus">＋</span> New case study</button></div>
    ${projects.length ? `<div class="section-kicker">RECENT PROJECTS <span>${projects.length} SAVED LOCALLY</span></div><div class="project-grid">${cards}</div>` : `<div class="empty-state"><div class="empty-symbol">✳</div><h2>Your next case study starts here.</h2><p>Bring a logo or app icon, your brand palette and typeface. The studio will help you shape them into two distinct portfolio presentations.</p><button class="primary-button" data-action="new-project">Create your first case study <span>↗</span></button></div>`}
    <div class="section-kicker">A BETTER WAY TO SHOW THE WORK</div>
    <div class="feature-strip"><div class="feature-cell"><span>01 / ASSETS</span><strong>Start with what is real.</strong><p>Your SVG, palette and type are the source of truth.</p></div><div class="feature-cell"><span>02 / ART DIRECTION</span><strong>Two points of view.</strong><p>Explore a quieter editorial page or a more expressive visual story.</p></div><div class="feature-cell"><span>03 / OWNERSHIP</span><strong>Keep it portable.</strong><p>Edit, save locally and export a self-contained page.</p></div></div>`;
}
function relativeDate(value) {
  if (!value) return 'just now';
  const date = new Date(value); if (Number.isNaN(date.getTime())) return 'recently';
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (mins < 2) return 'just now'; if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins/60); if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours/24)}d ago`;
}
function startProject() {
  currentProject = blankProject(); setupStep = 1; screen = 'builder'; undoStack=[];redoStack=[];
  setBreadcrumb([{label:'Workspace'},{label:'New case study',strong:true}]);
  renderSetup();
}
function setFieldValue(project, field, value) {
  if (field.startsWith('context.')) project.context[field.slice(8)] = value;
  else project[field] = value;
  if (field === 'brandName' && project.sameClient) project.clientName = value;
  if (field === 'sameClient') project.clientName = value ? project.brandName : (project.clientName === project.brandName ? '' : project.clientName);
  if (field === 'brandName' || field === 'clientName') project.title = project.brandName || 'Untitled case study';
}
function renderProgress() {
  const steps = [{n:1,label:'Brand assets'},{n:2,label:'Project context'},{n:3,label:'Case study'}];
  return `<div class="progress-wrap">${steps.map((s,i)=>`${i ? '<span class="progress-line"></span>':''}<div class="progress-step ${setupStep===s.n?'active':setupStep>s.n?'done':''}"><span class="num">${setupStep>s.n?'✓':s.n}</span>${s.label}</div>`).join('')}</div>`;
}
function renderSetup() {
  if (!currentProject) return showProjects();
  screen = 'builder';
  setBreadcrumb([{label:'Workspace'},{label:currentProject.brandName || 'New case study',strong:true}]);
  const project = currentProject;
  const palette = project.colors || [];
  const accent = palette[2]?.hex || palette[0]?.hex || '#c6f05e';
  view.innerHTML = `<div class="builder-head"><div><div class="eyebrow">CASE STUDY SETUP / 0${setupStep}</div><h1>${setupStep===1?'Start with the identity.':'Give the work its context.'}</h1><p>${setupStep===1?'Add your core brand assets and project details. You can refine everything later.':'A little context makes the story more accurate. Every question on this step is optional.'}</p></div>${renderProgress()}</div>
    <div class="setup-layout"><section class="form-panel"><div class="form-panel-header"><div><h2>${setupStep===1?'Brand foundations':'The project behind the identity'}</h2><p>${setupStep===1?'The essentials that shape both case study directions.':'Skip anything you do not know. No context will be invented.'}</p></div><span class="eyebrow">${setupStep===1?'REQUIRED + OPTIONAL':'OPTIONAL'}</span></div><div class="form-panel-body">${setupStep===1?renderCoreForm(project,palette):renderContextForm(project)}</div><div class="form-footer"><span class="hint">${setupStep===1?'Your assets are processed in this browser.':'You can edit the generated page and its copy later.'}</span><div style="display:flex;gap:8px">${setupStep===2?'<button class="outline-button" data-action="back-setup">Back</button>':''}<button class="primary-button" data-action="${setupStep===1?'continue-context':'generate-studio'}">${setupStep===1?'Continue to context':'Create two directions'} <span>↗</span></button></div></div></section>
    <aside class="side-preview"><div class="preview-card"><div class="preview-card-head"><span>LIVE IDENTITY SNAPSHOT</span><span>01 / 02</span></div><div class="preview-window" style="--preview-accent:${esc(accent)}"><div class="mini-logo">${project.brandType==='appicon'?'◧':esc(project.brandName || 'Your brand')}</div><div class="mini-meta">${esc(project.clientName || project.brandName || 'Brand / Client')}<br>${esc(project.projectType || 'Brand identity')}</div><div class="mini-stamp">CASE STUDY STUDIO</div></div><div class="side-brief"><h3>${project.svgText?'Identity asset added':'A mark makes the first impression.'}</h3><p>${project.svgText?'Your SVG is loaded and will be kept intact in the case study.':'Upload a valid SVG to see your brand mark preview here and in both layouts.'}</p></div></div><div><div class="side-brief"><h3>Built around the real work.</h3><p>Missing background, results or deliverables stay missing. The studio will describe what is provided, not make up a project story.</p><div class="privacy-line"><span>◈</span> LOCAL-FIRST · NO ASSET UPLOAD</div></div></div></aside></div>`;
  bindSetupEvents();
}
function renderCoreForm(project,palette) {
  return `<div class="field full"><div class="field-label">Brand mark <span class="required">*</span><span class="optional">SVG only · max 2 MB</span></div><div class="segmented" role="group" aria-label="Brand mark type"><button class="segment-button ${project.brandType==='logo'?'active':''}" data-action="brand-type" data-value="logo">Logo</button><button class="segment-button ${project.brandType==='appicon'?'active':''}" data-action="brand-type" data-value="appicon">App icon</button></div><label class="upload-zone" id="svg-drop" for="svg-file" style="margin-top:10px"><span class="upload-symbol">⇧</span><span class="upload-copy"><strong>${project.svgName ? esc(project.svgName) : 'Drop your SVG here or browse'}</strong><span>SVG is validated and sanitized before it is rendered. Scripts and external references are removed.</span></span><span class="upload-cta">Choose SVG</span></label><input id="svg-file" type="file" accept=".svg,image/svg+xml" hidden />${project.svgText?`<div class="asset-preview"><div class="asset-preview-box"><img alt="${esc(project.brandName || 'Uploaded logo')} on dark background" src="${svgDataUrl(project.svgText)}"></div><div class="asset-preview-box light"><img alt="${esc(project.brandName || 'Uploaded logo')} on light background" src="${svgDataUrl(project.svgText)}"></div><div class="asset-file-name"><strong>${esc(project.svgName)}</strong>Validated SVG · original proportions preserved</div><div class="asset-preview-actions"><button class="small-button" data-action="download-original-svg">Download original</button><button class="small-button" data-action="replace-svg">Replace</button><button class="small-button" data-action="remove-svg">Remove</button></div></div>`:''}</div>
    <div class="field-divider"></div>
    <div class="form-grid">
      <div class="field"><label for="brand-name">Brand name <span class="required">*</span></label><input id="brand-name" data-field="brandName" value="${esc(project.brandName)}" placeholder="e.g. Northline" required></div>
      <div class="field"><label for="client-name">Client / company <span class="required">*</span></label><input id="client-name" data-field="clientName" value="${esc(project.clientName)}" placeholder="e.g. Northline Studio" ${project.sameClient?'disabled':''} required><div class="field-help"><label class="check-row"><input type="checkbox" data-field="sameClient" ${project.sameClient?'checked':''}> Same as brand name</label></div></div>
      <div class="field"><label for="project-type">Project type</label><select id="project-type" data-field="projectType">${['Brand identity','New identity','Rebrand','App icon','Product identity','Campaign identity','Visual identity system','Other'].map(v=>`<option ${project.projectType===v?'selected':''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label for="project-year">Project year <span class="optional">OPTIONAL</span></label><input id="project-year" data-field="year" inputmode="numeric" value="${esc(project.year)}" placeholder="e.g. 2026"></div>
      <div class="field"><label for="project-location">Location / market <span class="optional">OPTIONAL</span></label><input id="project-location" data-field="location" value="${esc(project.location)}" placeholder="e.g. Rabat, Morocco"></div>
      <div class="field"><label for="designer-credit">Designer / studio credit <span class="optional">OPTIONAL</span></label><input id="designer-credit" data-field="designer" value="${esc(project.designer)}" placeholder="e.g. Nour Oumousse"></div>
      <div class="field full"><label>Brand colors <span class="required">*</span><span class="optional">LABELS ARE YOURS TO DEFINE</span></label><div class="color-list" id="color-list">${palette.length?palette.map((color,index)=>renderColorRow(color,index)).join(''):'<p class="editor-note">No colours added yet. Start with the primary brand colour.</p>'}</div><button class="add-color" data-action="add-color">＋ Add a color</button><div class="palette-preview" id="palette-preview">${palette.map(c=>`<span style="background:${esc(c.hex)}"></span>`).join('')}</div><div class="palette-contrast" id="palette-contrast">${renderContrastContent(project)}</div><div class="field-help">Enter hex values or use the color picker. When fewer than four colours are supplied, supporting tones are derived and labelled as generated.</div></div>
      <div class="field"><label for="font-family">Typography / font family <span class="required">*</span></label><input id="font-family" data-field="fontFamily" value="${esc(project.fontFamily)}" placeholder="e.g. Neue Haas Grotesk"><div class="field-help">The font name is used as written. An uploaded font file is needed to ensure it travels with your export.</div></div>
      <div class="field"><label>Font file <span class="optional">OPTIONAL</span></label><label class="upload-zone" for="font-file" style="min-height:58px;padding:10px"><span class="upload-symbol" style="width:30px;height:30px;font-size:14px">Aa</span><span class="upload-copy"><strong>${project.fontFileName?esc(project.fontFileName):'Upload a font file'}</strong><span>WOFF2, WOFF, TTF or OTF</span></span><span class="upload-cta">Browse</span></label><input id="font-file" type="file" accept=".woff2,.woff,.ttf,.otf,font/woff,font/woff2,font/ttf,font/otf" hidden>${project.fontDataUrl?`<div class="field-help"><label class="check-row"><input type="checkbox" data-field="fontLicense" ${project.fontLicense?'checked':''}> I have permission to embed this font in exported files.</label><button class="danger-button" data-action="remove-font">Remove font file</button></div>`:'<div class="field-help">Only embed a font you are permitted to distribute.</div>'}</div>
      <div class="field full"><div class="font-specimen-card"><div><span>TYPE SPECIMEN / LOCAL FONT CHECK</span><strong id="font-sample" style="font-family:'${safeFontName(project.fontFamily||'DM Sans')}', 'DM Sans', sans-serif">Ag</strong><p id="font-sample-label">${esc(project.fontFamily||'Your typeface')} · shown if available on this device</p></div><span class="font-specimen-brand">${esc(project.brandName||'Your brand')}</span></div></div>
      <div class="field full"><label for="website-url">Brand website <span class="optional">OPTIONAL</span></label><div class="input-row"><input id="website-url" data-field="website" value="${esc(project.website)}" placeholder="https://brand.com" type="url"></div><div class="field-help" id="website-domain">Website analysis is not performed in this local-only version. Add screenshots in the next step to show real project work, or keep the URL as a reference link.</div></div>
    </div>`;
}
function renderColorRow(color,index) {
  return `<div class="color-row"><input type="color" value="${esc(color.hex)}" data-color-index="${index}" data-color-prop="hex" aria-label="Color ${index+1} picker"><input type="text" value="${esc(color.hex)}" data-color-index="${index}" data-color-prop="hex-text" aria-label="Color ${index+1} hex value"><input type="text" value="${esc(color.name)}" data-color-index="${index}" data-color-prop="name" aria-label="Color ${index+1} label" placeholder="Label"><button class="remove-color" data-action="remove-color" data-index="${index}" aria-label="Remove color">×</button></div>`;
}
function renderContextForm(project) {
  const context = project.context || {};
  return `<div class="context-note"><span>✳</span><div><b>Skip what you don't know.</b><p>Only confirmed information is used as project context. Leave a field blank and the corresponding story section will be omitted or kept descriptive.</p></div></div>
  <div class="form-grid">
    <div class="field full"><label for="ctx-description">What does the brand do? <span class="optional">OPTIONAL</span></label><textarea id="ctx-description" data-field="context.description" placeholder="One sentence about the brand, its product or service.">${esc(context.description)}</textarea></div>
    <div class="field full"><label for="ctx-challenge">What was the reason for the project? <span class="optional">OPTIONAL</span></label><textarea id="ctx-challenge" data-field="context.challenge" placeholder="The challenge or reason for the work, if known.">${esc(context.challenge)}</textarea></div>
    <div class="field"><label for="ctx-audience">Who is it for? <span class="optional">OPTIONAL</span></label><textarea id="ctx-audience" data-field="context.audience" placeholder="Audience or community.">${esc(context.audience)}</textarea></div>
    <div class="field"><label for="ctx-deliverables">What did you design? <span class="optional">OPTIONAL</span></label><textarea id="ctx-deliverables" data-field="context.deliverables" placeholder="Only list work that was actually delivered.">${esc(context.deliverables)}</textarea></div>
    <div class="field full"><label for="ctx-idea">Is there an idea or detail behind the identity worth explaining? <span class="optional">OPTIONAL</span></label><textarea id="ctx-idea" data-field="context.idea" placeholder="A genuine idea, influence or design decision.">${esc(context.idea)}</textarea></div>
    <div class="field full"><label for="ctx-results">Real results, launch details, testimonials or awards <span class="optional">OPTIONAL</span></label><textarea id="ctx-results" data-field="context.results" placeholder="Only include facts you can verify and have permission to publish.">${esc(context.results)}</textarea><div class="field-help">Never add an award, result, quote or business impact unless it is real and supplied by you.</div></div>
    <div class="field full"><label for="ctx-avoid">Anything that must not be shown? <span class="optional">OPTIONAL</span></label><textarea id="ctx-avoid" data-field="context.avoid" placeholder="Applications, images, sensitive information or concepts to avoid.">${esc(context.avoid)}</textarea></div>
    <div class="field full"><label>Project images / screenshots <span class="optional">OPTIONAL</span></label><label class="upload-zone" for="project-images" id="image-drop"><span class="upload-symbol">▧</span><span class="upload-copy"><strong>Add existing project images</strong><span>Use real project imagery where available. Up to 12 images, 8 MB each.</span></span><span class="upload-cta">Browse files</span></label><input id="project-images" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden><div class="asset-mini-list" id="image-list">${renderImageList(project.images)}</div><div class="field-help">Uploaded images are presented as project material. CSS-built application scenes are clearly marked as illustrative concepts.</div></div>
  </div>`;
}
function renderImageList(images=[]) {
  return images.map((image,index)=>`<div class="asset-mini"><img src="${image.dataUrl}" alt=""><span>${esc(image.name)}</span><button data-action="remove-image" data-index="${index}" aria-label="Remove ${esc(image.name)}">×</button></div>`).join('');
}
function bindSetupEvents() {
  $$('[data-field]', view).forEach(input => {
    const event = input.type === 'checkbox' || input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(event, () => {
      const field = input.dataset.field;
      const value = input.type === 'checkbox' ? input.checked : input.value;
      setFieldValue(currentProject, field, value);
      if (field === 'sameClient') {
        const clientInput = $('#client-name'); if (clientInput) { clientInput.disabled = value; clientInput.value = currentProject.clientName; }
      }
      if (field === 'brandName') {
        const client = $('#client-name'); if (client && currentProject.sameClient) client.value = value;
      }
      if (field === 'fontLicense') currentProject.fontLicense = value;
      if (field === 'fontFamily') { const sample=$('#font-sample'); const label=$('#font-sample-label'); if(sample)sample.style.fontFamily=`'${safeFontName(value)}', 'DM Sans', sans-serif`; if(label)label.textContent=`${value || 'Your typeface'} · shown if available on this device`; }
      if (field === 'website') { const status=$('#website-domain'); if(status){const domain=safeHttpUrl(value);status.textContent=domain?`Reference domain: ${new URL(domain).hostname} · not fetched or analyzed by this tool.`:'Website analysis is not performed in this local-only version. Add screenshots in the next step or continue without a website.';} }
      scheduleSave();
    });
  });
  $('#svg-file')?.addEventListener('change', handleSvgUpload);
  $('#font-file')?.addEventListener('change', handleFontUpload);
  $('#project-images')?.addEventListener('change', handleImagesUpload);
  const drop = $('#svg-drop');
  if (drop) {
    drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('dragover'); const file=event.dataTransfer.files[0]; if(file) validateAndUseSvg(file); });
  }
  const imageDrop = $('#image-drop');
  if (imageDrop) {
    imageDrop.addEventListener('dragover', event => { event.preventDefault(); imageDrop.classList.add('dragover'); });
    imageDrop.addEventListener('dragleave', () => imageDrop.classList.remove('dragover'));
    imageDrop.addEventListener('drop', event => { event.preventDefault(); imageDrop.classList.remove('dragover'); handleImageFiles([...event.dataTransfer.files]); });
  }
  $$('[data-color-index]', view).forEach(input => {
    input.addEventListener('change', () => {
      const i=Number(input.dataset.colorIndex); const prop=input.dataset.colorProp;
      if (!currentProject.colors[i]) return;
      let value=input.value;
      if (prop==='hex-text') { if (!/^#[0-9a-fA-F]{6}$/.test(value)) { toast('Enter a 6-digit hex value, e.g. #2A2A2A.', true); input.value=currentProject.colors[i].hex; return; } prop==='hex-text' && (value=value.toUpperCase()); }
      currentProject.colors[i][prop==='hex-text'?'hex':prop]=value;
      scheduleSave();
      if (prop==='hex'||prop==='hex-text') {
        const picker=$(`[data-color-index="${i}"][data-color-prop="hex"]`,view); const text=$(`[data-color-index="${i}"][data-color-prop="hex-text"]`,view);
        if(picker)picker.value=value;if(text)text.value=value;
        updatePalettePreview();
      }
    });
    if(input.dataset.colorProp==='hex') input.addEventListener('input',()=>{const i=Number(input.dataset.colorIndex);const text=$(`[data-color-index="${i}"][data-color-prop="hex-text"]`,view);if(text)text.value=input.value.toUpperCase();if(currentProject.colors[i])currentProject.colors[i].hex=input.value.toUpperCase();updatePalettePreview();scheduleSave();});
  });
}
function updatePalettePreview() {
  const node=$('#palette-preview');if(node)node.innerHTML=(currentProject.colors||[]).map(c=>`<span style="background:${esc(c.hex)}"></span>`).join('');
  const contrast=$('#palette-contrast');if(contrast)contrast.innerHTML=renderContrastContent(currentProject);
}
function sanitizeSvg(source) {
  if (source.length > 2_000_000) throw new Error('SVG files must be smaller than 2 MB.');
  const parser = new DOMParser();
  const doc = parser.parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror') || !doc.documentElement || doc.documentElement.localName !== 'svg') throw new Error('This file does not contain a valid SVG.');
  const forbidden = new Set(['script','foreignObject','iframe','object','embed','audio','video','image','canvas','link','meta','base','animate','animateMotion','animateTransform','set','discard','feImage']);
  [...doc.querySelectorAll('*')].forEach(node => {
    if (forbidden.has(node.localName)) { node.remove(); return; }
    if (node.localName === 'style') {
      node.textContent = node.textContent.replace(/@import[^;]+;?/gi, '').replace(/url\s*\(\s*(['\"]?)(?!#)[^)]+\)/gi, 'none').replace(/expression\s*\([^)]*\)/gi, '').replace(/(?:^|;)\s*(?:behavior|-moz-binding)\s*:[^;]*/gi, '');
    }
    [...node.attributes].forEach(attr => {
      const name = attr.name.toLowerCase(); const value = attr.value.trim();
      if (name.startsWith('on') || name === 'srcdoc') node.removeAttribute(attr.name);
      else if (name === 'href' || name.endsWith(':href')) {
        if (!value.startsWith('#')) node.removeAttribute(attr.name);
      } else if (name === 'style') {
        const safeValue=value.replace(/url\s*\(\s*(['\"]?)(?!#)[^)]+\)/gi,'none').replace(/@import[^;]+;?/gi,'').replace(/expression\s*\([^)]*\)/gi,'').replace(/(?:^|;)\s*(?:behavior|-moz-binding)\s*:[^;]*/gi,'');
        if(safeValue!==value)node.setAttribute(attr.name,safeValue);
      }
      else if ((name === 'fill' || name === 'stroke' || name === 'filter' || name === 'clip-path' || name === 'mask') && /url\s*\((?!\s*['"]?#)/i.test(value)) node.removeAttribute(attr.name);
    });
  });
  const svg = doc.documentElement;
  svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
  if (!svg.getAttribute('viewBox') && (!svg.getAttribute('width') || !svg.getAttribute('height'))) throw new Error('The SVG needs a viewBox or explicit width and height.');
  return new XMLSerializer().serializeToString(svg);
}
function bytesToBase64(bytes) {
  let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(binary);
}
function svgDataUrl(svgText) { return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svgText))}`; }
async function validateAndUseSvg(file) {
  if (!file.name.toLowerCase().endsWith('.svg') && file.type !== 'image/svg+xml') { toast('Choose an SVG file.',true); return; }
  try {
    const text=await file.text();currentProject.svgOriginalText=text;currentProject.svgText=sanitizeSvg(text);currentProject.svgName=file.name;
    scheduleSave();renderSetup();toast('SVG validated and added.');
  } catch(error) { toast(error.message || 'Could not read this SVG.',true); }
}
function handleSvgUpload(event) { const file=event.target.files?.[0];if(file)validateAndUseSvg(file);event.target.value=''; }
async function fileToDataUrl(file) { return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);}); }
async function handleFontUpload(event) {
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  if(!/\.(woff2?|ttf|otf)$/i.test(file.name)){toast('Use a WOFF2, WOFF, TTF or OTF font file.',true);return;}
  if(file.size>5*1024*1024){toast('Font files must be smaller than 5 MB.',true);return;}
  currentProject.fontDataUrl=await fileToDataUrl(file);currentProject.fontFileName=file.name;currentProject.fontLicense=false;
  scheduleSave();renderSetup();toast('Font file added. Confirm embedding permission before exporting.');
}
async function handleImagesUpload(event) { const files=[...(event.target.files||[])];event.target.value='';await handleImageFiles(files); }
async function handleImageFiles(files) {
  const allowed=['image/png','image/jpeg','image/webp','image/gif'];
  for (const file of files) {
    if(!allowed.includes(file.type)){toast(`${file.name}: unsupported image format.`,true);continue;}
    if(file.size>8*1024*1024){toast(`${file.name}: images must be smaller than 8 MB.`,true);continue;}
    if(currentProject.images.length>=12){toast('A maximum of 12 project images is supported.');break;}
    currentProject.images.push({id:uid(),name:file.name,dataUrl:await fileToDataUrl(file),alt:file.name.replace(/\.[^.]+$/,''),caption:''});
  }
  scheduleSave();renderSetup();
}
function openProject(id) {
  const found=projects.find(p=>p.id===id);if(!found)return;
  currentProject=clone(found);undoStack=[];redoStack=[];setupStep=3;activeDirection=currentProject.direction||'editorial';selectedSection=currentProject.sections?.[0]?.id||'opening';screen=currentProject.sections?.length?'studio':'builder';
  if(screen==='studio')renderStudio();else renderSetup();
}
function ensureSections() {
  const p=currentProject;if(p.sections?.length)return;
  const brand=p.brandName.trim();const client=p.clientName.trim()||brand;const context=p.context||{};
  const type=p.projectType||'Visual identity';
  const intro=context.description ? context.description : `A presentation of the ${type.toLowerCase()} for ${brand}.`;
  p.sections=[
    {id:'opening',kind:'hero',label:'Opening',title:brand,body:intro,visible:true},
    {id:'snapshot',kind:'snapshot',label:'Project snapshot',title:'The identity, at a glance',body:`A closer look at the identity assets for ${brand}, developed for ${client}. This page presents the supplied mark, colour palette and typeface.` ,visible:true},
    ...([context.challenge,context.audience,context.deliverables,context.results].some(value=>String(value||'').trim())?[{id:'context',kind:'context',label:'Project context',title:'The work in context',body:'The project details in this section were supplied for this case study.',facts:{challenge:context.challenge||'',audience:context.audience||'',deliverables:context.deliverables||'',results:context.results||''},visible:true}]:[]),
    ...(context.idea?.trim()?[{id:'idea',kind:'idea',label:'The idea',title:'The thought behind the form',body:context.idea.trim(),visible:true}]:[]),
    {id:'identity',kind:'identity',label:'The identity',title:'A mark to build from',body:'The supplied mark is the starting point for this visual presentation. Its original proportions and artwork are preserved.',visible:true},
    {id:'palette',kind:'palette',label:'Colour',title:'A considered palette',body:'The colours shown here are the values supplied for this project. Any additional tones are identified as derived supporting colours.',visible:true},
    {id:'typography',kind:'type',label:'Typography',title:'Type in its own voice',body:p.fontFamily?`The type specimen uses ${p.fontFamily} as the named typeface. A local fallback is used when the font itself has not been supplied.`:'The type specimen uses the supplied font information.',visible:true},
    {id:'applications',kind:'applications',label:'In use',title:'The identity in context',body:'Illustrative application concepts, created to explore how the supplied identity assets might appear in context. These are concepts, not confirmed client deliverables.',visible:true},
    ...(p.website||p.images?.length?[{id:'digital',kind:'digital',label:p.website?'Digital presence':'Project imagery',title:p.website?'Beyond the page':'Project imagery',body:p.website?'The supplied website address is included as a reference only. This tool has not accessed or analyzed the website.':'Images supplied for this case study are shown as project material.',visible:true}]:[]),
    {id:'details',kind:'details',label:'A closer look',title:'Details worth a closer look',body:'A final look at the mark, its silhouette and its relationship with the surrounding palette.',visible:true},
    {id:'closing',kind:'closing',label:'Closing',title:brand,body:[client,p.designer,p.year].filter(Boolean).join(' · '),visible:true}
  ];
  p.title=brand||p.title||'Untitled case study';
}
function validateBeforeGenerate() {
  const p=currentProject;
  if(!p.svgText){toast('Upload a valid logo or app icon SVG before continuing.',true);setupStep=1;renderSetup();return false;}
  if(!p.brandName.trim()){toast('Add a brand name before continuing.',true);setupStep=1;renderSetup();$('#brand-name')?.focus();return false;}
  if(!(p.clientName||p.brandName).trim()){toast('Add a client or company name.',true);setupStep=1;renderSetup();$('#client-name')?.focus();return false;}
  if(!p.fontFamily.trim()){toast('Add the typeface name. You can upload the font file later.',true);setupStep=1;renderSetup();$('#font-family')?.focus();return false;}
  if(!p.colors?.length){toast('Add at least one brand colour.',true);setupStep=1;renderSetup();return false;}
  for(const c of p.colors){if(!/^#[0-9a-fA-F]{6}$/.test(c.hex)){toast('Check that all brand colors use 6-digit hex values.',true);setupStep=1;renderSetup();return false;}}
  if(p.website){try{const url=new URL(p.website);if(!['http:','https:'].includes(url.protocol))throw new Error();p.website=url.href;}catch{toast('Enter a valid website URL, including https://.',true);setupStep=1;renderSetup();return false;}}
  if(p.sameClient)p.clientName=p.brandName;
  return true;
}
function enterStudio() {
  if(!validateBeforeGenerate())return;
  currentProject.title=currentProject.brandName;
  ensureSections();activeDirection=currentProject.direction||'editorial';selectedSection='opening';screen='studio';
  scheduleSave();renderStudio();toast('Two case study directions are ready to explore.');
}
function pushHistory() { if(!currentProject)return;undoStack.push(clone(currentProject.sections));if(undoStack.length>30)undoStack.shift();redoStack=[]; }
function changeSection(id,patch) { const section=currentProject.sections.find(s=>s.id===id);if(!section)return;pushHistory();Object.assign(section,patch);scheduleSave();renderPreview(); }
function renderStudio() {
  screen='studio';if(!currentProject)return showProjects();
  setBreadcrumb([{label:'Workspace'},{label:currentProject.brandName||'Case study',strong:true}]);
  const section=currentProject.sections.find(s=>s.id===selectedSection);
  view.innerHTML=`<div class="studio-header"><div><div class="eyebrow">CASE STUDY / ${esc(currentProject.brandName.toUpperCase())}</div><h1>${esc(currentProject.brandName)} <span style="font-weight:400;color:#999b91">/</span> Studio</h1><p>Two directions. One set of facts. Every line and section stays editable.</p></div><div class="studio-actions"><div class="direction-switch" role="tablist" aria-label="Case study art direction"><button class="direction-button ${activeDirection==='editorial'?'active':''}" data-direction="editorial" role="tab" aria-selected="${activeDirection==='editorial'}">01 &nbsp; Editorial</button><button class="direction-button ${activeDirection==='immersive'?'active':''}" data-direction="immersive" role="tab" aria-selected="${activeDirection==='immersive'}">02 &nbsp; Immersive</button></div><button class="quiet-button" data-action="undo-sections" title="Undo section edit">↶</button><button class="quiet-button" data-action="redo-sections" title="Redo section edit">↷</button><button class="outline-button" data-action="regenerate-direction">↻ Regenerate</button><button class="outline-button" data-action="export-menu">Export ↗</button></div></div>
  <div class="studio-layout"><aside class="editor-panel"><div class="editor-tabs"><button class="editor-tab ${editorTab==='content'?'active':''}" data-editor-tab="content">Content</button><button class="editor-tab ${editorTab==='sections'?'active':''}" data-editor-tab="sections">Sections</button><button class="editor-tab ${editorTab==='assets'?'active':''}" data-editor-tab="assets">Assets</button></div><div class="editor-content" id="editor-content">${renderEditorContent()}</div></aside>
  <section class="preview-stage"><div class="preview-toolbar"><div class="preview-tabs"><button class="viewport-button ${viewport==='desktop'?'active':''}" data-viewport="desktop">▰ Desktop</button><button class="viewport-button ${viewport==='tablet'?'active':''}" data-viewport="tablet">▯ Tablet</button><button class="viewport-button ${viewport==='mobile'?'active':''}" data-viewport="mobile">▯ Mobile</button></div><div class="preview-tools"><button data-action="toggle-visitor">${visitorMode?'Show editor':'Visitor view'} ↗</button><button data-action="refresh-preview" title="Refresh preview">↻</button></div></div><div class="preview-scroll ${viewport==='mobile'?'mobile-scroll':''}" id="preview-scroll"><div class="preview-frame-wrap ${viewport==='desktop'?'':viewport}" id="preview-frame-wrap"><iframe id="case-preview" class="preview-frame" title="${esc(currentProject.brandName)} case study preview" sandbox="allow-same-origin" loading="eager"></iframe></div></div><div class="preview-stage-footer"><span><strong>${DIRECTIONS[activeDirection].label}</strong> · LIVE PREVIEW</span><span>1440 / 1024 / 768 / 390</span></div></section></div>`;
  if(visitorMode){const panel=$('.editor-panel');const layout=$('.studio-layout');if(panel)panel.style.display='none';if(layout)layout.style.gridTemplateColumns='minmax(0,1fr)';const button=$('[data-action="toggle-visitor"]',view);if(button)button.textContent='Show editor ↗';}
  renderPreview();bindStudioEvents();
}
function renderEditorContent() {
  if(editorTab==='sections')return renderSectionManager();
  if(editorTab==='assets')return renderAssetsEditor();
  const section=currentProject.sections.find(s=>s.id===selectedSection) || currentProject.sections[0];
  if(!section)return '<p class="editor-note">Choose a section to edit its content.</p>';
  return `<div class="editor-section-label"><strong>${esc(section.label)}</strong><span>${esc(section.kind.toUpperCase())}</span></div>
    <div class="editor-field"><label for="section-title">Section heading</label><input id="section-title" data-section-field="title" value="${esc(section.title)}"></div>
    <div class="editor-field"><label for="section-body">Supporting copy</label><textarea id="section-body" data-section-field="body">${esc(section.body)}</textarea></div>
    <div class="editor-controls"><button class="small-button" data-action="regenerate-section" data-id="${esc(section.id)}">↻ Suggest copy</button><button class="small-button" data-action="hide-selected">${section.visible?'Hide section':'Show section'}</button></div>
    <p class="editor-note">${section.kind==='applications'?'These compositions are marked as visual concepts, not real client deliverables.':section.kind==='digital'?'Website URLs are linked as references only; no website assets have been fetched.':'Edits update the live preview. Your original SVG and uploaded assets are not altered.'}</p>
    <div class="editor-divider"></div><div class="editor-section-label"><strong>Factual safeguards</strong><span>ON</span></div><p class="editor-note">No awards, results, testimonials or deliverables are added unless you supplied them. Blank context sections stay out of the story.</p>`;
}
function renderSectionManager() {
  return `<div class="editor-section-label"><strong>Page structure</strong><span>${currentProject.sections.length} SECTIONS</span></div><p class="editor-note" style="margin:0 0 13px">Reorder, hide or remove sections. Hidden sections stay in your project.</p><div class="section-list">${currentProject.sections.map((s,i)=>`<div class="section-item ${s.id===selectedSection?'selected':''}" data-select-section="${esc(s.id)}"><span class="section-drag" title="Section position">⠿</span><span class="section-name">${String(i+1).padStart(2,'0')} &nbsp; ${esc(s.label)}</span><button data-action="move-section" data-id="${esc(s.id)}" data-dir="up" aria-label="Move ${esc(s.label)} up">↑</button><button data-action="move-section" data-id="${esc(s.id)}" data-dir="down" aria-label="Move ${esc(s.label)} down">↓</button><button data-action="toggle-section" data-id="${esc(s.id)}" title="${s.visible?'Hide':'Show'} section" class="${s.visible?'':'visibility-hidden'}">${s.visible?'◉':'○'}</button><button data-action="remove-section" data-id="${esc(s.id)}" title="Remove section">×</button></div>`).join('')}</div><div class="editor-controls"><button class="small-button" data-action="add-section">＋ Add section</button></div><p class="editor-note">The opening and closing sections can be edited or hidden, but cannot be deleted.</p>`;
}
function renderAssetsEditor() {
  const p=currentProject;
  return `<div class="editor-section-label"><strong>Brand assets</strong><span>LOCAL</span></div><div class="asset-mini-list">
    <div class="asset-mini"><img src="${p.svgText?svgDataUrl(p.svgText):''}" alt=""><span>${p.svgName?esc(p.svgName):'No SVG uploaded'}</span><button data-action="edit-brand-assets">Edit</button></div>
    <div class="asset-mini"><span style="width:38px;height:28px;background:${esc(p.colors[0]?.hex||'#ddd')};display:grid;place-items:center;color:white">Aa</span><span>${esc(p.fontFamily||'No typeface named')}</span><button data-action="edit-brand-assets">Edit</button></div></div>
    <div class="editor-divider"></div><div class="editor-section-label"><strong>Project imagery</strong><span>${p.images.length} FILES</span></div>
    <div class="asset-image-editor">${p.images.map(image=>`<div class="asset-image-row"><img src="${image.dataUrl}" alt=""><div class="asset-image-fields"><input data-image-id="${esc(image.id)}" data-image-field="caption" value="${esc(image.caption||'')}" placeholder="Image caption" aria-label="Caption for ${esc(image.name)}"><input data-image-id="${esc(image.id)}" data-image-field="alt" value="${esc(image.alt||'')}" placeholder="Descriptive alt text" aria-label="Alt text for ${esc(image.name)}"><small>${esc(image.name)}</small></div><div class="asset-image-actions"><button data-action="replace-project-image" data-id="${esc(image.id)}" title="Replace image" aria-label="Replace ${esc(image.name)}">↻</button><button data-action="remove-project-image" data-id="${esc(image.id)}" title="Remove image" aria-label="Remove ${esc(image.name)}">×</button></div></div>`).join('')||'<p class="editor-note">No project images uploaded. The page will use CSS-built visual concepts.</p>'}</div>
    <label class="upload-zone" for="studio-image-upload" style="margin-top:12px;min-height:60px;padding:9px"><span class="upload-symbol" style="width:28px;height:28px">＋</span><span class="upload-copy"><strong>Add project imagery</strong><span>PNG, JPG, WEBP or GIF</span></span><span class="upload-cta">Browse</span></label><input id="studio-image-upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
    <div class="editor-divider"></div><div class="editor-section-label"><strong>Project details</strong><span>CONFIRMED</span></div><p class="editor-note">${esc([p.clientName,p.year,p.location,p.designer].filter(Boolean).join(' · ')||'No optional metadata supplied.')}</p><button class="small-button" data-action="edit-brand-assets">Edit setup details</button>`;
}
function bindStudioEvents() {
  $$('[data-section-field]',view).forEach(input=>{input.addEventListener('focus',()=>pushHistory());input.addEventListener('input',()=>{const s=currentProject.sections.find(s=>s.id===selectedSection);if(!s)return;s[input.dataset.sectionField]=input.value;scheduleSave();renderPreview();});});
  $$('[data-image-field]',view).forEach(input=>input.addEventListener('input',()=>{const img=currentProject.images.find(image=>image.id===input.dataset.imageId);if(!img)return;img[input.dataset.imageField]=input.value;scheduleSave();renderPreview();}));
  $$('[data-select-section]',view).forEach(node=>node.addEventListener('click',event=>{if(event.target.closest('button'))return;selectedSection=node.dataset.selectSection;editorTab='content';renderStudio();}));
  $('#studio-image-upload')?.addEventListener('change',async event=>{const files=[...(event.target.files||[])];event.target.value='';await handleImageFilesForStudio(files);});
}
async function handleImageFilesForStudio(files) {
  for (const file of files) {
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)){toast(`${file.name}: unsupported format.`,true);continue;}
    if(file.size>8*1024*1024){toast(`${file.name}: image is larger than 8 MB.`,true);continue;}
    if(currentProject.images.length>=12){toast('A maximum of 12 images is supported.');break;}
    currentProject.images.push({id:uid(),name:file.name,dataUrl:await fileToDataUrl(file),alt:file.name.replace(/\.[^.]+$/,''),caption:''});
  }
  scheduleSave();editorTab='assets';renderStudio();
}
function markImage(project, extraClass='') {
  if(!project.svgText)return `<div class="mark-placeholder ${extraClass}">${esc(project.brandName.slice(0,1)||'✳')}</div>`;
  return `<img class="brand-mark ${project.brandType==='appicon'?'app-icon-mark':''} ${extraClass}" src="${svgDataUrl(project.svgText)}" alt="${esc(project.brandName)} ${project.brandType==='appicon'?'app icon':'logo'}" />`;
}
function projectMeta(project) {
  return [project.clientName,project.projectType,project.year,project.location].filter(Boolean);
}
function safeHttpUrl(raw) { try { const url=new URL(raw); return ['http:','https:'].includes(url.protocol)?url.href:''; } catch { return ''; } }
function blendHex(source, target, amount) {
  const a=source.replace('#',''),b=target.replace('#','');
  const channels=[0,2,4].map(offset=>Math.round(parseInt(a.slice(offset,offset+2),16)*(1-amount)+parseInt(b.slice(offset,offset+2),16)*amount));
  return '#'+channels.map(value=>value.toString(16).padStart(2,'0')).join('').toUpperCase();
}
function pagePalette(project) {
  const colors=(project.colors||[]).filter(color=>/^#[0-9a-f]{6}$/i.test(color.hex||''));
  const primary=colors[0]?.hex||'#20211F';
  const derived=[];
  const derive=(hex,label)=>{const item={name:label,hex,derived:true};derived.push(item);return hex;};
  const secondary=colors[1]?.hex||derive(blendHex(primary,'#FFFFFF',.86),'Generated supporting tone 01');
  const accent=colors[2]?.hex||derive(blendHex(primary,'#FFFFFF',.58),'Generated supporting tone 02');
  const suppliedBackground=colors.find(c=>/background|paper/i.test(c.name||''))?.hex||colors[3]?.hex;
  const background=suppliedBackground||derive(blendHex(secondary,'#FFFFFF',.58),'Generated supporting tone 03');
  return {primary,secondary,accent,background,colors,derived,displayColors:[...colors,...derived]};
}
function luminance(hex) {
  const channels=[0,2,4].map(offset=>parseInt(hex.replace('#','').slice(offset,offset+2),16)/255).map(value=>value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2));
  return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];
}
function contrastRatio(first,second) {const a=luminance(first),b=luminance(second);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
function renderContrastContent(project) {
  if(!project.colors?.length)return '<div class="contrast-empty">Add a brand colour to preview text against your background.</div>';
  const p=pagePalette(project),ratio=contrastRatio(p.primary,p.background),status=ratio>=4.5?'AA · normal text':ratio>=3?'AA · large text only':'Below AA';
  return `<div class="contrast-preview-pair" style="--contrast-ink:${esc(p.primary)};--contrast-paper:${esc(p.background)}"><strong>Aa</strong><span>The quick brown fox</span></div><div class="contrast-score"><strong>${ratio.toFixed(2)}:1</strong><span>${status}</span></div>`;
}
function safeFontName(value) { return String(value||'DM Sans').replace(/[^a-zA-Z0-9 _-]/g,'').slice(0,80)||'DM Sans'; }
function pageFont(project) { const family=safeFontName(project.fontFamily); return project.fontDataUrl && project.fontLicense ? `'StudioUploaded', '${family}', Arial, sans-serif` : `'${family}', 'DM Sans', Arial, sans-serif`; }
function imageGallery(project) {
  if(!project.images?.length)return '';
  return `<div class="real-image-grid">${project.images.map((image,i)=>`<figure><img src="${image.dataUrl}" alt="${esc(image.alt||image.name)}" loading="lazy"><figcaption><span>PROJECT IMAGE ${String(i+1).padStart(2,'0')}</span>${esc(image.caption||image.name)}</figcaption></figure>`).join('')}</div>`;
}
function renderApplications(project, palette) {
  const isIcon=project.brandType==='appicon';
  const mark = isIcon ? `<div class="app-icon-scene">${markImage(project)}</div>` : markImage(project,'application-mark');
  return `<div class="concept-grid">
    <article class="concept-scene concept-poster"><span class="scene-label">01 / PRINT STUDY</span><div class="poster-frame"><span class="poster-top">${esc(project.brandName.toUpperCase())}</span>${mark}<strong>${esc(project.brandName)}</strong><small>IDENTITY / VISUAL CONCEPT</small></div><span class="scene-caption">A graphic composition using the supplied identity.</span></article>
    <article class="concept-scene concept-digital"><span class="scene-label">02 / DIGITAL STUDY</span><div class="screen-frame"><div class="screen-top"><i></i><i></i><i></i><span>${esc(project.brandName.toLowerCase().replace(/\s+/g,''))}</span></div><div class="screen-content"><div class="screen-brand">${markImage(project)}</div><strong>${esc(project.brandName)}</strong><p>${esc(project.projectType)}<br>Visual language / digital concept</p><div class="screen-lines"><i></i><i></i><i></i></div></div></div><span class="scene-caption">A possible digital expression — not a live website.</span></article>
    <article class="concept-scene concept-stationery"><span class="scene-label">03 / MATERIAL STUDY</span><div class="stationery-sheet"><span class="stationery-name">${esc(project.brandName.toUpperCase())}</span><div>${markImage(project)}</div><small>${esc(project.clientName)}</small></div><span class="scene-caption">An illustrative print and stationery composition.</span></article>
  </div><p class="concept-disclaimer">ILLUSTRATIVE APPLICATION CONCEPTS · CREATED FOR PRESENTATION ONLY · NOT CONFIRMED CLIENT DELIVERABLES</p>`;
}
function sectionMarkup(section, project, palette, index, direction) {
  const title=esc(section.title);const body=section.body ? `<p class="section-copy">${esc(section.body)}</p>`:'';
  const number=String(index+1).padStart(2,'0');
  switch(section.kind){
    case 'hero': return `<section class="cs-section hero-section" id="${esc(section.id)}"><div class="hero-topline"><span>${esc(project.clientName||project.brandName)}</span><span>${esc(project.projectType||'Identity')}</span><span>${esc(project.year||'')}</span></div><div class="hero-main"><div class="hero-mark-wrap">${markImage(project)}</div><div class="hero-copy"><div class="section-index">CASE STUDY / ${number}</div><h1>${title}</h1>${body}<div class="hero-meta">${projectMeta(project).map((v,i)=>`<span>${esc(v)}</span>`).join('<i>·</i>')}</div></div></div><div class="hero-bottom"><span>VISUAL IDENTITY / ${esc(project.brandName.toUpperCase())}</span><span>SCROLL TO EXPLORE ↓</span></div></section>`;
    case 'snapshot': return `<section class="cs-section snapshot-section" id="${esc(section.id)}"><div class="section-rail"><span>${number} / PROJECT SNAPSHOT</span><span>${esc(project.brandName.toUpperCase())}</span></div><div class="snapshot-grid"><h2>${title}</h2><div>${body}<div class="snapshot-facts">${projectMeta(project).map((v,i)=>`<div><small>${['CLIENT','DISCIPLINE','YEAR','LOCATION'][i]||'DETAIL'}</small><strong>${esc(v)}</strong></div>`).join('')}</div></div></div></section>`;
    case 'context': { const facts=[['CHALLENGE',section.facts?.challenge],['AUDIENCE',section.facts?.audience],['SCOPE',section.facts?.deliverables],['RESULTS / DETAILS SUPPLIED',section.facts?.results]].filter(([,value])=>String(value||'').trim()); return `<section class="cs-section context-section" id="${esc(section.id)}"><div class="section-rail"><span>${number} / PROJECT CONTEXT</span><span>USER-SUPPLIED DETAILS</span></div><div class="context-heading"><h2>${title}</h2>${body}</div><div class="context-facts">${facts.map(([label,value])=>`<div><small>${label}</small><p>${esc(value)}</p></div>`).join('')}</div></section>`; }
    case 'idea': return `<section class="cs-section idea-section" id="${esc(section.id)}"><div class="section-rail"><span>${number} / THE IDEA</span><span>PROJECT CONTEXT</span></div><div class="idea-content"><span class="idea-star">✳</span><h2>${title}</h2>${body}</div></section>`;
    case 'identity': return `<section class="cs-section identity-section" id="${esc(section.id)}"><div class="section-rail"><span>${number} / THE IDENTITY</span><span>ORIGINAL ASSET</span></div><div class="identity-stage"><div class="identity-stage-mark">${markImage(project)}</div><div class="identity-stage-footer"><h2>${title}</h2>${body}</div></div></section>`;
    case 'palette': return `<section class="cs-section palette-section" id="${esc(section.id)}"><div class="section-rail"><span>${number} / COLOUR</span><span>COLOUR SYSTEM</span></div><div class="palette-heading"><h2>${title}</h2>${body}</div><div class="swatch-grid">${(palette.displayColors||palette.colors).map((c,i)=>`<div class="swatch"><div class="swatch-color" style="background:${esc(c.hex)}"></div><div class="swatch-meta"><strong>${esc(c.name||`Colour ${i+1}`)}</strong><span>${esc(c.hex.toUpperCase())}</span></div></div>`).join('')}</div>${palette.derived?.length?'<p class="derived-disclosure">GENERATED SUPPORTING TONES · DERIVED FROM THE SUPPLIED PALETTE · NOT OFFICIAL BRAND COLOURS</p>':''}</section>`;
    case 'type': return `<section class="cs-section type-section" id="${esc(section.id)}"><div class="section-rail"><span>${number} / TYPOGRAPHY</span><span>TYPE SPECIMEN</span></div><div class="type-layout"><div><h2>${title}</h2>${body}<small class="font-disclosure">${project.fontDataUrl&&project.fontLicense?'UPLOADED TYPEFACE EMBEDDED':'FONT NAME SUPPLIED · LOCAL AVAILABILITY MAY VARY'}</small></div><div class="type-specimen"><div class="type-name">${esc(project.fontFamily||'Typeface')}</div><div class="type-large">Ag</div><div class="type-ruler">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>0123456789 &amp; @!?$%</div></div></div></section>`;
    case 'applications': return `<section class="cs-section applications-section" id="${esc(section.id)}"><div class="section-rail"><span>${number} / IN USE</span><span>VISUAL CONCEPTS</span></div><div class="applications-heading"><h2>${title}</h2>${body}</div>${renderApplications(project,palette)}</section>`;
    case 'digital': return `<section class="cs-section digital-section" id="${esc(section.id)}"><div class="section-rail"><span>${number} / DIGITAL PRESENCE</span><span>REFERENCE MATERIAL</span></div><div class="digital-layout"><div><h2>${title}</h2>${body}${safeHttpUrl(project.website)?`<a class="website-reference" href="${esc(safeHttpUrl(project.website))}" target="_blank" rel="noopener noreferrer">${esc(new URL(safeHttpUrl(project.website)).hostname)} ↗</a><small class="font-disclosure">REFERENCE LINK ONLY · WEBSITE NOT ANALYZED BY THIS TOOL</small>`:''}</div><div class="digital-images">${imageGallery(project)||`<div class="digital-placeholder">${markImage(project)}<span>PROJECT IMAGE / SCREENSHOT</span></div>`}</div></div></section>`;
    case 'details': return `<section class="cs-section details-section" id="${esc(section.id)}"><div class="section-rail"><span>${number} / DETAILS</span><span>MARK &amp; MATERIAL</span></div><div class="details-layout"><div class="details-mark">${markImage(project)}</div><div><h2>${title}</h2>${body}<div class="detail-lines"><span>01 / FORM</span><span>02 / COLOUR</span><span>03 / TYPE</span></div></div></div></section>`;
    case 'closing': return `<section class="cs-section closing-section" id="${esc(section.id)}"><div class="closing-mark">${markImage(project)}</div><span class="closing-kicker">END OF CASE STUDY / ${esc(project.brandName.toUpperCase())}</span><h2>${title}</h2>${body?`<p>${esc(section.body)}</p>`:''}<div class="closing-credit">${project.designer?`DESIGN / ${esc(project.designer.toUpperCase())}`:''}<span>${esc(project.clientName||project.brandName)}</span></div></section>`;
    default: return `<section class="cs-section custom-section" id="${esc(section.id)}"><div class="section-rail"><span>${number} / ${esc(section.label.toUpperCase())}</span><span>PROJECT NOTES</span></div><div class="custom-inner"><h2>${title}</h2>${body}</div></section>`;
  }
}
const CASE_CSS = `
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--body);font-size:14px;-webkit-font-smoothing:antialiased}a{color:inherit}.case-page{width:100%;overflow:hidden}.case-nav{height:58px;padding:0 5.2vw;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);font:9px var(--mono);letter-spacing:1.2px;text-transform:uppercase}.case-nav .nav-left{display:flex;gap:10px;align-items:center}.nav-symbol{width:8px;height:8px;background:var(--accent);display:inline-block;border-radius:50%}.nav-right{color:var(--soft)}.cs-section{padding:90px 8vw;position:relative}.hero-section{min-height:690px;padding:0 7vw 35px;display:flex;flex-direction:column;justify-content:space-between;background:var(--paper)}.hero-topline,.hero-bottom{display:flex;align-items:center;justify-content:space-between;gap:15px;font:9px var(--mono);letter-spacing:1.3px;text-transform:uppercase;color:var(--soft)}.hero-topline{padding:26px 0 20px;border-bottom:1px solid var(--line)}.hero-main{flex:1;display:grid;grid-template-columns:1.05fr .95fr;align-items:center;gap:6vw;padding:45px 0}.hero-mark-wrap{min-height:340px;display:grid;place-items:center;background:var(--surface);position:relative;overflow:hidden}.hero-mark-wrap:before{content:'';position:absolute;width:55%;aspect-ratio:1;border-radius:50%;background:var(--accent);opacity:.8;right:-14%;top:-24%}.brand-mark{position:relative;z-index:1;max-width:72%;max-height:190px;width:auto;height:auto;object-fit:contain}.hero-copy{position:relative;z-index:1}.section-index,.section-rail,.scene-label,.font-disclosure{font:9px var(--mono);letter-spacing:1.2px;text-transform:uppercase;color:var(--soft)}h1,h2,p{margin-top:0}.hero-copy h1{font:600 clamp(45px,6.8vw,94px)/.96 var(--display);letter-spacing:-.065em;margin:24px 0 19px;max-width:670px}.section-copy{font:400 14px/1.7 var(--body);color:var(--muted);max-width:550px}.hero-meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:36px;font:9px var(--mono);text-transform:uppercase;letter-spacing:.8px;color:var(--muted)}.hero-meta i{font-style:normal;color:var(--accent-dark)}.hero-bottom{border-top:1px solid var(--line);padding-top:17px}.section-rail{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:13px;margin-bottom:45px}.snapshot-section{padding-top:100px;padding-bottom:100px}.snapshot-grid{display:grid;grid-template-columns:.9fr 1.1fr;gap:9vw}.snapshot-grid h2,.idea-content h2,.identity-stage-footer h2,.palette-heading h2,.type-layout h2,.applications-heading h2,.digital-layout h2,.details-layout h2,.custom-inner h2{font:550 clamp(34px,4.2vw,62px)/1.03 var(--display);letter-spacing:-.055em;margin:0;max-width:550px}.snapshot-grid .section-copy{font-size:16px;max-width:600px;margin:0}.snapshot-facts{display:flex;flex-wrap:wrap;gap:28px;margin-top:38px;padding-top:18px;border-top:1px solid var(--line)}.snapshot-facts div{min-width:92px}.snapshot-facts small{font:8px var(--mono);letter-spacing:1px;color:var(--soft);display:block;margin-bottom:8px}.snapshot-facts strong{font-size:11px;font-weight:550}.idea-section{background:var(--ink);color:var(--paper);padding-top:85px;padding-bottom:100px}.idea-section .section-rail{border-color:rgba(255,255,255,.2);color:#c5c7bc}.idea-content{max-width:840px;margin:0 auto;text-align:center;padding:30px 0}.idea-star{display:block;color:var(--accent);font-size:33px;margin-bottom:25px}.idea-content h2{font:550 clamp(38px,6vw,76px)/.99 var(--display);letter-spacing:-.06em;margin:0 auto 22px}.idea-content .section-copy{margin:0 auto;color:#b6b9ae;max-width:600px;font-size:15px}.identity-section{padding-top:86px;padding-bottom:90px}.identity-stage{background:var(--surface);min-height:455px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden;padding:6vw}.identity-stage:after{content:'';width:38vw;aspect-ratio:1;position:absolute;right:-10vw;top:-20vw;border:1px solid var(--line);border-radius:50%;box-shadow:0 0 0 4vw var(--surface),0 0 0 calc(4vw + 1px) var(--line),0 0 0 9vw var(--surface),0 0 0 calc(9vw + 1px) var(--line)}.identity-stage-mark{flex:1;display:grid;place-items:center;min-height:300px;position:relative;z-index:1}.identity-stage-mark .brand-mark{max-width:66%;max-height:190px}.identity-stage-footer{display:flex;justify-content:space-between;align-items:flex-end;gap:35px;position:relative;z-index:1}.identity-stage-footer h2{font-size:30px}.identity-stage-footer .section-copy{max-width:370px;font-size:11px;margin:0}.palette-section{background:var(--surface)}.palette-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:30px;margin-bottom:42px}.palette-heading .section-copy{max-width:420px;margin:0;font-size:12px}.swatch-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}.swatch-color{height:175px;background:#ddd}.swatch-meta{display:flex;justify-content:space-between;gap:5px;padding-top:11px;font:9px var(--mono);text-transform:uppercase}.swatch-meta strong{font-weight:400;letter-spacing:.4px}.swatch-meta span{color:var(--soft)}.type-section{padding-top:100px;padding-bottom:110px}.type-layout{display:grid;grid-template-columns:.75fr 1.25fr;gap:8vw;align-items:center}.type-layout .section-copy{font-size:12px;margin:19px 0 27px}.font-disclosure{display:block;font-size:8px;line-height:1.5}.type-specimen{border-left:1px solid var(--line);padding-left:5vw;min-width:0}.type-name{font:11px var(--mono);letter-spacing:1px;color:var(--soft);text-transform:uppercase}.type-large{font:500 clamp(170px,24vw,340px)/.8 var(--body);letter-spacing:-.1em;color:var(--accent-dark);margin:20px 0}.type-ruler{font:11px/1.8 var(--body);letter-spacing:.11em;color:var(--muted);word-break:break-all}.applications-section{background:var(--paper);padding-top:94px}.applications-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:32px;margin-bottom:48px}.applications-heading .section-copy{max-width:410px;font-size:12px;margin:0}.concept-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:13px}.concept-scene{min-width:0;min-height:365px;padding:17px;background:var(--surface);display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}.scene-label{z-index:2}.scene-caption{font:9px var(--mono);color:var(--soft);line-height:1.4;margin-top:15px;z-index:2}.poster-frame{width:76%;height:260px;margin:12px auto 0;background:var(--accent);color:var(--ink);display:flex;flex-direction:column;justify-content:space-between;padding:15px;box-shadow:8px 10px 0 rgba(0,0,0,.06);position:relative}.poster-frame .brand-mark,.poster-frame .application-mark{max-width:58%;max-height:90px;align-self:center}.poster-frame strong{font:600 28px/.95 var(--display);letter-spacing:-.06em;max-width:130px}.poster-frame small,.poster-top{font:7px var(--mono);letter-spacing:.8px}.screen-frame{width:76%;max-width:250px;height:260px;margin:12px auto 0;background:#fbfaf6;border:6px solid #30332e;border-radius:17px;overflow:hidden;box-shadow:8px 10px 0 rgba(0,0,0,.06)}.screen-top{height:26px;background:#e4e5dc;display:flex;align-items:center;gap:4px;padding:0 7px}.screen-top i{width:4px;height:4px;background:#9c9e94;border-radius:50%}.screen-top span{font:6px var(--mono);margin-left:auto;color:#777}.screen-content{padding:18px 12px}.screen-brand{height:65px;display:grid;place-items:center;background:var(--accent);margin-bottom:14px}.screen-brand .brand-mark{max-width:55%;max-height:39px}.screen-content strong{font:600 19px var(--display);letter-spacing:-1px}.screen-content p{font:7px/1.5 var(--mono);color:#888;margin:6px 0 12px}.screen-lines i{display:block;height:3px;background:#e3e3dc;margin-top:4px;width:90%}.screen-lines i:nth-child(2){width:73%}.screen-lines i:nth-child(3){width:48%}.stationery-sheet{width:82%;height:230px;margin:18px auto 0;background:#e4e2d8;padding:18px;color:#30322d;display:flex;flex-direction:column;justify-content:space-between;box-shadow:7px 9px 0 rgba(0,0,0,.05);transform:rotate(2deg)}.stationery-sheet>div{height:100px;display:grid;place-items:center;background:var(--paper)}.stationery-sheet .brand-mark{max-width:70%;max-height:70px}.stationery-name,.stationery-sheet small{font:7px var(--mono);letter-spacing:1px}.concept-disclaimer{font:8px var(--mono);letter-spacing:1px;color:var(--soft);margin:20px 0 0}.digital-section{background:var(--surface)}.digital-layout{display:grid;grid-template-columns:.8fr 1.2fr;gap:8vw;align-items:start}.digital-layout .section-copy{font-size:12px;margin:18px 0 20px}.website-reference{font:10px var(--mono);text-decoration:none;border-bottom:1px solid var(--accent-dark);padding-bottom:5px;display:inline-block;margin:0 0 12px}.digital-images .real-image-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.real-image-grid figure{margin:0;min-width:0}.real-image-grid figure:first-child:nth-last-child(odd){grid-column:1/-1}.real-image-grid img{display:block;width:100%;max-height:360px;object-fit:cover;background:var(--paper)}.real-image-grid figcaption{display:flex;justify-content:space-between;gap:6px;margin-top:7px;font:8px var(--mono);color:var(--soft)}.real-image-grid figcaption span{letter-spacing:.7px}.digital-placeholder{height:260px;display:grid;place-items:center;background:var(--paper);position:relative}.digital-placeholder .brand-mark{max-width:60%;max-height:100px}.digital-placeholder>span{position:absolute;bottom:13px;left:15px;font:8px var(--mono);color:var(--soft)}.details-section{padding-top:90px;padding-bottom:105px}.details-layout{display:grid;grid-template-columns:1.1fr .9fr;align-items:center;gap:8vw}.details-mark{min-height:330px;background:var(--surface);display:grid;place-items:center;position:relative;overflow:hidden}.details-mark:after{content:'';position:absolute;width:250px;height:250px;border:1px solid var(--line);border-radius:50%;box-shadow:0 0 0 35px var(--surface),0 0 0 36px var(--line),0 0 0 70px var(--surface),0 0 0 71px var(--line)}.details-mark .brand-mark{max-width:63%;max-height:140px}.details-layout .section-copy{font-size:12px;margin:18px 0 30px}.detail-lines{display:flex;gap:15px;flex-wrap:wrap;font:8px var(--mono);color:var(--soft);letter-spacing:.7px}.closing-section{min-height:440px;background:var(--ink);color:var(--paper);padding:75px 8vw 40px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;overflow:hidden}.closing-section:after{content:'';position:absolute;width:45vw;height:45vw;border:1px solid rgba(255,255,255,.14);border-radius:50%;right:-18vw;bottom:-25vw;box-shadow:0 0 0 6vw var(--ink),0 0 0 calc(6vw + 1px) rgba(255,255,255,.1),0 0 0 12vw var(--ink),0 0 0 calc(12vw + 1px) rgba(255,255,255,.1)}.closing-mark{max-width:85px;max-height:64px;margin-bottom:35px;display:grid;place-items:center}.closing-mark .brand-mark{max-width:85px;max-height:64px;filter:none}.closing-kicker{font:8px var(--mono);letter-spacing:1.3px;color:#adb0a5}.closing-section h2{font:600 clamp(52px,8vw,112px)/.9 var(--display);letter-spacing:-.07em;margin:18px 0;position:relative;z-index:1}.closing-section p{font-size:11px;color:#b3b5ab;position:relative;z-index:1}.closing-credit{width:100%;display:flex;justify-content:space-between;gap:12px;border-top:1px solid rgba(255,255,255,.2);padding-top:15px;margin-top:60px;position:relative;z-index:1;font:8px var(--mono);letter-spacing:1px;color:#b6b8af}.custom-section{min-height:280px}.custom-inner{max-width:780px;margin:0 auto}.custom-inner .section-copy{margin-top:18px}.mark-placeholder{font:600 55px var(--display);color:var(--ink);background:var(--accent);width:100px;height:100px;display:grid;place-items:center}.brand-mark.application-mark{max-height:100px}.case-page.editorial{--display:var(--brand-font);--body:var(--brand-font)}.case-page.immersive{--display:var(--brand-font);--body:var(--brand-font)}.case-page.immersive .case-nav{background:var(--ink);color:var(--paper);border-color:rgba(255,255,255,.12)}.case-page.immersive .hero-section{background:var(--ink);color:var(--paper);min-height:740px;padding-left:6vw;padding-right:6vw}.case-page.immersive .hero-topline,.case-page.immersive .hero-bottom{color:#b5b8aa;border-color:rgba(255,255,255,.2)}.case-page.immersive .hero-main{grid-template-columns:1fr 1fr;gap:5vw}.case-page.immersive .hero-mark-wrap{min-height:420px;background:var(--accent);color:var(--ink)}.case-page.immersive .hero-mark-wrap:before{background:var(--paper);width:70%;right:-23%;top:-40%}.case-page.immersive .hero-copy h1{font-size:clamp(55px,8vw,115px);max-width:550px}.case-page.immersive .hero-copy .section-copy{color:#c2c5ba}.case-page.immersive .hero-meta{color:#b3b6aa}.case-page.immersive .idea-section{background:var(--accent);color:var(--ink)}.case-page.immersive .idea-section .section-rail{border-color:rgba(0,0,0,.2);color:#575d4a}.case-page.immersive .idea-content .section-copy{color:#555a4b}.case-page.immersive .idea-star{color:var(--ink)}.case-page.immersive .snapshot-section{background:var(--surface)}.case-page.immersive .identity-stage{background:var(--ink);color:var(--paper)}.case-page.immersive .identity-stage:after{border-color:rgba(255,255,255,.18);box-shadow:0 0 0 4vw var(--ink),0 0 0 calc(4vw + 1px) rgba(255,255,255,.18),0 0 0 9vw var(--ink),0 0 0 calc(9vw + 1px) rgba(255,255,255,.18)}.case-page.immersive .identity-stage-footer .section-copy{color:#b5b7ae}.case-page.immersive .palette-section{background:var(--ink);color:var(--paper)}.case-page.immersive .palette-section .section-rail{border-color:rgba(255,255,255,.18);color:#b7baaf}.case-page.immersive .palette-section .section-copy{color:#b5b7ae}.case-page.immersive .type-section{background:var(--accent)}.case-page.immersive .type-section .type-specimen{border-color:rgba(0,0,0,.22)}.case-page.immersive .type-section .type-large{color:var(--ink)}.case-page.immersive .applications-section{background:var(--ink);color:var(--paper)}.case-page.immersive .applications-section .section-rail{border-color:rgba(255,255,255,.18);color:#b7baaf}.case-page.immersive .applications-section .section-copy{color:#b5b7ae}.case-page.immersive .concept-scene{background:#353a30}.case-page.immersive .scene-caption{color:#c1c3b8}.case-page.immersive .digital-section{background:var(--accent);color:var(--ink)}.case-page.immersive .digital-section .section-rail{border-color:rgba(0,0,0,.2);color:#555a4a}.case-page.immersive .digital-section .section-copy{color:#565b4d}.case-page.immersive .details-section{background:var(--surface)}.case-page.immersive .details-mark{background:var(--accent)}.case-page.immersive .details-mark:after{border-color:rgba(0,0,0,.18);box-shadow:0 0 0 35px var(--accent),0 0 0 36px rgba(0,0,0,.18),0 0 0 70px var(--accent),0 0 0 71px rgba(0,0,0,.18)}
@media(max-width:700px){.case-nav{height:48px;padding:0 18px;font-size:7px}.cs-section{padding:60px 22px}.hero-section,.case-page.immersive .hero-section{min-height:660px;padding:0 20px 25px}.hero-topline{padding:19px 0 14px;font-size:7px;gap:6px}.hero-main,.case-page.immersive .hero-main{grid-template-columns:1fr;gap:25px;padding:22px 0}.hero-mark-wrap,.case-page.immersive .hero-mark-wrap{min-height:220px}.brand-mark{max-height:120px}.hero-copy h1,.case-page.immersive .hero-copy h1{font-size:clamp(48px,14vw,76px);margin:14px 0}.hero-meta{margin-top:20px}.hero-bottom{font-size:7px}.section-rail{font-size:7px;margin-bottom:28px}.snapshot-grid,.type-layout,.digital-layout,.details-layout{grid-template-columns:1fr;gap:25px}.snapshot-grid .section-copy{font-size:13px}.snapshot-facts{gap:17px}.idea-content h2{font-size:48px}.identity-stage{min-height:350px;padding:25px}.identity-stage-mark{min-height:230px}.identity-stage-footer{display:block}.identity-stage-footer h2{margin-bottom:10px}.palette-heading,.applications-heading{display:block}.palette-heading .section-copy,.applications-heading .section-copy{margin-top:13px}.swatch-grid{grid-template-columns:repeat(2,1fr)}.swatch-color{height:125px}.type-specimen{padding-left:0;border:0}.type-large{font-size:190px;margin:18px 0}.concept-grid{grid-template-columns:1fr}.concept-scene{min-height:340px}.poster-frame,.screen-frame,.stationery-sheet{max-width:245px}.digital-layout .section-copy{margin-top:13px}.details-mark{min-height:250px}.closing-section{min-height:365px;padding:60px 22px 30px}.closing-section h2{font-size:62px}.closing-credit{margin-top:40px;font-size:7px}.case-page.immersive .palette-section{padding-top:55px}.real-image-grid{grid-template-columns:1fr!important}.real-image-grid figure:first-child:nth-last-child(odd){grid-column:auto}.real-image-grid img{max-height:270px}}
.case-page.revision-1 .hero-main{grid-template-columns:.82fr 1.18fr}.case-page.revision-1 .hero-mark-wrap{min-height:390px}.case-page.revision-1 .hero-mark-wrap:before{left:-15%;right:auto;top:auto;bottom:-27%}.case-page.revision-2 .hero-main{grid-template-columns:1fr;gap:28px}.case-page.revision-2 .hero-mark-wrap{min-height:260px}.case-page.revision-2 .hero-copy{max-width:850px}.case-page.revision-2 .hero-copy h1{max-width:850px}.case-page.immersive.revision-1 .hero-main{grid-template-columns:1.2fr .8fr}.case-page.immersive.revision-1 .hero-mark-wrap{order:2}.case-page.immersive.revision-1 .hero-copy{order:1}.case-page.immersive.revision-2 .hero-main{grid-template-columns:1fr}.case-page.immersive.revision-2 .hero-mark-wrap{min-height:300px}.case-page.revision-1 .applications-section .concept-scene:nth-child(2){transform:translateY(18px)}.case-page.revision-2 .applications-section .concept-scene:nth-child(3){transform:translateY(-16px)}.context-section{background:var(--surface)}.context-heading{display:grid;grid-template-columns:.85fr 1.15fr;gap:8vw;align-items:start}.context-heading .section-copy{font-size:13px}.context-facts{display:grid;grid-template-columns:repeat(2,1fr);gap:0 35px;margin-top:35px;border-top:1px solid var(--line)}.context-facts>div{padding:18px 0;border-bottom:1px solid var(--line)}.context-facts small{font:8px var(--mono);letter-spacing:1px;color:var(--soft)}.context-facts p{font-size:13px;line-height:1.6;margin:8px 0 0;color:var(--ink)}.font-specimen-card{padding:15px 17px;background:#efeee8;border:1px solid #dedfd8;display:flex;align-items:center;justify-content:space-between;gap:12px}.font-specimen-card>div>span{display:block;font:8px var(--mono);letter-spacing:1px;color:#92948b}.font-specimen-card strong{display:block;font-size:48px;line-height:1;margin:9px 0 5px;font-weight:500;letter-spacing:-2px}.font-specimen-card p{margin:0;color:#85877f;font-size:9px}.font-specimen-brand{font-size:18px;letter-spacing:-.8px;color:#777a70}.asset-image-editor{display:grid;gap:9px}.asset-image-row{display:grid;grid-template-columns:55px minmax(0,1fr) 42px;gap:7px;align-items:start;border:1px solid #e1e2dc;background:#fffefa;padding:7px}.asset-image-row>img{width:55px;height:55px;object-fit:cover;background:#e8e8e1}.asset-image-fields{display:grid;gap:5px;min-width:0}.asset-image-fields input{width:100%;min-width:0;border:1px solid #e0e1db;background:#fff;padding:6px 7px;font:9px var(--sans);color:#45483f}.asset-image-fields small{font:8px var(--mono);color:#92948c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.asset-image-actions{display:flex;flex-direction:column;gap:3px}.asset-image-actions button{border:0;background:transparent;color:#77796f;padding:3px;font-size:12px}.asset-image-actions button:hover{color:#272922}@media(max-width:700px){.context-heading{grid-template-columns:1fr;gap:18px}.context-facts{grid-template-columns:1fr}.case-page.revision-1 .hero-main,.case-page.immersive.revision-1 .hero-main,.case-page.revision-2 .hero-main,.case-page.immersive.revision-2 .hero-main{grid-template-columns:1fr}.case-page.immersive.revision-1 .hero-mark-wrap{order:0}.case-page.immersive.revision-1 .hero-copy{order:0}.case-page.revision-1 .applications-section .concept-scene:nth-child(2),.case-page.revision-2 .applications-section .concept-scene:nth-child(3){transform:none}.font-specimen-card{align-items:flex-start}.font-specimen-brand{font-size:14px}}
@media print{.case-nav{break-inside:avoid}.cs-section{break-inside:avoid;page-break-inside:avoid}.hero-section,.closing-section{min-height:90vh}.concept-scene,.swatch{break-inside:avoid}a{text-decoration:none}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;
function buildPageDocument(project, direction=activeDirection) {
  const p=project;const colors=pagePalette(p);const font=pageFont(p);
  const pageSections=(p.sections||[]).filter(s=>s.visible).map((s,i)=>sectionMarkup(s,p,colors,i,direction)).join('');
  const meta=esc([p.brandName,p.clientName,p.projectType].filter(Boolean).join(' — '));
  const fontFace=p.fontDataUrl&&p.fontLicense?`@font-face{font-family:'StudioUploaded';src:url('${p.fontDataUrl}')}\n`:'';
  const pageVars=`--ink:${colors.primary};--paper:${colors.background};--surface:${colors.secondary};--accent:${colors.accent};--accent-dark:${colors.primary};--muted:${colors.primary}99;--soft:${colors.primary}88;--line:${colors.primary}25;--brand-font:${font};`;
  const revision=Number(project.directionRevision?.[direction]||0)%3;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${meta}"><title>${meta} — Case Study</title><style>${fontFace}:root{${pageVars}}${CASE_CSS}</style></head><body><div class="case-page ${direction} revision-${revision}"><header class="case-nav"><span class="nav-left"><i class="nav-symbol"></i> ${esc(p.brandName)}</span><span class="nav-right">${direction==='editorial'?'IDENTITY / VISUAL STUDY':'A BRAND IN CONTEXT'}</span></header>${pageSections}</div></body></html>`;
}
function renderPreview() {
  const iframe=$('#case-preview');if(!iframe||!currentProject)return;
  const frameWrap=$('#preview-frame-wrap');if(frameWrap)frameWrap.className=`preview-frame-wrap ${viewport==='desktop'?'':viewport}`;
  const scroll=$('#preview-scroll');if(scroll)scroll.classList.toggle('mobile-scroll',viewport==='mobile');
  iframe.srcdoc=buildPageDocument(currentProject,activeDirection);
}
async function createNewSection() {
  const label=await promptModal('Add a section','Choose a clear section name. The section will be editable and can be moved or removed.','Section title');
  if(!label)return;
  const id=uid();pushHistory();currentProject.sections.splice(Math.max(0,currentProject.sections.length-1),0,{id,kind:'custom',label:label.trim(),title:label.trim(),body:'Add a short, factual description of this part of the work.',visible:true});
  selectedSection=id;editorTab='content';scheduleSave();renderStudio();
}
function moveSection(id,dir) {
  const sections=currentProject.sections;const index=sections.findIndex(s=>s.id===id);const next=index+(dir==='up'?-1:1);if(index<0||next<0||next>=sections.length)return;
  pushHistory();[sections[index],sections[next]]=[sections[next],sections[index]];scheduleSave();renderStudio();
}
function regenerateLocal(section) {
  const p=currentProject;const c=p.context||{};const fact=p.brandName;
  const variants={
    opening:[`A visual presentation of ${fact}.`,`The identity and visual language of ${fact}.`,`A closer look at the visual identity for ${fact}.`],
    snapshot:[`A presentation of the supplied identity assets for ${fact}, including the mark, colour palette and typeface.`,`This case study brings together the provided visual identity elements for ${fact}.`,`The following pages document the supplied brand mark, palette and typography for ${fact}.`],
    identity:[`The original supplied mark is shown here without alteration. Its proportions and artwork are preserved.`,`The identity begins with the supplied mark, presented at scale and in its original form.`,`The mark shown here is the supplied artwork, kept intact for this presentation.`],
    palette:[`The palette uses the colour values supplied for this project. Supporting tones, where shown, are identified as derived.`,`Each swatch reflects a value provided in the project setup. No official colour names have been inferred.`,`The colours are shown as supplied, with their hex values available for reference.`],
    typography:[`The type specimen references ${p.fontFamily||'the supplied typeface'}. The font file is ${p.fontDataUrl?'available in the project':'not embedded'}, so local availability may vary.`,`The named typeface is ${p.fontFamily||'the supplied font'}. Its appearance depends on whether it is installed or supplied with the project.`,`A specimen of ${p.fontFamily||'the named typeface'}, using the font information provided in setup.`],
    applications:[`These are illustrative identity application concepts built from the supplied assets. They are not presented as completed client deliverables.`,`The compositions below explore possible uses of the identity. They are visual concepts, not evidence of work produced or launched.`,`A small set of browser-built visual concepts shows the identity in context. None are represented as real client applications.`],
    digital:[`The supplied website is linked as a reference only. This tool has not accessed, inspected or reused its content.`,`This section records the website URL provided in setup. No claim is made about its design or authorship.`,`The reference address is included for context. The website itself has not been analyzed.`]
  };
  const list=variants[section.kind]||[`A closer look at ${fact} and the visual elements supplied for this presentation.`,`This section presents the ${section.label.toLowerCase()} using the project information provided.`,`A focused view of the ${section.label.toLowerCase()} for ${fact}.`];
  const next=(section.localVariant||0)%list.length;section.localVariant=next+1;
  return {title:section.title,body:list[next]};
}
async function regenerateSection(id) {
  const section=currentProject.sections.find(s=>s.id===id);if(!section)return;
  const currentTitle=section.title,currentBody=section.body;
  try {
    if(aiAvailable) {
      toast('Requesting a factual copy suggestion…');
      const response=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brandName:currentProject.brandName,clientName:currentProject.clientName,projectType:currentProject.projectType,context:currentProject.context,section:{id:section.id,kind:section.kind,label:section.label,title:section.title,body:section.body}})});
      if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'AI service is unavailable.');
      const data=await response.json();
      if(typeof data.title!=='string'||typeof data.body!=='string'||data.title.length>140||data.body.length>1000)throw new Error('The copy service returned an invalid response.');
      pushHistory();section.title=data.title;section.body=data.body;section.aiGenerated=true;
      scheduleSave();renderStudio();toast('New copy suggestion added. Review it before publishing.');return;
    }
  } catch(error) { toast(`AI suggestion unavailable: ${error.message}. Using a local suggestion instead.`); }
  pushHistory();const suggestion=regenerateLocal(section);section.title=suggestion.title;section.body=suggestion.body;section.aiGenerated=false;
  scheduleSave();renderStudio();toast('Local copy suggestion added using only your supplied project facts.');
}
function undo() {if(!undoStack.length)return;redoStack.push(clone(currentProject.sections));currentProject.sections=undoStack.pop();scheduleSave();renderStudio();}
function redo() {if(!redoStack.length)return;undoStack.push(clone(currentProject.sections));currentProject.sections=redoStack.pop();scheduleSave();renderStudio();}
function openExportModal() {
  modal(`<div class="eyebrow">TAKE THE WORK WITH YOU</div><h2>Export your case study.</h2><p>Choose a self-contained page for the selected direction. Your logo, uploaded images and any permitted font file are embedded in the export.</p><div class="settings-row"><div><strong>Standalone HTML</strong><small>One portable page, ready to host.</small></div><button class="small-button" data-action="export-html">Download HTML</button></div><div class="settings-row"><div><strong>ZIP package</strong><small>A ZIP containing the standalone page.</small></div><button class="small-button" data-action="export-zip">Download ZIP</button></div><div class="settings-row"><div><strong>Save as PDF</strong><small>Opens the browser print dialog.</small></div><button class="small-button" data-action="export-pdf">Print / PDF</button></div><div class="settings-row"><div><strong>Copy page source</strong><small>Copy the full HTML source to your clipboard.</small></div><button class="small-button" data-action="copy-source">Copy HTML</button></div><div class="modal-actions"><button class="outline-button" data-action="close-modal">Close</button></div>`);
}
function modal(inner) {$('#modal-root').innerHTML=`<div class="modal-backdrop" data-action="backdrop-close"><div class="modal" role="dialog" aria-modal="true">${inner}</div></div>`;}
function promptModal(title, description, placeholder='') {
  return new Promise(resolve=>{
    modal(`<h2>${esc(title)}</h2><p>${esc(description)}</p><div class="field"><input id="modal-input" placeholder="${esc(placeholder)}" autocomplete="off"></div><div class="modal-actions"><button class="outline-button" data-action="modal-cancel">Cancel</button><button class="primary-button" data-action="modal-confirm">Continue</button></div>`);
    const input=$('#modal-input');input?.focus();
    const finish=value=>{$('#modal-root').innerHTML='';resolve(value);};
    $('#modal-root').querySelector('[data-action="modal-cancel"]').addEventListener('click',()=>finish(null));
    $('#modal-root').querySelector('[data-action="modal-confirm"]').addEventListener('click',()=>finish(input.value.trim()));
    input?.addEventListener('keydown',e=>{if(e.key==='Enter')finish(input.value.trim());if(e.key==='Escape')finish(null);});
  });
}
function downloadBlob(blob, filename) {const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function exportHtml() {const html=buildPageDocument(currentProject,activeDirection);downloadBlob(new Blob([html],{type:'text/html;charset=utf-8'}),`${slug(currentProject.brandName)}-${activeDirection}.html`);toast('Standalone HTML exported.');$('#modal-root').innerHTML='';}
function slug(name) {return String(name||'case-study').normalize('NFKD').replace(/[^\w-]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'case-study';}
function crc32(bytes) {let crc=~0;for(const byte of bytes){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xEDB88320:0);}return (crc^~0)>>>0;}
function zipSingleFile(filename, data) {
  const enc=new TextEncoder();const name=enc.encode(filename);const bytes=enc.encode(data);const crc=crc32(bytes);const size=bytes.length;
  const local=new Uint8Array(30+name.length+size);const lv=new DataView(local.buffer);let o=0;
  lv.setUint32(o,0x04034b50,true);o+=4;lv.setUint16(o,20,true);o+=2;lv.setUint16(o,0,true);o+=2;lv.setUint16(o,0,true);o+=2;lv.setUint16(o,0,true);o+=2;lv.setUint16(o,0,true);o+=2;lv.setUint32(o,crc,true);o+=4;lv.setUint32(o,size,true);o+=4;lv.setUint32(o,size,true);o+=4;lv.setUint16(o,name.length,true);o+=2;lv.setUint16(o,0,true);o+=2;local.set(name,o);o+=name.length;local.set(bytes,o);
  const central=new Uint8Array(46+name.length);const cv=new DataView(central.buffer);o=0;cv.setUint32(o,0x02014b50,true);o+=4;cv.setUint16(o,20,true);o+=2;cv.setUint16(o,20,true);o+=2;cv.setUint16(o,0,true);o+=2;cv.setUint16(o,0,true);o+=2;cv.setUint16(o,0,true);o+=2;cv.setUint16(o,0,true);o+=2;cv.setUint32(o,crc,true);o+=4;cv.setUint32(o,size,true);o+=4;cv.setUint32(o,size,true);o+=4;cv.setUint16(o,name.length,true);o+=2;cv.setUint16(o,0,true);o+=2;cv.setUint16(o,0,true);o+=2;cv.setUint16(o,0,true);o+=2;cv.setUint16(o,0,true);o+=2;cv.setUint32(o,0,true);o+=4;cv.setUint32(o,0,true);o+=4;central.set(name,o);
  const end=new Uint8Array(22);const ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(4,0,true);ev.setUint16(6,0,true);ev.setUint16(8,1,true);ev.setUint16(10,1,true);ev.setUint32(12,central.length,true);ev.setUint32(16,local.length,true);ev.setUint16(20,0,true);
  return new Blob([local,central,end],{type:'application/zip'});
}
function exportZip() {const html=buildPageDocument(currentProject,activeDirection);downloadBlob(zipSingleFile('index.html',html),`${slug(currentProject.brandName)}-${activeDirection}.zip`);toast('Portable ZIP exported.');$('#modal-root').innerHTML='';}
function printPage() {const html=buildPageDocument(currentProject,activeDirection);const blob=new Blob([html],{type:'text/html'});const url=URL.createObjectURL(blob);const win=window.open(url,'_blank');if(!win){toast('Allow pop-ups to open the print-ready page.',true);URL.revokeObjectURL(url);return;}win.addEventListener('load',()=>{win.focus();win.print();});setTimeout(()=>URL.revokeObjectURL(url),60000);$('#modal-root').innerHTML='';}
async function copySource() {try{await navigator.clipboard.writeText(buildPageDocument(currentProject,activeDirection));toast('HTML source copied to clipboard.');$('#modal-root').innerHTML='';}catch{toast('Clipboard access is unavailable in this browser.',true);}}
function renderSettings() {
  screen='settings';setBreadcrumb([{label:'Workspace'},{label:'Settings & data',strong:true}]);
  view.innerHTML=`<div class="page-heading"><div><div class="eyebrow">PREFERENCES / LOCAL DATA</div><h1>Settings & data.</h1><p>Control what stays in this browser and how your case studies are generated.</p></div></div><div class="settings-panel"><h2>AI copy generation</h2><p>${aiAvailable?'An AI provider is configured on this deployment. Copy suggestions can be generated through the server-side API.':'No AI provider is configured. The studio uses clearly labelled local copy suggestions based only on your supplied project details.'}</p><div class="settings-row"><div><strong>Generation mode</strong><small>${aiAvailable?'Server-side AI · API key is not exposed to the browser':'Local deterministic suggestions · no API calls'}</small></div><span class="badge-status">${aiAvailable?'CONNECTED':'LOCAL MODE'}</span></div><div class="section-kicker">DATA & PRIVACY</div><div class="settings-row"><div><strong>Local project data</strong><small>${projects.length} saved project${projects.length===1?'':'s'} in this browser.</small></div><button class="outline-button" data-action="export-backup">Export backup</button></div><div class="settings-row"><div><strong>Delete all local projects</strong><small>This permanently removes projects and uploaded assets from this browser.</small></div><button class="danger-button" data-action="reset-data">Delete all</button></div><div class="section-kicker">ABOUT THE STUDIO</div><p>Case Study Studio creates editable editorial presentations. It does not publish or host your projects, scrape brand websites, or claim that generated visual concepts were delivered client work.</p></div>`;
}
function bindGlobalEvents() {
  root.addEventListener('click', async event=>{
    const target=event.target.closest('[data-action],[data-direction],[data-viewport],[data-select-section],[data-editor-tab],[data-field],[data-color-index],[data-nav],.brand-lockup');if(!target)return;
    if(target.matches('.brand-lockup')){event.preventDefault();showProjects();return;}
    if(target.dataset.nav==='projects'){showProjects();return;}
    const action=target.dataset.action;
    if(target.dataset.direction){activeDirection=target.dataset.direction;currentProject.direction=activeDirection;scheduleSave();renderStudio();return;}
    if(target.dataset.viewport){viewport=target.dataset.viewport;renderStudio();return;}
    if(target.dataset.editorTab){editorTab=target.dataset.editorTab;renderStudio();return;}
    if(action==='new-project'){startProject();return;}
    if(action==='open-project'){if(target.closest('.project-card-actions'))return;openProject(target.dataset.id);return;}
    if(action==='brand-type'){currentProject.brandType=target.dataset.value;renderSetup();scheduleSave();return;}
    if(action==='continue-context'){if(!currentProject.svgText){toast('Upload a valid logo or app icon SVG first.',true);$('#svg-file')?.click();return;}if(!currentProject.brandName.trim()){toast('Add a brand name first.',true);$('#brand-name')?.focus();return;}if(!currentProject.clientName.trim()&&!currentProject.sameClient){toast('Add a client or company name first.',true);$('#client-name')?.focus();return;}if(!currentProject.fontFamily.trim()){toast('Add your typeface name first.',true);$('#font-family')?.focus();return;}if(!currentProject.colors.length){toast('Add at least one brand colour.',true);return;}setupStep=2;renderSetup();return;}
    if(action==='back-setup'){setupStep=1;renderSetup();return;}
    if(action==='generate-studio'){enterStudio();return;}
    if(action==='replace-svg'){$('#svg-file')?.click();return;}
    if(action==='remove-svg'){currentProject.svgText='';currentProject.svgOriginalText='';currentProject.svgName='';scheduleSave();renderSetup();return;}
    if(action==='download-original-svg'){if(!currentProject.svgOriginalText){toast('No original SVG is available.',true);return;}downloadBlob(new Blob([currentProject.svgOriginalText],{type:'image/svg+xml'}),currentProject.svgName||'original-logo.svg');toast('Original SVG downloaded.');return;}
    if(action==='remove-font'){currentProject.fontDataUrl='';currentProject.fontFileName='';currentProject.fontLicense=false;scheduleSave();renderSetup();return;}
    if(action==='add-color'){if(currentProject.colors.length>=12){toast('Up to 12 colors are supported.');return;}currentProject.colors.push({name:currentProject.colors.length===0?'Primary':'New colour',hex:'#20211F'});renderSetup();scheduleSave();return;}
    if(action==='remove-color'){currentProject.colors.splice(Number(target.dataset.index),1);renderSetup();scheduleSave();return;}
    if(action==='remove-image'){currentProject.images.splice(Number(target.dataset.index),1);scheduleSave();renderSetup();return;}
    if(action==='remove-project-image'){currentProject.images=currentProject.images.filter(i=>i.id!==target.dataset.id);scheduleSave();renderStudio();return;}
    if(action==='replace-project-image'){const image=currentProject.images.find(item=>item.id===target.dataset.id);if(!image)return;const picker=document.createElement('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp,image/gif';picker.addEventListener('change',async()=>{const file=picker.files?.[0];if(!file)return;if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>8*1024*1024){toast('Choose a PNG, JPG, WEBP or GIF under 8 MB.',true);return;}image.dataUrl=await fileToDataUrl(file);image.name=file.name;if(!image.alt)image.alt=file.name.replace(/\.[^.]+$/,'');scheduleSave();renderStudio();toast('Project image replaced.');});picker.click();return;}
    if(action==='settings'){renderSettings();return;}
    if(action==='edit-brand-assets'){setupStep=1;screen='builder';renderSetup();return;}
    if(action==='export-menu'){openExportModal();return;}
    if(action==='export-html'){exportHtml();return;}
    if(action==='export-zip'){exportZip();return;}
    if(action==='export-pdf'){printPage();return;}
    if(action==='copy-source'){await copySource();return;}
    if(action==='close-modal'||action==='modal-cancel'){ $('#modal-root').innerHTML='';return; }
    if(action==='backdrop-close'&&event.target===target){$('#modal-root').innerHTML='';return;}
    if(action==='toggle-visitor'){visitorMode=!visitorMode;const panel=$('.editor-panel');if(panel)panel.style.display=visitorMode?'none':'';const layout=$('.studio-layout');if(layout)layout.style.gridTemplateColumns=visitorMode?'minmax(0,1fr)':'';const button=$('[data-action="toggle-visitor"]',view);if(button)button.textContent=visitorMode?'Show editor':'Visitor view';return;}
    if(action==='refresh-preview'){renderPreview();return;}
    if(action==='regenerate-direction'){currentProject.directionRevision=currentProject.directionRevision||{editorial:0,immersive:0};currentProject.directionRevision[activeDirection]=(currentProject.directionRevision[activeDirection]||0)+1;scheduleSave();renderPreview();toast(`${DIRECTIONS[activeDirection].label} composition refreshed. The other direction is unchanged.`);return;}
    if(action==='undo-sections'){undo();return;}
    if(action==='redo-sections'){redo();return;}
    if(action==='hide-selected'){const s=currentProject.sections.find(s=>s.id===selectedSection);if(s){pushHistory();s.visible=!s.visible;scheduleSave();renderStudio();}return;}
    if(action==='toggle-section'){const s=currentProject.sections.find(s=>s.id===target.dataset.id);if(s){pushHistory();s.visible=!s.visible;scheduleSave();renderStudio();}return;}
    if(action==='move-section'){moveSection(target.dataset.id,target.dataset.dir);return;}
    if(action==='remove-section'){const s=currentProject.sections.find(s=>s.id===target.dataset.id);if(!s||['opening','closing'].includes(s.id)){toast('The opening and closing sections cannot be removed.');return;}pushHistory();currentProject.sections=currentProject.sections.filter(section=>section.id!==s.id);selectedSection=currentProject.sections[0]?.id; scheduleSave();renderStudio();return;}
    if(action==='add-section'){createNewSection();return;}
    if(action==='regenerate-section'){regenerateSection(target.dataset.id);return;}
    if(action==='rename-project'){const p=projects.find(p=>p.id===target.dataset.id);if(!p)return;const next=await promptModal('Rename project','Give this project a name for your workspace.',p.title||p.brandName);if(next){p.title=next;if(currentProject?.id===p.id)currentProject=p;try{await dbPut(p);}catch{localStorage.setItem('case-study-studio-projects',JSON.stringify(projects));}renderProjects();toast('Project renamed.');}return;}
    if(action==='duplicate-project'){const p=projects.find(p=>p.id===target.dataset.id);if(!p)return;const copy=clone(p);copy.id=uid();copy.title=`${p.title||p.brandName} copy`;copy.createdAt=new Date().toISOString();copy.updatedAt=copy.createdAt;projects.unshift(copy);try{await dbPut(copy);}catch{localStorage.setItem('case-study-studio-projects',JSON.stringify(projects));}renderProjects();$('#project-count').textContent=String(projects.length);toast('Project duplicated.');return;}
    if(action==='delete-project'){const p=projects.find(p=>p.id===target.dataset.id);if(!p)return;modal(`<h2>Delete this project?</h2><p><strong>${esc(p.brandName||p.title)}</strong> and its locally stored assets will be permanently removed from this browser.</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="confirm-delete" data-id="${esc(p.id)}">Delete project</button></div>`);return;}
    if(action==='confirm-delete'){const id=target.dataset.id;projects=projects.filter(p=>p.id!==id);try{await dbDelete(id);}catch{localStorage.setItem('case-study-studio-projects',JSON.stringify(projects));}$('#modal-root').innerHTML='';if(currentProject?.id===id)currentProject=null;showProjects();toast('Project deleted.');return;}
    if(action==='export-backup'){const data=JSON.stringify({exportedAt:new Date().toISOString(),projects},null,2);downloadBlob(new Blob([data],{type:'application/json'}),'case-study-studio-backup.json');toast('Local project backup exported.');return;}
    if(action==='reset-data'){modal(`<h2>Delete all local projects?</h2><p>This cannot be undone. Export a backup first if you need to keep your case studies.</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">Cancel</button><button class="primary-button" data-action="confirm-reset">Delete all projects</button></div>`);return;}
    if(action==='confirm-reset'){projects=[];currentProject=null;try{const database=await openDB();const tx=database.transaction('projects','readwrite');tx.objectStore('projects').clear();await new Promise(resolve=>tx.oncomplete=resolve);}catch{localStorage.removeItem('case-study-studio-projects');}$('#modal-root').innerHTML='';showProjects();toast('All local projects were deleted.');return;}
  });
  view.addEventListener('keydown',event=>{const card=event.target.closest('.project-card');if(card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openProject(card.dataset.id);}});
  document.addEventListener('keydown',event=>{const isTyping=event.target?.matches?.('input,textarea,select,[contenteditable="true"]');if(!isTyping&&(event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();if(screen==='studio')event.shiftKey?redo():undo();}if(event.key==='Escape'){const cancel=$('#modal-root [data-action="modal-cancel"]');if(cancel)cancel.click();else $('#modal-root').innerHTML='';}});
  $('#modal-root').addEventListener('click', async event=>{
    const button=event.target.closest('[data-action]'); if(!button)return; const action=button.dataset.action;
    if(action==='close-modal'||action==='modal-cancel'){ $('#modal-root').innerHTML=''; return; }
    if(action==='backdrop-close'&&event.target===button){ $('#modal-root').innerHTML=''; return; }
    if(action==='export-html'){ exportHtml(); return; }
    if(action==='export-zip'){ exportZip(); return; }
    if(action==='export-pdf'){ printPage(); return; }
    if(action==='copy-source'){ await copySource(); return; }
    if(action==='confirm-delete'){ const id=button.dataset.id; projects=projects.filter(p=>p.id!==id); try{await dbDelete(id);}catch{localStorage.setItem('case-study-studio-projects',JSON.stringify(projects));} $('#modal-root').innerHTML=''; if(currentProject?.id===id)currentProject=null; showProjects(); toast('Project deleted.'); return; }
    if(action==='confirm-reset'){ projects=[];currentProject=null;try{const database=await openDB();const tx=database.transaction('projects','readwrite');tx.objectStore('projects').clear();await new Promise(resolve=>tx.oncomplete=resolve);}catch{localStorage.removeItem('case-study-studio-projects');} $('#modal-root').innerHTML='';showProjects();toast('All local projects were deleted.');return; }
  });
}
async function checkAIStatus() {try{const response=await fetch('/api/status',{headers:{'Accept':'application/json'}});if(response.ok){const data=await response.json();aiAvailable=!!data.configured;}}catch{aiAvailable=false;}}
async function init() {
  await loadProjects();bindGlobalEvents();showProjects();
  checkAIStatus().then(()=>{if(screen==='settings')renderSettings();});
  $('#project-count').textContent=String(projects.length);
}
init();