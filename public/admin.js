const form = document.getElementById('form');
const rows = document.getElementById('rows');
const errBox = document.getElementById('error');

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, { ...opts, headers: { 'Content-Type': 'application/json' } });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

// textContent en vez de innerHTML: el contenido viene del usuario y no debe ejecutarse.
function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function button(text, onclick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = onclick;
  return b;
}

function render(links) {
  rows.replaceChildren(
    ...links.map((l) => {
      const a = document.createElement('a');
      a.href = l.shortUrl;
      a.textContent = l.shortUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      const linkTd = document.createElement('td');
      linkTd.append(a);

      const actions = document.createElement('td');
      actions.append(
        button('Copiar', () => navigator.clipboard.writeText(l.shortUrl)),
        button(l.active ? 'Desactivar' : 'Activar', () =>
          run(() => api(`/links/${l.id}`, { method: 'PATCH', body: JSON.stringify({ active: !l.active }) }))
        ),
        button('Borrar', () => confirm('¿Borrar link?') && run(() => api(`/links/${l.id}`, { method: 'DELETE' })))
      );

      const tr = document.createElement('tr');
      tr.append(linkTd, cell(l.label || l.target), cell(l.clicks), actions);
      return tr;
    })
  );
}

async function load() {
  render(await api('/links'));
}

async function run(fn) {
  errBox.textContent = '';
  try {
    await fn();
    await load();
  } catch (e) {
    errBox.textContent = e.message;
  }
}

function toggleFields() {
  const isWa = form.type.value === 'whatsapp';
  form.phone.hidden = form.message.hidden = !isWa;
  form.url.hidden = isWa;
}
form.type.onchange = toggleFields;

form.onsubmit = (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  run(async () => {
    await api('/links', { method: 'POST', body: JSON.stringify(body) });
    form.reset();
    toggleFields();
  });
};

load().catch((e) => (errBox.textContent = e.message));
