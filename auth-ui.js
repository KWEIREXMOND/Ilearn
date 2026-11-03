// Authentication protects the server endpoints. Learning data remains browser-local.
let authMode = 'login';
function authScreen(message = '', rememberedEmail = '', showOpenTab = false) {
  document.querySelector('#modal-root').innerHTML = '';
  const registering = authMode === 'register';
  document.querySelector('#app').innerHTML = `<main class="auth-layout"><section class="auth-aside"><div class="auth-brand"><span class="brand-mark">${icon('book')}</span> iLearn<span>.</span></div><div class="auth-aside-content"><span class="auth-tag">YOUR PERSONAL LEARNING SPACE</span><h1>Make space<br>for learning.</h1><p>Keep your subjects, study materials and goals together. Take it one step at a time.</p><div class="auth-illustration">${heroArt()}</div><div class="auth-benefits"><span>${icon('book')} Organize your subjects</span><span>${icon('spark')} Learn at your own pace</span></div></div><div class="auth-foot">A little progress every day ✦</div></section><section class="auth-main"><div class="auth-box"><div class="eyebrow">WELCOME TO ILEARN</div><h1>${registering ? 'Create your account' : 'Welcome back'}</h1><p>${registering ? 'Set up an account to start your learning journey.' : 'Sign in to continue your learning journey.'}</p><div class="auth-tabs" aria-label="Account options"><button type="button" id="auth-login-tab" aria-pressed="${!registering}" class="${!registering?'active':''}">Sign in</button><button type="button" id="auth-register-tab" aria-pressed="${registering}" class="${registering?'active':''}">Create account</button></div><form id="auth-form" class="form-grid"><div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com" value="${esc(rememberedEmail)}"></div><div class="field"><label for="auth-password">Password</label><div class="auth-password-wrap"><input id="auth-password" name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" minlength="10" maxlength="128" required placeholder="At least 10 characters"><button type="button" id="toggle-password" aria-label="Show password" aria-pressed="false">Show</button></div>${registering ? '<small>Use at least 10 characters.</small>' : ''}</div>${registering ? `<div class="field"><label for="auth-confirm">Confirm password</label><input id="auth-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required placeholder="Enter your password again"></div>` : ''}<div id="auth-error" role="alert" class="notice warning" ${message ? '' : 'hidden'}>${esc(message)}</div><div id="auth-open-tab" ${showOpenTab?'':'hidden'}><a class="text-button" href="${esc(window.location.href)}" target="_blank" rel="noopener noreferrer">Open iLearn in a new tab ↗</a></div><button type="submit" class="button auth-submit">${registering ? 'Create account' : 'Sign in'} ${icon('arrow')}</button></form><div class="auth-switch">${registering ? 'Already have an account?' : 'New to iLearn?'} <button type="button" class="text-button" id="auth-switch">${registering ? 'Sign in' : 'Create an account'}</button></div><div class="auth-disclosure">Accounts belong to this server. Learning records and PDFs stay in this browser, are not synced, and are not protected from other people using this browser.</div></div></section></main>`;
  const switchMode = mode => { const email = document.querySelector('#auth-email').value; authMode = mode; authScreen('', email); };
  document.querySelector('#auth-login-tab').onclick = () => switchMode('login');
  document.querySelector('#auth-register-tab').onclick = () => switchMode('register');
  document.querySelector('#auth-switch').onclick = () => switchMode(registering ? 'login' : 'register');
  const form = document.querySelector('#auth-form');
  document.querySelector('#toggle-password').onclick = e => {
    const input = form.elements.password, shown = input.type === 'password';
    input.type = shown ? 'text' : 'password';
    if (form.elements.confirmPassword) form.elements.confirmPassword.type = shown ? 'text' : 'password';
    e.currentTarget.textContent = shown ? 'Hide' : 'Show'; e.currentTarget.setAttribute('aria-pressed', String(shown)); e.currentTarget.setAttribute('aria-label', shown ? 'Hide password' : 'Show password');
  };
  form.onsubmit = async e => {
    e.preventDefault(); const submit = form.querySelector('[type=submit]'), error = form.querySelector('#auth-error');
    error.hidden = true;
    if (registering && form.elements.password.value !== form.elements.confirmPassword.value) {
      error.textContent = 'Passwords do not match. Please try again.'; error.hidden = false; form.elements.confirmPassword.focus(); return;
    }
    submit.disabled = true; submit.textContent = registering ? 'Creating account…' : 'Signing in…';
    try {
      const res = await fetch(`/api/auth/${authMode}`, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:form.elements.email.value,password:form.elements.password.value}) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Could not sign in.');
      // Do not show a signed-in dashboard if the embedded browser rejected its session cookie.
      const session = await fetch('/api/auth/session', { credentials:'same-origin', cache:'no-store' });
      if (session.status === 401) {
        authMode = 'login'; authScreen('Your browser blocked the sign-in cookie. Open iLearn in a new tab and sign in there. If you just registered, your account may already have been created.', form.elements.email.value, true); return;
      }
      if (!session.ok) throw new Error('Could not verify your session. Please try again.');
      const verified = await session.json();
      if (!verified.user || verified.user.id !== result.user?.id) throw new Error('Could not verify your session. Please try again.');
      activateUser(verified.user);
    } catch (err) { error.textContent = err.message || 'Account service is unavailable.'; error.hidden = false; submit.disabled = false; submit.textContent = registering ? 'Create account' : 'Sign in'; }
  };
}

function activateUser(user) {
  currentUser = user;
  KEY = `${LEGACY_KEY}:${user.id}`; PDF_DB = `ilearn-pdfs-v1:${user.id}`;
  try { data = { ...initial(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { data = initial(); toast('Could not load local data. It has not been deleted.'); }
  page='Overview'; readerOpen=false; render();
}
async function startAuth() {
  document.querySelector('#app').innerHTML = '<main class="auth-loading" role="status">Loading your learning space…</main>';
  try {
    const response = await fetch('/api/auth/session', { cache:'no-store' });
    if (response.status === 401) return authScreen();
    if (!response.ok) throw new Error('Account service is unavailable.');
    activateUser((await response.json()).user);
  } catch { authScreen('Account service is unavailable. Please check your connection.'); }
}
function clearClientSession() {
  closeModal(); pdfRenderToken++; readerOpen=false; currentUser=null; data=initial(); KEY=LEGACY_KEY; PDF_DB='ilearn-pdfs-v1'; quiz=null; authMode='login';
}
function sessionExpired() { clearClientSession(); authScreen('Your session expired. Please sign in again.'); }
async function signOut() {
  try {
    const response = await fetch('/api/auth/logout', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    if (!response.ok) throw Error('Could not sign out. Please try again.');
    clearClientSession(); authScreen();
  } catch (err) { toast(err.message || 'Could not sign out. Please try again.'); }
}
async function importLegacyData() {
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (!legacy) return toast('No previous local data was found.');
  if (localStorage.getItem(KEY)) return toast('This account already has local data; importing would overwrite it.');
  if (!confirm('Copy the previous browser-only workspace and its PDFs into this account on this browser? The original will remain unchanged.')) return;
  const copied = [], accountKey=KEY, accountDb=PDF_DB, accountId=currentUser?.id;
  try {
    const old = { ...initial(), ...JSON.parse(legacy) };
    for (const t of old.topics) {
      for (const pdf of topicPdfs(t)) {
        const blob = await pdfStore('get', pdf.id, undefined, 'ilearn-pdfs-v1');
        if (!blob) throw Error(`A previous PDF is missing: ${pdf.name}. Nothing was imported.`);
        await pdfStore('put', pdf.id, blob, accountDb); copied.push(pdf.id);
      }
    }
    if (currentUser?.id !== accountId) throw Error('Import cancelled because the account changed.');
    localStorage.setItem(accountKey, JSON.stringify(old)); data=old; render(); toast('Previous local workspace copied.');
  } catch (err) {
    for (const id of copied) await pdfStore('delete', id, undefined, accountDb).catch(()=>{});
    if(currentUser?.id === accountId) toast(err.message || 'Could not import the previous workspace.');
  }
}
