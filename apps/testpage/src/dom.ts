/** Tiny DOM helpers. Text always goes in with textContent, never as HTML, so nothing from the server can inject markup. */

type Attrs = Record<string, string | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined) e.append(kid);
  return e;
}

export const clear = (n: Element) => n.replaceChildren();

export function button(id: string, label: string, onClick: () => void | Promise<void>, cls = ''): HTMLButtonElement {
  const b = el('button', { id, type: 'button', class: cls }, label);
  b.addEventListener('click', () => {
    Promise.resolve(onClick()).catch((e: unknown) => console.error(e));
  });
  return b;
}

export function field(id: string, label: string, value = '', type = 'text'): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = el('input', { id, type, value });
  return { wrap: el('label', {}, label, input), input };
}

export function select(id: string, label: string, options: [string, string][]): { wrap: HTMLElement; input: HTMLSelectElement } {
  const input = el('select', { id }, ...options.map(([v, t]) => el('option', { value: v }, t)));
  return { wrap: el('label', {}, label, input), input };
}

export const section = (title: string, ...kids: (Node | string)[]) => el('section', {}, el('h3', {}, title), ...kids);

/** A line of status text that says whether the last thing worked. */
export function status(id: string): { node: HTMLElement; set(text: string, ok?: boolean): void } {
  const node = el('p', { id, class: 'note', role: 'status' });
  return {
    node,
    set(text, ok) {
      node.textContent = text;
      node.className = ok === undefined ? 'note' : ok ? 'note ok' : 'note bad';
    },
  };
}

export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
