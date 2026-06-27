import { useEffect, useRef } from 'react';

/*
 * Hero background: a gold point-terrain wave (THREE.Points over a PlaneGeometry),
 * mouse-reactive, gold→steel vertex color ramp. Three.js r128 is lazy-loaded from
 * CDN only when this mounts (keeps it off admin/other pages).
 *
 * Robustness: a CSS radial gold "atmosphere" gradient is ALWAYS rendered underneath.
 * The WebGL canvas overlays it only if Three loads and inits cleanly. On reduced
 * motion or any failure, the gradient alone remains — the hero never blanks.
 */

const THREE_SRC = 'https://unpkg.com/three@0.128.0/build/three.min.js';

declare global {
  interface Window { THREE?: any; __threeLoading?: Promise<any> }
}

function loadThree(): Promise<any> {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (window.__threeLoading) return window.__threeLoading;
  window.__threeLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = THREE_SRC;
    s.async = true;
    s.onload = () => (window.THREE ? resolve(window.THREE) : reject(new Error('THREE missing')));
    s.onerror = () => reject(new Error('THREE failed to load'));
    document.head.appendChild(s);
  });
  return window.__threeLoading;
}

export function GoldTerrain({ reduced }: { reduced: boolean }) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (reduced) return; // static gradient only
    let raf = 0;
    let renderer: any, scene: any, camera: any, points: any, geometry: any, material: any;
    let disposed = false;
    const mouse = { x: 0, y: 0 };

    const onMouse = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    loadThree().then((THREE) => {
      const mount = mountRef.current;
      if (!mount || disposed) return;
      try {
        const w = mount.clientWidth, h = mount.clientHeight;
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
        camera.position.set(0, 4.2, 9);
        camera.lookAt(0, 0, 0);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(w, h);
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
        points = new THREE.Points(geometry, material);
        scene.add(points);

        const base = Float32Array.from(pos.array as Float32Array);
        const clock = new THREE.Clock();

        const animate = () => {
          if (disposed) return;
          raf = requestAnimationFrame(animate);
          const t = clock.getElapsedTime();
          const p = geometry.attributes.position;
          for (let i = 0; i < p.count; i++) {
            const x = base[i * 3], z = base[i * 3 + 2];
            p.setY(i, Math.sin(x * 0.6 + t * 0.9) * 0.35 + Math.cos(z * 0.5 + t * 0.7) * 0.35);
          }
          p.needsUpdate = true;
          // gentle parallax toward cursor
          camera.position.x += (mouse.x * 1.6 - camera.position.x) * 0.03;
          camera.position.y += (4.2 - mouse.y * 1.2 - camera.position.y) * 0.03;
          camera.lookAt(0, 0, 0);
          renderer.render(scene, camera);
        };
        animate();

        const onResize = () => {
          if (!mount) return;
          const nw = mount.clientWidth, nh = mount.clientHeight;
          camera.aspect = nw / nh; camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
        };
        window.addEventListener('resize', onResize);
        window.addEventListener('mousemove', onMouse);
        (renderer as any).__cleanup = () => {
          window.removeEventListener('resize', onResize);
          window.removeEventListener('mousemove', onMouse);
        };
      } catch {
        /* leave gradient fallback */
      }
    }).catch(() => { /* gradient fallback */ });

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      try {
        renderer?.__cleanup?.();
        geometry?.dispose?.();
        material?.dispose?.();
        if (renderer) { renderer.dispose?.(); renderer.domElement?.remove?.(); }
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
      {/* WebGL canvas mounts here when Three loads (non-reduced-motion only) */}
      <div ref={mountRef} className="absolute inset-0" />
      {/* Fade the terrain into the page bottom */}
      <div className="absolute inset-x-0 bottom-0 h-40" style={{ background: 'linear-gradient(to bottom, rgba(11,10,8,0), #0B0A08)' }} />
    </div>
  );
}
