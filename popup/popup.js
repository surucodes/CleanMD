'use strict';

const { FORMATS, DEFAULT_SETTINGS } = globalThis.CleanMD;

const formatsEl = document.getElementById('formats');
for (const [value, { label, hint }] of Object.entries(FORMATS)) {
  const option = document.createElement('label');
  option.className = 'option';
  option.innerHTML = '<input type="radio" name="format"><span><span class="label"></span><small></small></span>';
  option.querySelector('input').value = value;
  option.querySelector('.label').textContent = label;
  option.querySelector('small').textContent = hint;
  formatsEl.append(option);
}

// FR-3.2: settings persist in chrome.storage.sync.
chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
  const format = formatsEl.querySelector(`input[value="${settings.format}"]`) ||
    formatsEl.querySelector(`input[value="${DEFAULT_SETTINGS.format}"]`);
  format.checked = true;
  for (const box of document.querySelectorAll('input[type="checkbox"]')) {
    box.checked = settings[box.name];
  }
});

document.addEventListener('change', ({ target }) => {
  chrome.storage.sync.set({ [target.name]: target.type === 'checkbox' ? target.checked : target.value });
});
