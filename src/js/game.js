import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let scene, camera, renderer, controls;
let basketball;
let ballResetPending = false;
let throwStartTime = null; 
let isThrown = false;
let world;
let ballBody = null; // 공의 물리 바디
let currentPlayerIndex = 0;

const ballModelMap = {
  '농구공': 'basketball',
  '볼링공': 'bowlingball',
  '종이공': 'paperball',
  '포켓몬볼': 'pokeball',
  '돌맹이': 'rock',
  '눈덩이': 'snowball',
  '방울토마토': 'tomato',
};

const ballSizeMap = {
  '농구공': 0.01,
  '볼링공': 0.4,
  '종이공': 3,
  '포켓몬볼': 0.01,
  '돌맹이': 2,
  '눈덩이': 0.1,
  '방울토마토': 10,
};

const hoopPieces = [];
const segments = 32;
const ringRadius = 1.0;
const ringHeight = 0.1;
const pieceSize = 0.2;
const hoopY = 1;
const hoopZ = -3;

let throwPower = 0;
let powerScaling = 0.4;
let powerMax = 100;
let isCharging = false;

let selectedBalls = [];
let remainingThrows = [];
let throwCount = 3;



init();
animate();

function init() {
  selectedBalls = JSON.parse(localStorage.getItem('selectedBalls') || '[]');
  throwCount = JSON.parse(localStorage.getItem('throwCount') || '3');

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 5, 12);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableRotate = false;

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(5, 10, 7.5);
  scene.add(directionalLight);

  // 물리 엔진 설정
  world = new CANNON.World();
  world.gravity.set(0, -9.82, 0);

  // 바닥
  const floorGeometry = new THREE.BoxGeometry(100, 1, 100);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.position.y = -0.5;
  scene.add(floor);

  const floorShape = new CANNON.Box(new CANNON.Vec3(50, 0.5, 50));
  const floorBody = new CANNON.Body({
    mass: 0,
    position: new CANNON.Vec3(0, -0.5, 0),
  });
  floorBody.addShape(floorShape);
  world.addBody(floorBody);

  // 도넛 골대 (시각용)
  const torusGeometry = new THREE.TorusGeometry(ringRadius, 0.05, 16, 100);
  const torusMaterial = new THREE.MeshStandardMaterial({ color: 0xffff00 });
  const torus = new THREE.Mesh(torusGeometry, torusMaterial);
  torus.position.set(0, hoopY, hoopZ);
  torus.rotation.x = Math.PI / 2;
  scene.add(torus);

  // 도넛 골대 (충돌체용 - 박스로 링 구성)
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = ringRadius * Math.cos(angle);
    const z = ringRadius * Math.sin(angle);

    const shape = new CANNON.Box(new CANNON.Vec3(pieceSize, ringHeight / 2, pieceSize));
    const body = new CANNON.Body({
      mass: 0,
      position: new CANNON.Vec3(x, hoopY, z + hoopZ),
    });
    body.addShape(shape);
    body.quaternion.setFromEuler(0, -angle, 0);
    world.addBody(body);
    hoopPieces.push(body);

    const box = new THREE.BoxGeometry(pieceSize * 2, ringHeight, pieceSize * 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffff00 });
    const mesh = new THREE.Mesh(box, mat);
    mesh.position.set(x, hoopY, z + hoopZ);
    mesh.rotation.y = -angle;
    scene.add(mesh);
  }

  loadPlayerBallModel(currentPlayerIndex);

  // 점수 초기화
selectedBalls.forEach(p => {
  if (p.score === undefined) {
    p.score = 0; // 기존 데이터에 점수 추가
  }
});

  // 각 플레이어별 남은 공 수 초기화
  remainingThrows = Array(selectedBalls.length).fill(throwCount);

  // 이벤트
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !isCharging && !isThrown) {
      isCharging = true;
      throwPower = 0;
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space' && isCharging && !isThrown) {
      const vx = 0;
      const vy = throwPower * 0.7;
      const vz = -throwPower;

      ballBody.velocity.set(vx, vy, vz);
      
      isThrown = true;
      throwStartTime = Date.now();
      ballResetPending = true;

      isCharging = false;
    }
  });
  window.addEventListener('resize', onWindowResize);

  // 디버깅 헬퍼
  const axesHelper = new THREE.AxesHelper(5);
  scene.add(axesHelper);
  const gridHelper = new THREE.GridHelper(100, 100);
  scene.add(gridHelper);
}

function loadPlayerBallModel(playerIndex) {
  if (basketball) scene.remove(basketball);
  if (ballBody) world.removeBody(ballBody);

  const ballName = selectedBalls[playerIndex].ball;
  const modelFolder = ballModelMap[ballName];
  const ballSize = ballSizeMap[ballName] || 0.3;  // 기본 크기 설정

  if (!modelFolder) {
    console.warn(`알 수 없는 공 이름: ${ballName}`);
    return;
  }

  const gltfLoader = new GLTFLoader();
  gltfLoader.setPath(`src/models/${modelFolder}/`); // 폴더 경로 (gltf, bin, 텍스처들이 있는 곳)
  gltfLoader.load('scene.gltf', (gltf) => {
    basketball = gltf.scene;

    gltf.scene.position.set(0, 0, 0);
    gltf.scene.rotation.set(0, 0, 0);

    basketball.scale.set(ballSize, ballSize, ballSize); // 필요 시 크기 조정
    basketball.position.set(0, 3, 5); // 필요 시 위치 조정
    scene.add(basketball);
    console.log('GLTF 모델 로드 완료');

    // if (!ballBody) {  
      const ballShape = new CANNON.Sphere(ballSize);
      ballBody = new CANNON.Body({
        mass: 0.2,
        position: new CANNON.Vec3(0, 3, 5),
      });
      ballBody.addShape(ballShape);
      world.addBody(ballBody);
    // }
  }, undefined, (error) => {
    console.error('GLTF 모델 로드 실패:', error);
  });
}



function updateScore(playerName) {
  const player = selectedBalls.find(p => p.name === playerName);
  if (player) {
    player.score += 1; // 점수 증가
    localStorage.setItem('selectedBalls', JSON.stringify(selectedBalls)); // 저장
    updateScoreUI();
  }
}

function updateScoreUI() {
  const playerRows = document.querySelectorAll("#player-list tr");
  playerRows.forEach(row => {
    const playerName = row.cells[0].textContent.trim();
    const player = selectedBalls.find(p => p.name === playerName);
    if (player) {
      row.cells[3].textContent = `${player.score}점`; // 점수 UI 업데이트
    }
  });
}

function updateRemainingThrowsUI() {
  const playerRows = document.querySelectorAll("#player-list tr");
  playerRows.forEach((row, index) => {
    row.cells[2].textContent = remainingThrows[index];
  });
}

function resetBall() {
  if (!remainingThrows || remainingThrows.length === 0) {
    console.log('remainingThrows가 아직 초기화되지 않았습니다.');
    return;
  }

  ballBody.position.set(0, 3, 5);
  ballBody.velocity.set(0, 0, 0);
  ballBody.angularVelocity.set(0, 0, 0);

  isThrown = false;
  throwStartTime = null;
  ballResetPending = false;  


  // 공 개수 감소
  remainingThrows[currentPlayerIndex]--;

  // UI 업데이트
  updateRemainingThrowsUI();

  // 다음 플레이어로 전환
  currentPlayerIndex = (currentPlayerIndex + 1) % selectedBalls.length;
  
  // 모든 플레이어가 0개 남으면 결과 페이지로 이동
  if (remainingThrows.every(t => t <= 0)) {
    localStorage.setItem('selectedBalls', JSON.stringify(selectedBalls)); // 점수 저장
    window.location.href = '../../result.html'; // 결과 화면으로 이동
    return;
  }

  // 남은 공 정보 저장
  // localStorage.setItem('remainingThrows', JSON.stringify(remainingThrows));
  loadPlayerBallModel(currentPlayerIndex);

}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}


function animate() {
  requestAnimationFrame(animate);
  world.step(1 / 60);

  if (isCharging && throwPower < powerMax) {
    throwPower += powerScaling;
  }

  if (basketball && ballBody) {
    basketball.position.copy(ballBody.position);
    // basketball.quaternion.copy(ballBody.quaternion);
  }

  // 골대 안 통과 체크
  const ballPos = ballBody.position;
  const hoopCenter = new CANNON.Vec3(0, hoopY, hoopZ);
  const dx = ballPos.x - hoopCenter.x;
  const dz = ballPos.z - hoopCenter.z;
  const horizontalDist = Math.sqrt(dx * dx + dz * dz);
  const withinHoopRadius = horizontalDist < 0.9;
  const passedThroughHoop = ballPos.y < hoopY && ballPos.y > hoopY - 0.5;

  if (isThrown && withinHoopRadius && passedThroughHoop) {
    const currentPlayer = selectedBalls[currentPlayerIndex].name;
    updateScore(currentPlayer); // 점수 업데이트
    
    resetBall();
  }

  if (isThrown && ballResetPending && Date.now() - throwStartTime > 3000) {
    resetBall();
  }

  window.remainingThrows = remainingThrows;

  controls.update();
  renderer.render(scene, camera);
}
