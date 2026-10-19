const OPEN = 'data-dropdown-open';
let openControl = null;
let typeahead = '';
let typeaheadTimer = null;

function optionItems(select) {
  const options = [...select.options];
  const limit = Number(select.dataset.dropdownLimit || 0);
  const expanded = select.dataset.dropdownExpanded === 'true';
  let visible = options;
  let truncated = false;
  if (limit > 0 && !expanded && options.length > limit) {
    visible = options.slice(0, limit);
    const selected = select.selectedOptions?.[0];
    if (selected && !visible.includes(selected)) visible = [...visible, selected];
    truncated = true;
  }
  return {visible, truncated, total: options.length};
}

function close(control = openControl, restoreFocus = false) {
  if (!control) return false;
  const {select, trigger, menu} = control;
  menu?.remove();
  select.removeAttribute(OPEN);
  trigger.setAttribute('aria-expanded', 'false');
  control.open = false;
  if (openControl === control) openControl = null;
  if (restoreFocus && !select.disabled) trigger.focus({preventScroll: true});
  return true;
}

function closeAll(restoreFocus = false) {
  return close(openControl, restoreFocus);
}

function position(control) {
  const rect = control.trigger.getBoundingClientRect();
  const menu = control.menu;
  const margin = 8;
  const maxHeight = Math.min(420, Math.max(180, window.innerHeight - rect.bottom - margin));
  const width = Math.max(rect.width, 220);
  const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - width - margin));
  const top = Math.min(rect.bottom + margin, Math.max(margin, window.innerHeight - Math.min(maxHeight, 240) - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.width = `${Math.min(width, window.innerWidth - margin * 2)}px`;
  menu.style.maxHeight = `${maxHeight}px`;
}

function sync(control) {
  const {select, trigger} = control;
  const selected = select.selectedOptions?.[0];
  trigger.querySelector('.dropdown-trigger-text').textContent = selected?.textContent || '请选择';
  trigger.disabled = select.disabled;
  trigger.setAttribute('aria-expanded', control.open ? 'true' : 'false');
  if (control.open) renderMenu(control);
}

function choose(control, option) {
  const {select} = control;
  if (!option || option.disabled) return;
  close(control);
  select.value = option.value;
  select.dispatchEvent(new Event('input', {bubbles: true}));
  select.dispatchEvent(new Event('change', {bubbles: true}));
}

function renderMenu(control) {
  control.menu?.remove();
  const {select, trigger} = control;
  const menu = document.createElement('div');
  menu.className = 'dropdown-menu';
  menu.setAttribute('role', 'listbox');
  menu.id = `${select.id || 'dropdown'}__menu`;
  menu.setAttribute('aria-label', trigger.getAttribute('aria-label') || '选项');
  const {visible, truncated} = optionItems(select);
  visible.forEach((option, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dropdown-option';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', option === select.selectedOptions?.[0] ? 'true' : 'false');
    item.disabled = option.disabled;
    item.dataset.dropdownIndex = String(index);
    item.style.setProperty('--dropdown-index', index);
    item.textContent = option.textContent;
    if (option === select.selectedOptions?.[0]) item.classList.add('selected');
    item.addEventListener('click', () => choose(control, option));
    item.addEventListener('keydown', event => optionKeydown(event, control, item));
    menu.append(item);
  });
  if (truncated) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'dropdown-more';
    more.textContent = '查看全部';
    more.addEventListener('click', () => {
      select.dataset.dropdownExpanded = 'true';
      renderMenu(control);
      control.menu.querySelector('.dropdown-option')?.focus();
      position(control);
    });
    menu.append(more);
  }
  (select.closest('dialog[open]') || document.body).append(menu);
  control.menu = menu;
  position(control);
}

function open(control, focusSelected = false) {
  if (control.select.disabled) return;
  if (openControl && openControl !== control) close(openControl);
  control.open = true;
  openControl = control;
  control.select.setAttribute(OPEN, '');
  control.trigger.setAttribute('aria-expanded', 'true');
  control.trigger.setAttribute('aria-controls', control.menuId);
  renderMenu(control);
  const selected = control.menu?.querySelector('.selected') || control.menu?.querySelector('.dropdown-option');
  if (focusSelected) selected?.focus({preventScroll: true});
}

function optionKeydown(event, control, item) {
  const options = [...control.menu.querySelectorAll('.dropdown-option:not(:disabled)')];
  const index = options.indexOf(item);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const native = [...control.select.options].find(option => option.textContent === item.textContent && !option.disabled);
    choose(control, native);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    close(control, true);
  } else if (event.key.length === 1 && /\S/.test(event.key)) {
    typeahead += event.key.toLocaleLowerCase();
    clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(() => { typeahead = ''; }, 500);
    const match = [...control.select.options].find(option => option.textContent.toLocaleLowerCase().startsWith(typeahead));
    if (match) {
      const target = [...control.menu.querySelectorAll('.dropdown-option')].find(option => option.textContent === match.textContent);
      target?.focus();
    }
  }
}

function enhance(select) {
  if (select.dataset.dropdownEnhanced === 'true' || select.closest('.dropdown-control')) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'dropdown-control';
  if (select.classList.contains('compact-select')) wrapper.classList.add('compact');
  if (select.classList.contains('account-switcher')) wrapper.classList.add('account');
  select.parentNode.insertBefore(wrapper, select);
  wrapper.append(select);
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = `dropdown-trigger ${select.className}`;
  trigger.removeAttribute('id');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const label = select.getAttribute('aria-label') || document.querySelector(`label[for="${CSS.escape(select.id)}"]`)?.textContent?.trim();
  if (label) trigger.setAttribute('aria-label', label);
  trigger.innerHTML = '<span class="dropdown-trigger-text"></span><span class="dropdown-chevron" aria-hidden="true">⌄</span>';
  wrapper.insertBefore(trigger, select);
  select.dataset.dropdownEnhanced = 'true';
  select.classList.add('dropdown-native');
  select.setAttribute('tabindex', '-1');
  const control = {select, trigger, wrapper, menu: null, menuId: `${select.id || 'dropdown'}__menu`, open: false};
  trigger.addEventListener('click', () => control.open ? close(control) : open(control, true));
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(control, true); }
    else if (event.key === 'Escape' && control.open) { event.preventDefault(); close(control, true); }
  });
  select.addEventListener('change', () => sync(control));
  select.addEventListener('focus', () => trigger.focus({preventScroll: true}));
  sync(control);
  return control;
}

export function enhanceDropdowns(root = document) {
  const controls = [];
  root.querySelectorAll?.('select').forEach(select => {
    const control = enhance(select);
    if (control) controls.push(control);
    else if (select.closest('.dropdown-control')) sync(select.closest('.dropdown-control').__dropdownControl);
  });
  controls.forEach(control => { control.wrapper.__dropdownControl = control; });
  return controls;
}

document.addEventListener('pointerdown', event => {
  if (openControl && !openControl.wrapper.contains(event.target) && !openControl.menu?.contains(event.target)) close(openControl);
}, true);
window.addEventListener('resize', () => { if (openControl) position(openControl); });
window.addEventListener('scroll', () => { if (openControl) position(openControl); }, true);

export function closeDropdowns(restoreFocus = false) { return closeAll(restoreFocus); }
