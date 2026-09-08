import * as THREE from 'three';

// 4 Gerstner Waves
export const WAVES = [
  { dirX: 1.0,  dirZ: 0.2, steepness: 0.22, wavelength: 40.0, speed: 1.2 },
  { dirX: 0.7,  dirZ: 0.7, steepness: 0.16, wavelength: 22.0, speed: 1.5 },
  { dirX: -0.3, dirZ: 0.9, steepness: 0.12, wavelength: 14.0, speed: 1.8 },
  { dirX: 0.2,  dirZ: -0.9, steepness: 0.08, wavelength: 7.0, speed: 2.2 }
];

export class Ocean {
  constructor(scene, size = 1500, segments = 100) {
    this.scene = scene;
    this.size = size;
    this.time = 0;

    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.4).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.95, 0.8) },
      uDeepColor: { value: new THREE.Color(0.02, 0.22, 0.38) },      // Caribbean deep blue
      uShallowColor: { value: new THREE.Color(0.05, 0.58, 0.65) },  // Aqua tropical turquoise
      uFoamColor: { value: new THREE.Color(0.9, 0.96, 1.0) }
    };

    const vertexShader = `
      uniform float uTime;
      varying vec3 vWorldPos;
      varying vec3 vNorm;
      varying float vWaveH;

      void main() {
        vec3 p = position;
        vec2 worldCoord = (modelMatrix * vec4(position, 1.0)).xz;
        vec3 tangent = vec3(1.0, 0.0, 0.0);
        vec3 binormal = vec3(0.0, 0.0, 1.0);

        // Wave 1
        float k1 = 2.0 * 3.14159265 / 40.0;
        float c1 = sqrt(9.8 / k1) * 1.2;
        vec2 d1 = normalize(vec2(1.0, 0.2));
        float f1 = k1 * (dot(d1, worldCoord) - c1 * uTime * 0.4);
        float a1 = 0.22 / k1;
        p.x += d1.x * (a1 * cos(f1));
        p.y += a1 * sin(f1);
        p.z += d1.y * (a1 * cos(f1));

        // Wave 2
        float k2 = 2.0 * 3.14159265 / 22.0;
        float c2 = sqrt(9.8 / k2) * 1.5;
        vec2 d2 = normalize(vec2(0.7, 0.7));
        float f2 = k2 * (dot(d2, worldCoord) - c2 * uTime * 0.4);
        float a2 = 0.16 / k2;
        p.x += d2.x * (a2 * cos(f2));
        p.y += a2 * sin(f2);
        p.z += d2.y * (a2 * cos(f2));

        // Wave 3
        float k3 = 2.0 * 3.14159265 / 14.0;
        float c3 = sqrt(9.8 / k3) * 1.8;
        vec2 d3 = normalize(vec2(-0.3, 0.9));
        float f3 = k3 * (dot(d3, worldCoord) - c3 * uTime * 0.4);
        float a3 = 0.12 / k3;
        p.x += d3.x * (a3 * cos(f3));
        p.y += a3 * sin(f3);
        p.z += d3.y * (a3 * cos(f3));

        // Normals calculation
        tangent += vec3(-d1.x * d1.x * (0.22 * sin(f1)), d1.x * (0.22 * cos(f1)), -d1.x * d1.y * (0.22 * sin(f1)));
        binormal += vec3(-d1.x * d1.y * (0.22 * sin(f1)), d1.y * (0.22 * cos(f1)), -d1.y * d1.y * (0.22 * sin(f1)));

        vec3 norm = normalize(cross(binormal, tangent));
        vNorm = norm;
        vWaveH = p.y;
        vWorldPos = (modelMatrix * vec4(p, 1.0)).xyz;

        gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
      }
    `;

    const fragmentShader = `
      precision highp float;
      uniform float uTime;
      uniform vec3 uDeepColor;
      uniform vec3 uShallowColor;
      uniform vec3 uFoamColor;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;

      varying vec3 vWorldPos;
      varying vec3 vNorm;
      varying float vWaveH;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 n = normalize(vNorm);

        // World-space moving ripples (these stream past the ship as it sails!)
        float r1 = sin(vWorldPos.x * 0.45 + uTime * 2.2) * cos(vWorldPos.z * 0.45 + uTime * 1.8);
        float r2 = sin(vWorldPos.x * 0.9 - uTime * 2.5 + vWorldPos.z * 0.35) * cos(vWorldPos.z * 0.85 - uTime * 2.0);
        float ripples = (r1 + r2) * 0.5;

        // Fresnel reflection
        float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(viewDir, n), 0.0), 4.0);

        // Color gradient based on wave height + ripples
        float crest = smoothstep(-1.0, 1.8, vWaveH + ripples * 0.4);
        vec3 waterColor = mix(uDeepColor, uShallowColor, crest);
        waterColor += vec3(0.04, 0.12, 0.14) * ripples;

        // Sun specular glint with ripple perturbation
        vec3 lightDir = normalize(uSunDir);
        vec3 halfDir = normalize(lightDir + viewDir);
        vec3 perturbedN = normalize(n + vec3(ripples * 0.18, 0.0, ripples * 0.18));
        float spec = pow(max(dot(perturbedN, halfDir), 0.0), 95.0) * 1.8;
        vec3 specular = uSunColor * spec;

        // Foam on wave peaks
        float foam = smoothstep(1.15, 1.85, vWaveH + ripples * 0.35);
        vec3 finalColor = mix(waterColor, uFoamColor, foam * 0.55) + specular;
        finalColor = mix(finalColor, vec3(0.5, 0.75, 0.95), fresnel * 0.35);

        gl_FragColor = vec4(finalColor, 0.92);
      }
    `;

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false, // Critical: prevent masking of opaque objects
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = 1; // Render after opaque ships/islands
    this.scene.add(this.mesh);
  }

  update(delta, playerPos) {
    this.time += delta;
    this.uniforms.uTime.value = this.time;
    if (playerPos && typeof playerPos.x === 'number' && !isNaN(playerPos.x) && !isNaN(playerPos.z)) {
      this.mesh.position.x = playerPos.x;
      this.mesh.position.z = playerPos.z;
    }
  }

  getWaveHeight(x, z, time = this.time) {
    if (typeof x !== 'number' || isNaN(x) || typeof z !== 'number' || isNaN(z)) {
      return 0;
    }
    let y = 0;
    for (let i = 0; i < WAVES.length; i++) {
      const w = WAVES[i];
      const k = (2.0 * Math.PI) / w.wavelength;
      const c = Math.sqrt(9.8 / k) * w.speed;
      const len = Math.sqrt(w.dirX * w.dirX + w.dirZ * w.dirZ);
      const dx = w.dirX / len;
      const dz = w.dirZ / len;
      const f = k * (dx * x + dz * z - c * time * 0.4);
      const a = w.steepness / k;
      y += a * Math.sin(f);
    }
    return isNaN(y) ? 0 : y;
  }
}
