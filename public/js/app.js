(function () {
  var csrf = document.body.getAttribute('data-csrf');

  // Menú móvil
  var toggle = document.querySelector('[data-toggle-sidebar]');
  if (toggle) toggle.addEventListener('click', function () { document.getElementById('sidebar').classList.toggle('open'); });

  // Confirmaciones
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) { if (!confirm(f.getAttribute('data-confirm'))) e.preventDefault(); });
  });

  // Pide un dato antes de enviar (motivo de pérdida, monto de venta)
  document.querySelectorAll('form[data-prompt]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      var name = f.getAttribute('data-prompt');
      var value = prompt(f.getAttribute('data-prompt-text'), f.getAttribute('data-prompt-default') || '');
      if (value === null) { e.preventDefault(); return; }
      var input = f.querySelector('input[name="' + name + '"]') || document.createElement('input');
      input.type = 'hidden'; input.name = name; input.value = value;
      f.appendChild(input);
    });
  });

  // Selects que envían el formulario al cambiar
  document.querySelectorAll('[data-autosubmit]').forEach(function (s) {
    s.addEventListener('change', function () { s.form.submit(); });
  });

  // Seleccionar todos los checkboxes
  document.querySelectorAll('[data-check-all]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      document.querySelectorAll('input[name="' + a.getAttribute('data-check-all') + '"]').forEach(function (c) { c.checked = true; });
    });
  });

  // Plantillas de SMS
  document.querySelectorAll('[data-template]').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = document.querySelector(b.getAttribute('data-target'));
      if (t) { t.value = b.getAttribute('data-template'); t.focus(); }
    });
  });

  // Enter para enviar en el chat
  document.querySelectorAll('textarea[data-enter-submit]').forEach(function (t) {
    t.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (t.value.trim()) t.form.submit(); }
    });
  });

  // Chat: scroll al final y polling de mensajes nuevos
  var chat = document.getElementById('chat-body');
  if (chat) {
    chat.scrollTop = chat.scrollHeight;
    var contactId = chat.getAttribute('data-contact');
    var poll = function () {
      fetch('/conversations/' + contactId + '/messages.json?after=' + chat.getAttribute('data-last'), { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : { messages: [] }; })
        .then(function (data) {
          if (!data.messages.length) return;
          var empty = document.getElementById('chat-empty');
          if (empty) empty.remove();
          data.messages.forEach(function (m) {
            var div = document.createElement('div');
            div.className = 'bubble ' + m.direction;
            div.textContent = m.body;
            var meta = document.createElement('div');
            meta.className = 'meta';
            meta.textContent = m.created_at.slice(11, 16) + (m.user_name ? ' · ' + m.user_name : '');
            div.appendChild(meta);
            chat.appendChild(div);
            chat.setAttribute('data-last', m.id);
          });
          chat.scrollTop = chat.scrollHeight;
        })
        .catch(function () {});
    };
    setInterval(poll, 8000);
  }

  // Pipeline: arrastrar y soltar
  var board = document.getElementById('board');
  if (board) {
    var dragged = null;
    var fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
    var refresh = function () {
      board.querySelectorAll('.column').forEach(function (col) {
        var deals = col.querySelectorAll('.deal');
        var sum = 0;
        deals.forEach(function (d) { sum += Number(d.getAttribute('data-value')) || 0; });
        col.querySelector('.column-head .badge').textContent = deals.length;
        col.querySelector('.column-sum').textContent = fmt.format(sum);
      });
    };
    board.addEventListener('dragstart', function (e) {
      dragged = e.target.closest('.deal');
      if (dragged) { dragged.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
    });
    board.addEventListener('dragend', function () { if (dragged) dragged.classList.remove('dragging'); dragged = null; });
    board.querySelectorAll('.column').forEach(function (col) {
      col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', function () { col.classList.remove('drag-over'); });
      col.addEventListener('drop', function (e) {
        e.preventDefault();
        col.classList.remove('drag-over');
        if (!dragged || dragged.parentElement === col) return;
        var stage = col.getAttribute('data-stage');
        var body = { stage: stage };
        if (stage === 'ganado') {
          var v = prompt('Monto de la venta', dragged.getAttribute('data-value') || '');
          if (v === null) return;
          body.deal_value = v;
          dragged.setAttribute('data-value', Number(String(v).replace(/[^0-9.]/g, '')) || 0);
        } else if (stage === 'perdido') {
          var reason = prompt('¿Por qué se perdió? (opcional)', '');
          if (reason === null) return;
          body.lost_reason = reason;
        }
        var card = dragged;
        var from = card.parentElement;
        col.insertBefore(card, col.querySelector('.deal'));
        refresh();
        fetch('/contacts/' + card.getAttribute('data-id') + '/stage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify(body),
        }).then(function (r) {
          if (!r.ok) throw new Error();
        }).catch(function () {
          from.appendChild(card);
          refresh();
          alert('No se pudo mover la oportunidad. Intenta de nuevo.');
        });
      });
    });
  }
})();
