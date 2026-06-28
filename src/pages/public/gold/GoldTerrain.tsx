import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/*
 * Hero background: a gold point-terrain wave (THREE.Points over a PlaneGeometry),
 * mouse-reactive, gold→steel vertex color ramp. Three.js is bundled (npm import).
 *
 * Production-hardened against init timing: the WebGL scene is NOT built synchronously
 * in useEffect (the container can be 0×0 at first paint on the deployed build). Instead
 * a ResizeObserver builds it the first time the container reports a non-zero size, then
 * just resizes thereafter. An rAF poll covers environments without ResizeObserver.
 *
 * A CSS gold-atmosphere gradient always renders underneath, so the hero never blanks
 * (reduced motion, no WebGL, or any failure → gradient only).
 */

export function GoldTerrain({ reduced }: { reduced: boolean }) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // NOTE: we do NOT early-return on reduced motion. Reduced motion renders a
    // single STATIC terrain frame (no animation loop / no mouse parallax) so the
    // canvas always mounts — skipping it entirely was leaving prod on the gradient.
    const mount = mountRef.current;
    console.log('[GoldTerrain] effect run · reduced =', reduced, '· mount?', !!mount);
    if (!mount) return;                  // null guard

    let raf = 0;
    let pollRaf = 0;
    let disposed = false;
    let initialized = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let geometry: THREE.PlaneGeometry | null = null;
    let material: THREE.PointsMaterial | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let scene: THREE.Scene | null = null;
    let base: Float32Array | null = null;
    let clock: THREE.Clock | null = null;
    const mouse = { x: 0, y: 0 };

    const onMouse = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    const animate = () => {
      if (disposed || !renderer || !geometry || !camera || !scene || !base || !clock) return;
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const p = geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        p.setY(i, Math.sin(x * 0.6 + t * 0.9) * 0.35 + Math.cos(z * 0.5 + t * 0.7) * 0.35);
      }
      p.needsUpdate = true;
      camera.position.x += (mouse.x * 1.6 - camera.position.x) * 0.03;
      camera.position.y += (4.2 - mouse.y * 1.2 - camera.position.y) * 0.03;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };

    const init = (w: number, h: number) => {
      if (initialized || disposed) return;
      try {
        initialized = true;
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
        camera.position.set(0, 4.2, 9);
        camera.lookAt(0, 0, 0);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(w, h);
        renderer.domElement.style.display = 'block';
        mount.appendChild(renderer.domElement);

        const SIZE = 34, SEP = 0.65;
        geometry = new THREE.PlaneGeometry(SIZE * SEP, SIZE * SEP, SIZE, SIZE);
        geometry.rotateX(-Math.PI / 2);

        const colors: number[] = [];
        const gold = new THREE.Color('#E8D199');
        const steel = new THREE.Color('#7F95A8');
        const pos = geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const d = Math.min(1, Math.hypot(pos.getX(i), pos.getZ(i)) / (SIZE * SEP * 0.5));
          const c = gold.clone().lerp(steel, d * 0.85);
          colors.push(c.r, c.g, c.b);
        }
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        material = new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, opacity: 0.9 });
        scene.add(new THREE.Points(geometry, material));

        base = Float32Array.from(pos.array as Float32Array);

        if (reduced) {
          // Reduced motion: render ONE static, gently-deformed frame — no loop, no parallax.
          const p = geometry.attributes.position;
          for (let i = 0; i < p.count; i++) {
            const x = base[i * 3], z = base[i * 3 + 2];
            p.setY(i, Math.sin(x * 0.6 + 1.2) * 0.35 + Math.cos(z * 0.5 + 1.0) * 0.35);
          }
          p.needsUpdate = true;
          renderer.render(scene, camera);
        } else {
          clock = new THREE.Clock();
          window.addEventListener('mousemove', onMouse);
          animate();
        }
        console.log('[GoldTerrain] init OK · canvas appended ·', reduced ? 'static frame' : 'animating');
      } catch (err) {
        initialized = false; // leave the CSS gradient fallback
        console.error('[GoldTerrain] init failed:', err);
      }
    };

    const resize = (w: number, h: number) => {
      if (!renderer || !camera) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (reduced && scene) renderer.render(scene, camera); // keep static frame visible
    };

    const handleSize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      console.log('[GoldTerrain] container size:', w, h); // temporary diagnostic
      if (w === 0 || h === 0) return;     // wait until laid out
      if (!initialized) init(w, h);
      else resize(w, h);
    };

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => handleSize());
      ro.observe(mount);
      handleSize(); // attempt immediately too (covers already-laid-out case)
    } else {
      // Fallback: poll with rAF until the container has a non-zero size, then init.
      const poll = () => {
        if (disposed) return;
        const w = mount.clientWidth, h = mount.clientHeight;
        if (w > 0 && h > 0) { init(w, h); window.addEventListener('resize', handleSize); }
        else pollRaf = requestAnimationFrame(poll);
      };
      poll();
    }

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (pollRaf) cancelAnimationFrame(pollRaf);
      ro?.disconnect();
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('resize', handleSize);
      try {
        geometry?.dispose();
        material?.dispose();
        if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
      } catch { /* noop */ }
    };
  }, [reduced]);

  return (
    <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
      {/* Always-present warm-black + champagne atmosphere */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 70% 10%, rgba(232,209,153,0.16), rgba(11,10,8,0) 55%),' +
            'radial-gradient(90% 70% at 20% 90%, rgba(127,149,168,0.10), rgba(11,10,8,0) 60%),' +
            '#0B0A08',
        }}
      />
      {/* WebGL canvas mounts here once the container reports a non-zero size */}
      <div ref={mountRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />
      {/* Fade the terrain into the page bottom */}
      <div className="absolute inset-x-0 bottom-0 h-40" style={{ background: 'linear-gradient(to bottom, rgba(11,10,8,0), #0B0A08)' }} />
    </div>
  );
}
