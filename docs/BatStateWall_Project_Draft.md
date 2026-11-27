# BATSTATEWALL: A CLOUD-DEPLOYED COMMUNITY FEEDBACK WALL AND GAMIFIED SUDOKU ARENA WEB APPLICATION FOR BATANGAS STATE UNIVERSITY

**A Final Project Presentation to the Subject Teacher of Platform Technologies**  
**Batangas State University – The National Engineering University – Malvar Campus**

**Marvin Ferrer**  
*(Add group member names here if submitting as a team)*

**DECEMBER 2026**

---

## OVERVIEW

BatStateWall is a cloud-deployed, full-stack community feedback wall and gamified Sudoku web application developed for the Batangas State University community using Node.js, Express, PostgreSQL (Supabase), and Render Platform-as-a-Service (PaaS). The system provides a centralized, real-time public wall where Red Spartans and visitors can share campus shoutouts, constructive ideas, and student feedback of up to 280 characters, while integrating a server-authoritative BatStateU Sudoku Arena and live leaderboard to encourage sustained engagement.

Traditional campus feedback channels—such as physical suggestion boxes, scattered social media threads, and static survey forms—often suffer from limited visibility, delayed feedback, inconsistent moderation, and low recurring user engagement. Through BatStateWall, visitors can immediately read, search, sort, and filter public community posts on desktop or mobile devices, while authenticated users can sign in securely using Google OAuth 2.0 after agreeing to the Terms of Service and Privacy Policy, publish posts in two clicks, interact through likes and comments, and compete in Classic or Daily Spartan Sudoku Challenges.

The system is intended for Batangas State University students, campus organizations, visitors, and Platform Technologies instructors. Students can use the platform as an accessible, moderated space to voice campus feedback and enjoy friendly Sudoku competition, while instructors can evaluate a production-ready PaaS web architecture demonstrating secure authentication, parameterized database operations, bilingual content moderation, and responsive user interface design.

---

## OBJECTIVES

### General Objective

To design, develop, and deploy a cloud-hosted community feedback wall and gamified Sudoku web application on a Platform-as-a-Service (PaaS) architecture that fosters respectful student discourse, real-time social engagement, and friendly academic competition within Batangas State University.

### Specific Objectives:

- To develop a responsive, Facebook-style public feedback wall featuring real-time community statistics, keyword search, sorting (Latest and Most Liked), filtering (All and Mine), pagination, and non-intrusive live-post notifications.
- To implement secure Google OAuth 2.0 authentication with HMAC-SHA256 signed `HttpOnly` session cookies and mandatory Terms of Service and Privacy Policy consent verification prior to account creation.
- To enforce respectful community standards through an automated English and Tagalog profanity filter across display names, posts, and comments, supported by user-driven post reporting and owner-only post deletion.
- To integrate a server-authoritative BatStateU Sudoku Arena modal overlay featuring guaranteed unique-solution puzzles (Easy, Medium, Hard, and date-seeded Daily Spartan Challenges), interactive pencil marks, smart hints, mistake limits, procedural audio feedback, and one-click victory sharing to the wall.
- To build a live Sudoku Rankings leaderboard (Overall Points, Daily Challenge, and fastest Easy, Medium, and Hard clear times) paired with Top-10 rank badges displayed beside ranked authors' names on community wall posts.
- To deploy the full-stack application on modern cloud PaaS infrastructure (Render Web Service and Supabase managed PostgreSQL over TLS) using parameterized SQL queries, XSS-safe rendering, and well-structured RESTful API endpoints.

---

## STATEMENT OF THE PROBLEM

### General Problem

How can a cloud-deployed web application improve centralized campus feedback sharing, ensure respectful bilingual content moderation, and sustain active student engagement at Batangas State University?

### Specific Problems:

- Existing campus feedback channels and scattered social media groups lack a unified, searchable public wall where students can share and view community feedback in real time.
- Publicly accessible posting platforms without verified account authentication and automated language moderation are vulnerable to spam, impersonation, and English or Tagalog profanity.
- Poorly structured web layouts often create cluttered content hierarchy and break on smaller mobile screens, limiting accessibility for smartphone users.
- Community feedback walls frequently experience declining return visits when they lack interactive activities, public recognition badges, or friendly competitive features.
- Manually provisioning virtual machines, reverse proxies, SSL certificates, and database instances under Infrastructure-as-a-Service (IaaS) introduces high setup and maintenance overhead compared to Platform-as-a-Service (PaaS) deployment.

---

## SYSTEM FEATURES

### Real-Time Community Feedback Wall

- Compact two-click post composer with auto-growing textarea and 280-character limit validation
- Optimistic post publishing, animated Like toggles, collapsible per-post Comments, and native or clipboard Share links
- Keyword search, Latest and Most Liked sorting, All and Mine feed filtering, Load More pagination, and a live-polling new-posts indicator pill
- Three-dot post overflow menu providing Post ID reference, Copy Link, Report Post, and owner-only Delete Post with inline confirmation

### Google OAuth 2.0 Authentication and Legal Consent Gate

- Streamlined Google / Gmail OAuth 2.0 authentication with automatic account creation on first sign-in
- Mandatory Terms of Service (`/terms.html`) and Privacy Policy (`/privacy.html`) agreement enforced in the sign-in modal and validated server-side before OAuth state generation, storing a `terms_accepted_at` timestamp in PostgreSQL
- HMAC-SHA256 signed `HttpOnly` session cookies (`SameSite=Lax`, `Secure` over HTTPS) and short-lived CSRF OAuth state cookies

### Automated Bilingual Content Moderation and Security

- Zero-dependency English and Tagalog profanity filter detecting leetspeak substitutions, stretched letters, and spaced or censored evasions while preventing false positives on everyday Filipino and campus terms
- Strict parameterized PostgreSQL queries (`$1`, `$2`) preventing SQL injection and strict HTML escaping preventing Cross-Site Scripting (XSS)
- HTTPS-only Google avatar URL sanitization and strict positive 32-bit integer validation on resource IDs

### BatStateU Sudoku Arena (Game Modal Overlay)

- Server-authoritative Sudoku engine using bitmask Minimum Remaining Values (MRV) solving to guarantee strictly unique solutions across Easy, Medium, Hard, and Asia/Manila date-seeded Daily Spartan Challenges without exposing solutions to the client
- Tactile 9×9 board overlay with zero-latency selection, peer and same-digit highlighting, conflict indicators, 3×3 pencil marks with automatic peer pruning, Undo/Redo stack, Erase, Smart Hints (maximum of 3), and a 3-mistake limit
- Frosted Pause privacy veil with automatic pause on tab switch, row/column/box completion ripple animations, combo streak counter, muteable Web Audio synthesized micro-sound effects, full keyboard and mobile touch controls, and one-click Share Victory to Wall

### Live Community Rankings and Wall Recognition

- Sticky desktop right-sidebar Top 5 Rankings widget (`Overall` and `Daily` tabs) showing pinned personal standing, alongside mobile access from the community info sheet
- Full Top 50 Leaderboard modal spanning Overall Points, Daily Challenge, and fastest Easy, Medium, and Hard clear times computed via PostgreSQL window functions (`RANK() OVER`)
- Automatic Top-10 rank badges (`#1`–`#10`) rendered beside ranked authors' names on Community Wall posts

### Responsive 3D-Enhanced Interface and Cloud PaaS Architecture

- Adaptive dark obsidian and BatStateU crimson glassmorphic design structured for desktop (`1440px`), tablet (`768px`), and mobile (`375px`) viewports
- Three.js WebGL ambient 3D background, foreground parallax floating ember dots, Lottie confirmation toasts, and `prefers-reduced-motion` accessibility support
- Automated GitHub-to-Render PaaS web service deployment paired with Supabase managed PostgreSQL (Session Pooler over TLS)

---

## SCOPE AND LIMITATION

### Scope of the Study:

This study focuses on the design, development, and cloud deployment of BatStateWall, a full-stack community feedback wall and gamified Sudoku web application for Batangas State University. Specifically, it covers the following:

#### Content Coverage

- Public campus feedback posts and comments (up to 280 characters each), post likes, community metrics (total posts, total members, posts today), and moderation reports.
- Automated English and Tagalog profanity filtering for display names, posts, and comments, alongside publicly accessible Terms of Service and Privacy Policy pages.
- Server-generated Classic (Easy, Medium, Hard) and Daily Spartan Challenge 9×9 Sudoku puzzles, transparent score breakdowns, solve streaks, and multi-scope user rankings.

#### System Features and Functionalities

- Full-stack RESTful API built with Node.js and Express backed by seven normalized PostgreSQL tables (`users`, `items`, `likes`, `comments`, `reports`, `sudoku_sessions`, and `sudoku_user_stats`) hosted on Supabase.
- Google OAuth 2.0 authentication flow with mandatory legal consent verification and persistent `HttpOnly` signed sessions.
- Interactive Facebook-style social feed, full-featured Sudoku Game Modal overlay preserving feed scroll position, Top 5 sidebar and Top 50 modal rankings, and ambient WebGL/Canvas 3D visual effects.

#### Intended Users

- Batangas State University students and campus community members seeking a centralized, moderated platform to share feedback and compete on the Sudoku leaderboard.
- Unauthenticated visitors who wish to browse public feedback posts, search discussions, and view community rankings.
- Platform Technologies instructors evaluating cloud PaaS deployment, REST API correctness, security controls, and responsive web design.

#### Objectives

- To provide an accessible, clean, and structured digital wall for respectful campus expression across mobile and desktop devices.
- To demonstrate practical Platform-as-a-Service (PaaS) cloud engineering using Render and Supabase instead of manual IaaS server administration.
- To increase recurring student engagement by uniting social feedback with a fair, server-validated Sudoku Arena and live leaderboard.

#### Coverage Boundaries

- The system operates strictly as a web application accessible via standard modern browsers; no native iOS or Android binary application is developed.
- BatStateWall functions as an independent IT 412 academic community platform and does not replace official Batangas State University administrative portals, registrar systems, or formal student grievance offices.

### Limitations of the Study:

This study and the developed system are subject to the following constraints:

#### Content Limitations

- Feedback posts and comments are limited to plain text of up to 280 characters; image, document, audio, and video file attachments are not supported.
- The integrated game module is limited to standard 9×9 Classic and Daily Sudoku puzzles and does not include multiplayer real-time matches or other puzzle genres.
- Automated English and Tagalog profanity moderation relies on curated pattern matching and normalization rules rather than machine-learning contextual sentiment analysis, so subtle sarcasm or newly coined slang may require manual reporting.

#### Functional Constraints

- Account authentication is strictly limited to Google OAuth 2.0 (Gmail); traditional username/email-and-password registration and login are intentionally excluded.
- Live feed discovery uses periodic 20-second HTTP polling against `/api/stats` rather than persistent WebSocket push connections.
- While users can submit post reports into the database and delete their own posts, a dedicated administrative moderation dashboard for reviewing reported content or suspending accounts is not included in the current version.

#### User and Environment Limitations

- An active internet connection is required to authenticate via Google OAuth 2.0, query or write to Supabase PostgreSQL, validate Sudoku moves server-side, and load CDN assets (Inter font, Three.js, and Lottie).
- Rendering smoothness of the Three.js WebGL background and foreground particle canvas depends on the user's browser and device hardware capabilities, though reduced-motion preferences are respected.
- User feedback and leaderboard data reflect voluntary participation within the Batangas State University community and may vary depending on adoption outside coursework evaluation.

#### Other Constraints

- Deployment relies on free or academic cloud tiers on Render and Supabase, which may introduce brief cold-start wake-up delays after periods of inactivity.
- Long-term post-semester hosting, continuous content updates, and permanent database archival are not guaranteed beyond the academic term.

---

## SCREENSHOT OF WEBSITE

- **Figure 1:** BatStateWall Homepage — Desktop View (Logged-Out Feed with Sticky Right Sidebar and Live Sudoku Rankings)
- **Figure 2:** Google OAuth 2.0 Sign-In Modal with Mandatory Terms of Service and Privacy Policy Consent Checkbox
- **Figure 3:** BatStateWall Feed — Logged-In View (Two-Click Post Composer, Likes, Comments, and Top-10 Author Rank Badges)
- **Figure 4:** BatStateU Sudoku Arena Game Modal Overlay (9×9 Board, Pencil Notes, Smart Hints, HUD, and Victory Summary)
- **Figure 5:** Full Top 50 Community Sudoku Leaderboard Modal (Overall, Daily, Easy, Medium, and Hard Scopes)
- **Figure 6:** Responsive Mobile View (`375px` Viewport — Compact Header, Search Bar, Feed Cards, and Mobile Info Sheet)
- **Figure 7:** Public Terms of Service (`/terms.html`) and Privacy Policy (`/privacy.html`) Documentation Pages

---

### Printing & Formatting Checklist (Applied to `BatStateWall_Project_Draft.docx`)

- **Paper Size:** Letter / Short (`8.5" × 11"`)
- **Margin Size:** `1"` all sides
- **Line Spacing (Front Page / Title Page):** `1.5`
- **Line Spacing (Overview – Scope and Limitation):** `2.0`
- **Font Style:** Times New Roman
- **Font Size:** `12pt`
- **Alignment:** Justified
- **Submission Reminder:** Print 1 copy of the finalized documentation (after pasting website screenshots into `SCREENSHOT OF WEBSITE`) and submit to your instructor on the last day of Examination.
