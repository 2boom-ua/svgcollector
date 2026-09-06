// content.js - Content Script

const MAX_CONCURRENT_FETCHES = 5;
const LARGE_SVG_THRESHOLD = 5 * 1024 * 1024;

let svgCache = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'SCAN_DOM') {
    scanPage().then((result) => {
      sendResponse(result);
    }).catch((err) => {
      sendResponse({ error: err.message, items: [] });
    });
    return true;
  }
});

async function scanPage() {
    console.log('=== scanPage START ===');
  const items = [];
  const seenHashes = new Map();

  // 1. Inline SVG
  const inlineSvgs = document.querySelectorAll('svg');
  for (const svg of inlineSvgs) {
    // Skip SVG that contains any use reference with href="#"
    const useElements = svg.querySelectorAll('use');
    let hasUseReference = false;
    for (const useEl of useElements) {
      let href = useEl.getAttribute('href');
      if (!href) {
        href = useEl.getAttribute('xlink:href');
      }
      if (!href) {
        try {
          href = useEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        } catch (e) {
          href = null;
        }
      }
      if (href && href.startsWith('#')) {
        hasUseReference = true;
        break;
      }
    }
    if (hasUseReference) {
      continue;
    }
    
    const code = svg.outerHTML;
    const hash = simpleHash(code);
    const existing = seenHashes.get(hash);
    if (existing) {
      existing.duplicateCount++;
      continue;
    }
    
    // Get dimensions only from width/height attributes
    let w = svg.getAttribute('width');
    let h = svg.getAttribute('height');
    
    // Only include dimensions if both width and height are present
    if (w !== null && h !== null && w !== '' && h !== '') {
      // Use as is
    } else {
      w = null;
      h = null;
    }
    
    const item = createItem('inline', code, {
      width: w,
      height: h,
      sizeBytes: new Blob([code]).size,
      duplicateCount: 1
    });
    items.push(item);
    seenHashes.set(hash, item);
  }

  // 2. <img src="*.svg">
  const imgElements = document.querySelectorAll('img[src], img[srcset]');
  for (const img of imgElements) {
    const src = img.getAttribute('src');
    const srcset = img.getAttribute('srcset');
    let url = null;
    if (src && src.toLowerCase().endsWith('.svg')) {
      url = src;
    } else if (srcset) {
      const match = srcset.match(/[^\s,]+\.svg/);
      if (match) url = match[0];
    }
    if (url) {
      const fullUrl = new URL(url, window.location.href).href;
      const item = await resolveExternalSvg(fullUrl, 'img', {
        width: img.getAttribute('width') || null,
        height: img.getAttribute('height') || null
      });
      if (item) {
        const hash = simpleHash(item.sourceCode);
        const existing = seenHashes.get(hash);
        if (existing) {
          existing.duplicateCount++;
          continue;
        }
        items.push(item);
        seenHashes.set(hash, item);
      }
    }
  }

  // 3. CSS background-image
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const styles = window.getComputedStyle(el);
    const bg = styles.backgroundImage;
    if (bg && bg !== 'none') {
      const matches = bg.match(/url\(["']?([^"')]+\.svg)["']?\)/gi);
      if (matches) {
        for (const match of matches) {
          const urlMatch = match.match(/url\(["']?([^"')]+\.svg)["']?\)/i);
          if (urlMatch) {
            const fullUrl = new URL(urlMatch[1], window.location.href).href;
            const item = await resolveExternalSvg(fullUrl, 'css-bg', {
              width: null,
              height: null
            });
            if (item) {
              const hash = simpleHash(item.sourceCode);
              const existing = seenHashes.get(hash);
              if (existing) {
                existing.duplicateCount++;
                continue;
              }
              items.push(item);
              seenHashes.set(hash, item);
            }
          }
        }
      }
    }
  }

  // 4. <object type="image/svg+xml"> and <embed type="image/svg+xml">
  const objectElements = document.querySelectorAll('object[type="image/svg+xml"], embed[type="image/svg+xml"]');
  for (const el of objectElements) {
    const url = el.getAttribute('data') || el.getAttribute('src');
    if (url) {
      const fullUrl = new URL(url, window.location.href).href;
      const item = await resolveExternalSvg(fullUrl, 'object', {
        width: el.getAttribute('width') || null,
        height: el.getAttribute('height') || null
      });
      if (item) {
        const hash = simpleHash(item.sourceCode);
        const existing = seenHashes.get(hash);
        if (existing) {
          existing.duplicateCount++;
          continue;
        }
        items.push(item);
        seenHashes.set(hash, item);
      }
    }
  }

  // 5. <use href="...svg"> and <use xlink:href="...svg">
  const useElements = document.querySelectorAll('use[href$=".svg"], use[xlink\\:href$=".svg"]');
  for (const useEl of useElements) {
    const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href');
    if (href) {
      const fullUrl = new URL(href, window.location.href).href;
      const item = await resolveExternalSvg(fullUrl, 'use', {
        width: useEl.getAttribute('width') || null,
        height: useEl.getAttribute('height') || null
      });
      if (item) {
        const hash = simpleHash(item.sourceCode);
        const existing = seenHashes.get(hash);
        if (existing) {
          existing.duplicateCount++;
          continue;
        }
        items.push(item);
        seenHashes.set(hash, item);
      }
    }
  }

  return {
    action: 'SCAN_RESULT',
    items: items,
    total: items.length
  };
}

function analyzeSvgColors(svgCode) {
  console.log('=== analyzeSvgColors called ===');
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgCode, 'image/svg+xml');
  const svg = doc.documentElement;
  
  // Check if there are any gradients in defs
  const defs = svg.querySelector('defs');
  if (defs) {
    const gradients = defs.querySelectorAll('linearGradient, radialGradient');
    if (gradients.length > 0) {
      console.log('Gradient found in defs, returning multi-color');
      return 'multi-color';
    }
  }
  
  // Parse CSS styles from <style> tags
  const styleMap = new Map();
  const styleTags = svg.querySelectorAll('style');
  for (const styleTag of styleTags) {
    const cssText = styleTag.textContent || '';
    const classRegex = /\.([\w-]+)\s*\{[^}]*fill:\s*([^;]+);?/g;
    let match;
    while ((match = classRegex.exec(cssText)) !== null) {
      const className = match[1];
      const color = match[2].trim();
      if (color && !color.startsWith('url(')) {
        styleMap.set(className, color);
      }
    }
  }
  
  const colors = new Set();
  let hasGradient = false;
  let hasInherit = false;
  let hasCssVar = false;
  const allElements = svg.querySelectorAll('*');
  
  const isCurrentColor = (val) => {
    return val && val.toLowerCase() === 'currentcolor';
  };
  
  const isVarColor = (val) => {
    return val && val.startsWith('var(--');
  };
  
  const isUrlColor = (val) => {
    return val && val.startsWith('url(');
  };
  
  const isInherit = (val) => {
    return val && val.toLowerCase() === 'inherit';
  };
  
  const addColor = (val) => {
    if (!val) return;
    const trimmed = val.trim();
    if (trimmed === 'none') return;
    if (isCurrentColor(trimmed)) {
      console.log('  Ignoring currentColor:', trimmed);
      return;
    }
    if (isVarColor(trimmed)) {
      console.log('  Found CSS var:', trimmed);
      hasCssVar = true;
      return;
    }
    if (isUrlColor(trimmed)) {
      console.log('  Ignoring url(#):', trimmed);
      return;
    }
    if (isInherit(trimmed)) {
      console.log('  Found inherit:', trimmed);
      hasInherit = true;
      return;
    }
    console.log('  Adding color:', trimmed);
    colors.add(trimmed);
  };
  
  const checkElement = (el) => {
    const fill = el.getAttribute('fill');
    const stroke = el.getAttribute('stroke');
    const style = el.getAttribute('style');
    const classAttr = el.getAttribute('class');
    
    if (classAttr) {
      const classes = classAttr.split(/\s+/);
      for (const cls of classes) {
        if (styleMap.has(cls)) {
          const color = styleMap.get(cls);
          if (color && !isUrlColor(color)) {
            addColor(color);
          }
        }
      }
    }
    
    if (fill) {
      if (isUrlColor(fill)) {
        hasGradient = true;
        return;
      }
      addColor(fill);
    }
    
    if (stroke) {
      if (isUrlColor(stroke)) {
        hasGradient = true;
        return;
      }
      addColor(stroke);
    }
    
    if (style) {
      const fillMatch = style.match(/fill:\s*([^;]+)/);
      if (fillMatch) {
        const val = fillMatch[1].trim();
        if (isUrlColor(val)) {
          hasGradient = true;
          return;
        }
        addColor(val);
      }
      const strokeMatch = style.match(/stroke:\s*([^;]+)/);
      if (strokeMatch) {
        const val = strokeMatch[1].trim();
        if (isUrlColor(val)) {
          hasGradient = true;
          return;
        }
        addColor(val);
      }
    }
  };
  
  checkElement(svg);
  
  for (const el of allElements) {
    if (hasGradient) break;
    checkElement(el);
  }
  
  console.log('Colors collected:', Array.from(colors));
  console.log('hasGradient:', hasGradient);
  console.log('hasInherit:', hasInherit);
  console.log('hasCssVar:', hasCssVar);
  
  if (hasGradient) {
    console.log('Result: multi-color (gradient detected)');
    return 'multi-color';
  }
  
  // If there are explicit colors - check them
  if (colors.size > 0) {
    if (colors.size === 1) {
      const color = colors.values().next().value;
      if (isColorWhiteOrBlack(color)) {
        console.log('Result: single-color (white or black)');
        return 'single-color';
      }
      console.log('Result: multi-color (color is not white/black)');
      return 'multi-color';
    }
    console.log('Result: multi-color (multiple colors)');
    return 'multi-color';
  }
  
  // No explicit colors - check if there are CSS vars or inherit
  if (hasCssVar || hasInherit) {
    console.log('Result: single-color (CSS var or inherit detected)');
    return 'single-color';
  }
  
  console.log('Result: single-color (no colors found)');
  return 'single-color';
}

function createItem(type, code, meta) {
  const previewDataUrl = generatePreviewDataUrl(code);
  const colorAnalysis = analyzeSvgColors(code);
  
  const item = {
    id: 'svg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
    type: type,
    sourceCode: code,
    previewDataUrl: previewDataUrl || null,
    width: meta.width || null,
    height: meta.height || null,
    sizeBytes: meta.sizeBytes || new Blob([code]).size,
    duplicateCount: meta.duplicateCount || 1,
    resolveError: null,
    colorMode: colorAnalysis
  };
  if (item.sizeBytes > LARGE_SVG_THRESHOLD) {
    item.isLarge = true;
  }
  return item;
}

function generatePreviewDataUrl(code) {
  try {
    let svgCode = code;
    if (!svgCode.includes('xmlns')) {
      svgCode = svgCode.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    svgCode = svgCode.replace(/<script[\s\S]*?<\/script>/gi, '');
    const encoded = encodeURIComponent(svgCode)
      .replace(/'/g, '%27')
      .replace(/"/g, '%22');
    return 'data:image/svg+xml;charset=utf-8,' + encoded;
  } catch (e) {
    try {
      let cleanCode = code;
      if (!cleanCode.includes('xmlns')) {
        cleanCode = cleanCode.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      cleanCode = cleanCode.replace(/<script[\s\S]*?<\/script>/gi, '');
      const base64 = btoa(unescape(encodeURIComponent(cleanCode)));
      return 'data:image/svg+xml;base64,' + base64;
    } catch (e2) {
      return null;
    }
  }
}

async function resolveExternalSvg(url, type, meta) {
  const cacheKey = url;
  if (svgCache.has(cacheKey)) {
    const cached = svgCache.get(cacheKey);
    if (cached.error) {
      return createErrorItem(type, url, cached.error);
    }
    return createItem(type, cached.code, cached.dimensions);
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const err = 'HTTP ' + response.status;
      svgCache.set(cacheKey, { error: err });
      return createErrorItem(type, url, err);
    }
    const code = await response.text();
    if (!code.trim().startsWith('<svg') && !code.trim().startsWith('<?xml')) {
      const err = 'Not valid SVG';
      svgCache.set(cacheKey, { error: err });
      return createErrorItem(type, url, err);
    }
    
    // Parse SVG to extract width/height from file
    let fileWidth = null;
    let fileHeight = null;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(code, 'image/svg+xml');
      const svg = doc.documentElement;
      fileWidth = svg.getAttribute('width');
      fileHeight = svg.getAttribute('height');
      
      // Only use if both exist
      if (fileWidth !== null && fileHeight !== null && fileWidth !== '' && fileHeight !== '') {
        // Use as is
      } else {
        fileWidth = null;
        fileHeight = null;
      }
    } catch (e) {
      // If parsing fails, use meta dimensions
      fileWidth = meta.width || null;
      fileHeight = meta.height || null;
    }
    
    const dimensions = {
      width: fileWidth,
      height: fileHeight
    };
    
    svgCache.set(cacheKey, { code: code, dimensions: dimensions });
    return createItem(type, code, dimensions);
  } catch (err) {
    const errMsg = err.message || 'Fetch failed';
    svgCache.set(cacheKey, { error: errMsg });
    return createErrorItem(type, url, errMsg);
  }
}

function createErrorItem(type, url, errorMsg) {
  return {
    id: 'err-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
    type: type,
    sourceCode: null,
    previewDataUrl: null,
    width: null,
    height: null,
    sizeBytes: 0,
    duplicateCount: 1,
    resolveError: errorMsg,
    sourceUrl: url,
    colorMode: 'single-color'
  };
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

function isColorWhiteOrBlack(color) {
  if (!color) return false;
  
  // Normalize color string
  let c = color.trim().toLowerCase();
  
  // Check named colors
  if (c === 'white' || c === '#fff' || c === '#ffffff') return true;
  if (c === 'black' || c === '#000' || c === '#000000') return true;
  
  // Parse hex
  try {
    let r, g, b;
    
    // Hex #RGB or #RRGGBB
    if (c.startsWith('#')) {
      const hex = c.replace('#', '');
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else if (hex.length === 6) {
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
      } else {
        return false;
      }
    }
    // RGB rgb(r, g, b)
    else if (c.startsWith('rgb')) {
      const match = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (match) {
        r = parseInt(match[1]);
        g = parseInt(match[2]);
        b = parseInt(match[3]);
      } else {
        return false;
      }
    }
    // HSL - convert to RGB
    else if (c.startsWith('hsl')) {
      const match = c.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
      if (match) {
        const h = parseInt(match[1]) / 360;
        const s = parseInt(match[2]) / 100;
        const l = parseInt(match[3]) / 100;
        
        // Convert HSL to RGB
        let r2, g2, b2;
        if (s === 0) {
          r2 = g2 = b2 = l;
        } else {
          const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
          };
          const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
          const p = 2 * l - q;
          r2 = hue2rgb(p, q, h + 1/3);
          g2 = hue2rgb(p, q, h);
          b2 = hue2rgb(p, q, h - 1/3);
        }
        r = Math.round(r2 * 255);
        g = Math.round(g2 * 255);
        b = Math.round(b2 * 255);
      } else {
        return false;
      }
    } else {
      return false;
    }
    
    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // White: luminance > 0.9, Black: luminance < 0.1
    return luminance > 0.9 || luminance < 0.1;
    
  } catch (e) {
    return false;
  }
}