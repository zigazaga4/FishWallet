// Iframe Controller — executes JavaScript inside the app preview iframe
// Uses Electron's webFrameMain API to find and interact with the iframe
// that shows the running Vite dev server (http://localhost:{port})

import { BrowserWindow, WebFrameMain } from 'electron';
import { getActiveDevServer } from './devServer';
import { logger } from './logger';

// Find the iframe frame matching the active dev server
function findIframeFrame(window: BrowserWindow): WebFrameMain | null {
  const devServer = getActiveDevServer();
  if (!devServer) {
    logger.warn('[IframeCtrl] No active dev server');
    return null;
  }

  const targetUrl = `http://localhost:${devServer.port}`;

  // Traverse all frames to find the one matching the dev server URL
  const mainFrame = window.webContents.mainFrame;
  for (const frame of mainFrame.frames) {
    if (frame.url.startsWith(targetUrl)) {
      return frame;
    }
  }

  logger.warn('[IframeCtrl] Iframe frame not found for', targetUrl);
  return null;
}

// Execute JavaScript in the iframe and return the result
async function executeInIframe(window: BrowserWindow, code: string): Promise<unknown> {
  const frame = findIframeFrame(window);
  if (!frame) {
    throw new Error('App preview iframe not found. Is the dev server running?');
  }
  return frame.executeJavaScript(code);
}

// Read a simplified DOM tree from the iframe (capped at 15k chars)
export async function readDom(window: BrowserWindow): Promise<string> {
  const code = `
    (function() {
      function serialize(el, depth) {
        if (depth > 6) return '';
        if (el.nodeType === 3) {
          const t = el.textContent.trim();
          return t ? t.slice(0, 100) : '';
        }
        if (el.nodeType !== 1) return '';
        const tag = el.tagName.toLowerCase();
        if (['script', 'style', 'svg', 'path', 'noscript'].includes(tag)) return '';
        let attrs = '';
        if (el.id) attrs += ' id="' + el.id + '"';
        if (el.className && typeof el.className === 'string') attrs += ' class="' + el.className.slice(0, 80) + '"';
        if (el.type) attrs += ' type="' + el.type + '"';
        if (el.href) attrs += ' href="' + el.href.slice(0, 100) + '"';
        if (el.src) attrs += ' src="' + el.src.slice(0, 100) + '"';
        if (el.placeholder) attrs += ' placeholder="' + el.placeholder + '"';
        if (el.value) attrs += ' value="' + String(el.value).slice(0, 50) + '"';
        if (el.name) attrs += ' name="' + el.name + '"';
        if (el.getAttribute('role')) attrs += ' role="' + el.getAttribute('role') + '"';
        if (el.getAttribute('aria-label')) attrs += ' aria-label="' + el.getAttribute('aria-label') + '"';
        const children = Array.from(el.childNodes).map(c => serialize(c, depth + 1)).filter(Boolean).join('');
        if (!children && !attrs) return '';
        return '<' + tag + attrs + '>' + children + '</' + tag + '>';
      }
      const result = serialize(document.body, 0);
      return result.slice(0, 15000);
    })()
  `;
  return (await executeInIframe(window, code)) as string;
}

// Query elements by CSS selector — returns array of element info
export async function querySelectorAll(window: BrowserWindow, selector: string): Promise<Array<{ tag: string; text: string; attributes: Record<string, string>; index: number }>> {
  const code = `
    (function() {
      const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      return els.slice(0, 50).map((el, i) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 200),
        attributes: {
          id: el.id || '',
          class: (typeof el.className === 'string' ? el.className : '').slice(0, 100),
          type: el.type || '',
          href: (el.href || '').slice(0, 100),
          value: String(el.value || '').slice(0, 50),
          placeholder: el.placeholder || '',
          name: el.name || '',
          role: el.getAttribute('role') || '',
          'aria-label': el.getAttribute('aria-label') || ''
        },
        index: i
      }));
    })()
  `;
  return (await executeInIframe(window, code)) as Array<{ tag: string; text: string; attributes: Record<string, string>; index: number }>;
}

// Click an element by CSS selector (optionally at a specific index)
export async function clickElement(window: BrowserWindow, selector: string, index = 0): Promise<string> {
  const code = `
    (function() {
      const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      if (els.length === 0) return 'No elements found for selector: ${selector.replace(/'/g, "\\'")}';
      const idx = Math.min(${index}, els.length - 1);
      const el = els[idx];
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.click();
      return 'Clicked ' + el.tagName.toLowerCase() + (el.textContent ? ' "' + el.textContent.trim().slice(0, 50) + '"' : '') + ' (index ' + idx + ' of ' + els.length + ')';
    })()
  `;
  return (await executeInIframe(window, code)) as string;
}

// Type text into an input element (handles React controlled inputs)
export async function typeText(window: BrowserWindow, selector: string, text: string, index = 0, clearFirst = true): Promise<string> {
  const code = `
    (function() {
      const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      if (els.length === 0) return 'No elements found for selector: ${selector.replace(/'/g, "\\'")}';
      const idx = Math.min(${index}, els.length - 1);
      const el = els[idx];
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
      // Use native input value setter to work with React controlled inputs
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, ${clearFirst} ? ${JSON.stringify(text)} : (el.value || '') + ${JSON.stringify(text)});
      } else {
        el.value = ${clearFirst} ? ${JSON.stringify(text)} : (el.value || '') + ${JSON.stringify(text)};
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'Typed into ' + el.tagName.toLowerCase() + ' (index ' + idx + ')';
    })()
  `;
  return (await executeInIframe(window, code)) as string;
}

// Scroll the page in a direction
export async function scrollPage(window: BrowserWindow, direction: 'up' | 'down' | 'top' | 'bottom', pixels = 400): Promise<string> {
  const scrollMap: Record<string, string> = {
    up: `window.scrollBy(0, -${pixels})`,
    down: `window.scrollBy(0, ${pixels})`,
    top: `window.scrollTo(0, 0)`,
    bottom: `window.scrollTo(0, document.body.scrollHeight)`
  };
  const code = `(function() { ${scrollMap[direction]}; return 'Scrolled ${direction}'; })()`;
  return (await executeInIframe(window, code)) as string;
}

// Get current URL of the iframe
export async function getCurrentUrl(window: BrowserWindow): Promise<string> {
  return (await executeInIframe(window, 'window.location.href')) as string;
}

// Get text content of an element
export async function getElementText(window: BrowserWindow, selector: string, index = 0): Promise<string> {
  const code = `
    (function() {
      const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      if (els.length === 0) return 'No elements found for selector: ${selector.replace(/'/g, "\\'")}';
      const idx = Math.min(${index}, els.length - 1);
      return (els[idx].textContent || '').trim().slice(0, 2000);
    })()
  `;
  return (await executeInIframe(window, code)) as string;
}
