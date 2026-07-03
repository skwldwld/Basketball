// background.js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

let model = null;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({ alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);

document.getElementById("background-canvas").appendChild(renderer.domElement);

// 조명 추가
const light = new THREE.PointLight(0xffffff, 1);
light.position.set(5, 5, 5);
scene.add(light);

// 배경.. 하늘
const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();

// Vite 배포용 asset 경로
const texturePath = new URL(
  "../models/sky/textures/Scene_-_Root_diffuse.jpeg",
  import.meta.url
).href;

const modelPath = new URL(
  "../models/sky/scene.glb",
  import.meta.url
).href;

const myTexture = textureLoader.load(
  texturePath,
  () => console.log("texture loaded"),
  undefined,
  (err) => console.error("texture load error:", err)
);

gltfLoader.load(
  modelPath,
  (gltf) => {
    model = gltf.scene;

    model.traverse((child) => {
      if (child.isMesh) {
        child.material.map = myTexture;
        child.material.needsUpdate = true;
      }
    });

    model.position.set(0, 0, 0);
    model.scale.set(0.1, 0.1, 0.1);

    scene.add(model);
  },
  undefined,
  (err) => console.error("glb load error:", err)
);

// 애니메이션
function animate() {
  requestAnimationFrame(animate);

  if (model) {
    model.rotation.y += 0.001;
  }

  renderer.render(scene, camera);
}

animate();

// 창 크기 변경
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
});