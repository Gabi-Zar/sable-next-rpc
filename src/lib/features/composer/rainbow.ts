import { convertHslToRgb, serializeHex } from 'culori/fn';

import { graphemes } from '#lib/graphemes.js';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);
}

function splitGraphemes(text: string): string[] {
  return Array.from(graphemes.segment(text), ({ segment }) => segment);
}

function visible(char: string): boolean {
  return char.trim().length > 0;
}

function colourOf(index: number, total: number): string {
  return serializeHex(convertHslToRgb({ h: (index / total) * 300, s: 1, l: 0.5 }));
}

export function rainbowHtml(text: string): string {
  const characters = splitGraphemes(text);
  const coloured = characters.filter(visible).length;
  if (coloured === 0) return escapeHtml(text);

  let index = 0;
  return characters
    .map((char) => {
      if (!visible(char)) return escapeHtml(char);

      const colour = colourOf(index, coloured);
      index += 1;
      return `<span data-mx-color="${colour}">${escapeHtml(char)}</span>`;
    })
    .join('');
}

export function rainbowFormatted(html: string): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text);
  }

  const coloured = nodes.reduce(
    (count, node) => count + splitGraphemes(node.data).filter(visible).length,
    0
  );
  if (coloured === 0) return html;

  let index = 0;
  for (const node of nodes) {
    const fragment = body.ownerDocument.createDocumentFragment();
    for (const char of splitGraphemes(node.data)) {
      if (!visible(char)) {
        fragment.append(char);
        continue;
      }
      const span = body.ownerDocument.createElement('span');
      span.setAttribute('data-mx-color', colourOf(index, coloured));
      span.textContent = char;
      fragment.append(span);
      index += 1;
    }
    node.replaceWith(fragment);
  }
  return body.innerHTML;
}
