/**
 * The test console: one plain page, no framework, served at /dev when KAABIL_DEV_CONSOLE=1.
 * It exists so the two of us can drive and watch the whole flow (family, phone, live events)
 * until the real screens are on the live API. It is a developer tool, not the product UI.
 * Everything from the server is written with textContent, never as HTML.
 * The script below avoids template literals so this string stays simple.
 */
export const consoleHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kaabil test console</title>
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 0; background: #f6f5f1; color: #1c1b19; }
  header { background: #7a2b00; color: #fff; padding: 10px 16px; }
  header b { font-size: 17px; }
  main { display: grid; gap: 12px; padding: 12px; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); }
  section { background: #fff; border: 1px solid #d9d5cb; border-radius: 8px; padding: 12px; }
  h2 { font-size: 15px; margin: 0 0 8px; }
  label { display: block; margin: 6px 0 2px; font-size: 13px; color: #55524a; }
  input, select, button { font: inherit; padding: 6px 8px; margin: 2px 4px 2px 0; }
  input[type=text], input[type=email], input[type=password] { width: 100%; box-sizing: border-box; }
  button { cursor: pointer; border: 1px solid #7a2b00; background: #fff; border-radius: 6px; }
  button.primary { background: #7a2b00; color: #fff; }
  button.small { padding: 2px 6px; font-size: 12px; }
  ul { margin: 6px 0; padding-left: 18px; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .note { font-size: 12px; color: #55524a; }
  .ok { color: #17743f; } .bad { color: #b3261e; }
  #log { max-height: 240px; overflow: auto; font: 12px/1.4 ui-monospace, monospace; background: #1c1b19; color: #e6e2d6; padding: 8px; border-radius: 6px; white-space: pre-wrap; }
  .code { font: 28px ui-monospace, monospace; letter-spacing: 4px; }
</style>
</head>
<body>
<header><b>Kaabil test console</b> &nbsp; developer tool, fictional data only. Not the product screens.</header>
<main>
  <section id="acct">
    <h2>1. Family account</h2>
    <label>Name</label><input id="name" type="text" value="Ravi">
    <label>Email</label><input id="email" type="email" value="ravi@example.test">
    <label>Password (10 or more characters)</label><input id="pw" type="password" value="a-long-password-1">
    <div class="row"><button id="signup" class="primary">Sign up</button><button id="signin">Sign in</button><button id="signout">Sign out</button></div>
    <div id="me" class="note">Not signed in.</div>
  </section>

  <section id="grp">
    <h2>2. Care group</h2>
    <div id="groups" class="note">Sign in first.</div>
    <label>Person's name</label><input id="pname" type="text" value="Amma">
    <label>How to address them</label><input id="paddr" type="text" value="అమ్మ">
    <div class="row">
      <select id="plang"><option value="te">Telugu</option><option value="en">English</option></select>
      <label><input id="cmissed" type="checkbox" checked> alert on missed dose</label>
      <label><input id="cemerg" type="checkbox" checked> alert on emergency</label>
    </div>
    <button id="mkgroup" class="primary">Create group</button>
    <div id="gsel" class="note"></div>
  </section>

  <section id="meds">
    <h2>3. Medicines (typed line)</h2>
    <input id="line" type="text" value="Metformin 500, 1-0-1">
    <div class="row"><button id="addmed" class="primary">Add</button><button id="remind">Remind now (to the phone)</button></div>
    <ul id="medlist"></ul>
  </section>

  <section id="pair">
    <h2>4. Pair the person's phone</h2>
    <button id="mkcode" class="primary">Make a pairing code</button>
    <div id="codebox"><span class="code" id="code"></span> <span class="note" id="codeexp"></span></div>
    <div class="note">The family member types this code on the person's phone. The person never says or types it.</div>
    <ul id="devlist"></ul>
  </section>

  <section id="phone">
    <h2>5. Act as the person's phone</h2>
    <div class="row"><input id="dcode" type="text" placeholder="8-digit code" style="width:9em"><input id="dname" type="text" value="Test phone" style="width:9em"><button id="dpair" class="primary">Pair</button><button id="dforget">Forget token</button></div>
    <div id="dstate" class="note">Not paired in this browser.</div>
    <div class="row"><select id="dmed"></select><select id="dtime"></select><select id="dvia"><option>voice</option><option>button</option></select><button id="ddose">Log dose</button></div>
    <div class="row"><select id="dkind"><option>missed_dose</option><option>double_dose</option><option>emergency</option></select><button id="dalert">Send alert</button></div>
    <div class="row"><button id="dplan">Fetch plan</button><button id="dlisten">Listen for events</button></div>
  </section>

  <section id="live">
    <h2>6. What the family sees</h2>
    <div class="row"><button id="flisten">Listen live</button><button id="frefresh">Refresh lists</button></div>
    <div><b>Doses</b><ul id="doses"></ul></div>
    <div><b>Alerts</b><ul id="alerts"></ul></div>
  </section>

  <section id="logsec" style="grid-column: 1 / -1">
    <h2>Log</h2>
    <div id="log"></div>
  </section>
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = { groupId: null, group: null };
  var TOKEN_KEY = 'kaabil.dev.deviceToken';

  function log(kind, msg) {
    var d = new Date().toLocaleTimeString();
    $('log').textContent = d + ' ' + kind + ' ' + msg + '\\n' + $('log').textContent;
  }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function api(method, path, body, headers) {
    var h = Object.assign({}, headers || {});
    if (body !== undefined) h['content-type'] = 'application/json';
    return fetch(path, { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }).then(function (r) {
      return r.text().then(function (t) {
        var j; try { j = t ? JSON.parse(t) : undefined; } catch (e) { j = undefined; }
        log(r.ok ? 'OK ' : 'ERR', method + ' ' + path + ' -> ' + r.status + (r.ok ? '' : ' ' + (j && j.error ? j.error.message : t.slice(0, 120))));
        if (!r.ok) { var err = new Error(j && j.error ? j.error.message : 'HTTP ' + r.status); err.status = r.status; throw err; }
        return j;
      });
    });
  }
  function fail(e) { log('ERR', e && e.message ? e.message : String(e)); }

  // ---- 1. account
  function refreshMe() {
    return api('GET', '/api/care/me').then(function (me) {
      $('me').textContent = 'Signed in as ' + me.user.name + ' (' + me.user.email + ')';
      var box = $('groups'); clear(box);
      if (!me.groups.length) box.textContent = 'No groups yet.';
      me.groups.forEach(function (g) {
        var b = el('button', g.personName + ' (' + g.role + ')', 'small');
        b.onclick = function () { selectGroup(g.id); };
        box.appendChild(b);
      });
      if (!state.groupId && me.groups.length) selectGroup(me.groups[0].id);
    }).catch(function () { $('me').textContent = 'Not signed in.'; });
  }
  $('signup').onclick = function () { api('POST', '/api/auth/sign-up/email', { name: $('name').value, email: $('email').value, password: $('pw').value }).then(refreshMe).catch(fail); };
  $('signin').onclick = function () { api('POST', '/api/auth/sign-in/email', { email: $('email').value, password: $('pw').value }).then(refreshMe).catch(fail); };
  $('signout').onclick = function () { api('POST', '/api/auth/sign-out', {}).then(function () { state.groupId = null; refreshMe(); }).catch(fail); };

  // ---- 2. group
  $('mkgroup').onclick = function () {
    api('POST', '/api/care/groups', { personName: $('pname').value, address: $('paddr').value, lang: $('plang').value, consent: { missedDose: $('cmissed').checked, emergency: $('cemerg').checked } })
      .then(function (g) { state.groupId = null; return refreshMe().then(function () { selectGroup(g.id); }); }).catch(fail);
  };
  function selectGroup(id) {
    state.groupId = id;
    return api('GET', '/api/care/groups/' + id).then(function (g) {
      state.group = g;
      $('gsel').textContent = 'Selected group ' + id.slice(0, 8) + ': ' + g.personName + ', ' + g.lang + ', consent missed=' + g.consent.missedDose + ' emergency=' + g.consent.emergency;
      var ml = $('medlist'); clear(ml);
      g.medicines.forEach(function (m) {
        var li = el('li', m.name + ' ' + m.strength + ' at ' + m.times.join(', ') + ' ');
        var rm = el('button', 'remove', 'small'); rm.onclick = function () { api('DELETE', '/api/care/groups/' + id + '/medicines/' + m.id).then(function () { selectGroup(id); }).catch(fail); };
        li.appendChild(rm); ml.appendChild(li);
      });
      var dl = $('devlist'); clear(dl);
      g.devices.forEach(function (d) {
        var li = el('li', 'phone: ' + d.name + ' ');
        var rv = el('button', 'revoke', 'small'); rv.onclick = function () { api('DELETE', '/api/care/groups/' + id + '/devices/' + d.id).then(function () { selectGroup(id); }).catch(fail); };
        li.appendChild(rv); dl.appendChild(li);
      });
      refreshLists();
    }).catch(fail);
  }

  // ---- 3. medicines, remind
  $('addmed').onclick = function () {
    if (!state.groupId) return log('ERR', 'select a group first');
    api('POST', '/api/care/groups/' + state.groupId + '/medicines', { line: $('line').value }).then(function () { selectGroup(state.groupId); }).catch(fail);
  };
  $('remind').onclick = function () {
    if (!state.groupId) return log('ERR', 'select a group first');
    api('POST', '/api/dev/remind-now', { groupId: state.groupId }).catch(fail);
  };

  // ---- 4. pairing
  $('mkcode').onclick = function () {
    if (!state.groupId) return log('ERR', 'select a group first');
    api('POST', '/api/care/groups/' + state.groupId + '/pairing-codes').then(function (c) {
      $('code').textContent = c.code;
      $('codeexp').textContent = 'valid until ' + new Date(c.expiresAt).toLocaleTimeString() + ', works once';
      $('dcode').value = c.code;
    }).catch(fail);
  };

  // ---- 5. the phone
  function token() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function dev(method, path, body) { return api(method, path, body, { authorization: 'Bearer ' + token() }); }
  function showDevice() { $('dstate').textContent = token() ? 'Paired. Token stored in this browser only.' : 'Not paired in this browser.'; }
  showDevice();
  $('dpair').onclick = function () {
    api('POST', '/api/device/pair', { code: $('dcode').value.trim(), deviceName: $('dname').value }).then(function (r) {
      try { localStorage.setItem(TOKEN_KEY, r.deviceToken); } catch (e) { fail(e); }
      showDevice(); fetchPlan();
    }).catch(fail);
  };
  $('dforget').onclick = function () { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { fail(e); } showDevice(); };
  var plan = null;
  function fetchPlan() {
    if (!token()) return log('ERR', 'pair first');
    return dev('GET', '/api/device/plan').then(function (p) {
      plan = p;
      var dm = $('dmed'); clear(dm);
      p.medicines.forEach(function (m) { var o = el('option', m.name + ' ' + m.strength); o.value = m.id; o.dataset.times = m.times.join(','); dm.appendChild(o); });
      fillTimes();
      $('dstate').textContent = 'Paired for ' + p.person.name + ' (' + p.lang + '), ' + p.medicines.length + ' medicine(s).';
    }).catch(fail);
  }
  function fillTimes() {
    var dt = $('dtime'); clear(dt);
    var o = $('dmed').selectedOptions[0]; if (!o) return;
    o.dataset.times.split(',').forEach(function (t) { dt.appendChild(el('option', t)); });
  }
  $('dmed').onchange = fillTimes;
  $('dplan').onclick = fetchPlan;
  function today() { var d = new Date(); function p(n) { return String(n).padStart(2, '0'); } return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  $('ddose').onclick = function () {
    var m = $('dmed').value; if (!m) return log('ERR', 'fetch the plan first');
    dev('POST', '/api/device/doses', { slotId: m + '|' + today() + '|' + $('dtime').value, medicineId: m, atMs: Date.now(), via: $('dvia').value }).catch(fail);
  };
  $('dalert').onclick = function () {
    var kind = $('dkind').value; var m = $('dmed').value;
    var body = { kind: kind, atMs: Date.now() };
    if (kind !== 'emergency' && m) { body.slotId = m + '|' + today() + '|' + $('dtime').value; body.medicineId = m; }
    dev('POST', '/api/device/alerts', body).then(function (r) { if (!r.created) log('INFO', 'alert not created: ' + r.reason); }).catch(fail);
  };

  // ---- live streams (fetch, so the phone can send its Authorization header)
  function listen(url, headers, label, onEvent) {
    log('INFO', label + ' listening');
    fetch(url, { headers: Object.assign({ accept: 'text/event-stream' }, headers) }).then(function (res) {
      if (!res.ok) return log('ERR', label + ' stream refused: ' + res.status);
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return log('INFO', label + ' stream ended');
          buf += dec.decode(r.value, { stream: true });
          var parts = buf.split('\\n\\n'); buf = parts.pop();
          parts.forEach(function (f) {
            var m = /^data: (.*)$/m.exec(f); if (!m) return;
            try { var e = JSON.parse(m[1]); if (e.type !== 'ping') { log('EVT', label + ' ' + m[1].slice(0, 160)); if (onEvent) onEvent(e); } } catch (x) { /* ignore */ }
          });
          return pump();
        });
      }
      return pump();
    }).catch(fail);
  }
  $('flisten').onclick = function () {
    if (!state.groupId) return log('ERR', 'select a group first');
    listen('/api/care/groups/' + state.groupId + '/events', {}, 'family', function (e) { if (e.type === 'dose' || e.type === 'alert' || e.type === 'device' || e.type === 'plan') { refreshLists(); if (e.type !== 'alert' && e.type !== 'dose') selectGroup(state.groupId); } });
  };
  $('dlisten').onclick = function () {
    if (!token()) return log('ERR', 'pair first');
    listen('/api/device/events', { authorization: 'Bearer ' + token() }, 'phone', function (e) { if (e.type === 'plan') fetchPlan(); });
  };

  // ---- 6. lists
  function refreshLists() {
    if (!state.groupId) return;
    var g = '/api/care/groups/' + state.groupId;
    api('GET', g + '/doses').then(function (r) {
      var ul = $('doses'); clear(ul);
      r.doses.forEach(function (d) { ul.appendChild(el('li', new Date(d.atMs).toLocaleTimeString() + ' ' + d.slotId.split('|').slice(1).join(' ') + ' by ' + d.via)); });
      if (!r.doses.length) ul.appendChild(el('li', 'none yet'));
    }).catch(fail);
    api('GET', g + '/alerts').then(function (r) {
      var ul = $('alerts'); clear(ul);
      r.alerts.forEach(function (a) {
        var li = el('li', a.kind + ' at ' + new Date(a.atMs).toLocaleTimeString() + (a.slotId ? ' (' + a.slotId.split('|').slice(1).join(' ') + ')' : '') + ' ', a.acknowledgedAt ? 'ok' : 'bad');
        if (!a.acknowledgedAt) { var b = el('button', 'acknowledge', 'small'); b.onclick = function () { api('POST', g + '/alerts/' + a.id + '/ack').then(refreshLists).catch(fail); }; li.appendChild(b); } else li.appendChild(el('span', 'acknowledged'));
        ul.appendChild(li);
      });
      if (!r.alerts.length) ul.appendChild(el('li', 'none'));
    }).catch(fail);
  }
  $('frefresh').onclick = refreshLists;

  refreshMe();
  if (token()) fetchPlan();
})();
</script>
</body>
</html>`;
