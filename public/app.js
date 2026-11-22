// Maximum message length allowed by the backend API
const MAX_MESSAGE_LENGTH = 280;

// Cache references to DOM elements used throughout the script
const siteHeader = document.querySelector('.site-header');
const feedbackForm = document.getElementById('feedback-form');
const formAuthGate = document.getElementById('form-auth-gate');
const gateNotice = document.getElementById('gate-notice');
const postingAsName = document.getElementById('posting-as-name');
const postingAsEmail = document.getElementById('posting-as-email');
const nameInput = document.getElementById('name-input');
const messageInput = document.getElementById('message-input');
const charCounter = document.getElementById('char-counter');
const charProgressFill = document.getElementById('char-progress-fill');
const submitBtn = document.getElementById('submit-btn');
const submitBtnLabel = submitBtn.querySelector('.btn-label');
const formError = document.getElementById('form-error');
const totalPostsEl = document.getElementById('total-posts');
const headerTotalPostsEl = document.getElementById('header-total-posts');
const postsList = document.getElementById('posts-list');
const successToast = document.getElementById('success-toast');
const lottieContainer = document.getElementById('lottie-success');
const toastTitleEl = document.getElementById('toast-title');
const toastSubtitleEl = document.getElementById('toast-subtitle');

// Authentication UI elements
const authGuestActions = document.getElementById('auth-guest-actions');
const authUserChip = document.getElementById('auth-user-chip');
const userChipAvatar = document.getElementById('user-chip-avatar');
const userChipName = document.getElementById('user-chip-name');
const userChipGoogle = document.getElementById('user-chip-google');
const openLoginBtn = document.getElementById('open-login-btn');
const openRegisterBtn = document.getElementById('open-register-btn');
const gateLoginBtn = document.getElementById('gate-login-btn');
const gateRegisterBtn = document.getElementById('gate-register-btn');
const gateGoogleBtn = document.getElementById('gate-google-btn');
const logoutBtn = document.getElementById('logout-btn');

// Modal & Auth Forms
const authModal = document.getElementById('auth-modal');
const closeAuthModalBtn = document.getElementById('close-auth-modal');
const authModalTitle = document.getElementById('auth-modal-title');
const authModalSubtitle = document.getElementById('auth-modal-subtitle');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const modalGoogleBtn = document.getElementById('modal-google-btn');
const loginForm = document.getElementById('login-form');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const loginSubmitBtn = document.getElementById('login-submit-btn');
const registerForm = document.getElementById('register-form');
const registerNameInput = document.getElementById('register-name');
const registerEmailInput = document.getElementById('register-email');
const registerPasswordInput = document.getElementById('register-password');
const registerSubmitBtn = document.getElementById('register-submit-btn');
const authErrorEl = document.getElementById('auth-error');

// Client application state
let currentUser = null;
let googleEnabled = false;
let authMode = 'login';
let lottieSuccessAnim = null;
let toastHideTimer = null;
let lastRenderedCount = null;

/**
 * Escapes HTML special characters in user-provided text to prevent XSS attacks
 * before inserting content into the DOM.
 */
function escapeHtml(text) {
  const str = String(text ?? '');
  const replacements = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, (char) => replacements[char]);
}

/**
 * Validates that an avatar URL uses HTTPS before rendering an <img> tag.
 */
function getSafeAvatarUrl(url) {
  if (typeof url === 'string' && url.startsWith('https://')) {
    return url;
  }
  return null;
}

/**
 * Extracts up to two uppercase initials from a poster's name for the avatar badge.
 */
function getInitials(name) {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Returns a deterministic avatar color tone index (0, 1, or 2) from a poster's name.
 */
function getAvatarTone(name) {
  const text = String(name ?? '');
  let sum = 0;
  for (let i = 0; i < text.length; i += 1) {
    sum += text.charCodeAt(i);
  }
  return sum % 3;
}

/**
 * Formats an ISO timestamp from PostgreSQL into a readable local date and time.
 */
function formatDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Triggers a brief pop animation on a count badge when the post total changes.
 */
function animateCountElement(el) {
  if (!el) {
    return;
  }
  el.classList.remove('count-bump');
  void el.offsetWidth;
  el.classList.add('count-bump');
}

/**
 * Updates the live character counter and progress track near the 280-char limit.
 */
function updateCharCounter() {
  const length = messageInput.value.length;
  const nearLimit = length >= 240 && length < 270;
  const atLimit = length >= 270;

  charCounter.textContent = `${length} / ${MAX_MESSAGE_LENGTH}`;
  charCounter.classList.toggle('near-limit', nearLimit);
  charCounter.classList.toggle('at-limit', atLimit);

  if (charProgressFill) {
    const percent = Math.min(100, (length / MAX_MESSAGE_LENGTH) * 100);
    charProgressFill.style.width = `${percent.toFixed(1)}%`;
    charProgressFill.classList.toggle('near-limit', nearLimit);
    charProgressFill.classList.toggle('at-limit', atLimit);
  }
}

/**
 * Shows or clears an error message directly under the feedback form.
 */
function showError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

function clearError() {
  formError.textContent = '';
  formError.hidden = true;
}

/**
 * Shows or clears an error message inside the authentication modal or gate.
 */
function showAuthError(message) {
  authErrorEl.textContent = message;
  authErrorEl.hidden = false;
}

function clearAuthError() {
  authErrorEl.textContent = '';
  authErrorEl.hidden = true;
}

function showGateNotice(message) {
  if (!gateNotice) {
    return;
  }
  gateNotice.textContent = message;
  gateNotice.hidden = false;
}

function clearGateNotice() {
  if (!gateNotice) {
    return;
  }
  gateNotice.textContent = '';
  gateNotice.hidden = true;
}

/**
 * Plays the Lottie checkmark animation (or a clean SVG fallback offline) inside #success-toast.
 */
function showSuccessToast(title = 'Feedback posted!', subtitle = 'Your message is now live on the wall.') {
  if (!successToast || !lottieContainer) {
    return;
  }

  if (toastTitleEl) {
    toastTitleEl.textContent = title;
  }
  if (toastSubtitleEl) {
    toastSubtitleEl.textContent = subtitle;
  }

  if (toastHideTimer) {
    window.clearTimeout(toastHideTimer);
  }

  successToast.hidden = false;
  // Force reflow so the CSS transition replays smoothly when visible
  void successToast.offsetWidth;
  successToast.classList.add('is-visible');

  if (window.lottie) {
    if (!lottieSuccessAnim) {
      lottieContainer.innerHTML = '';
      lottieSuccessAnim = window.lottie.loadAnimation({
        container: lottieContainer,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        path: 'assets/post-success.json',
      });
    } else {
      lottieSuccessAnim.goToAndPlay(0, true);
    }
  } else {
    lottieContainer.innerHTML = `
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="22" fill="#e53935" />
        <path d="M21 33L29 41L44 24" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
  }

  toastHideTimer = window.setTimeout(() => {
    successToast.classList.remove('is-visible');
    window.setTimeout(() => {
      if (!successToast.classList.contains('is-visible')) {
        successToast.hidden = true;
      }
    }, 240);
  }, 3200);
}

/**
 * Renders the avatar image (when HTTPS Google avatar is present) or initials fallback safely.
 */
function buildAvatarHtml(name, avatarUrl) {
  const safeAvatar = getSafeAvatarUrl(avatarUrl);
  if (safeAvatar) {
    return `<img src="${escapeHtml(safeAvatar)}" alt="" referrerpolicy="no-referrer" />`;
  }
  return escapeHtml(getInitials(name));
}

/**
 * Synchronizes header account controls and the feedback form gate with currentUser.
 */
function updateAuthUI() {
  if (currentUser) {
    authGuestActions.hidden = true;
    authUserChip.hidden = false;
    userChipAvatar.innerHTML = buildAvatarHtml(currentUser.name, currentUser.avatar_url);
    userChipName.textContent = currentUser.name;
    userChipGoogle.hidden = currentUser.auth_provider !== 'google';

    formAuthGate.hidden = true;
    feedbackForm.hidden = false;
    clearGateNotice();
    postingAsName.textContent = currentUser.name;
    postingAsEmail.textContent = currentUser.email;

    if (!nameInput.value.trim()) {
      nameInput.value = currentUser.name;
    }
  } else {
    authGuestActions.hidden = false;
    authUserChip.hidden = true;
    userChipAvatar.innerHTML = '';
    userChipName.textContent = '';
    userChipGoogle.hidden = true;

    formAuthGate.hidden = false;
    feedbackForm.hidden = true;
    postingAsName.textContent = '';
    postingAsEmail.textContent = '';
  }

  window.BatStateScene?.refreshCardEffects();
}

/**
 * Switches the authentication modal between Log In and Create Account views.
 */
function setAuthMode(mode) {
  authMode = mode === 'register' ? 'register' : 'login';
  clearAuthError();

  const isRegister = authMode === 'register';
  tabLogin.classList.toggle('is-active', !isRegister);
  tabRegister.classList.toggle('is-active', isRegister);
  tabLogin.setAttribute('aria-selected', String(!isRegister));
  tabRegister.setAttribute('aria-selected', String(isRegister));

  loginForm.hidden = isRegister;
  registerForm.hidden = !isRegister;

  if (isRegister) {
    authModalTitle.textContent = 'Create Your Account';
    authModalSubtitle.textContent = 'Join BatStateWall or sign in instantly with Gmail';
  } else {
    authModalTitle.textContent = 'Welcome Back';
    authModalSubtitle.textContent = 'Sign in to share feedback on BatStateWall';
  }
}

function openAuthModal(mode = 'login') {
  setAuthMode(mode);
  authModal.hidden = false;
  document.body.style.overflow = 'hidden';

  if (mode === 'register') {
    registerNameInput.focus();
  } else {
    loginEmailInput.focus();
  }
}

function closeAuthModal() {
  authModal.hidden = true;
  document.body.style.overflow = '';
  clearAuthError();
}

/**
 * Checks whether Google OAuth is configured before navigating to /api/auth/google.
 */
function handleGoogleClick(event) {
  if (!googleEnabled) {
    event.preventDefault();
    if (authModal.hidden) {
      openAuthModal('login');
    }
    showAuthError(
      'Google login is not configured on this server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env or Render.'
    );
  }
}

/**
 * Loads current user session, Google OAuth status, and handles OAuth callback query params.
 */
async function loadAuthState() {
  const params = new URLSearchParams(window.location.search);
  const authResult = params.get('auth');
  const authError = params.get('auth_error');

  try {
    const [meRes, cfgRes] = await Promise.all([fetch('/api/auth/me'), fetch('/api/auth/config')]);
    const meData = await meRes.json().catch(() => null);
    const cfgData = await cfgRes.json().catch(() => null);

    currentUser = meData && meData.user ? meData.user : null;
    googleEnabled = Boolean(cfgData && cfgData.googleEnabled);
  } catch (err) {
    console.error('Failed to load authentication state:', err);
    currentUser = null;
  }

  updateAuthUI();

  if (authResult === 'google_success' && currentUser) {
    window.BatStateScene?.pulseSuccess();
    showSuccessToast('Signed in with Google!', `Welcome, ${currentUser.name}`);
  } else if (authError) {
    const messages = {
      google_not_configured:
        'Google login is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env or Render.',
      google_cancelled: 'Google sign-in was cancelled.',
      google_failed: 'Google sign-in failed. Please try again.',
    };
    showGateNotice(messages[authError] || 'Unable to sign in with Google.');
  }

  if (authResult || authError) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

/**
 * Handles email + password login form submission.
 */
async function handleLoginSubmit(event) {
  event.preventDefault();
  clearAuthError();

  const btnLabel = loginSubmitBtn.querySelector('.btn-label');
  loginSubmitBtn.disabled = true;
  if (btnLabel) {
    btnLabel.textContent = 'Logging in...';
  }

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: loginEmailInput.value,
        password: loginPasswordInput.value,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showAuthError(data.error || 'Could not log in. Please try again.');
      window.BatStateScene?.pulseError();
      return;
    }

    currentUser = data.user;
    loginForm.reset();
    closeAuthModal();
    updateAuthUI();
    window.BatStateScene?.pulseSuccess();
    showSuccessToast('Welcome back!', `Signed in as ${currentUser.name}`);
  } catch (err) {
    console.error('Login failed:', err);
    showAuthError('Network error while logging in. Please try again.');
    window.BatStateScene?.pulseError();
  } finally {
    loginSubmitBtn.disabled = false;
    if (btnLabel) {
      btnLabel.textContent = 'Log In';
    }
  }
}

/**
 * Handles new account registration form submission.
 */
async function handleRegisterSubmit(event) {
  event.preventDefault();
  clearAuthError();

  const btnLabel = registerSubmitBtn.querySelector('.btn-label');
  registerSubmitBtn.disabled = true;
  if (btnLabel) {
    btnLabel.textContent = 'Creating account...';
  }

  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: registerNameInput.value,
        email: registerEmailInput.value,
        password: registerPasswordInput.value,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showAuthError(data.error || 'Could not create account. Please try again.');
      window.BatStateScene?.pulseError();
      return;
    }

    currentUser = data.user;
    registerForm.reset();
    closeAuthModal();
    updateAuthUI();
    window.BatStateScene?.pulseSuccess();
    showSuccessToast('Account created!', `Welcome to BatStateWall, ${currentUser.name}`);
  } catch (err) {
    console.error('Registration failed:', err);
    showAuthError('Network error while creating account. Please try again.');
    window.BatStateScene?.pulseError();
  } finally {
    registerSubmitBtn.disabled = false;
    if (btnLabel) {
      btnLabel.textContent = 'Create Account';
    }
  }
}

/**
 * Logs out the current user and refreshes the form gate.
 */
async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    console.error('Logout failed:', err);
  }
  currentUser = null;
  nameInput.value = '';
  clearError();
  updateAuthUI();
}

/**
 * Renders the list of feedback posts and updates both Total posts counters.
 */
function renderPosts(items) {
  const countText = String(items.length);
  const countChanged = lastRenderedCount !== null && lastRenderedCount !== items.length;
  lastRenderedCount = items.length;

  totalPostsEl.textContent = countText;
  if (headerTotalPostsEl) {
    headerTotalPostsEl.textContent = countText;
  }
  if (countChanged) {
    animateCountElement(totalPostsEl);
    animateCountElement(headerTotalPostsEl);
  }

  if (items.length === 0) {
    postsList.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <p>No feedback posted yet. Be the first to leave a message!</p>
      </div>
    `;
    return;
  }

  const cardsHtml = items
    .map((item, index) => {
      const safeId = escapeHtml(item.id);
      const safeName = escapeHtml(item.name);
      const avatarInner = buildAvatarHtml(item.name, item.avatar_url);
      const tone = getAvatarTone(item.name);
      const googleBadgeHtml =
        item.auth_provider === 'google' ? '<span class="post-google-tag">Gmail</span>' : '';
      const safeMessage = escapeHtml(item.message);
      const formattedDate = escapeHtml(formatDate(item.created_at));
      const safeIsoDate = escapeHtml(item.created_at);
      const delayMs = Math.min(index, 5) * 45;

      return `
        <article class="post-card" style="animation-delay: ${delayMs}ms">
          <div class="post-avatar" data-tone="${tone}" aria-hidden="true">${avatarInner}</div>
          <div class="post-body">
            <div class="post-meta">
              <div class="post-identity">
                <span class="post-author">${safeName}</span>
                ${googleBadgeHtml}
                <span class="post-id">#${safeId}</span>
              </div>
              <time class="post-date" datetime="${safeIsoDate}">
                <svg class="date-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>${formattedDate}</span>
              </time>
            </div>
            <p class="post-message">${safeMessage}</p>
          </div>
        </article>
      `;
    })
    .join('');

  postsList.innerHTML = cardsHtml;
  window.BatStateScene?.refreshCardEffects();
}

/**
 * Fetches all feedback posts from GET /api/items and updates the page.
 */
async function loadPosts() {
  try {
    const response = await fetch('/api/items');
    const data = await response.json().catch(() => null);

    if (!response.ok || !Array.isArray(data)) {
      const errorMsg = (data && data.error) || 'Could not load feedback messages.';
      postsList.innerHTML = `<div class="empty-state"><p>${escapeHtml(errorMsg)}</p></div>`;
      return;
    }

    renderPosts(data);
  } catch (err) {
    console.error('Failed to fetch posts:', err);
    postsList.innerHTML =
      '<div class="empty-state"><p>Unable to connect to the server. Please refresh the page.</p></div>';
  }
}

/**
 * Handles form submission by sending a POST /api/items request.
 */
async function handleFormSubmit(event) {
  event.preventDefault();
  clearError();

  const payload = {
    name: nameInput.value,
    message: messageInput.value,
  };

  // Prevent duplicate submissions while waiting for the server response
  submitBtn.disabled = true;
  if (submitBtnLabel) {
    submitBtnLabel.textContent = 'Posting...';
  }

  try {
    const response = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      currentUser = null;
      updateAuthUI();
      showGateNotice(data.error || 'Please log in to post feedback.');
      openAuthModal('login');
      return;
    }

    if (!response.ok) {
      showError(data.error || 'Could not submit your feedback. Please try again.');
      window.BatStateScene?.pulseError();
      return;
    }

    // Reset message while keeping the signed-in user's name pre-filled
    messageInput.value = '';
    if (currentUser && !nameInput.value.trim()) {
      nameInput.value = currentUser.name;
    }
    updateCharCounter();
    clearError();
    window.BatStateScene?.pulseSuccess();
    showSuccessToast('Feedback posted!', 'Your message is now live on the wall.');
    await loadPosts();
  } catch (err) {
    console.error('Failed to submit feedback:', err);
    showError('Network error while posting feedback. Please try again.');
    window.BatStateScene?.pulseError();
  } finally {
    submitBtn.disabled = false;
    if (submitBtnLabel) {
      submitBtnLabel.textContent = 'Post Feedback';
    }
  }
}

// Add elevated glass depth to the sticky header once the page scrolls
if (siteHeader) {
  window.addEventListener(
    'scroll',
    () => {
      siteHeader.classList.toggle('is-scrolled', window.scrollY > 12);
    },
    { passive: true }
  );
}

// Wire up UI event listeners
openLoginBtn?.addEventListener('click', () => openAuthModal('login'));
openRegisterBtn?.addEventListener('click', () => openAuthModal('register'));
gateLoginBtn?.addEventListener('click', () => openAuthModal('login'));
gateRegisterBtn?.addEventListener('click', () => openAuthModal('register'));
gateGoogleBtn?.addEventListener('click', handleGoogleClick);
modalGoogleBtn?.addEventListener('click', handleGoogleClick);
logoutBtn?.addEventListener('click', handleLogout);

closeAuthModalBtn?.addEventListener('click', closeAuthModal);
authModal?.addEventListener('click', (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.closeModal === 'true') {
    closeAuthModal();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && authModal && !authModal.hidden) {
    closeAuthModal();
  }
});

tabLogin?.addEventListener('click', () => setAuthMode('login'));
tabRegister?.addEventListener('click', () => setAuthMode('register'));

document.querySelectorAll('.btn-toggle-pass').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const input = targetId ? document.getElementById(targetId) : null;
    if (!input) {
      return;
    }
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
});

loginForm?.addEventListener('submit', handleLoginSubmit);
registerForm?.addEventListener('submit', handleRegisterSubmit);

nameInput.addEventListener('input', () => {
  window.BatStateScene?.pulseTyping();
});

messageInput.addEventListener('input', () => {
  updateCharCounter();
  window.BatStateScene?.pulseTyping();
});

feedbackForm.addEventListener('submit', handleFormSubmit);

// Initialize counter, authentication state, and community posts on page load
updateCharCounter();
loadAuthState();
loadPosts();
