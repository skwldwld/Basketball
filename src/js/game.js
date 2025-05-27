import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import * as CANNON from 'cannon-es';

let scene, camera, renderer, controls;
let basketball;
let ballResetPending = false;
let throwStartTime = null; 
let isThrown = false;
let world, ballBody;

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

let remainingThrows;

init();
animate();

function init() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 5, 10);

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

  // 농구공
  const ballGeometry = new THREE.SphereGeometry(0.3, 32, 32);
  const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xFF4500 });
  basketball = new THREE.Mesh(ballGeometry, ballMaterial);
  basketball.position.set(0, 1, 2);
  scene.add(basketball);

  const ballShape = new CANNON.Sphere(0.3);
  ballBody = new CANNON.Body({
    mass: 0.2,
    position: new CANNON.Vec3(0, 1, 2),
  });
  ballBody.addShape(ballShape);
  world.addBody(ballBody);

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
  // renderer.domElement.addEventListener('mousedown', onMouseDown);
  // renderer.domElement.addEventListener('mouseup', onMouseUp);
  window.addEventListener('resize', onWindowResize);

  // 디버깅 헬퍼
  const axesHelper = new THREE.AxesHelper(5);
  scene.add(axesHelper);
  const gridHelper = new THREE.GridHelper(100, 100);
  scene.add(gridHelper);
}

let mouseStart = null;
// function onMouseDown(event) {
//   if (!isThrown) {
//     mouseStart = { x: event.clientX, y: event.clientY };
//   }
// }

// function onMouseUp(event) {
//   if (!isThrown && mouseStart) {
//     const dx = event.clientX - mouseStart.x;
//     const dy = mouseStart.y - event.clientY;
//     const powerScale = 0.05;
//     const vx = dx * powerScale;
//     const vy = Math.min(dy * powerScale, 15);
//     const vz = -Math.max(dy * powerScale, 1);
//     ballBody.velocity.set(vx, vy, vz);

//     isThrown = true;
//     throwStartTime = Date.now();     
//     ballResetPending = true;         
//   }
// }

const storedBalls = localStorage.getItem('selectedBalls');
const throwCountRaw = localStorage.getItem('throwCount');

let selectedBalls = storedBalls ? JSON.parse(storedBalls) : [];
let throwCount = throwCountRaw ? JSON.parse(throwCountRaw) : 3;
let currentPlayerIndex = 0;

remainingThrows = Array(selectedBalls.length).fill(throwCount);



// 점수 초기화
selectedBalls.forEach(p => {
  if (p.score === undefined) {
    p.score = 0; // 기존 데이터에 점수 추가
  }
});

// 업데이트된 데이터를 다시 저장
localStorage.setItem('selectedBalls', JSON.stringify(selectedBalls));

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
  ballBody.position.set(0, 1, 2);
  ballBody.velocity.set(0, 0, 0);
  ballBody.angularVelocity.set(0, 0, 0);
  isThrown = false;
  throwStartTime = null;
  ballResetPending = false;  

  // 공 개수 감소
  remainingThrows[currentPlayerIndex] -= 1;
  // UI 업데이트
  updateRemainingThrowsUI();
  // 다음 플레이어로 이동
  currentPlayerIndex = (currentPlayerIndex + 1) % selectedBalls.length;

    // 모든 플레이어가 0개 남으면 결과 페이지로 이동
  if (remainingThrows.every(t => t <= 0)) {
    localStorage.setItem('selectedBalls', JSON.stringify(selectedBalls)); // 점수 저장
    window.location.href = '../../result.html'; // 결과 화면으로 이동
    return;
  }

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

  basketball.position.copy(ballBody.position);
  basketball.quaternion.copy(ballBody.quaternion);

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
