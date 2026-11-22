// Maximum message length allowed by the backend API
const MAX_MESSAGE_LENGTH = 280;

// Cache references to DOM elements used throughout the script
const feedbackForm = document.getElementById('feedback-form');
const nameInput = document.getElementById('name-input');
const messageInput = document.getElementById('message-input');
const charCounter = document.getElementById('char-counter');
const submitBtn = document.getElementById('submit-btn');
const submitBtnLabel = submitBtn.querySelector('.btn-label');
const formError = document.getElementById('form-error');
const totalPostsEl = document.getElementById('total-posts');
const headerTotalPostsEl = document.getElementById('header-total-posts');
const postsList = document.getElementById('posts-list');

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
 * Updates the live character counter and applies warning highlights near the 280-char limit.
 */
function updateCharCounter() {
  const length = messageInput.value.length;
  charCounter.textContent = `${length} / ${MAX_MESSAGE_LENGTH}`;
  charCounter.classList.toggle('near-limit', length >= 240 && length < 270);
  charCounter.classList.toggle('at-limit', length >= 270);
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
 * Renders the list of feedback posts and updates both Total posts counters.
 */
function renderPosts(items) {
  const countText = String(items.length);
  totalPostsEl.textContent = countText;
  if (headerTotalPostsEl) {
    headerTotalPostsEl.textContent = countText;
  }

  if (items.length === 0) {
    postsList.innerHTML =
      '<div class="empty-state">No feedback posted yet. Be the first to leave a message!</div>';
    return;
  }

  const cardsHtml = items
    .map((item) => {
      const safeName = escapeHtml(item.name);
      const safeInitials = escapeHtml(getInitials(item.name));
      const safeMessage = escapeHtml(item.message);
      const formattedDate = escapeHtml(formatDate(item.created_at));
      const safeIsoDate = escapeHtml(item.created_at);

      return `
        <article class="post-card">
          <div class="post-avatar" aria-hidden="true">${safeInitials}</div>
          <div class="post-body">
            <div class="post-meta">
              <span class="post-author">${safeName}</span>
              <span class="meta-dot" aria-hidden="true">&middot;</span>
              <time class="post-date" datetime="${safeIsoDate}">${formattedDate}</time>
            </div>
            <p class="post-message">${safeMessage}</p>
          </div>
        </article>
      `;
    })
    .join('');

  postsList.innerHTML = cardsHtml;
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
      postsList.innerHTML = `<div class="empty-state">${escapeHtml(errorMsg)}</div>`;
      return;
    }

    renderPosts(data);
  } catch (err) {
    console.error('Failed to fetch posts:', err);
    postsList.innerHTML =
      '<div class="empty-state">Unable to connect to the server. Please refresh the page.</div>';
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
      return;
    }

    // Clear inputs, reset counter, and reload the posts list after a successful post
    feedbackForm.reset();
    updateCharCounter();
    clearError();
    await loadPosts();
  } catch (err) {
    console.error('Failed to submit feedback:', err);
    showError('Network error while posting feedback. Please try again.');
  } finally {
    submitBtn.disabled = false;
    if (submitBtnLabel) {
      submitBtnLabel.textContent = 'Post Feedback';
    }
  }
}

// Wire up UI event listeners
messageInput.addEventListener('input', updateCharCounter);
feedbackForm.addEventListener('submit', handleFormSubmit);

// Initialize counter and load existing posts on page load
updateCharCounter();
loadPosts();
