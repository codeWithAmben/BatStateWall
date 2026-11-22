// Feed page size and live polling interval
const MAX_MESSAGE_LENGTH = 280;
const PAGE_SIZE = 10;
const STATS_POLL_MS = 20000;

// Header & Search elements
const searchInput = document.getElementById('search-input');
const searchClearBtn = document.getElementById('search-clear-btn');
const openInfoBtn = document.getElementById('open-info-btn');

// Header Auth & Profile Dropdown elements
const authGuestActions = document.getElementById('auth-guest-actions');
const authUserMenu = document.getElementById('auth-user-menu');
const profileMenuBtn = document.getElementById('profile-menu-btn');
const profileDropdown = document.getElementById('profile-dropdown');
const userChipAvatar = document.getElementById('user-chip-avatar');
const userChipName = document.getElementById('user-chip-name');
const dropdownUserName = document.getElementById('dropdown-user-name');
const dropdownUserEmail = document.getElementById('dropdown-user-email');
const dropdownUserGoogle = document.getElementById('dropdown-user-google');
const menuMyPostsBtn = document.getElementById('menu-my-posts');
const headerGoogleBtn = document.getElementById('header-google-btn');
const logoutBtn = document.getElementById('logout-btn');

// Composer strip & modal elements
const composerAvatar = document.getElementById('composer-avatar');
const composerTrigger = document.getElementById('composer-trigger');
const gateNotice = document.getElementById('gate-notice');
const composerModal = document.getElementById('composer-modal');
const closeComposerModalBtn = document.getElementById('close-composer-modal');
const composerModalAvatar = document.getElementById('composer-modal-avatar');
const postingAsName = document.getElementById('posting-as-name');
const feedbackForm = document.getElementById('feedback-form');
const messageInput = document.getElementById('message-input');
const charCounter = document.getElementById('char-counter');
const submitBtn = document.getElementById('submit-btn');
const submitBtnLabel = submitBtn.querySelector('.btn-label');
const formError = document.getElementById('form-error');

// Feed toolbar, live banner, posts & pagination elements
const sortSelect = document.getElementById('sort-select');
const filterAllBtn = document.getElementById('filter-all');
const filterMineBtn = document.getElementById('filter-mine');
const newPostsWrap = document.getElementById('new-posts-wrap');
const newPostsPill = document.getElementById('new-posts-pill');
const newPostsCountEl = document.getElementById('new-posts-count');
const feedErrorEl = document.getElementById('feed-error');
const feedErrorText = document.getElementById('feed-error-text');
const feedRetryBtn = document.getElementById('feed-retry-btn');
const postsList = document.getElementById('posts-list');
const loadMoreWrap = document.getElementById('load-more-wrap');
const loadMoreBtn = document.getElementById('load-more-btn');

// Sidebar & Mobile Info stats elements
const statTotalPosts = document.getElementById('stat-total-posts');
const statTotalMembers = document.getElementById('stat-total-members');
const statPostsToday = document.getElementById('stat-posts-today');
const mobileStatPosts = document.getElementById('mobile-stat-posts');
const mobileStatMembers = document.getElementById('mobile-stat-members');
const mobileStatToday = document.getElementById('mobile-stat-today');
const infoModal = document.getElementById('info-modal');
const closeInfoModalBtn = document.getElementById('close-info-modal');

// Auth modal elements (Google OAuth only)
const authModal = document.getElementById('auth-modal');
const closeAuthModalBtn = document.getElementById('close-auth-modal');
const authModalSubtitle = document.getElementById('auth-modal-subtitle');
const modalGoogleBtn = document.getElementById('modal-google-btn');
const authErrorEl = document.getElementById('auth-error');

// Toast elements
const successToast = document.getElementById('success-toast');
const lottieContainer = document.getElementById('lottie-success');
const toastTitleEl = document.getElementById('toast-title');
const toastSubtitleEl = document.getElementById('toast-subtitle');

// Client application state
let currentUser = null;
let googleEnabled = false;
let posts = [];
let hasMorePosts = false;
let knownLatestId = 0;
let highlightedPostId = null;
let lottieSuccessAnim = null;
let toastHideTimer = null;
let searchDebounceTimer = null;
const commentsCache = new Map();

const feedState = {
  sort: 'latest',
  filter: 'all',
  q: '',
  offset: 0,
};

/**
 * Escapes HTML special characters in user-provided text to prevent XSS attacks.
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

function getSafeAvatarUrl(url) {
  if (typeof url === 'string' && url.startsWith('https://')) {
    return url;
  }
  return null;
}

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

function getAvatarTone(name) {
  const text = String(name ?? '');
  let sum = 0;
  for (let i = 0; i < text.length; i += 1) {
    sum += text.charCodeAt(i);
  }
  return sum % 5;
}

function buildAvatarHtml(name, avatarUrl) {
  const safeAvatar = getSafeAvatarUrl(avatarUrl);
  if (safeAvatar) {
    return `<img src="${escapeHtml(safeAvatar)}" alt="" referrerpolicy="no-referrer" />`;
  }
  return escapeHtml(getInitials(name));
}

function formatFullDate(isoString) {
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
 * Formats timestamps into compact relative labels ("5m ago", "2h ago") with full date fallback.
 */
function formatRelativeTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown date';
  }
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 45) {
    return 'Just now';
  }
  if (diffSec < 3600) {
    return `${Math.floor(diffSec / 60)}m ago`;
  }
  if (diffSec < 86400) {
    return `${Math.floor(diffSec / 3600)}h ago`;
  }
  if (diffSec < 604800) {
    return `${Math.floor(diffSec / 86400)}d ago`;
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Plays the Lottie checkmark animation (or inline SVG fallback) inside #success-toast.
 */
function showSuccessToast(title = 'Feedback posted!', subtitle = 'Your message is now live on the wall.') {
  if (!successToast || !lottieContainer) {
    return;
  }

  toastTitleEl.textContent = title;
  toastSubtitleEl.textContent = subtitle;

  if (toastHideTimer) {
    window.clearTimeout(toastHideTimer);
  }

  successToast.hidden = false;
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
    }, 220);
  }, 3000);
}

function syncBodyScrollLock() {
  const sudokuModal = document.getElementById('sudoku-modal');
  const rankingsModal = document.getElementById('rankings-modal');
  const anyModalOpen =
    (authModal && !authModal.hidden) ||
    (composerModal && !composerModal.hidden) ||
    (infoModal && !infoModal.hidden) ||
    (sudokuModal && !sudokuModal.hidden) ||
    (rankingsModal && !rankingsModal.hidden);
  document.body.style.overflow = anyModalOpen ? 'hidden' : '';
}

function closeAllMenus() {
  if (profileDropdown && !profileDropdown.hidden) {
    profileDropdown.hidden = true;
    profileMenuBtn?.setAttribute('aria-expanded', 'false');
  }
  document.querySelectorAll('.post-dropdown:not([hidden])').forEach((menu) => {
    menu.hidden = true;
  });
  document.querySelectorAll('.post-card.menu-open').forEach((card) => {
    card.classList.remove('menu-open');
  });
}

function showGateNotice(message) {
  gateNotice.textContent = message;
  gateNotice.hidden = false;
}

function clearGateNotice() {
  gateNotice.textContent = '';
  gateNotice.hidden = true;
}

/**
 * Updates header controls, compact composer placeholder, and profile dropdown.
 */
function updateAuthUI() {
  if (currentUser) {
    const firstName = currentUser.name.trim().split(/\s+/)[0] || currentUser.name;
    const tone = getAvatarTone(currentUser.name);

    authGuestActions.hidden = true;
    authUserMenu.hidden = false;
    userChipAvatar.dataset.tone = String(tone);
    userChipAvatar.innerHTML = buildAvatarHtml(currentUser.name, currentUser.avatar_url);
    userChipName.textContent = firstName;
    dropdownUserName.textContent = currentUser.name;
    dropdownUserEmail.textContent = currentUser.email;
    dropdownUserGoogle.hidden = currentUser.auth_provider !== 'google';

    composerAvatar.dataset.tone = String(tone);
    composerAvatar.innerHTML = buildAvatarHtml(currentUser.name, currentUser.avatar_url);
    composerTrigger.textContent = `What's on your mind, ${firstName}?`;

    composerModalAvatar.dataset.tone = String(tone);
    composerModalAvatar.innerHTML = buildAvatarHtml(currentUser.name, currentUser.avatar_url);
    postingAsName.textContent = currentUser.name;
    clearGateNotice();
  } else {
    authGuestActions.hidden = false;
    authUserMenu.hidden = true;
    profileDropdown.hidden = true;
    profileMenuBtn.setAttribute('aria-expanded', 'false');

    composerAvatar.dataset.tone = 'guest';
    composerAvatar.textContent = '?';
    composerTrigger.textContent = 'Sign in with Google to share your feedback...';
  }

  window.dispatchEvent(new CustomEvent('batstate:auth-changed', { detail: { user: currentUser } }));
}

/* ==================== Modals & Composer Controls ==================== */

function updateComposerState() {
  const length = messageInput.value.length;
  const hasText = messageInput.value.trim().length > 0;

  submitBtn.disabled = !hasText;

  // Auto-grow textarea height smoothly without manual resize handle
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 260)}px`;

  if (length >= 240) {
    charCounter.hidden = false;
    charCounter.textContent = `${length} / ${MAX_MESSAGE_LENGTH}`;
    charCounter.classList.toggle('near-limit', length >= 240 && length < 270);
    charCounter.classList.toggle('at-limit', length >= 270);
  } else {
    charCounter.hidden = true;
    charCounter.classList.remove('near-limit', 'at-limit');
  }
}

function openComposerModal() {
  if (!currentUser) {
    openAuthModal('Sign in with Google to share your feedback.');
    return;
  }
  closeAllMenus();
  formError.textContent = '';
  formError.hidden = true;
  composerModal.hidden = false;
  syncBodyScrollLock();
  updateComposerState();
  messageInput.focus();
}

function openComposerWithText(prefillText) {
  openComposerModal();
  if (!currentUser) {
    return;
  }
  messageInput.value = String(prefillText ?? '').slice(0, MAX_MESSAGE_LENGTH);
  updateComposerState();
  messageInput.focus();
}

function closeComposerModal() {
  composerModal.hidden = true;
  formError.textContent = '';
  formError.hidden = true;
  syncBodyScrollLock();
}

function openInfoModal() {
  closeAllMenus();
  infoModal.hidden = false;
  syncBodyScrollLock();
}

function closeInfoModal() {
  infoModal.hidden = true;
  syncBodyScrollLock();
}

const DEFAULT_AUTH_SUBTITLE = 'Log in or create your account with your Google / Gmail account.';

function openAuthModal(subtitle) {
  closeAllMenus();
  authErrorEl.textContent = '';
  authErrorEl.hidden = true;
  if (authModalSubtitle) {
    authModalSubtitle.textContent =
      typeof subtitle === 'string' && subtitle && subtitle !== 'login'
        ? subtitle
        : DEFAULT_AUTH_SUBTITLE;
  }
  authModal.hidden = false;
  syncBodyScrollLock();
  modalGoogleBtn?.focus();
}

function closeAuthModal() {
  authModal.hidden = true;
  authErrorEl.textContent = '';
  authErrorEl.hidden = true;
  syncBodyScrollLock();
}

function handleGoogleClick(event) {
  if (!googleEnabled) {
    event.preventDefault();
    if (authModal.hidden) {
      openAuthModal();
    }
    authErrorEl.textContent =
      'Google login is not configured on this server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env or Render.';
    authErrorEl.hidden = false;
  }
}

/* ==================== Community Stats & Live Polling ==================== */

function applyStats(stats) {
  const totalPostsText = String(stats.totalPosts ?? 0);
  const totalMembersText = String(stats.totalMembers ?? 0);
  const postsTodayText = String(stats.postsToday ?? 0);

  statTotalPosts.textContent = totalPostsText;
  statTotalMembers.textContent = totalMembersText;
  statPostsToday.textContent = postsTodayText;

  mobileStatPosts.textContent = totalPostsText;
  mobileStatMembers.textContent = totalMembersText;
  mobileStatToday.textContent = postsTodayText;
}

async function loadStats() {
  try {
    const response = await fetch('/api/stats');
    if (!response.ok) {
      return null;
    }
    const stats = await response.json();
    applyStats(stats);
    return stats;
  } catch (err) {
    console.error('Failed to load community stats:', err);
    return null;
  }
}

async function checkForNewPosts() {
  if (document.hidden || feedState.sort !== 'latest' || feedState.filter !== 'all' || feedState.q) {
    return;
  }
  const stats = await loadStats();
  if (stats && knownLatestId > 0 && stats.latestPostId > knownLatestId) {
    const diff = stats.latestPostId - knownLatestId;
    newPostsCountEl.textContent = String(diff);
    newPostsWrap.hidden = false;
  }
}

/* ==================== Feed Rendering & Interactions ==================== */

function renderCommentHtml(comment) {
  const author = escapeHtml(comment.author_name);
  const avatarInner = buildAvatarHtml(comment.author_name, comment.avatar_url);
  const tone = getAvatarTone(comment.author_name);
  const relTime = escapeHtml(formatRelativeTime(comment.created_at));
  const fullTime = escapeHtml(formatFullDate(comment.created_at));
  const body = escapeHtml(comment.body);

  return `
    <div class="comment-item">
      <div class="comment-avatar" data-tone="${tone}" aria-hidden="true">${avatarInner}</div>
      <div class="comment-bubble">
        <div class="comment-header">
          <span class="comment-author">${author}</span>
          <span class="comment-time" title="${fullTime}">${relTime}</span>
        </div>
        <div class="comment-body">${body}</div>
      </div>
    </div>
  `;
}

function renderPostCardHtml(item) {
  const id = escapeHtml(item.id);
  const safeName = escapeHtml(item.name);
  const avatarInner = buildAvatarHtml(item.name, item.avatar_url);
  const tone = getAvatarTone(item.name);
  const relTime = escapeHtml(formatRelativeTime(item.created_at));
  const fullTime = escapeHtml(formatFullDate(item.created_at));
  const safeMessage = escapeHtml(item.message);
  const likeCount = Number(item.like_count) || 0;
  const commentCount = Number(item.comment_count) || 0;
  const liked = Boolean(item.liked_by_me);
  const isOwner = Boolean(item.is_owner);
  const optimisticClass = item._optimistic ? 'is-optimistic' : '';
  const highlightedClass = Number(item.id) === highlightedPostId ? 'is-highlighted' : '';

  const googleBadgeHtml =
    item.auth_provider === 'google' ? '<span class="google-badge">Gmail</span>' : '';

  const sudokuRank = Number(item.sudoku_rank);
  let rankBadgeHtml = '';
  if (Number.isInteger(sudokuRank) && sudokuRank >= 1 && sudokuRank <= 10) {
    const rankClass =
      sudokuRank === 1
        ? 'rank-gold'
        : sudokuRank === 2
          ? 'rank-silver'
          : sudokuRank === 3
            ? 'rank-bronze'
            : 'rank-top10';
    rankBadgeHtml = `<span class="rank-badge ${rankClass}" title="Sudoku Community Rank #${sudokuRank}">#${sudokuRank} Sudoku</span>`;
  }

  const summaryHtml =
    likeCount > 0 || commentCount > 0
      ? `
      <div class="post-counts">
        <span class="like-summary">
          ${
            likeCount > 0
              ? `<span class="like-dot-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </span><span>${likeCount}</span>`
              : ''
          }
        </span>
        ${
          commentCount > 0
            ? `<button type="button" class="comments-toggle-link" data-action="toggle-comments" data-post-id="${id}">
                View ${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}
              </button>`
            : '<span></span>'
        }
      </div>
    `
      : '';

  return `
    <article class="fb-card post-card ${optimisticClass} ${highlightedClass}" data-post-id="${id}">
      <div class="post-header">
        <div class="post-author-row">
          <div class="post-avatar" data-tone="${tone}" aria-hidden="true">${avatarInner}</div>
          <div class="post-author-meta">
            <div class="post-name-line">
              <span class="post-author">${safeName}</span>
              ${rankBadgeHtml}
              ${googleBadgeHtml}
            </div>
            <div class="post-submeta">
              <time datetime="${escapeHtml(item.created_at)}" title="${fullTime}">${relTime}</time>
              <span aria-hidden="true">&middot;</span>
              <svg class="globe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </div>
          </div>
        </div>

        <div class="post-menu-wrap">
          <button
            type="button"
            class="btn-menu-dots"
            data-action="toggle-menu"
            data-post-id="${id}"
            aria-label="More options for post by ${safeName}"
            aria-haspopup="menu"
          >
            &hellip;
          </button>
          <div class="dropdown-menu post-dropdown" role="menu" hidden>
            <div class="dropdown-item info-only">Post #${id}</div>
            <button type="button" class="dropdown-item" data-action="copy-link" data-post-id="${id}" role="menuitem">
              <span>Copy link</span>
            </button>
            <button type="button" class="dropdown-item" data-action="report-post" data-post-id="${id}" role="menuitem">
              <span>Report post</span>
            </button>
            ${
              isOwner
                ? `<button type="button" class="dropdown-item danger" data-action="delete-post" data-post-id="${id}" role="menuitem">
                    <span>Delete post</span>
                  </button>`
                : ''
            }
          </div>
        </div>
      </div>

      <p class="post-message">${safeMessage}</p>

      ${summaryHtml}

      <div class="post-actions">
        <button
          type="button"
          class="action-btn ${liked ? 'is-liked' : ''}"
          data-action="like-post"
          data-post-id="${id}"
          aria-pressed="${liked}"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          <span>${liked ? 'Liked' : 'Like'}</span>
        </button>

        <button
          type="button"
          class="action-btn"
          data-action="toggle-comments"
          data-post-id="${id}"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>Comment</span>
        </button>

        <button
          type="button"
          class="action-btn"
          data-action="share-post"
          data-post-id="${id}"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span>Share</span>
        </button>
      </div>

      <div class="comments-section" data-comments-for="${id}" hidden>
        <div class="comments-list"></div>
        <form class="comment-form" data-post-id="${id}">
          <input
            type="text"
            class="comment-input"
            maxlength="280"
            placeholder="${currentUser ? 'Write a comment...' : 'Log in to write a comment...'}"
            aria-label="Write a comment"
          />
          <button type="submit" class="comment-send-btn">Post</button>
        </form>
        <div class="comment-error" role="alert" hidden></div>
      </div>
    </article>
  `;
}

function renderPosts() {
  if (posts.length === 0) {
    const isFiltered = Boolean(feedState.q || feedState.filter === 'mine');
    postsList.innerHTML = `
      <div class="fb-card empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <p>${
          isFiltered
            ? 'No posts match your current search or filter.'
            : 'No posts yet. Be the first to post on BatStateWall!'
        }</p>
        ${
          isFiltered
            ? '<button type="button" id="reset-filters-btn" class="btn-ghost btn-sm">Reset filters</button>'
            : ''
        }
      </div>
    `;
    loadMoreWrap.hidden = true;
    return;
  }

  postsList.innerHTML = posts.map(renderPostCardHtml).join('');
  loadMoreWrap.hidden = !hasMorePosts;

  // Re-open any expanded comments from cache after re-render
  posts.forEach((item) => {
    const cached = commentsCache.get(item.id);
    if (cached && cached.open) {
      const section = postsList.querySelector(`.comments-section[data-comments-for="${item.id}"]`);
      if (section) {
        section.hidden = false;
        const listEl = section.querySelector('.comments-list');
        listEl.innerHTML =
          cached.items.length > 0
            ? cached.items.map(renderCommentHtml).join('')
            : '<div class="comments-status">No comments yet. Start the conversation!</div>';
      }
    }
  });
}

async function fetchFeed({ append = false } = {}) {
  feedErrorEl.hidden = true;
  if (!append) {
    feedState.offset = 0;
  }

  const params = new URLSearchParams({
    sort: feedState.sort,
    filter: feedState.filter,
    limit: String(PAGE_SIZE + 1),
    offset: String(feedState.offset),
  });
  if (feedState.q) {
    params.set('q', feedState.q);
  }

  try {
    const response = await fetch(`/api/items?${params.toString()}`);
    const data = await response.json().catch(() => null);

    if (!response.ok || !Array.isArray(data)) {
      const errMsg = (data && data.error) || 'Could not load posts.';
      feedErrorText.textContent = errMsg;
      feedErrorEl.hidden = false;
      if (!append && posts.length === 0) {
        postsList.innerHTML = '';
      }
      return;
    }

    hasMorePosts = data.length > PAGE_SIZE;
    const pageItems = hasMorePosts ? data.slice(0, PAGE_SIZE) : data;

    if (append) {
      const existingIds = new Set(posts.map((p) => p.id));
      posts = posts.concat(pageItems.filter((p) => !existingIds.has(p.id)));
    } else {
      posts = pageItems;
      newPostsWrap.hidden = true;

      // Handle deep-linked post (?post=123) if it wasn't on page 1
      if (highlightedPostId && !posts.some((p) => p.id === highlightedPostId)) {
        const singleRes = await fetch(`/api/items/${highlightedPostId}`);
        if (singleRes.ok) {
          const singlePost = await singleRes.json();
          posts = [singlePost, ...posts];
        }
      }
    }

    const maxId = posts.reduce((max, item) => (item.id > max ? item.id : max), 0);
    if (maxId > knownLatestId) {
      knownLatestId = maxId;
    }

    renderPosts();

    if (!append && highlightedPostId) {
      const target = postsList.querySelector(`.post-card[data-post-id="${highlightedPostId}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      window.setTimeout(() => {
        highlightedPostId = null;
        document.querySelectorAll('.post-card.is-highlighted').forEach((el) => {
          el.classList.remove('is-highlighted');
        });
      }, 2400);
    }
  } catch (err) {
    console.error('Failed to load feed:', err);
    feedErrorText.textContent = 'Network error while loading posts.';
    feedErrorEl.hidden = false;
    if (!append && posts.length === 0) {
      postsList.innerHTML = '';
    }
  } finally {
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = 'Load more posts';
  }
}

/* ==================== Post Action Handlers ==================== */

async function handleToggleLike(postId, buttonEl) {
  if (!currentUser) {
    openAuthModal();
    return;
  }
  const post = posts.find((p) => p.id === postId);
  if (!post || post._optimistic) {
    return;
  }

  // Optimistic toggle with scale pop
  const prevLiked = Boolean(post.liked_by_me);
  const prevCount = Number(post.like_count) || 0;
  post.liked_by_me = !prevLiked;
  post.like_count = Math.max(0, prevCount + (post.liked_by_me ? 1 : -1));
  renderPosts();

  const updatedBtn = postsList.querySelector(`.action-btn[data-action="like-post"][data-post-id="${postId}"]`);
  if (updatedBtn && post.liked_by_me) {
    updatedBtn.classList.add('like-pop');
  }

  try {
    const response = await fetch(`/api/items/${postId}/like`, { method: 'POST' });
    if (response.status === 401) {
      currentUser = null;
      updateAuthUI();
      openAuthModal();
      return;
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw new Error('Like failed');
    }
    post.liked_by_me = Boolean(data.liked);
    post.like_count = Number(data.like_count) || 0;
    renderPosts();
  } catch (err) {
    console.error('Like error:', err);
    post.liked_by_me = prevLiked;
    post.like_count = prevCount;
    renderPosts();
    if (buttonEl) {
      showSuccessToast('Could not update like', 'Please try again.');
    }
  }
}

async function loadPostComments(postId, sectionEl) {
  const listEl = sectionEl.querySelector('.comments-list');
  listEl.innerHTML = '<div class="comments-status">Loading comments...</div>';

  try {
    const response = await fetch(`/api/items/${postId}/comments`);
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data)) {
      listEl.innerHTML = '<div class="comments-status">Could not load comments.</div>';
      return;
    }
    commentsCache.set(postId, { open: true, items: data });
    listEl.innerHTML =
      data.length > 0
        ? data.map(renderCommentHtml).join('')
        : '<div class="comments-status">No comments yet. Start the conversation!</div>';
  } catch (err) {
    console.error('Comments fetch error:', err);
    listEl.innerHTML = '<div class="comments-status">Network error loading comments.</div>';
  }
}

async function handleToggleComments(postId) {
  const section = postsList.querySelector(`.comments-section[data-comments-for="${postId}"]`);
  if (!section) {
    return;
  }

  const willOpen = section.hidden;
  section.hidden = !willOpen;
  const cached = commentsCache.get(postId) || { open: false, items: [] };
  cached.open = willOpen;
  commentsCache.set(postId, cached);

  if (willOpen) {
    await loadPostComments(postId, section);
    const input = section.querySelector('.comment-input');
    input?.focus();
  }
}

async function handleSubmitComment(postId, formEl) {
  if (!currentUser) {
    openAuthModal();
    return;
  }
  const input = formEl.querySelector('.comment-input');
  const sendBtn = formEl.querySelector('.comment-send-btn');
  const errorEl = formEl.parentElement?.querySelector('.comment-error');
  const body = input.value.trim();
  if (!body) {
    return;
  }

  if (errorEl) {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }

  sendBtn.disabled = true;
  try {
    const response = await fetch(`/api/items/${postId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });

    if (response.status === 401) {
      currentUser = null;
      updateAuthUI();
      openAuthModal();
      return;
    }

    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      const errMsg = (data && data.error) || 'Could not post comment. Please try again.';
      if (errorEl) {
        errorEl.textContent = errMsg;
        errorEl.hidden = false;
      } else {
        showSuccessToast('Comment not posted', errMsg);
      }
      window.BatStateScene?.pulseError();
      return;
    }

    input.value = '';
    const cached = commentsCache.get(postId) || { open: true, items: [] };
    cached.open = true;
    cached.items.push(data);
    commentsCache.set(postId, cached);

    const post = posts.find((p) => p.id === postId);
    if (post) {
      post.comment_count = (Number(post.comment_count) || 0) + 1;
    }
    renderPosts();
  } catch (err) {
    console.error('Failed to post comment:', err);
    showSuccessToast('Network error', 'Could not post comment.');
  } finally {
    sendBtn.disabled = false;
  }
}

async function handleSharePost(postId, useNativeShare = true) {
  const url = `${window.location.origin}/?post=${postId}`;
  if (useNativeShare && navigator.share) {
    try {
      await navigator.share({ title: 'BatStateWall Post', url });
      return;
    } catch {
      // User cancelled or native share unsupported; fall back to clipboard
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    showSuccessToast('Link copied!', 'Post link copied to your clipboard.');
  } catch {
    showSuccessToast('Share link ready', url);
  }
}

async function handleReportPost(postId) {
  closeAllMenus();
  if (!currentUser) {
    openAuthModal();
    return;
  }

  try {
    const response = await fetch(`/api/items/${postId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Reported from feed menu' }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      currentUser = null;
      updateAuthUI();
      openAuthModal();
      return;
    }
    if (!response.ok) {
      showSuccessToast('Report failed', data.error || 'Could not submit report.');
      return;
    }
    showSuccessToast('Report submitted', 'Thank you for helping keep BatStateWall respectful.');
  } catch (err) {
    console.error('Report error:', err);
    showSuccessToast('Network error', 'Could not submit report.');
  }
}

async function handleDeletePost(postId, btnEl) {
  // Inline confirmation step inside the menu before deleting
  if (btnEl.dataset.confirmed !== '1') {
    btnEl.dataset.confirmed = '1';
    btnEl.querySelector('span').textContent = 'Confirm delete?';
    return;
  }

  closeAllMenus();
  try {
    const response = await fetch(`/api/items/${postId}`, { method: 'DELETE' });
    if (response.status === 401) {
      currentUser = null;
      updateAuthUI();
      openAuthModal();
      return;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showSuccessToast('Delete failed', data.error || 'Could not delete post.');
      return;
    }

    posts = posts.filter((p) => p.id !== postId);
    commentsCache.delete(postId);
    renderPosts();
    loadStats();
    showSuccessToast('Post deleted', 'Your post has been removed.');
  } catch (err) {
    console.error('Delete error:', err);
    showSuccessToast('Network error', 'Could not delete post.');
  }
}

/* ==================== Auth & Post Submission Handlers ==================== */

async function loadAuthState() {
  const params = new URLSearchParams(window.location.search);
  const authResult = params.get('auth');
  const authError = params.get('auth_error');
  const postParam = params.get('post');
  if (postParam && /^\d+$/.test(postParam)) {
    highlightedPostId = Number(postParam);
  }

  try {
    const [meRes, cfgRes] = await Promise.all([fetch('/api/auth/me'), fetch('/api/auth/config')]);
    const meData = await meRes.json().catch(() => null);
    const cfgData = await cfgRes.json().catch(() => null);

    currentUser = meData && meData.user ? meData.user : null;
    googleEnabled = Boolean(cfgData && cfgData.googleEnabled);
  } catch (err) {
    console.error('Failed to load auth state:', err);
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

async function handleLogout() {
  closeAllMenus();
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    console.error('Logout failed:', err);
  }
  currentUser = null;
  if (feedState.filter === 'mine') {
    feedState.filter = 'all';
    filterAllBtn.classList.add('is-active');
    filterMineBtn.classList.remove('is-active');
  }
  updateAuthUI();
  fetchFeed();
}

/**
 * Optimistically prepends new post and reconciles with POST /api/items.
 */
async function handleFormSubmit(event) {
  event.preventDefault();
  if (!currentUser) {
    closeComposerModal();
    openAuthModal();
    return;
  }

  const trimmedMessage = messageInput.value.trim();
  if (!trimmedMessage) {
    formError.textContent = 'Message is required.';
    formError.hidden = false;
    return;
  }

  formError.hidden = true;
  submitBtn.disabled = true;
  if (submitBtnLabel) {
    submitBtnLabel.textContent = 'Posting...';
  }

  const canPrependOptimistically =
    feedState.sort === 'latest' && !feedState.q && (feedState.filter === 'all' || feedState.filter === 'mine');
  const tempId = -Date.now();
  const optimisticPost = {
    id: tempId,
    name: currentUser.name,
    message: trimmedMessage,
    user_id: currentUser.id,
    avatar_url: currentUser.avatar_url,
    auth_provider: currentUser.auth_provider,
    created_at: new Date().toISOString(),
    like_count: 0,
    comment_count: 0,
    liked_by_me: false,
    is_owner: true,
    _optimistic: true,
  };

  if (canPrependOptimistically) {
    posts = [optimisticPost, ...posts];
    renderPosts();
  }

  messageInput.value = '';
  updateComposerState();
  closeComposerModal();
  window.BatStateScene?.pulseSuccess();
  showSuccessToast('Feedback posted!', 'Your message is now live on the wall.');

  try {
    const response = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: trimmedMessage }),
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      posts = posts.filter((p) => p.id !== tempId);
      renderPosts();
      currentUser = null;
      updateAuthUI();
      openAuthModal();
      return;
    }

    if (!response.ok) {
      posts = posts.filter((p) => p.id !== tempId);
      renderPosts();
      openComposerModal();
      messageInput.value = trimmedMessage;
      updateComposerState();
      formError.textContent = data.error || 'Could not submit your post.';
      formError.hidden = false;
      window.BatStateScene?.pulseError();
      return;
    }

    if (canPrependOptimistically) {
      posts = posts.map((p) => (p.id === tempId ? data : p));
      if (data.id > knownLatestId) {
        knownLatestId = data.id;
      }
      renderPosts();
    } else {
      await fetchFeed();
    }
    loadStats();
  } catch (err) {
    console.error('Failed to submit post:', err);
    posts = posts.filter((p) => p.id !== tempId);
    renderPosts();
    openComposerModal();
    messageInput.value = trimmedMessage;
    updateComposerState();
    formError.textContent = 'Network error while posting. Please try again.';
    formError.hidden = false;
    window.BatStateScene?.pulseError();
  } finally {
    submitBtn.disabled = !messageInput.value.trim();
    if (submitBtnLabel) {
      submitBtnLabel.textContent = 'Post';
    }
  }
}

/* ==================== Event Wiring ==================== */

// Header & Profile Dropdown
headerGoogleBtn?.addEventListener('click', handleGoogleClick);
modalGoogleBtn?.addEventListener('click', handleGoogleClick);
logoutBtn?.addEventListener('click', handleLogout);

profileMenuBtn?.addEventListener('click', (event) => {
  event.stopPropagation();
  const willOpen = profileDropdown.hidden;
  closeAllMenus();
  profileDropdown.hidden = !willOpen;
  profileMenuBtn.setAttribute('aria-expanded', String(willOpen));
});

menuMyPostsBtn?.addEventListener('click', () => {
  closeAllMenus();
  feedState.filter = 'mine';
  filterMineBtn.classList.add('is-active');
  filterAllBtn.classList.remove('is-active');
  fetchFeed();
});

// Composer & Modals
composerTrigger?.addEventListener('click', openComposerModal);
closeComposerModalBtn?.addEventListener('click', closeComposerModal);
composerModal?.addEventListener('click', (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.closeComposer === 'true') {
    closeComposerModal();
  }
});

openInfoBtn?.addEventListener('click', openInfoModal);
closeInfoModalBtn?.addEventListener('click', closeInfoModal);
infoModal?.addEventListener('click', (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.closeInfo === 'true') {
    closeInfoModal();
  }
});

closeAuthModalBtn?.addEventListener('click', closeAuthModal);
authModal?.addEventListener('click', (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.closeModal === 'true') {
    closeAuthModal();
  }
});

feedbackForm?.addEventListener('submit', handleFormSubmit);

messageInput?.addEventListener('input', () => {
  updateComposerState();
  window.BatStateScene?.pulseTyping();
});

// Search, Sort, Filter, Load More & New Posts Pill
searchInput?.addEventListener('input', () => {
  const val = searchInput.value.trim();
  searchClearBtn.hidden = val.length === 0;
  window.clearTimeout(searchDebounceTimer);
  searchDebounceTimer = window.setTimeout(() => {
    feedState.q = val;
    fetchFeed();
  }, 260);
});

searchClearBtn?.addEventListener('click', () => {
  searchInput.value = '';
  searchClearBtn.hidden = true;
  feedState.q = '';
  fetchFeed();
  searchInput.focus();
});

sortSelect?.addEventListener('change', () => {
  feedState.sort = sortSelect.value === 'popular' ? 'popular' : 'latest';
  fetchFeed();
});

filterAllBtn?.addEventListener('click', () => {
  if (feedState.filter === 'all') {
    return;
  }
  feedState.filter = 'all';
  filterAllBtn.classList.add('is-active');
  filterMineBtn.classList.remove('is-active');
  fetchFeed();
});

filterMineBtn?.addEventListener('click', () => {
  if (!currentUser) {
    openAuthModal('Sign in with Google to view your posts.');
    return;
  }
  if (feedState.filter === 'mine') {
    return;
  }
  feedState.filter = 'mine';
  filterMineBtn.classList.add('is-active');
  filterAllBtn.classList.remove('is-active');
  fetchFeed();
});

newPostsPill?.addEventListener('click', () => {
  newPostsWrap.hidden = true;
  fetchFeed();
  loadStats();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

feedRetryBtn?.addEventListener('click', () => {
  fetchFeed();
  loadStats();
});

loadMoreBtn?.addEventListener('click', () => {
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = 'Loading...';
  feedState.offset += PAGE_SIZE;
  fetchFeed({ append: true });
});

// Event delegation on posts feed (Like, Comments, Share, Overflow Menu, Reset Filters)
postsList?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  if (target.closest('#reset-filters-btn')) {
    searchInput.value = '';
    searchClearBtn.hidden = true;
    feedState.q = '';
    feedState.filter = 'all';
    filterAllBtn.classList.add('is-active');
    filterMineBtn.classList.remove('is-active');
    fetchFeed();
    return;
  }

  const actionEl = target.closest('[data-action]');
  if (!actionEl) {
    return;
  }

  const action = actionEl.dataset.action;
  const postId = Number(actionEl.dataset.postId);

  if (action === 'toggle-menu') {
    event.stopPropagation();
    const menu = actionEl.nextElementSibling;
    const card = actionEl.closest('.post-card');
    const willOpen = menu && menu.hidden;
    closeAllMenus();
    if (menu) {
      menu.hidden = !willOpen;
      if (card) {
        card.classList.toggle('menu-open', Boolean(willOpen));
      }
      const deleteBtn = menu.querySelector('[data-action="delete-post"]');
      if (deleteBtn) {
        delete deleteBtn.dataset.confirmed;
        deleteBtn.querySelector('span').textContent = 'Delete post';
      }
    }
    return;
  }

  if (!Number.isFinite(postId)) {
    return;
  }

  if (action === 'like-post') {
    handleToggleLike(postId, actionEl);
  } else if (action === 'toggle-comments') {
    handleToggleComments(postId);
  } else if (action === 'share-post') {
    handleSharePost(postId, true);
  } else if (action === 'copy-link') {
    closeAllMenus();
    handleSharePost(postId, false);
  } else if (action === 'report-post') {
    handleReportPost(postId);
  } else if (action === 'delete-post') {
    handleDeletePost(postId, actionEl);
  }
});

postsList?.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.classList.contains('comment-form')) {
    return;
  }
  event.preventDefault();
  const postId = Number(form.dataset.postId);
  if (Number.isFinite(postId)) {
    handleSubmitComment(postId, form);
  }
});

// Close open dropdowns / modals cleanly on outside click or Escape
document.addEventListener('click', (event) => {
  const target = event.target;
  if (target instanceof Element && !target.closest('.profile-menu-wrap') && !target.closest('.post-menu-wrap')) {
    closeAllMenus();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }
  closeAllMenus();
  if (!composerModal.hidden) {
    closeComposerModal();
  }
  if (!infoModal.hidden) {
    closeInfoModal();
  }
  if (!authModal.hidden) {
    closeAuthModal();
  }
});

// Expose safe integration hooks for sibling UI modules (sudoku.js)
window.BatStateWall = {
  getCurrentUser: () => currentUser,
  openAuthModal,
  openComposerWithText,
  closeInfoModal,
  showSuccessToast,
  refreshFeed: () => fetchFeed(),
  syncBodyScrollLock,
  escapeHtml,
  buildAvatarHtml,
  getAvatarTone,
};

// Initialize page state & start background live-feed poll
(async function init() {
  await loadAuthState();
  await Promise.all([fetchFeed(), loadStats()]);
  window.setInterval(checkForNewPosts, STATS_POLL_MS);
})();
