import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let scene, camera, renderer, controls;
let ballResetPending = false;
let throwStartTime = null; 
let isThrown = false;
let world;
let ball = null;
let ballBody = null; // 공의 물리 바디
let ballName = null;
let currentPlayerIndex = 0;

let sideCamera; // 옆에서 보는 카메라

const ballDataMap = {
  '농구공': { model: 'basketball', size: 0.01, mass: 0.2, restitution: 0.8, scale: 0.005 },
  '볼링공': { model: 'bowlingball', size: 0.4, mass: 10000, restitution: 0.1, scale: 0.3 },
  '포켓몬볼': { model: 'pokeball', size: 0.01, mass: 0.1, restitution: 0.4, scale: 0.02 },
  '눈덩이': { model: 'snowball', size: 0.1, mass: 0.3, restitution: 0.1, scale: 0.1 },
  '방울토마토': { model: 'tomato', size: 0.1, mass: 0.001, restitution: 0.0, scale: 10 },
  // '돌맹이': { model: 'rock', size: 2, mass: 10, restitution: 0.1, scale: 2 },
  // '종이공': { model: 'paperball', size: 3, mass: 30, restitution: 0.3, scale: 3 },
};

const hoopPieces = [];
const segments = 32;
const ringRadius = 0.85;
const ringHeight = 0.01;
const pieceSize = 0.2;

const hoopY = 12.9;
const hoopZ = -3.3;
const hoopmodelY = 8;
const hoopmodelZ = -5;

let throwPower = 0;
let powerScaling = 0.4;
let powerMax = 100;
let isCharging = false;

let selectedBalls = [];
let remainingThrows = [];
let throwCount = 3;

let ballMaterial;

init();
animate();

function init() {
  selectedBalls = JSON.parse(localStorage.getItem('selectedBalls') || '[]');
  throwCount = JSON.parse(localStorage.getItem('throwCount') || '3');

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 8, 18);
  camera.lookAt(0, hoopmodelY + 10, hoopmodelZ + 10);

  // --- 추가: 보조 카메라 (Side Camera) 설정 ---
  const aspect = 1; // 네모난 화면이므로 가로/세로 비율은 1
  sideCamera = new THREE.PerspectiveCamera(30, aspect, 0.1, 1000);
  scene.add(sideCamera); // 씬에 추가해줘야 합니다.

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableRotate = false;
  controls.target.set(0, hoopY, hoopZ - 10); // 예시: 농구 골대 림의 중심을 바라보도록 설정
  controls.update(); // target을 변경한 후에는 항상 update()를 호출해야 합니다.

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

  // 재질 및 ContactMaterial 등록 (여기)
  ballMaterial = new CANNON.Material('ball_' + ballName);
  const ballFloorContactMaterial = new CANNON.ContactMaterial(
    ballMaterial, floorMaterial,
    { friction: 0.3, restitution: 0.8 }
  );
  world.addContactMaterial(ballFloorContactMaterial)

  const floorShape = new CANNON.Box(new CANNON.Vec3(50, 0.5, 50));
  const floorBody = new CANNON.Body({
    mass: 0,
    position: new CANNON.Vec3(0, -0.5, 0),
    material: floorMaterial // 바닥 재질 설정
  });
  floorBody.addShape(floorShape);
  world.addBody(floorBody);

  // 골대
  const loader = new OBJLoader();
  loader.load('src/models/hoop/basketball_hoop.obj', (object) => {
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load('src/models/hoop/basketball_hoop_diffuse_noAO.jpg');
    object.traverse((child) => {
      if (child.isMesh) {
        child.material.map = texture;
        child.material.needsUpdate = true;
      }
    });

    object.position.set(0, hoopmodelY, hoopmodelZ);
    object.scale.set(0.001, 0.001, 0.001); // OBJ 크기에 따라 조정
    scene.add(object);
  });

  // 도넛 골대 (시각용)
  const torusGeometry = new THREE.TorusGeometry(ringRadius, 0.05, 16, 100);
  const torusMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const torus = new THREE.Mesh(torusGeometry, torusMaterial);
  torus.position.set(0, hoopY, hoopZ);
  torus.rotation.x = Math.PI / 2;
  scene.add(torus);

  // 도넛 골대 (충돌체용 - 박스로 링 구성)
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = ringRadius * Math.cos(angle);
    const z = ringRadius * Math.sin(angle);

    const shape = new CANNON.Box(new CANNON.Vec3(pieceSize/2, ringHeight, pieceSize/2));
    const body = new CANNON.Body({
      mass: 0,
      position: new CANNON.Vec3(x, hoopY, z + hoopZ),
    });
    body.addShape(shape);
    body.quaternion.setFromEuler(0, -angle, 0);
    world.addBody(body);
    hoopPieces.push(body);

    const box = new THREE.BoxGeometry(pieceSize/2, ringHeight, pieceSize/2 );
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(box, mat);
    mesh.position.set(x, hoopY, z + hoopZ);
    mesh.rotation.y = -angle;
    scene.add(mesh);
  }

  // 백보드 물리 바디
  const backboardWidth = 6.3; // 실제 모델 크기에 맞춰 조절
  const backboardHeight = 3.5;
  const backboardDepth = 0.5;
  const backboardShape = new CANNON.Box(new CANNON.Vec3(backboardWidth / 2, backboardHeight / 2, backboardDepth / 2));
  const backboardBody = new CANNON.Body({
    mass: 0, // 움직이지 않는 물체
    position: new CANNON.Vec3(0, hoopY + 1, hoopZ - 1), // 골대 링 뒤쪽, 높이 조정 필요
    restitution: 0.8
  });
  backboardBody.addShape(backboardShape);
  world.addBody(backboardBody);

  // 디버깅용 시각화 (선택 사항)
  const backboardMesh = new THREE.Mesh(
    new THREE.BoxGeometry(backboardWidth, backboardHeight, backboardDepth),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
  );
  backboardMesh.position.copy(backboardBody.position);
  scene.add(backboardMesh);

  // 폴대 물리 바디
  const poleWidth = 0.5; // 실제 모델 크기에 맞춰 조절
  const poleHeight = 10;
  const poleDepth = 0.5;
  const poleShape = new CANNON.Box(new CANNON.Vec3(poleWidth / 2, poleHeight / 2, poleDepth / 2));
  const poleBody = new CANNON.Body({
    mass: 0, // 움직이지 않는 물체
    position: new CANNON.Vec3(0, hoopmodelY, hoopmodelZ - 2), // 골대 링 뒤쪽, 높이 조정 필요
    restitution: 0.8
  });
  poleBody.addShape(poleShape);
  world.addBody(poleBody);

  // 디버깅용 시각화 (선택 사항)
  const poleMesh = new THREE.Mesh(
    new THREE.BoxGeometry(poleWidth, poleHeight, poleDepth),
    new THREE.MeshBasicMaterial({ color: 0xc2c2c2, transparent: true, opacity: 0.5 })
  );
  poleMesh.position.copy(poleBody.position);
  scene.add(poleMesh);


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
      world.addBody(ballBody);

      const vx = 0;
      const vy = throwPower * 1.3;
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
  if (ball) scene.remove(ball);
  if (ballBody) world.removeBody(ballBody);

  ballName = selectedBalls[playerIndex].ball;
  const ballData = ballDataMap[ballName];
  console.log();

  // const modelFolder = ballModelMap[ballName];
  // const ballSize = ballSizeMap[ballName] || 0.3;  // 기본 크기 설정

  if (!ballData) {
    console.warn(`알 수 없는 공 이름: ${ballName}`);
    return;
  }

  const gltfLoader = new GLTFLoader();
  gltfLoader.setPath(`src/models/${ballData.model}/`); // 폴더 경로 (gltf, bin, 텍스처들이 있는 곳)
  gltfLoader.load('scene.gltf', (gltf) => {
    ball = gltf.scene;
    // 공 위치 1/2
    ball.position.set(0, 5, 10);
    ball.scale.set(ballData.scale, ballData.scale, ballData.scale); // 필요 시 크기 조정
    scene.add(ball);
    console.log('GLTF 모델 로드 완료');

    const ballShape = new CANNON.Sphere(ballData.size);
    ballBody = new CANNON.Body({
      mass: ballData.mass,
      // 공 위치 2/2
      position: new CANNON.Vec3(0, 5, 10),
      material: ballMaterial 
    });
    ballBody.addShape(ballShape);
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

  ballBody.position.set(0, 3, 10);
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

// function onWindowResize() {
//   camera.aspect = window.innerWidth / window.innerHeight;
//   camera.updateProjectionMatrix();
//   renderer.setSize(window.innerWidth, window.innerHeight);
// }

function onWindowResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  // 메인 카메라 업데이트
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  
  // 사이드 카메라 업데이트 (가로/세로 비율 1:1 유지)
  sideCamera.aspect = 1; // (w / 4) / (h / 4) = w / h 와 동일, 하지만 정사각형을 원하면 1로 고정
  sideCamera.updateProjectionMatrix();

  renderer.setSize(w, h);
}


function animate() {
  requestAnimationFrame(animate);

  world.step(1 / 60);

  if (isCharging && throwPower < powerMax) {
    throwPower += powerScaling;
  }

  if (ball !== null && ballBody !== null) {
    ball.position.copy(ballBody.position);
    // ball.quaternion.copy(ballBody.quaternion);
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

    isThrown = false; // 중복 체크 방지
    ballResetPending = false;
   
    setTimeout(() => {
    resetBall();
  }, 1000); // .5초 대기 후 공 리셋
}

  if (isThrown && ballResetPending && Date.now() - throwStartTime > 3000) {
    resetBall();
  }


  // --- 렌더링 로직 수정 ---

  const w = window.innerWidth;
  const h = window.innerHeight;

  // 1. 전체 화면 (메인 카메라) 렌더링
  renderer.setViewport(0, 0, w, h);
  renderer.setScissor(0, 0, w, h);
  renderer.setScissorTest(true); // Scissor Test 활성화
  renderer.render(scene, camera);

  // 2. 오른쪽 위 보조 화면 (사이드 카메라) 렌더링
  if (ball && ballBody) { // 공이 존재할 때만 보조 화면 렌더링
    const pipWidth = w / 4;  // 화면 너비의 1/4 크기
    const pipHeight = h / 4; // 화면 높이의 1/4 크기
    const pipX = w - pipWidth - 20; // 오른쪽에서 20px 띄움
    const pipY = h - pipHeight - 20; // 위에서 20px 띄움

    renderer.setViewport(pipX, pipY, pipWidth, pipHeight);
    renderer.setScissor(pipX, pipY, pipWidth, pipHeight);
    renderer.setScissorTest(true);

    // 사이드 카메라가 공을 따라가도록 위치와 시점 업데이트
    const sideOffset = 15; // 옆에서 얼마나 떨어져서 볼지
    const heightOffset = 5;  // 위에서 얼마나 높게 볼지
    sideCamera.position.set(
      ball.position.x + sideOffset,
      ball.position.y + heightOffset,
      ball.position.z
    );
    sideCamera.lookAt(ball.position); // 항상 공을 바라보도록 설정

    // 보조 화면 배경을 약간 어둡게 처리 (선택사항)
    renderer.setClearColor(0x000000, 0.5); 
    renderer.clear(false, true, false); // Depth 버퍼만 클리어
    
    renderer.render(scene, sideCamera);

    // 다음 렌더링을 위해 기본값으로 복원
    renderer.setClearColor(0x000000, 0); 
  }

  // Scissor Test 비활성화
  renderer.setScissorTest(false);

  // window.remainingThrows = remainingThrows;

  // controls.update();
  // renderer.render(scene, camera);
}
