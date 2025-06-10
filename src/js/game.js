import * as THREE from "../../node_modules/three/build/three.module.js"
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
let inactivityTimer = null; // <<< 추가: 비활성화 타이머 ID 저장 변수
let sideCamera; // 옆에서 보는 카메라

const ballDataMap = {
  '농구공': { model: 'basketball', size: 0.01, mass: 0.2, restitution: 0.8, scale: 0.008 },
  '볼링공': { model: 'bowlingball', size: 0.4, mass: 10000, restitution: 0.1, scale: 0.5 },
  '포켓몬볼': { model: 'pokeball', size: 0.1, mass: 0.1, restitution: 0.4, scale: 0.3 },
  '눈덩이': { model: 'snowball', size: 0.1, mass: 0.3, restitution: 0.1, scale: 0.2 },
  '방울토마토': { model: 'tomato', size: 0.1, mass: 0.001, restitution: 0.0, scale: 10 },
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
  scene.background = new THREE.Color(0x87CEEB);


  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, hoopY + 2, 20);
  // camera.lookAt(0, 0, hoopmodelZ + 10);

  // 보조 카메라 (Side Camera) 설정
  const aspect = 2; // 가로/세로 비율
  sideCamera = new THREE.PerspectiveCamera(30, aspect, 0.1, 1000);
  scene.add(sideCamera); 

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableRotate = false;
  controls.maxDistance = 30; // 카메라가 너무 멀어지지 않도록 제한
  controls.target.set(0, hoopY - 2, 0); 
  controls.update(); 

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(5, 10, 7.5);
  scene.add(directionalLight);
  
  // 물리 엔진 설정
  world = new CANNON.World();
  world.gravity.set(0, -9.82, 0);

  // 바닥
  const floorGeometry = new THREE.BoxGeometry(100, 1, 40);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xDEB887 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.position.y = -0.6;
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

  // 골대 모델
  const objloader = new OBJLoader();
  objloader.load('src/models/hoop/basketball_hoop.obj', (object) => {
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load('src/models/hoop/basketball_hoop_diffuse_noAO.jpg');
    object.traverse((child) => {
      if (child.isMesh) {
        child.material.map = texture;
        child.material.needsUpdate = true;
      }
    });

    object.position.set(0, hoopmodelY, hoopmodelZ);
    object.scale.set(0.001, 0.001, 0.001); 
    scene.add(object);
  });

  // 농구 경기장 모델
  objloader.load('src/models/basketball-stadium/source/63BasketBallZemin.obj', (object) => {
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load('src/models/basketball-stadium/textures/BasketZemin_Color.png');
    object.traverse((child) => {
      if (child.isMesh) {
        child.material.map = texture;
        child.material.needsUpdate = true;
      }
    });
    object.position.set(-0.5, 0, 12);
    object.rotation.y = Math.PI / 2;
    object.scale.set(5, 5, 5); 
    scene.add(object);
  });

  // 배경.. 모델
  const gltfLoader = new GLTFLoader();
  gltfLoader.setPath('src/models/seating__bleacher/');
  gltfLoader.load('scene.gltf', (gltf) => {
    const originalBleacher = gltf.scene;
    const bleacherPositions = [
      { x: -26, y: 0, z: -5, rotationY: 0 },
      { x: -26, y: 0, z: 10, rotationY: 0},
      { x: -26, y: 0, z: 25, rotationY: 0 },
      { x: 26, y: 0, z: 0, rotationY: Math.PI },    
      { x: 26, y: 0, z: 20, rotationY: Math.PI}, 
    ];
    bleacherPositions.forEach((pos, i) => {
      const bleacher = originalBleacher.clone(true);
      bleacher.position.set(pos.x, pos.y, pos.z);
      bleacher.rotation.y = pos.rotationY;
      bleacher.scale.set(50, 50, 50); 
      scene.add(bleacher);
      console.log(`관중석 ${i + 1}번 로드 완료`);
    });
  })

  // 배경.. 하늘
  const textureLoader = new THREE.TextureLoader();
  const myTexture = textureLoader.load('src/models/sky/textures/Scene_-_Root_diffuse.jpeg'); 
  gltfLoader.setPath('src/models/sky/');
  gltfLoader.load('scene.glb', (gltf) => {
    const model = gltf.scene;
    model.traverse((child) => {
      if (child.isMesh) {
        child.material.map = myTexture;
        child.material.needsUpdate = true;
      }
    });
    model.position.set(0, 30, 0);
    model.scale.set(0.1, 0.1, 0.1); 
    scene.add(model);
  });

  // 도넛 골대 (시각용)
  const torusGeometry = new THREE.TorusGeometry(ringRadius, 0.05, 16, 100);
  const torusMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const torus = new THREE.Mesh(torusGeometry, torusMaterial);
  torus.position.set(0, hoopY, hoopZ);
  torus.rotation.x = Math.PI / 2;
  scene.add(torus);

  // 골대 (충돌체용 - 박스로 링 구성)
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
  const backboardWidth = 6.3; 
  const backboardHeight = 3.5;
  const backboardDepth = 0.3;
  const backboardShape = new CANNON.Box(new CANNON.Vec3(backboardWidth / 2, backboardHeight / 2, backboardDepth / 2));
  const backboardBody = new CANNON.Body({
    mass: 0, 
    position: new CANNON.Vec3(0, hoopY + 1, hoopZ - 1), 
    restitution: 0.8
  });
  backboardBody.addShape(backboardShape);
  world.addBody(backboardBody);

  // 백보드 시각화
  // const backboardMesh = new THREE.Mesh(
  //   new THREE.BoxGeometry(backboardWidth, backboardHeight, backboardDepth),
  //   new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
  // );
  // backboardMesh.position.copy(backboardBody.position);
  // scene.add(backboardMesh);

  // 폴대 물리 바디
  const poleWidth = 0.5; 
  const poleHeight = 13;
  const poleDepth = 0.9;
  const poleShape = new CANNON.Box(new CANNON.Vec3(poleWidth / 2, poleHeight / 2, poleDepth / 2));
  const poleBody = new CANNON.Body({
    mass: 0,
    position: new CANNON.Vec3(0, hoopmodelY - 3, hoopmodelZ - 2), 
    restitution: 0.3
  });
  poleBody.addShape(poleShape);
  world.addBody(poleBody);

  // 폴대 시각화 
  // const poleMesh = new THREE.Mesh(
  //   new THREE.BoxGeometry(poleWidth, poleHeight, poleDepth),
  //   new THREE.MeshBasicMaterial({ color: 0xc2c2c2, transparent: true, opacity: 0.5 })
  // );
  // poleMesh.position.copy(poleBody.position);
  // scene.add(poleMesh);

  loadPlayerBallModel(currentPlayerIndex);

  selectedBalls.forEach(p => {
    if (p.score === undefined) {
      p.score = 0; 
    }
  });

  // 각 플레이어별 남은 공 수 초기화
  remainingThrows = Array(selectedBalls.length).fill(throwCount);

  // 게임 시작 시 첫 플레이어 턴 알림 및 강조
  if (selectedBalls.length > 0) {
      updatePlayerHighlight();
      startInactivityTimer(); 
  }

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !isCharging && !isThrown) {
      isCharging = true;
      throwPower = 0;
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space' && isCharging && !isThrown) {
      clearTimeout(inactivityTimer);
      const promptElement = document.getElementById('inactivity-prompt');
        if (promptElement) {
            promptElement.style.opacity = 0;
        }

      world.addBody(ballBody);

      ballBody.addEventListener("collide", (event) => {
      const impactVelocity = event.contact.getImpactVelocityAlongNormal();
      const destroyableBalls = ['눈덩이', '방울토마토'];
      const breakThreshold = 5.0;

      if (destroyableBalls.includes(ballName) && impactVelocity > breakThreshold) {
        destroyBall();
      }
    });
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
}

function loadPlayerBallModel(playerIndex) {
  if (ball) scene.remove(ball);
  if (ballBody) world.removeBody(ballBody);

  ballName = selectedBalls[playerIndex].ball;
  const ballData = ballDataMap[ballName];
  console.log();

  if (!ballData) {
    console.warn(`알 수 없는 공 이름: ${ballName}`);
    return;
  }

  const gltfLoader = new GLTFLoader();
  gltfLoader.setPath(`src/models/${ballData.model}/`); 
  gltfLoader.load('scene.gltf', (gltf) => {
    ball = gltf.scene;
    // 공 위치 1/2
    ball.position.set(0, 5, 10);
    ball.scale.set(ballData.scale, ballData.scale, ballData.scale); 
    scene.add(ball);
    console.log('공 모델 로드 완료');

    const ballShape = new CANNON.Sphere(ballData.size);
    ballBody = new CANNON.Body({
      mass: ballData.mass,
      // 공 위치 2/2
      position: new CANNON.Vec3(0, 5, 10),
      material: ballMaterial 
    });
    ballBody.addShape(ballShape);
  }, undefined, (error) => {
    console.error('공 모델 로드 실패:', error);
  });
}

function updateScore(playerName) {
  const player = selectedBalls.find(p => p.name === playerName);
  if (player) {
    player.score += 1; 
    localStorage.setItem('selectedBalls', JSON.stringify(selectedBalls)); 
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

// 점수표에서 현재 턴인 플레이어의 행 강조
function updatePlayerHighlight() {
    const playerRows = document.querySelectorAll("#player-list tr");
    playerRows.forEach((row, index) => {
        row.classList.remove('current-player');
        
        // 현재 플레이어 인덱스와 일치하는 행만 강조
        if (index === currentPlayerIndex) {
            row.classList.add('current-player');
        }
    });
}

// 공 던져!!!
function startInactivityTimer() {
    // 이전에 설정된 타이머가 있다면 제거
    clearTimeout(inactivityTimer);

    const promptElement = document.getElementById('inactivity-prompt');
    
    inactivityTimer = setTimeout(() => {
        promptElement.textContent = "스페이스바를 눌러 공을 던지세요";
        promptElement.style.opacity = 1;
    }, 10000); 
}

function destroyBall() {
  if (!ball || !ballBody) return;

  const position = ball.position.clone();

  scene.remove(ball);
  world.removeBody(ballBody);

  // 파편 그룹 
  const particleGroup = new THREE.Group();
  const particleColor = ballName === '눈덩이' ? 0xffffff : 0xff0000;
  const particleCount = 20;

  for (let i = 0; i < particleCount; i++) {
    const spriteMaterial = new THREE.SpriteMaterial({
      color: particleColor,
      opacity: 0.9,
      transparent: true,
    });

    const particle = new THREE.Sprite(spriteMaterial);
    particle.scale.set(0.2, 0.2, 0.2); 
    particle.position.copy(position);

    particle.position.x += (Math.random() - 0.5) * 0.5;
    particle.position.y += (Math.random() - 0.5) * 0.5;
    particle.position.z += (Math.random() - 0.5) * 0.5;
    particleGroup.add(particle);
  }

  scene.add(particleGroup);

  const startTime = performance.now();
  const duration = 500;

  function animateParticles(time) {
    const elapsed = time - startTime;

    if (elapsed > duration) {
      scene.remove(particleGroup);

      isThrown = false;
      ballResetPending = false;
      proceedToNextTurn(); 
      return;
    }
  }
  requestAnimationFrame(animateParticles);
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

  updateRemainingThrowsUI();

  // 다음 플레이어로 전환
  currentPlayerIndex = (currentPlayerIndex + 1) % selectedBalls.length;
  
  // 모든 플레이어가 공 0개 남으면 결과 페이지로 이동
  if (remainingThrows.every(t => t <= 0)) {
    localStorage.setItem('selectedBalls', JSON.stringify(selectedBalls)); 
    window.location.href = '../../result.html'; 
    return;
  }
  updatePlayerHighlight();
  startInactivityTimer();
  loadPlayerBallModel(currentPlayerIndex);
}

function onWindowResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  // 메인 카메라 업데이트
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  
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
    updateScore(currentPlayer);

    isThrown = false; 
    ballResetPending = false;
   
    setTimeout(() => {
    resetBall();
  }, 1000); 
}

  if (isThrown && ballResetPending && Date.now() - throwStartTime > 3000) {
    resetBall();
  }

  const w = window.innerWidth;
  const h = window.innerHeight;

  // 전체 화면 렌더링
  renderer.setViewport(0, 0, w, h);
  renderer.setScissor(0, 0, w, h);
  renderer.setScissorTest(true); 
  renderer.render(scene, camera);

  // 사이드 카메라 렌더링
  if (ball && ballBody) { 
    const pipWidth = w / 4; 
    const pipHeight = h / 4;
    const pipX = w - pipWidth - 20;
    const pipY = h - pipHeight - 20;

    renderer.setViewport(pipX, pipY, pipWidth, pipHeight);
    renderer.setScissor(pipX, pipY, pipWidth, pipHeight);
    renderer.setScissorTest(true);

    // 위치, 시점이 공을 따라가도록 
    const sideOffset = 10; // 옆
    const heightOffset = 3;  // 위
    sideCamera.position.set(
      ball.position.x + sideOffset,
      ball.position.y + heightOffset,
      ball.position.z
    );
    sideCamera.lookAt(ball.position); 
    renderer.render(scene, sideCamera);
  }
  // Scissor Test 비활성화
  renderer.setScissorTest(false);
}
