// Tiny settings-form builder. Each tool declares its fields; this renders them and returns typed values.
import { h, splitTerms } from './util.js';

let uid = 0;

/**
 * field: { key, label, type: select|number|text|tags|checkbox|date|month, options:[[value,label]], default, help,
 *          min, max, step, placeholder, datalist:[[value,label]], showIf(values), advanced }
 */
export function buildForm(fields, { onChange } = {}) {
  const main = h('div', { class: 'fields' });
  const adv = h('div', { class: 'fields' });
  const controls = new Map();

  for (const f of fields) {
    const id = `f${++uid}`;
    let input;
    if (f.type === 'select') {
      input = h('select', { id }, f.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(f.default) }, l)));
    } else if (f.type === 'chips') {
      // One-of-many buttons (like a segmented control). The chosen value lives in data-value.
      input = h('div', { id, class: 'chips', role: 'group', 'aria-label': f.label });
      input.dataset.value = String(f.default ?? f.options[0][0]);
      // An option can carry a third item, { otherField: value }, that fills in other fields when it is chosen.
      for (const [v, l, preset] of f.options) {
        input.append(
          h('button', { type: 'button', class: 'chipbtn', dataset: { v: String(v) }, 'aria-pressed': String(String(v) === input.dataset.value), onclick: () => {
            input.dataset.value = String(v);
            for (const b of input.children) b.setAttribute('aria-pressed', String(b.dataset.v === String(v)));
            if (preset) for (const [k, val] of Object.entries(preset)) setField(k, val);
            refresh();
          } }, l),
        );
      }
    } else if (f.type === 'checkbox') {
      input = h('input', { id, type: 'checkbox', checked: !!f.default });
    } else {
      const type = f.type === 'tags' ? 'text' : f.type;
      input = h('input', { id, type, value: f.default ?? '', placeholder: f.placeholder, min: f.min, max: f.max, step: f.step, autocomplete: 'off', list: f.datalist ? `${id}-dl` : null });
    }
    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh);
    const box = h(
      'div',
      { class: `field${f.type === 'checkbox' ? ' check' : ''}${f.half ? ' half' : ''}` },
      f.type === 'checkbox' ? h('label', { for: id }, input, f.label) : h('label', { for: id }, f.label),
      f.type === 'checkbox' ? null : input,
      f.datalist ? h('datalist', { id: `${id}-dl` }, f.datalist.map(([v, l]) => h('option', { value: v }, l))) : null,
      f.help ? h('div', { class: 'help' }, f.help) : null,
    );
    (f.advanced ? adv : main).append(box);
    controls.set(f.key, { f, input, box });
  }

  function setField(key, value) {
    const c = controls.get(key);
    if (!c) return;
    if (c.f.type === 'chips') {
      c.input.dataset.value = String(value);
      for (const b of c.input.children) b.setAttribute('aria-pressed', String(b.dataset.v === String(value)));
    } else c.input.value = value;
  }

  function values() {
    const out = {};
    for (const [key, { f, input }] of controls) {
      if (f.type === 'checkbox') out[key] = input.checked;
      else if (f.type === 'chips') out[key] = input.dataset.value;
      else if (f.type === 'number') out[key] = input.value === '' ? null : Number(input.value);
      else if (f.type === 'tags') out[key] = splitTerms(input.value);
      else out[key] = input.value.trim();
    }
    return out;
  }
  function refresh() {
    const v = values();
    for (const { f, box } of controls.values()) if (f.showIf) box.hidden = !f.showIf(v);
    onChange?.(v);
  }

  const el = h('div', null, main, adv.children.length ? h('details', { class: 'adv' }, h('summary', null, 'Advanced options'), adv) : null);
  refresh();
  return {
    el,
    values,
    set: (key, value) => {
      setField(key, value);
      refresh();
    },
  };
}
