const PALETTE = ['#FF6B6B', '#4ECDC4', '#6BCB77', '#FFD93D', '#9B59B6', '#FF8C42', '#FF6B8A', '#45B7D1'];
const NODE_W = 180;
const NODE_H = 70;
const ROOT_W = 220;
const ROOT_H = 90;
const MAX_TEXT = 120;
const MAX_TITLE = 80;
const AUTO_SAVE_MS = 3000;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const state = {
  map: { id: null, title: 'Nova Pesquisa', nodes: [], createdAt: '', updatedAt: '' },
  selectedNode: null,
  dragging: null,
  panning: false,
  panStartX: 0,
  panStartY: 0,
  panViewX: 0,
  panViewY: 0,
  viewX: 0,
  viewY: 0,
  zoom: 1,
  autoSaveTimer: null,
  dirty: false,
  colorIdx: 0
};

const canvas = $('#canvas');
const svgLayer = $('#svgLayer');
const nodesLayer = $('#nodesLayer');
const statusEl = $('#status');
const titleEl = $('#mapTitle');
const shareUrl = $('#shareUrl');
const canvasWrapper = $('#canvasWrapper');

function nextColor() {
  const color = PALETTE[state.colorIdx % PALETTE.length];
  state.colorIdx += 1;
  return color;
}

function uid() {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function shortId() {
  return Math.random().toString(36).substring(2, 8);
}

function getRoot() {
  return state.map.nodes.find((node) => node.parentId === null) ?? null;
}

function getChildren(parentId) {
  return state.map.nodes.filter((node) => node.parentId === parentId);
}

function nodeRect(node) {
  const isRoot = node.parentId === null;
  const w = isRoot ? ROOT_W : NODE_W;
  const h = isRoot ? ROOT_H : NODE_H;
  return { x: node.x, y: node.y, w, h, cx: node.x + w / 2, cy: node.y + h / 2 };
}

function edgePoints(from, to) {
  const fr = nodeRect(from);
  const tr = nodeRect(to);
  const dx = tr.cx - fr.cx;
  const dy = tr.cy - fr.cy;
  const dist = Math.hypot(dx, dy) || 1;
  const ndx = dx / dist;
  const ndy = dy / dist;

  let ex1;
  let ey1;
  let ex2;
  let ey2;

  if (Math.abs(ndx) > Math.abs(ndy)) {
    ex1 = ndx > 0 ? fr.x + fr.w : fr.x;
    ey1 = fr.cy + ndy * (fr.h / 2) * (Math.abs(ndx) > 0.5 ? 0.5 : 1);
    ex2 = ndx > 0 ? tr.x : tr.x + tr.w;
    ey2 = tr.cy - ndy * (tr.h / 2) * (Math.abs(ndx) > 0.5 ? 0.5 : 1);
  } else {
    ex1 = fr.cx + ndx * (fr.w / 2) * (Math.abs(ndy) > 0.5 ? 0.5 : 1);
    ey1 = ndy > 0 ? fr.y + fr.h : fr.y;
    ex2 = tr.cx - ndx * (tr.w / 2) * (Math.abs(ndy) > 0.5 ? 0.5 : 1);
    ey2 = ndy > 0 ? tr.y : tr.y + tr.h;
  }

  return { x1: ex1, y1: ey1, x2: ex2, y2: ey2, color: from.color };
}

function updateTransform() {
  canvas.style.transform = `translate(${state.viewX}px, ${state.viewY}px) scale(${state.zoom})`;
}

function renderLines() {
  svgLayer.innerHTML = '';
  for (const node of state.map.nodes) {
    if (node.parentId === null) continue;
    const parent = state.map.nodes.find((item) => item.id === node.parentId);
    if (!parent) continue;

    const ep = edgePoints(parent, node);
    const mx = (ep.x1 + ep.x2) / 2;
    const my = (ep.y1 + ep.y2) / 2;
    const d = `M${ep.x1},${ep.y1} Q${mx},${ep.y1} ${mx},${my} Q${mx},${ep.y2} ${ep.x2},${ep.y2}`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', ep.color);
    path.setAttribute('stroke-width', '3');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('opacity', '0.7');
    svgLayer.appendChild(path);
  }
}

function setStatus(text, className = '') {
  statusEl.textContent = text;
  statusEl.className = className;
}

function updateTitleDisplay() {
  titleEl.textContent = state.map.title || 'Nova Pesquisa';
  titleEl.setAttribute('aria-label', `Título da pesquisa: ${state.map.title || 'Nova Pesquisa'}`);
}

function syncRootWithTitle() {
  const root = getRoot();
  if (root && state.map.title && state.map.title !== 'Nova Pesquisa') {
    root.text = state.map.title;
  }
}

function createNodeEl(node) {
  const isRoot = node.parentId === null;
  const w = isRoot ? ROOT_W : NODE_W;
  const h = isRoot ? ROOT_H : NODE_H;

  const el = document.createElement('div');
  el.className = `node${isRoot ? ' root' : ''}`;
  el.dataset.id = node.id;
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.borderColor = node.color;
  el.style.backgroundColor = `${node.color}20`;

  const textEl = document.createElement('span');
  textEl.className = 'node-text';
  textEl.title = 'Clique duas vezes para editar';
  textEl.textContent = node.text || '?';
  el.appendChild(textEl);

  const btns = document.createElement('div');
  btns.className = 'node-btns';

  const addBtn = document.createElement('button');
  addBtn.className = 'node-btn add-btn';
  addBtn.type = 'button';
  addBtn.title = 'Adicionar sub-tópico';
  addBtn.setAttribute('aria-label', 'Adicionar sub-tópico');
  addBtn.textContent = '+';
  addBtn.addEventListener('pointerdown', (event) => event.stopPropagation());
  addBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    addChildNode(node.id);
  });
  btns.appendChild(addBtn);

  if (!isRoot) {
    const delBtn = document.createElement('button');
    delBtn.className = 'node-btn del-btn';
    delBtn.type = 'button';
    delBtn.title = 'Remover este tópico';
    delBtn.setAttribute('aria-label', 'Remover tópico');
    delBtn.textContent = '×';
    delBtn.addEventListener('pointerdown', (event) => event.stopPropagation());
    delBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (confirm(`Tem certeza que quer apagar "${node.text || 'este tópico'}"?`)) {
        deleteNode(node.id);
      }
    });
    btns.appendChild(delBtn);
  }

  el.appendChild(btns);

  el.addEventListener('dblclick', (event) => {
    event.stopPropagation();
    if (event.target.closest('.node-btn')) return;
    openEditor(node);
  });

  el.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.node-btn')) return;
    if (event.button !== 0) return;
    event.preventDefault();

    const canvasX = (event.clientX - state.viewX) / state.zoom;
    const canvasY = (event.clientY - state.viewY) / state.zoom;
    state.dragging = {
      node,
      el,
      startCanvasX: canvasX,
      startCanvasY: canvasY,
      startNodeX: node.x,
      startNodeY: node.y
    };
    el.setPointerCapture(event.pointerId);
    state.selectedNode = node.id;
    highlightSelected();
  });

  el.addEventListener('pointermove', (event) => {
    if (!state.dragging || state.dragging.node.id !== node.id) return;
    const canvasX = (event.clientX - state.viewX) / state.zoom;
    const canvasY = (event.clientY - state.viewY) / state.zoom;
    const dx = canvasX - state.dragging.startCanvasX;
    const dy = canvasY - state.dragging.startCanvasY;
    node.x = Math.max(0, state.dragging.startNodeX + dx);
    node.y = Math.max(0, state.dragging.startNodeY + dy);
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    renderLines();
    markDirty();
  });

  const endDrag = () => {
    state.dragging = null;
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  return el;
}

function highlightSelected() {
  $$('.node').forEach((el) => {
    el.classList.toggle('selected', el.dataset.id === state.selectedNode);
  });
}

function renderNodes() {
  nodesLayer.innerHTML = '';
  for (const node of state.map.nodes) {
    nodesLayer.appendChild(createNodeEl(node));
  }
  renderLines();
  updateCanvasSize();
}

function addChildNode(parentId) {
  const parent = state.map.nodes.find((node) => node.id === parentId);
  if (!parent) return;

  const isRootParent = parent.parentId === null;
  const offsetX = (isRootParent ? ROOT_W : NODE_W) + 60 + Math.random() * 60;
  const offsetY = (state.colorIdx % 2 === 0 ? -60 : 60) + Math.random() * 40 - 20;
  const node = {
    id: uid(),
    text: 'Nova ideia',
    x: Math.max(0, parent.x + offsetX),
    y: Math.max(0, parent.y + offsetY),
    color: nextColor(),
    parentId
  };

  state.map.nodes.push(node);
  state.selectedNode = node.id;
  renderNodes();
  highlightSelected();
  markDirty();
  openEditor(node);
}

function deleteNode(nodeId) {
  const toDelete = new Set([nodeId]);
  const collect = (id) => {
    getChildren(id).forEach((child) => {
      toDelete.add(child.id);
      collect(child.id);
    });
  };
  collect(nodeId);

  state.map.nodes = state.map.nodes.filter((node) => !toDelete.has(node.id));
  if (state.selectedNode && toDelete.has(state.selectedNode)) {
    state.selectedNode = null;
  }
  renderNodes();
  markDirty();
}

function openEditor(node) {
  const input = $('#editInput');
  input.value = node.text;
  $('#editModal').style.display = 'flex';
  input.focus();
  input.select();

  const save = () => saveEdit(node, input);
  const cancel = () => closeModal('#editModal');

  input.onkeydown = (event) => {
    if (event.key === 'Enter') save();
    if (event.key === 'Escape') cancel();
  };
  $('#editSave').onclick = save;
  $('#editCancel').onclick = cancel;
}

function saveEdit(node, input) {
  node.text = input.value.trim().slice(0, MAX_TEXT) || '?';
  if (node.parentId === null) {
    state.map.title = node.text;
    updateTitleDisplay();
  }
  closeModal('#editModal');
  renderNodes();
  markDirty();
}

function openTitleEditor() {
  const input = $('#titleInput');
  input.value = state.map.title === 'Nova Pesquisa' ? '' : state.map.title;
  $('#titleModal').style.display = 'flex';
  input.focus();
  input.select();

  const save = () => {
    const title = input.value.trim().slice(0, MAX_TITLE) || 'Nova Pesquisa';
    state.map.title = title;
    updateTitleDisplay();
    syncRootWithTitle();
    closeModal('#titleModal');
    renderNodes();
    markDirty();
  };
  const cancel = () => closeModal('#titleModal');

  input.onkeydown = (event) => {
    if (event.key === 'Enter') save();
    if (event.key === 'Escape') cancel();
  };
  $('#titleSave').onclick = save;
  $('#titleCancel').onclick = cancel;
}

function openHelp() {
  $('#helpModal').style.display = 'flex';
}

function closeModal(selector) {
  $(selector).style.display = 'none';
}

function markDirty() {
  state.dirty = true;
  setStatus('Não salvo', 'dirty');
  clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer = setTimeout(autoSave, AUTO_SAVE_MS);
}

async function autoSave() {
  if (!state.dirty || state.map.nodes.length === 0) return;
  await saveToServer(!state.map.id);
}

async function saveToServer(isNew = false) {
  try {
    state.map.updatedAt = new Date().toISOString();
    if (isNew || !state.map.id) {
      state.map.id = shortId();
      state.map.createdAt = new Date().toISOString();
    }

    const response = await fetch(`/api/maps/${state.map.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.map)
    });

    if (response.ok) {
      state.dirty = false;
      setStatus('Salvo!', 'saved');
      updateShareUrl();
      history.replaceState(null, '', `?map=${state.map.id}`);
      setTimeout(() => {
        if (!state.dirty) setStatus('');
      }, 2500);
      return true;
    }

    const error = await response.json().catch(() => ({}));
    setStatus(error.error || 'Erro ao salvar', 'dirty');
    return false;
  } catch {
    setStatus('Sem conexão', 'dirty');
    return false;
  }
}

async function loadFromServer(id) {
  try {
    setStatus('Carregando...');
    const response = await fetch(`/api/maps/${id}`);
    if (!response.ok) throw new Error('Não encontrado');

    state.map = await response.json();
    state.dirty = false;
    state.colorIdx = state.map.nodes.length;
    updateTitleDisplay();
    setStatus('Pronto!', 'saved');
    updateShareUrl();
    history.replaceState(null, '', `?map=${state.map.id}`);
    renderNodes();
    centerOnRoot();
    setTimeout(() => {
      if (!state.dirty) setStatus('');
    }, 2500);
    return true;
  } catch {
    setStatus('Mapa não encontrado', 'dirty');
    return false;
  }
}

function updateShareUrl() {
  if (state.map.id) {
    shareUrl.value = `${location.origin}${location.pathname}?map=${state.map.id}`;
    $('#shareSection').style.display = 'flex';
  }
}

function centerOnRoot() {
  const root = getRoot();
  if (!root) return;
  const rect = nodeRect(root);
  const cw = canvasWrapper.clientWidth;
  const ch = canvasWrapper.clientHeight;
  state.viewX = cw / 2 - rect.cx * state.zoom;
  state.viewY = ch / 2 - rect.cy * state.zoom;
  updateTransform();
}

function createDefaultRoot() {
  return {
    id: uid(),
    text: 'Meu Tema',
    x: 500,
    y: 350,
    color: nextColor(),
    parentId: null
  };
}

function newMap() {
  if (state.dirty && !confirm('Você tem alterações não salvas. Criar um novo mapa mesmo assim?')) {
    return;
  }

  state.map = { id: null, title: 'Nova Pesquisa', nodes: [], createdAt: '', updatedAt: '' };
  state.colorIdx = 0;
  state.dirty = false;
  state.selectedNode = null;
  updateTitleDisplay();
  setStatus('');
  shareUrl.value = '';
  $('#shareSection').style.display = 'none';
  history.replaceState(null, '', location.pathname);
  state.viewX = 0;
  state.viewY = 0;
  state.zoom = 1;
  updateTransform();
  state.map.nodes.push(createDefaultRoot());
  renderNodes();
  centerOnRoot();
}

function initMap() {
  state.map.nodes.push(createDefaultRoot());
  renderNodes();
  centerOnRoot();
}

function updateCanvasSize() {
  let maxX = 1200;
  let maxY = 800;
  for (const node of state.map.nodes) {
    const rect = nodeRect(node);
    if (rect.x + rect.w + 300 > maxX) maxX = rect.x + rect.w + 300;
    if (rect.y + rect.h + 300 > maxY) maxY = rect.y + rect.h + 300;
  }
  canvas.style.width = `${maxX}px`;
  canvas.style.height = `${maxY}px`;
  svgLayer.setAttribute('width', maxX);
  svgLayer.setAttribute('height', maxY);
  svgLayer.setAttribute('viewBox', `0 0 ${maxX} ${maxY}`);
}

function downloadJSON() {
  state.map.updatedAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify(state.map, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${(state.map.title || 'mapa-mental').replace(/[^a-zA-Z0-9\-_]/g, '_')}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  setStatus('Arquivo baixado!', 'saved');
  setTimeout(() => {
    if (!state.dirty) setStatus('');
  }, 2000);
}

function uploadJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.nodes) || data.nodes.length === 0) {
        throw new Error('Inválido');
      }
      if (state.dirty && !confirm('Você tem alterações não salvas. Carregar este arquivo mesmo assim?')) {
        return;
      }

      state.map = {
        id: data.id || null,
        title: data.title || 'Mapa Mental',
        nodes: data.nodes,
        createdAt: data.createdAt || '',
        updatedAt: data.updatedAt || ''
      };
      state.dirty = true;
      state.colorIdx = state.map.nodes.length;
      state.selectedNode = null;
      updateTitleDisplay();
      state.viewX = 0;
      state.viewY = 0;
      state.zoom = 1;
      updateTransform();
      renderNodes();
      centerOnRoot();
      markDirty();
      setStatus('Arquivo carregado! Salve na nuvem para não perder.', 'saved');
    } catch {
      alert('Arquivo inválido! Escolha um arquivo JSON de mapa mental.');
    }
  };
  input.click();
}

function applyZoom(delta, anchorX, anchorY) {
  const canvasX = (anchorX - state.viewX) / state.zoom;
  const canvasY = (anchorY - state.viewY) / state.zoom;
  const newZoom = Math.max(0.25, Math.min(2.5, state.zoom + delta));
  state.viewX = anchorX - canvasX * newZoom;
  state.viewY = anchorY - canvasY * newZoom;
  state.zoom = newZoom;
  updateTransform();
}

function setupCanvasPan() {
  canvasWrapper.addEventListener('pointerdown', (event) => {
    if (event.target !== canvas && event.target !== svgLayer && event.target !== nodesLayer) return;
    if (event.button !== 0) return;
    state.panning = true;
    state.panStartX = event.clientX;
    state.panStartY = event.clientY;
    state.panViewX = state.viewX;
    state.panViewY = state.viewY;
    canvasWrapper.setPointerCapture(event.pointerId);
    canvasWrapper.style.cursor = 'grabbing';
  });

  canvasWrapper.addEventListener('pointermove', (event) => {
    if (!state.panning) return;
    state.viewX = state.panViewX + (event.clientX - state.panStartX);
    state.viewY = state.panViewY + (event.clientY - state.panStartY);
    updateTransform();
  });

  const endPan = () => {
    state.panning = false;
    canvasWrapper.style.cursor = 'grab';
  };
  canvasWrapper.addEventListener('pointerup', endPan);
  canvasWrapper.addEventListener('pointercancel', endPan);
  canvasWrapper.addEventListener('pointerleave', endPan);

  canvasWrapper.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = canvasWrapper.getBoundingClientRect();
      applyZoom(event.deltaY > 0 ? -0.08 : 0.08, event.clientX - rect.left, event.clientY - rect.top);
    },
    { passive: false }
  );
}

function setupToolbar() {
  $('#btnHelp').addEventListener('click', openHelp);
  $('#btnNew').addEventListener('click', newMap);
  $('#btnSave').addEventListener('click', () => saveToServer(!state.map.id));
  $('#btnDownload').addEventListener('click', downloadJSON);
  $('#btnUpload').addEventListener('click', uploadJSON);
  $('#mapTitle').addEventListener('click', openTitleEditor);

  $('#btnCopyLink').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl.value);
    } catch {
      shareUrl.select();
      document.execCommand('copy');
    }
    setStatus('Link copiado!', 'saved');
    setTimeout(() => {
      if (!state.dirty) setStatus('');
    }, 2000);
  });

  $('#zoomIn').addEventListener('click', () => {
    applyZoom(0.2, canvasWrapper.clientWidth / 2, canvasWrapper.clientHeight / 2);
  });

  $('#zoomOut').addEventListener('click', () => {
    applyZoom(-0.2, canvasWrapper.clientWidth / 2, canvasWrapper.clientHeight / 2);
  });

  $('#zoomReset').addEventListener('click', () => {
    state.zoom = 1;
    centerOnRoot();
  });

  for (const modal of ['#editModal', '#titleModal', '#helpModal']) {
    $(modal).addEventListener('click', (event) => {
      if (event.target === $(modal)) closeModal(modal);
    });
  }

  $('#helpClose').addEventListener('click', () => closeModal('#helpModal'));
}

async function init() {
  setupCanvasPan();
  setupToolbar();
  updateTitleDisplay();

  const mapId = new URLSearchParams(location.search).get('map');
  if (mapId) {
    const loaded = await loadFromServer(mapId);
    if (!loaded) initMap();
  } else {
    initMap();
  }
}

document.addEventListener('DOMContentLoaded', init);
