import * as THREE from 'three';

// Check user motion and pointer preferences so animations stay accessible and smooth
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const hasFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// Expose a safe global API immediately so app.js can trigger reactions even if WebGL is unavailable
const sceneApi = {
  pulseTyping() {},
  pulseSuccess() {},
  pulseError() {},
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

  // Interactive reaction state (damped back to rest in the render loop)
  let pointerX = 0;
  let pointerY = 0;
  let typingBoost = 0;
  let successBoost = 0;
  let errorBoost = 0;
  let shockwaveProgress = 0;

  sceneApi.pulseTyping = () => {
    typingBoost = Math.min(1, typingBoost + 0.45);
  };

  sceneApi.pulseSuccess = () => {
    successBoost = 1;
    shockwaveProgress = 0.001;
  };

  sceneApi.pulseError = () => {
    errorBoost = 1;
  };

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

    typingBoost *= Math.exp(-dt * 4);
    successBoost *= Math.exp(-dt * 2.2);
    errorBoost *= Math.exp(-dt * 4.5);

    for (let i = 0; i < gridPosAttr.count; i += 1) {
      const x = gridPosAttr.getX(i);
      const y = gridPosAttr.getY(i);
      const wave =
        Math.sin(x * 0.28 + elapsedTime * 1.15) * 0.35 +
        Math.cos(y * 0.32 + elapsedTime * 0.9) * 0.25;
      gridPosAttr.setZ(i, gridBaseZ[i] + wave);
    }
    gridPosAttr.needsUpdate = true;

    const emblemSpin = 0.24 + successBoost * 1.4;
    leftGroup.rotation.y += dt * emblemSpin;
    leftGroup.rotation.x = Math.sin(elapsedTime * 0.55) * 0.16;
    leftGroup.position.y = 0.6 + Math.sin(elapsedTime * 0.9) * 0.35;
    leftRing.rotation.z += dt * 0.45;

    rightGroup.rotation.y -= dt * emblemSpin;
    rightGroup.rotation.x = Math.cos(elapsedTime * 0.5) * 0.16;
    rightGroup.position.y = -0.3 + Math.cos(elapsedTime * 0.85) * 0.35;
    rightRing.rotation.z -= dt * 0.42;

    const speedMultiplier = 1 + typingBoost * 1.1 + successBoost * 3.2;
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

    if (shockwaveProgress > 0) {
      shockwaveProgress += dt / 1.1;
      if (shockwaveProgress >= 1) {
        shockwaveProgress = 0;
        shockwaveMaterial.opacity = 0;
        shockwaveRing.scale.setScalar(1);
      } else {
        const ringScale = 0.6 + shockwaveProgress * 10.9;
        shockwaveRing.scale.setScalar(ringScale);
        shockwaveMaterial.opacity = (1 - shockwaveProgress) * 0.75;
      }
    }

    const errorFlicker = errorBoost > 0.02 ? (0.5 + 0.5 * Math.sin(elapsedTime * 36)) * errorBoost : 0;
    centerLight.intensity = 6 + typingBoost * 10 + successBoost * 26 + errorFlicker * 18;

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
