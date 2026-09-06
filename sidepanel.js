// sidepanel.js - Side Panel UI

let currentItems = [];
let currentTabId = null;
let tooltipTimeout = null;
let modalItem = null;

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  requestScan(null);
});

// Notify background when panel is closed
window.addEventListener('pagehide', () => {
  if (currentTabId) {
    chrome.runtime.sendMessage({ action: 'PANEL_CLOSED', tabId: currentTabId });
  }
});

function initUI() {
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn.addEventListener('click', () => {
    requestScan(null);
  });
  refreshBtn.dataset.tooltip = chrome.i18n.getMessage('refresh') || 'Refresh';
  refreshBtn.addEventListener('mouseenter', (e) => {
    showTooltip(e.currentTarget, e.currentTarget.dataset.tooltip);
  });
  refreshBtn.addEventListener('mouseleave', hideTooltip);

  // Modal close handlers
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalOverlay')) {
      closeModal();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  });

  // Modal action buttons with tooltips
  const modalCopyBtn = document.getElementById('modalCopyBtn');
  modalCopyBtn.dataset.tooltip = chrome.i18n.getMessage('copySvg') || 'Copy SVG';
  modalCopyBtn.addEventListener('click', () => {
    if (modalItem) {
      copyCode(modalItem);
    }
  });
  modalCopyBtn.addEventListener('mouseenter', (e) => {
    showTooltip(e.currentTarget, e.currentTarget.dataset.tooltip);
  });
  modalCopyBtn.addEventListener('mouseleave', hideTooltip);

  const modalSaveBtn = document.getElementById('modalSaveBtn');
  modalSaveBtn.dataset.tooltip = chrome.i18n.getMessage('downloadSvg') || 'Save SVG';
  modalSaveBtn.addEventListener('click', () => {
    if (modalItem) {
      saveFile(modalItem);
    }
  });
  modalSaveBtn.addEventListener('mouseenter', (e) => {
    showTooltip(e.currentTarget, e.currentTarget.dataset.tooltip);
  });
  modalSaveBtn.addEventListener('mouseleave', hideTooltip);
}

function openModal(item) {
  modalItem = item;
  const overlay = document.getElementById('modalOverlay');
  const preview = document.getElementById('modalPreview');
  const typeEl = document.getElementById('modalType');
  const dimsEl = document.getElementById('modalDimensions');
  const idEl = document.getElementById('modalId');

  // Preview
  if (item.previewDataUrl) {
    preview.src = item.previewDataUrl;
    preview.style.display = 'block';
    if (item.colorMode === 'single-color') {
      preview.classList.add('svg-single-color');
    } else {
      preview.classList.remove('svg-single-color');
    }
    const scaled = getScaledSize(item);
    preview.style.width = scaled.width + 'px';
    preview.style.height = scaled.height + 'px';
  } else {
    preview.style.display = 'none';
  }

  // Type
  typeEl.textContent = formatType(item.type);

  // Dimensions (only if both exist) + size + duplicates
  let dims = '';
  if (item.width !== null && item.height !== null && item.width !== '' && item.height !== '') {
    dims += item.width + ', ' + item.height;
  }
  if (item.sizeBytes) {
    if (dims) dims += ' · ';
    dims += formatSize(item.sizeBytes);
  }
  if (item.duplicateCount && item.duplicateCount > 1) {
    if (dims) dims += ' · ';
    dims += '×' + item.duplicateCount + ' duplicates';
  }
  dimsEl.textContent = dims || '—';

  // ID
  idEl.textContent = item.id || '—';

  overlay.classList.add('active');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  modalItem = null;
}

function requestScan(tabId) {
  if (!tabId) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        const tab = tabs[0];
        currentTabId = tab.id;
        if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
          showErrorState();
          return;
        }
        doScan(tab.id);
      } else {
        showErrorState();
      }
    });
    return;
  }
  doScan(tabId);
}

function doScan(tabId) {
  showLoading();
  chrome.runtime.sendMessage({ action: 'SCAN_REQUEST', tabId: tabId }, (response) => {
    if (chrome.runtime.lastError) {
      hideLoading();
      showErrorState();
      return;
    }
    if (response && response.error) {
      hideLoading();
      if (response.error.includes('cannot access') || response.error.includes('chrome://') || response.error.includes('Cannot access')) {
        showErrorState();
      } else {
        showEmptyState();
      }
      return;
    }
    if (response && response.items) {
      currentItems = response.items;
      hideLoading();
      renderList(currentItems);
      updateCount(currentItems.length);
      if (currentItems.length === 0) {
        showEmptyState();
      }
    } else {
      hideLoading();
      showEmptyState();
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'SCAN_RESULT') {
    if (message.items) {
      currentItems = message.items;
      hideLoading();
      renderList(currentItems);
      updateCount(currentItems.length);
      if (currentItems.length === 0) {
        showEmptyState();
      }
    }
  }
});

function renderList(items) {
  const container = document.getElementById('svgList');
  const emptyState = document.getElementById('emptyState');
  container.innerHTML = '';

  if (items.length === 0) {
    container.style.display = 'none';
    emptyState.style.display = 'block';
    emptyState.textContent = 'No SVG found on this page';
    return;
  }

  container.style.display = 'block';
  emptyState.style.display = 'none';

  for (const item of items) {
    const card = createCard(item);
    container.appendChild(card);
  }
}

function createCard(item) {
  const card = document.createElement('div');
  card.className = 'svg-card';
  card.dataset.id = item.id;

  const preview = document.createElement('div');
  preview.className = 'svg-preview';
  if (item.previewDataUrl) {
    const img = document.createElement('img');
    img.src = item.previewDataUrl;
    img.alt = 'SVG preview';
    img.loading = 'lazy';
    if (item.colorMode === 'single-color') {
      img.classList.add('svg-single-color');
    }
    preview.appendChild(img);
    preview.addEventListener('click', () => {
      openModal(item);
    });
  } else if (item.resolveError) {
    const placeholder = document.createElement('div');
    placeholder.className = 'svg-placeholder-error';
    placeholder.textContent = '⚠ ' + item.resolveError;
    preview.appendChild(placeholder);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'svg-placeholder';
    placeholder.textContent = 'No preview';
    preview.appendChild(placeholder);
  }
  card.appendChild(preview);

  const info = document.createElement('div');
  info.className = 'svg-info';

  // Row 1: type + count badge
  const row1 = document.createElement('div');
  row1.className = 'svg-info-row';

  const typeLabel = document.createElement('span');
  typeLabel.className = 'svg-type';
  typeLabel.textContent = formatType(item.type);
  row1.appendChild(typeLabel);

  if (item.duplicateCount && item.duplicateCount > 1) {
    const countBadge = document.createElement('span');
    countBadge.className = 'svg-count-badge';
    countBadge.textContent = '×' + item.duplicateCount;
    row1.appendChild(countBadge);
  }

  info.appendChild(row1);

  // Row 2: dimensions (only if both exist) + filesize + warning
  const row2 = document.createElement('div');
  row2.className = 'svg-info-row';

  if (item.width !== null && item.height !== null && item.width !== '' && item.height !== '') {
    const sizeInfo = document.createElement('span');
    sizeInfo.className = 'svg-dimensions';
    sizeInfo.textContent = item.width + ', ' + item.height;
    row2.appendChild(sizeInfo);
  }

  if (item.sizeBytes) {
    const filesizeInfo = document.createElement('span');
    filesizeInfo.className = 'svg-filesize';
    filesizeInfo.textContent = formatSize(item.sizeBytes);
    row2.appendChild(filesizeInfo);
  }

  if (item.isLarge) {
    const warn = document.createElement('span');
    warn.className = 'svg-warning';
    warn.textContent = '⚠ Large SVG';
    row2.appendChild(warn);
  }

  info.appendChild(row2);

  // Row 3: source url (only if exists)
  if (item.sourceUrl) {
    const row3 = document.createElement('div');
    row3.className = 'svg-info-row';

    const urlInfo = document.createElement('span');
    urlInfo.className = 'svg-source-url';
    urlInfo.textContent = item.sourceUrl;
    row3.appendChild(urlInfo);

    info.appendChild(row3);
  }

  card.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'svg-actions';

  if (item.resolveError) {
    const errMsg = document.createElement('span');
    errMsg.className = 'svg-action-error';
    errMsg.textContent = 'Unavailable';
    actions.appendChild(errMsg);
  } else {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'svg-btn-copy';
    copyBtn.dataset.tooltip = chrome.i18n.getMessage('copySvg') || 'Copy SVG';
    const copyImg = document.createElement('img');
    copyImg.src = '/icons/copy.svg';
    copyImg.width = 18;
    copyImg.height = 18;
    copyBtn.appendChild(copyImg);
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyCode(item);
    });
    copyBtn.addEventListener('mouseenter', (e) => {
      showTooltip(e.currentTarget, e.currentTarget.dataset.tooltip);
    });
    copyBtn.addEventListener('mouseleave', hideTooltip);
    actions.appendChild(copyBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'svg-btn-save';
    saveBtn.dataset.tooltip = chrome.i18n.getMessage('downloadSvg') || 'Save SVG';
    const saveImg = document.createElement('img');
    saveImg.src = '/icons/download.svg';
    saveImg.width = 18;
    saveImg.height = 18;
    saveBtn.appendChild(saveImg);
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveFile(item);
    });
    saveBtn.addEventListener('mouseenter', (e) => {
      showTooltip(e.currentTarget, e.currentTarget.dataset.tooltip);
    });
    saveBtn.addEventListener('mouseleave', hideTooltip);
    actions.appendChild(saveBtn);
  }

  card.appendChild(actions);

  return card;
}

function formatType(type) {
  const map = {
    'inline': 'Inline SVG',
    'img': 'IMG SVG',
    'css-bg': 'CSS Background',
    'object': 'Object/Embed',
    'use': 'Use/Sprite'
  };
  return map[type] || type || 'SVG';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function updateCount(count) {
  document.getElementById('countValue').textContent = count;
}

function showLoading() {
  document.getElementById('loadingIndicator').style.display = 'block';
  document.getElementById('svgList').style.display = 'none';
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('errorState').style.display = 'none';
}

function hideLoading() {
  document.getElementById('loadingIndicator').style.display = 'none';
}

function showEmptyState() {
  document.getElementById('emptyState').style.display = 'block';
  document.getElementById('svgList').style.display = 'none';
  document.getElementById('errorState').style.display = 'none';
}

function showErrorState() {
  document.getElementById('errorState').style.display = 'block';
  document.getElementById('svgList').style.display = 'none';
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('loadingIndicator').style.display = 'none';
  document.getElementById('countValue').textContent = '0';
}

function showTooltip(element, text) {
  const tooltip = document.getElementById('tooltip');
  if (!tooltip) return;
  
  const rect = element.getBoundingClientRect();
  const tooltipWidth = Math.min(text.length * 7 + 24, 200);
  const tooltipHeight = 28;
  
  let left = rect.left + rect.width / 2 - tooltipWidth / 2;
  let top = rect.top - tooltipHeight - 6;
  
  const padding = 8;
  const maxLeft = window.innerWidth - tooltipWidth - padding;
  const minLeft = padding;
  
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = maxLeft;
  if (top < padding) top = rect.bottom + 6;
  
  tooltip.textContent = text;
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
  tooltip.style.maxWidth = '200px';
  tooltip.classList.add('visible');
  
  clearTimeout(tooltipTimeout);
}

function hideTooltip() {
  const tooltip = document.getElementById('tooltip');
  if (tooltip) {
    tooltip.classList.remove('visible');
  }
  clearTimeout(tooltipTimeout);
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.svg-toast');
  if (existing) {
    existing.remove();
  }
  
  const toast = document.createElement('div');
  toast.className = 'svg-toast ' + type;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });
  
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 2000);
}

function copyCode(item) {
  if (!item.sourceCode) {
    showToast(chrome.i18n.getMessage('copyFailed') || 'Failed to copy', 'error');
    return;
  }
  navigator.clipboard.writeText(item.sourceCode).then(() => {
    showToast(chrome.i18n.getMessage('copied') || 'Copied ✓', 'success');
  }).catch(() => {
    showToast(chrome.i18n.getMessage('copyFailed') || 'Failed to copy', 'error');
  });
}

function saveFile(item) {
  if (!item.sourceCode) {
    showToast(chrome.i18n.getMessage('saveFailed') || 'Failed to save', 'error');
    return;
  }
  const filename = generateFilename(item);
  showToast(chrome.i18n.getMessage('saving') || 'Saving...', 'info');
  chrome.runtime.sendMessage({
    action: 'SAVE_FILE',
    svgCode: item.sourceCode,
    filename: filename
  }, (response) => {
    if (chrome.runtime.lastError) {
      showToast((chrome.i18n.getMessage('saveFailed') || 'Failed to save') + ': ' + chrome.runtime.lastError.message, 'error');
      return;
    }
    if (response && response.error) {
      showToast((chrome.i18n.getMessage('saveFailed') || 'Failed to save') + ': ' + response.error, 'error');
      return;
    }
    showToast(chrome.i18n.getMessage('saved') || 'Saved ✓', 'success');
  });
}

function generateFilename(item) {
  let name = 'svg';
  if (item.sourceUrl) {
    const urlParts = item.sourceUrl.split('/');
    const last = urlParts[urlParts.length - 1];
    if (last && last.includes('.')) {
      name = last.replace(/[^a-zA-Z0-9._-]/g, '_');
      if (!name.endsWith('.svg')) name = name + '.svg';
      return name;
    }
  }
  if (item.id) {
    name = item.id;
  }
  return name + '.svg';
}

function getScaledSize(item) {
  const containerSize = 120;
  const maxDisplaySize = 128;
  const minDisplaySize = 32;
  
  let width = parseInt(item.width, 10);
  let height = parseInt(item.height, 10);
  
  // If dimensions are not available or invalid, use 24x24 as fallback
  if (!width || !height || isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
    width = 24;
    height = 24;
  }
  
  // Limit to reasonable range
  if (width > 512) width = 512;
  if (height > 512) height = 512;
  
  // Calculate scale: we want the icon to take about 80% of container
  const targetSize = Math.min(containerSize * 0.85, maxDisplaySize);
  
  // If icon is already large enough, scale to fit container with some padding
  if (width >= targetSize || height >= targetSize) {
    const scaleX = targetSize / width;
    const scaleY = targetSize / height;
    const scale = Math.min(scaleX, scaleY, 1);
    return { width: width * scale, height: height * scale };
  }
  
  // For small icons, scale up to target size but keep proportions
  let scale = targetSize / Math.max(width, height);
  
  // Limit max scale to prevent pixelation
  const maxScale = 5;
  if (scale > maxScale) {
    scale = maxScale;
  }
  
  // Ensure minimum display size
  const finalWidth = width * scale;
  const finalHeight = height * scale;
  
  if (finalWidth < minDisplaySize && finalHeight < minDisplaySize) {
    const minScale = minDisplaySize / Math.max(width, height);
    return { width: width * minScale, height: height * minScale };
  }
  
  return { width: finalWidth, height: finalHeight };
}

function formatDimension(value) {
  if (!value) return '?';
  const str = String(value).trim();
  // If it already has units (px, em, %, etc.)
  if (/[^0-9.]/.test(str)) {
    return str;
  }
  // If it's a number or numeric string
  return str + 'px';
}