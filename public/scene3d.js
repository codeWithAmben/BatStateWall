import * as THREE from 'three';

// Check user motion and pointer preferences so animations stay accessible and smooth
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hasFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// Shared reaction boosts used by both background WebGL and foreground parallax dots
const reactionState = {
  typingBoost: 0,
  successBoost: 0,
  errorBoost: 0,
  shockwaveProgress: 0,
};

// Expose a safe global API immediately so app.js can trigger reactions even if WebGL is unavailable
const sceneApi = {
  pulseTyping() {
    reactionState.typingBoost = Math.min(1, reactionState.typingBoost + 0.45);
  },
  pulseSuccess() {
    reactionState.successBoost = 1;
    reactionState.shockwaveProgress = 0.001;
  },
  pulseError() {
    reactionState.errorBoost = 1;
  },
  // Kept as a no-op so feed cards stay steady without 3D tilt jittering menus/inputs
  refreshCardEffects() {},
};
window.BatStateScene = sceneApi;

/**
 * Generates a soft circular radial glow sprite on an offscreen 2D canvas
 * so Three.js particle points look like glowing crimson embers instead of hard squares.
 */
function createEmberTexture() {
  const spriteCanvas = document.createElement('canvas');
  spriteCanvas.width = 64;
  spriteCanvas.height = 64;

  const ctx = spriteCanvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.35, 'rgba(239, 68, 68, 0.75)');
  gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(spriteCanvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Pre-renders soft glowing crimson/coral dot sprites for the foreground 2D overlay canvas.
 */
function createForegroundDotSprites() {
  const palettes = [
    ['rgba(255, 224, 224, 0.96)', 'rgba(239, 68, 68, 0.58)', 'rgba(239, 68, 68, 0)'],
    ['rgba(255, 175, 175, 0.92)', 'rgba(211, 47, 47, 0.52)', 'rgba(211, 47, 47, 0)'],
    ['rgba(254, 202, 202, 0.95)', 'rgba(229, 57, 53, 0.55)', 'rgba(229, 57, 53, 0)'],
  ];

  return palettes.map(([core, mid, edge]) => {
    const sprite = document.createElement('canvas');
    sprite.width = 40;
    sprite.height = 40;
    const sctx = sprite.getContext('2d');
    if (sctx) {
      const grad = sctx.createRadialGradient(20, 20, 1, 20, 20, 20);
      grad.addColorStop(0, core);
      grad.addColorStop(0.28, mid);
      grad.addColorStop(1, edge);
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, 40, 40);
    }
    return sprite;
  });
}

/**
 * Renders subtle glowing crimson dots in front of the feed & sidebar cards (#fg-dots)
 * with depth-scaled mouse & scroll parallax for multi-plane 3D immersion.
 */
function initForegroundDots() {
  const fgCanvas = document.getElementById('fg-dots');
  if (!fgCanvas) {
    return;
  }

  const ctx = fgCanvas.getContext('2d');
  if (!ctx) {
    fgCanvas.style.display = 'none';
    return;
  }

  const sprites = createForegroundDotSprites();
  let width = window.innerWidth;
  let height = Math.max(window.innerHeight, 1);
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resizeCanvas() {
    width = window.innerWidth;
    height = Math.max(window.innerHeight, 1);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    fgCanvas.width = Math.floor(width * dpr);
    fgCanvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();

  const dotCount = width <= 768 ? 14 : 26;
  const dots = Array.from({ length: dotCount }, (_, idx) => {
    const z = 0.35 + Math.random() * 0.65; // Depth factor: closer dots are brighter and shift more
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      z,
      size: 6 + z * 9,
      baseAlpha: 0.24 + z * 0.34,
      vy: -(8 + z * 16),
      vx: (Math.random() - 0.5) * 6,
      phase: Math.random() * Math.PI * 2,
      spriteIndex: idx % sprites.length,
    };
  });

  let targetPointerX = 0;
  let targetPointerY = 0;
  let smoothPointerX = 0;
  let smoothPointerY = 0;
  let lastScrollY = window.scrollY;
  let pendingScrollDelta = 0;

  if (hasFinePointer && !prefersReducedMotion) {
    window.addEventListener(
      'pointermove',
      (event) => {
        targetPointerX = (event.clientX / Math.max(width, 1) - 0.5) * 2;
        targetPointerY = (event.clientY / Math.max(height, 1) - 0.5) * 2;
      },
      { passive: true }
    );
  }

  if (!prefersReducedMotion) {
    window.addEventListener(
      'scroll',
      () => {
        const currentY = window.scrollY;
        pendingScrollDelta += currentY - lastScrollY;
        lastScrollY = currentY;
      },
      { passive: true }
    );
  }

  window.addEventListener('resize', () => {
    const prevWidth = width;
    const prevHeight = height;
    resizeCanvas();
    for (const dot of dots) {
      if (prevWidth > 0 && prevHeight > 0) {
        dot.x = (dot.x / prevWidth) * width;
        dot.y = (dot.y / prevHeight) * height;
      }
    }
  });

  function drawDots(elapsedTime) {
    ctx.clearRect(0, 0, width, height);

    for (const dot of dots) {
      const twinkle = 0.8 + 0.2 * Math.sin(elapsedTime * 1.8 + dot.phase);
      const alpha = Math.min(0.85, dot.baseAlpha * twinkle + reactionState.successBoost * 0.16);
      const drawX = dot.x + smoothPointerX * dot.z * 28;
      const drawY = dot.y + smoothPointerY * dot.z * 18;
      const half = dot.size * 0.5;

      ctx.globalAlpha = alpha;
      ctx.drawImage(sprites[dot.spriteIndex], drawX - half, drawY - half, dot.size, dot.size);
    }
    ctx.globalAlpha = 1;
  }

  if (prefersReducedMotion) {
    drawDots(0);
    return;
  }

  let fgFrameId = null;
  let lastTime = performance.now();
  let elapsedTime = 0;

  function animateFg(now) {
    fgFrameId = window.requestAnimationFrame(animateFg);
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    elapsedTime += dt;

    // Smoothly damp pointer parallax and consume scroll parallax delta
    const pointerLerp = 1 - Math.exp(-dt * 6);
    smoothPointerX += (targetPointerX - smoothPointerX) * pointerLerp;
    smoothPointerY += (targetPointerY - smoothPointerY) * pointerLerp;

    const scrollStep = pendingScrollDelta;
    pendingScrollDelta = 0;

    const speedBoost = 1 + reactionState.typingBoost * 0.8 + reactionState.successBoost * 2.4;
    const margin = 24;

    for (const dot of dots) {
      dot.x += (dot.vx + Math.sin(elapsedTime * 0.9 + dot.phase) * 4) * dt;
      dot.y += dot.vy * speedBoost * dt - scrollStep * dot.z * 0.22;

      if (dot.y < -margin) {
        dot.y = height + margin;
        dot.x = Math.random() * width;
      } else if (dot.y > height + margin) {
        dot.y = -margin;
        dot.x = Math.random() * width;
      }

      if (dot.x < -margin) {
        dot.x = width + margin;
      } else if (dot.x > width + margin) {
        dot.x = -margin;
      }
    }

    drawDots(elapsedTime);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (fgFrameId !== null) {
        window.cancelAnimationFrame(fgFrameId);
        fgFrameId = null;
      }
    } else if (fgFrameId === null) {
      lastTime = performance.now();
      fgFrameId = window.requestAnimationFrame(animateFg);
    }
  });

  fgFrameId = window.requestAnimationFrame(animateFg);
}

/**
 * Initializes the Three.js WebGL background scene on #webgl-bg.
 */
function initWebGLScene() {
  const canvas = document.getElementById('webgl-bg');
  if (!canvas) {
    return;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch (err) {
    // Gracefully fall back to the static CSS + image backdrop when WebGL is unavailable
    console.warn('WebGL unavailable, falling back to static backdrop:', err);
    canvas.style.display = 'none';
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / Math.max(window.innerHeight, 1),
    0.1,
    120
  );
  camera.position.set(0, 1.4, 14);

  // Lighting setup matching the BatStateU obsidian & crimson palette
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.65);
  directionalLight.position.set(4, 8, 10);

  const leftLight = new THREE.PointLight(0xef4444, 28, 30);
  leftLight.position.set(-10, 3, 2);

  const rightLight = new THREE.PointLight(0xd32f2f, 28, 30);
  rightLight.position.set(10, -1, 2);

  const centerLight = new THREE.PointLight(0xef4444, 6, 36);
  centerLight.position.set(0, 0, 5);

  scene.add(ambientLight, directionalLight, leftLight, rightLight, centerLight);

  // 1. Animated Crimson Wave Horizon Grid
  const gridGeometry = new THREE.PlaneGeometry(54, 34, 42, 26);
  const gridPosAttr = gridGeometry.attributes.position;
  const gridBaseZ = new Float32Array(gridPosAttr.count);
  for (let i = 0; i < gridPosAttr.count; i += 1) {
    gridBaseZ[i] = gridPosAttr.getZ(i);
  }
  const gridMaterial = new THREE.MeshBasicMaterial({
    color: 0xd32f2f,
    wireframe: true,
    transparent: true,
    opacity: 0.16,
  });
  const gridMesh = new THREE.Mesh(gridGeometry, gridMaterial);
  gridMesh.rotation.x = -Math.PI / 2.25;
  gridMesh.position.set(0, -5.6, -6);
  scene.add(gridMesh);

  // 2. Left & Right Floating 3D Geometric Emblems
  const darkMetalMaterial = new THREE.MeshStandardMaterial({
    color: 0x16161d,
    metalness: 0.78,
    roughness: 0.28,
  });

  const leftGroup = new THREE.Group();
  const leftCore = new THREE.Mesh(new THREE.OctahedronGeometry(1.45, 0), darkMetalMaterial);
  const leftShell = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.75, 0),
    new THREE.MeshBasicMaterial({
      color: 0xef4444,
      wireframe: true,
      transparent: true,
      opacity: 0.36,
    })
  );
  const leftRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.35, 0.032, 12, 64),
    new THREE.MeshBasicMaterial({ color: 0xd32f2f, transparent: true, opacity: 0.45 })
  );
  leftRing.rotation.set(Math.PI / 3, Math.PI / 5, 0);
  leftGroup.add(leftCore, leftShell, leftRing);
  scene.add(leftGroup);

  const rightGroup = new THREE.Group();
  const rightCore = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 0), darkMetalMaterial);
  const rightShell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.65, 0),
    new THREE.MeshBasicMaterial({
      color: 0xef4444,
      wireframe: true,
      transparent: true,
      opacity: 0.34,
    })
  );
  const rightRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.03, 12, 64),
    new THREE.MeshBasicMaterial({ color: 0xd32f2f, transparent: true, opacity: 0.42 })
  );
  rightRing.rotation.set(-Math.PI / 3, -Math.PI / 6, 0);
  rightGroup.add(rightCore, rightShell, rightRing);
  scene.add(rightGroup);

  function layoutEmblems() {
    const isNarrow = window.innerWidth < 900;
    const scale = isNarrow ? 0.62 : 1;
    const spreadX = isNarrow ? 6.4 : 8.8;

    leftGroup.scale.setScalar(scale);
    leftGroup.position.set(-spreadX, 0.6, -3);

    rightGroup.scale.setScalar(scale);
    rightGroup.position.set(spreadX, -0.3, -3);
  }
  layoutEmblems();

  // 3. 3D Glowing Ember Particle Field
  const particleCount = window.innerWidth <= 768 ? 65 : 150;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);
  const particleSpeeds = new Float32Array(particleCount);
  const palette = [
    new THREE.Color(0xef4444),
    new THREE.Color(0xd32f2f),
    new THREE.Color(0xfca5a5),
  ];

  for (let i = 0; i < particleCount; i += 1) {
    const i3 = i * 3;
    particlePositions[i3] = (Math.random() - 0.5) * 32;
    particlePositions[i3 + 1] = (Math.random() - 0.5) * 20;
    particlePositions[i3 + 2] = -10 + Math.random() * 14;

    const color = palette[i % palette.length];
    particleColors[i3] = color.r;
    particleColors[i3 + 1] = color.g;
    particleColors[i3 + 2] = color.b;

    particleSpeeds[i] = 0.35 + Math.random() * 0.85;
  }

  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

  const emberTexture = createEmberTexture();
  const particleMaterial = new THREE.PointsMaterial({
    size: 0.24,
    map: emberTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const particlePoints = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particlePoints);

  // 4. Post-Success Shockwave Ring
  const shockwaveMaterial = new THREE.MeshBasicMaterial({
    color: 0xef4444,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const shockwaveRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.9, 0.045, 12, 64),
    shockwaveMaterial
  );
  shockwaveRing.position.set(0, 0, -2.5);
  scene.add(shockwaveRing);

  let pointerX = 0;
  let pointerY = 0;

  if (hasFinePointer && !prefersReducedMotion) {
    window.addEventListener(
      'pointermove',
      (event) => {
        pointerX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
        pointerY = -(event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
      },
      { passive: true }
    );
  }

  window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = Math.max(window.innerHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    layoutEmblems();
  });

  // Render a single calm frame and skip the loop when the user prefers reduced motion
  if (prefersReducedMotion) {
    camera.lookAt(0, 0, -2);
    renderer.render(scene, camera);
    return;
  }

  let animationFrameId = null;
  let lastTime = performance.now();
  let elapsedTime = 0;

  function animate(now) {
    animationFrameId = window.requestAnimationFrame(animate);
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    elapsedTime += dt;

    reactionState.typingBoost *= Math.exp(-dt * 4);
    reactionState.successBoost *= Math.exp(-dt * 2.2);
    reactionState.errorBoost *= Math.exp(-dt * 4.5);

    for (let i = 0; i < gridPosAttr.count; i += 1) {
      const x = gridPosAttr.getX(i);
      const y = gridPosAttr.getY(i);
      const wave =
        Math.sin(x * 0.28 + elapsedTime * 1.15) * 0.35 +
        Math.cos(y * 0.32 + elapsedTime * 0.9) * 0.25;
      gridPosAttr.setZ(i, gridBaseZ[i] + wave);
    }
    gridPosAttr.needsUpdate = true;

    const emblemSpin = 0.24 + reactionState.successBoost * 1.4;
    leftGroup.rotation.y += dt * emblemSpin;
    leftGroup.rotation.x = Math.sin(elapsedTime * 0.55) * 0.16;
    leftGroup.position.y = 0.6 + Math.sin(elapsedTime * 0.9) * 0.35;
    leftRing.rotation.z += dt * 0.45;

    rightGroup.rotation.y -= dt * emblemSpin;
    rightGroup.rotation.x = Math.cos(elapsedTime * 0.5) * 0.16;
    rightGroup.position.y = -0.3 + Math.cos(elapsedTime * 0.85) * 0.35;
    rightRing.rotation.z -= dt * 0.42;

    const speedMultiplier = 1 + reactionState.typingBoost * 1.1 + reactionState.successBoost * 3.2;
    const posArray = particleGeometry.attributes.position.array;
    for (let i = 0; i < particleCount; i += 1) {
      const i3 = i * 3;
      posArray[i3 + 1] += particleSpeeds[i] * speedMultiplier * dt;
      posArray[i3] += Math.sin(elapsedTime * 0.8 + i) * 0.08 * dt;

      if (posArray[i3 + 1] > 10) {
        posArray[i3 + 1] = -10;
        posArray[i3] = (Math.random() - 0.5) * 32;
      }
    }
    particleGeometry.attributes.position.needsUpdate = true;

    if (reactionState.shockwaveProgress > 0) {
      reactionState.shockwaveProgress += dt / 1.1;
      if (reactionState.shockwaveProgress >= 1) {
        reactionState.shockwaveProgress = 0;
        shockwaveMaterial.opacity = 0;
        shockwaveRing.scale.setScalar(1);
      } else {
        const ringScale = 0.6 + reactionState.shockwaveProgress * 10.9;
        shockwaveRing.scale.setScalar(ringScale);
        shockwaveMaterial.opacity = (1 - reactionState.shockwaveProgress) * 0.75;
      }
    }

    const errorFlicker =
      reactionState.errorBoost > 0.02
        ? (0.5 + 0.5 * Math.sin(elapsedTime * 36)) * reactionState.errorBoost
        : 0;
    centerLight.intensity =
      6 + reactionState.typingBoost * 10 + reactionState.successBoost * 26 + errorFlicker * 18;

    const targetCamX = pointerX * 0.85;
    const targetCamY = 1.4 + pointerY * 0.55;
    const camLerp = 1 - Math.exp(-dt * 5);
    camera.position.x += (targetCamX - camera.position.x) * camLerp;
    camera.position.y += (targetCamY - camera.position.y) * camLerp;
    camera.lookAt(0, 0, -2);

    renderer.render(scene, camera);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    } else if (animationFrameId === null) {
      lastTime = performance.now();
      animationFrameId = window.requestAnimationFrame(animate);
    }
  });

  animationFrameId = window.requestAnimationFrame(animate);
}

initWebGLScene();
initForegroundDots();
