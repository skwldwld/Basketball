// background.js
import * as THREE from "../../node_modules/three/build/three.module.js"
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
document.getElementById('background-canvas').appendChild(renderer.domElement);


// 조명 추가
const light = new THREE.PointLight(0xffffff, 1);
light.position.set(5, 5, 5);
scene.add(light);


// 배경.. 하늘
const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();
const myTexture = textureLoader.load('src/models/sky/textures/Scene_-_Root_diffuse.jpeg'); // 여기가 디렉토리
gltfLoader.setPath('src/models/sky/');
gltfLoader.load('scene.glb', (gltf) => {
model = gltf.scene;
model.traverse((child) => {
    if (child.isMesh) {
    // 기본 머티리얼에 텍스처 적용
    child.material.map = myTexture;
    child.material.needsUpdate = true;
    }
});
model.position.set(0, 0, 0);
model.scale.set(0.1, 0.1, 0.1); // 필요 시 크기 조정
scene.add(model);
});

// 애니메이션
function animate() {
    requestAnimationFrame(animate);

    if(model) {
        model.rotation.y += 0.001; // 모델 회전
    }
    renderer.render(scene, camera);
}
animate();

// 창 크기 변경 대응
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
