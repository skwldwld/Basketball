import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

let spotlight = null;
let spotlightTarget = null;
let lightCone = null;


const ballDataMap = {
  '농구공': { model: 'basketball', size: 0.01, mass: 0.2, restitution: 0.8, scale: 0.008 },
  '볼링공': { model: 'bowlingball', size: 0.4, mass: 10000, restitution: 0.1, scale: 0.4 },
  '포켓몬볼': { model: 'pokeball', size: 0.01, mass: 0.1, restitution: 0.4, scale: 0.02 },
  '눈덩이': { model: 'snowball', size: 0.1, mass: 0.3, restitution: 0.1, scale: 0.1 },
  '방울토마토': { model: 'tomato', size: 0.1, mass: 0.01, restitution: 0.0, scale: 10 },
  // '돌맹이': { model: 'rock', size: 2, mass: 10, restitution: 0.1, scale: 2 },
  // '종이공': { model: 'paperball', size: 3, mass: 30, restitution: 0.3, scale: 3 },
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

let ballMaterial;

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
      world.addBody(ballBody);

      const vx = 0;
      const vy = throwPower * 0.4;
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
    ball.position.set(0, 2, 7);
    ball.scale.set(ballData.scale, ballData.scale, ballData.scale); // 필요 시 크기 조정
    scene.add(ball);
    console.log('GLTF 모델 로드 완료');

    // gltf.scene.position.set(0, 0, 0);
    // gltf.scene.rotation.set(0, 0, 0);

      const ballShape = new CANNON.Sphere(ballData.size);
      ballBody = new CANNON.Body({
        mass: ballData.mass,
        position: new CANNON.Vec3(0, 2, 7),
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

  ballBody.position.set(0, 2, 7);
  ballBody.velocity.set(0, 0, 0);
  ballBody.angularVelocity.set(0, 0, 0);

  isThrown = false;
  throwStartTime = null;
  ballResetPending = false;  

  // 공 개수 감소
  remainingThrows[currentPlayerIndex]--;

  // UI 업데이트
  updateRemainingThrowsUI();

  if (spotlight) {
    scene.remove(spotlight);
    if (spotlightTarget) scene.remove(spotlightTarget);
    spotlight = null;
    spotlightTarget = null;
  }

  if (lightCone) {
  scene.remove(lightCone);
  lightCone = null;
}

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

    // ✅ 이전 스포트라이트 제거
    if (spotlight) {
      scene.remove(spotlight);
      scene.remove(spotlightTarget);
      spotlight = null;
      spotlightTarget = null;
    }

    // ✅ 새로운 스포트라이트 생성
    spotlight = new THREE.SpotLight(0xffffff, 10, 10, Math.PI / 10, 0.3, 1.0);
    spotlight.position.set(ball.position.x, ball.position.y + 10, ball.position.z);
    
    spotlightTarget = new THREE.Object3D();
    spotlightTarget.position.copy(ball.position);
    scene.add(spotlightTarget);
    
    spotlight.target = spotlightTarget;
    scene.add(spotlight);

    const coneHeight = spotlight.distance;
    const coneRadius = Math.tan(spotlight.angle) * coneHeight;

    // 기존 spotlight 설정은 그대로 유지하고, 아래 코드 추가
    const coneGeometry = new THREE.ConeGeometry(coneRadius, coneHeight, 32, 1, true);
    const coneMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide, // 내부도 보이도록
    });

    lightCone = new THREE.Mesh(coneGeometry, coneMaterial);

    // 원뿔 위치와 방향 조정
    lightCone.position.copy(spotlight.position);
    lightCone.lookAt(spotlightTarget.position);
    lightCone.rotateX(Math.PI/2); // 기본이 위쪽이므로 뒤집기
    lightCone.rotateZ(Math.PI); // 전체를 뒤집어서 넓은 부분이 타겟을 향하게

    // 스포트라이트가 향하는 방향
    const direction = new THREE.Vector3().subVectors(spotlightTarget.position, spotlight.position).normalize();
    // 원뿔의 가장 좁은 부분이 스포트라이트의 시작점에 오도록 원뿔 위치를 조정
    lightCone.position.add(direction.multiplyScalar(coneHeight / 2));

    scene.add(lightCone);

    setTimeout(() => {
    resetBall();
  }, 1000); // .5초 대기 후 공 리셋
}

  if (isThrown && ballResetPending && Date.now() - throwStartTime > 3000) {
    resetBall();
  }

  window.remainingThrows = remainingThrows;

  controls.update();
  renderer.render(scene, camera);
}
