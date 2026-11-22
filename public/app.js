// Maximum message length allowed by the backend API
const MAX_MESSAGE_LENGTH = 280;

// Cache references to DOM elements used throughout the script
const siteHeader = document.querySelector('.site-header');
const feedbackForm = document.getElementById('feedback-form');
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

// Lottie instance, toast timer, and previous count for subtle counter pulse
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
 * Displays an error message directly under the feedback form.
 */
function showError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

/**
 * Hides and clears the form error alert box.
 */
function clearError() {
  formError.textContent = '';
  formError.hidden = true;
}

/**
 * Plays the Lottie checkmark animation (or a clean SVG fallback offline) inside #success-toast.
 */
function showSuccessToast() {
  if (!successToast || !lottieContainer) {
    return;
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
      const safeInitials = escapeHtml(getInitials(item.name));
      const tone = getAvatarTone(item.name);
      const safeMessage = escapeHtml(item.message);
      const formattedDate = escapeHtml(formatDate(item.created_at));
      const safeIsoDate = escapeHtml(item.created_at);
      const delayMs = Math.min(index, 5) * 45;

      return `
        <article class="post-card" style="animation-delay: ${delayMs}ms">
          <div class="post-avatar" data-tone="${tone}" aria-hidden="true">${safeInitials}</div>
          <div class="post-body">
            <div class="post-meta">
              <div class="post-identity">
                <span class="post-author">${safeName}</span>
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

    if (!response.ok) {
      showError(data.error || 'Could not submit your feedback. Please try again.');
      window.BatStateScene?.pulseError();
      return;
    }

    // Clear inputs, reset counter, play 3D/Lottie success reactions, and reload posts
    feedbackForm.reset();
    updateCharCounter();
    clearError();
    window.BatStateScene?.pulseSuccess();
    showSuccessToast();
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

// Wire up UI event listeners and subtle 3D scene typing pulse
nameInput.addEventListener('input', () => {
  window.BatStateScene?.pulseTyping();
});

messageInput.addEventListener('input', () => {
  updateCharCounter();
  window.BatStateScene?.pulseTyping();
});

feedbackForm.addEventListener('submit', handleFormSubmit);

// Initialize counter and load existing posts on page load
updateCharCounter();
loadPosts();
