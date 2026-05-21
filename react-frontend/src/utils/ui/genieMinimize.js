import { toCanvas } from 'html-to-image';
import * as THREE from 'three';

let isAnimating = false;

export const captureModal = async (modalElement) => {
  if (!modalElement) return null;
  const rect = modalElement.getBoundingClientRect();

  try {
    const canvas = await toCanvas(modalElement, {
      backgroundColor: 'transparent',
      pixelRatio: window.devicePixelRatio || 2,
      skipFonts: true,
      imagePlaceholder:
        'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
    });
    return { canvas, rect };
  } catch (error) {
    console.error('Initial canvas capture failed, retrying without images.', error);
    try {
      const canvasFallback = await toCanvas(modalElement, {
        backgroundColor: 'transparent',
        pixelRatio: window.devicePixelRatio || 2,
        skipFonts: true,
        filter: (node) => node.tagName !== 'IMG' && node.tagName !== 'VIDEO',
      });
      return { canvas: canvasFallback, rect };
    } catch (fallbackError) {
      console.error('Fallback canvas capture also failed.', fallbackError);
      return null;
    }
  }
};

export default async function genieMinimize(snapshot, targetEl, onComplete) {
  if (!snapshot || !targetEl || isAnimating) {
    onComplete?.();
    return;
  }
  isAnimating = true;

  try {
    const { canvas, rect } = snapshot;
    const targetRect = targetEl.getBoundingClientRect();

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100vw';
    container.style.height = '100vh';
    container.style.zIndex = '99999';
    container.style.pointerEvents = 'none';
    document.body.appendChild(container);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(
      0,
      window.innerWidth,
      window.innerHeight,
      0,
      0.1,
      1000
    );
    camera.position.z = 10;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;

    // Create a dense plane mesh
    const segmentsX = 40;
    const segmentsY = 40;
    const geometry = new THREE.PlaneGeometry(rect.width, rect.height, segmentsX, segmentsY);

    const uniforms = {
      tMap: { value: texture },
      uProgress: { value: 0.0 },
      uStartPos: {
        value: new THREE.Vector2(rect.left + rect.width / 2, rect.top + rect.height / 2),
      },
      uStartSize: { value: new THREE.Vector2(rect.width, rect.height) },
      uTargetPos: {
        value: new THREE.Vector2(
          targetRect.left + targetRect.width / 2,
          targetRect.top + targetRect.height / 2
        ),
      },
      uTargetSize: { value: new THREE.Vector2(targetRect.width, targetRect.height) },
      uWindowSize: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    };

    const vertexShader = `
      uniform float uProgress;
      uniform vec2 uStartPos;
      uniform vec2 uStartSize;
      uniform vec2 uTargetPos;
      uniform vec2 uTargetSize;
      uniform vec2 uWindowSize;

      varying vec2 vUv;

      float easeInOutCubic(float t) {
        return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
      }

      void main() {
        vUv = uv;

        // Target lives at the bottom-left (sidebar My Space), so the
        // bottom of the modal should peel away first and the top trails
        // behind to produce the funnel squish toward the dock.
        // uv.y is 1 at top, 0 at bottom of texture map.
        float yNorm = uv.y;

        // Calculate delayed start based on y component to create the funnel squish
        float MAX_DELAY = 0.55;
        float delay = yNorm * MAX_DELAY;
        float segmentDuration = 1.0 - MAX_DELAY;
        
        // normalize segment progress
        float sliceProgress = clamp((uProgress - delay) / segmentDuration, 0.0, 1.0);
        float t = easeInOutCubic(sliceProgress);

        // Funnel calculations:
        // Width shrinks natively as the progress interpolates
        float currentWidth = mix(uStartSize.x, uTargetSize.x, t);
        
        // X center position tracking the curve
        float startCenterX = uStartPos.x;
        float targetCenterX = uTargetPos.x;
        float currentXCenter = mix(startCenterX, targetCenterX, t);
        
        // Absolute Y position tracking the descent and squeeze
        // source Y grows down, uv.y grows up.
        // at uv.y=1 (top), screenY is startTop.
        float startY = uStartPos.y - (uv.y - 0.5) * uStartSize.y;
        float targetY = uTargetPos.y - (uv.y - 0.5) * uTargetSize.y;
        
        float currentYLine = mix(startY, targetY, t);

        // Generate pixel-perfect final positions for rendering
        float currentXOffset = (uv.x - 0.5) * currentWidth;
        float finalX = currentXCenter + currentXOffset;
        float finalY = currentYLine;

        // Convert final pixel coordinates to Normalized Device Coordinates (-1 to 1)
        float ndcX = (finalX / uWindowSize.x) * 2.0 - 1.0;
        float ndcY = -((finalY / uWindowSize.y) * 2.0 - 1.0);

        gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
      }
    `;

    const fragmentShader = `
      uniform sampler2D tMap;
      uniform float uProgress;
      varying vec2 vUv;

      void main() {
        vec4 texColor = texture2D(tMap, vUv);
        // Alpha fades slightly at the very end as it docks 
        float alpha = 1.0 - smoothstep(0.85, 1.0, uProgress);
        gl_FragColor = vec4(texColor.rgb, texColor.a * alpha);
      }
    `;

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const duration = 700; // Milliseconds, ideal premium timing
    const start = performance.now();

    const animate = (now) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1.0);

      material.uniforms.uProgress.value = progress;
      renderer.render(scene, camera);

      if (progress < 1.0) {
        requestAnimationFrame(animate);
      } else {
        container.remove();
        geometry.dispose();
        material.dispose();
        texture.dispose();
        renderer.dispose();
        isAnimating = false;
        onComplete?.();
      }
    };

    requestAnimationFrame(animate);
  } catch (error) {
    console.error('Genie effect error:', error);
    isAnimating = false;
    onComplete?.();
  }
}
