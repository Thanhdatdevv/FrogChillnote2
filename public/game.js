const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let myUsername = "";
let currentRoomId = null;
let mySlot = null;
let roomData = null;
let gameState = 'lobby';

// --- TẢI TÀI NGUYÊN HÌNH ẢNH ---
const imgIdle = new Image(); imgIdle.src = 'assets/cat_idle.png';
const imgRun = new Image(); imgRun.src = 'assets/cat1.png';
const imgLine = new Image(); imgLine.src = 'assets/day.png'; 
const imgTicket = new Image(); imgTicket.src = 'assets/bando.png';
const imgMonster = new Image(); imgMonster.src = 'assets/chuot.png';
const imgMSpit = new Image(); imgMSpit.src = 'assets/chuotskill.png';
const imgHeartFx = new Image(); imgHeartFx.src = 'assets/tim.png'; 
const imgSword = new Image(); imgSword.src = 'assets/kiem.png';

// --- THÔNG SỐ KHÔNG GIAN GAME ---
const V_WIDTH = 850;   
const V_HEIGHT = 400;  
const MAP_WIDTH = 1700; 
const FLOOR_Y = 320;   // Mặt sàn cỏ bắt đầu từ y = 320

// Phóng to kích thước nhân vật vạm vỡ
const CAT_W = 120;
const CAT_H = 120;
const MONSTER_W = 70;
const MONSTER_H = 70;

const MAX_ROPE_DIST = 380; 

let players = { slot1: null, slot2: null };
let monsters = [];
let playerProjectiles = []; 
let monsterProjectiles = []; 
let ticket = { x: -100, y: -100, spawned: false, pickedUp: false };
let portal = { x: 1550, y: FLOOR_Y - 120, width: 80, height: 120, open: false };
let gameLevel = 1;

// Biến hiệu ứng và camera toàn cục
let cameraX = 0;
let healEffectTimer = 0; 
let ropeWarningTimer = 0;
let gameOverReason = "";

// Cấu hình Cooldown (Thời gian hồi chiêu bằng số Frame: 60 frame = 1 giây)
const COOLDOWNS = {
    shoot: 1.5 * 60, // 1.5 giây hồi kiếm
    heal: 5 * 60     // 5 giây hồi máu
};
let myShootTimer = 0;
let myHealTimer = 0;

// Cấu hình phím bấm ảo HUD cố định màn hình
const buttons = {
    left:   { x: 30,  y: 310, w: 60, h: 60, label: "◀", pressed: false },
    right:  { x: 110, y: 310, w: 60, h: 60, label: "▶", pressed: false },
    jump:   { x: 650, y: 310, w: 60, h: 60, label: "▲", pressed: false },
    action: { x: 730, y: 310, w: 95, h: 60, label: "ATK", pressed: false } 
};

// Cấu trúc nút bấm "VÀO TEST LUÔN" trên giao diện HTML cũ
setTimeout(() => {
    const authBox = document.getElementById('auth-screen');
    if (authBox && !document.getElementById('test-fast-btn')) {
        const testBtn = document.createElement('button');
        testBtn.id = 'test-fast-btn';
        testBtn.innerText = '⚡ VÀO TEST LUÔN';
        testBtn.style.marginTop = '10px';
        testBtn.style.background = '#ff4500';
        testBtn.style.color = '#fff';
        testBtn.style.padding = '10px';
        testBtn.style.border = 'none';
        testBtn.style.borderRadius = '5px';
        testBtn.style.cursor = 'pointer';
        testBtn.style.fontWeight = 'bold';
        testBtn.onclick = fastTestMode;
        authBox.appendChild(testBtn);
    }
}, 500);

function fastTestMode() {
    myUsername = "Tester ⚔️";
    mySlot = 'slot1';
    buttons.action.label = "KIẾM";
    document.getElementById('auth-screen').style.display = 'none';
    canvas.style.display = 'block';
    gameState = 'playing';
    try { document.documentElement.requestFullscreen(); } catch(e){}
    resizeCanvas();
    initGameWorld();
    gameLoop();
}

function resizeCanvas() {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    let scale = Math.min(windowWidth / V_WIDTH, windowHeight / V_HEIGHT);
    canvas.style.width = (V_WIDTH * scale) + 'px';
    canvas.style.height = (V_HEIGHT * scale) + 'px';
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => { setTimeout(resizeCanvas, 200); });

function login() {
    myUsername = document.getElementById('username').value.trim();
    if(!myUsername) return alert("Nhập tên vô nè!");
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'flex';
    document.getElementById('welcome-text').innerText = `Chào ${myUsername} 🐯`;
    try { document.documentElement.requestFullscreen(); } catch(e){}
    resizeCanvas();
}
function createRoom() { socket.emit('createRoom', myUsername); }
function joinRoom() {
    let rId = document.getElementById('room-id-input').value.trim();
    if(!rId) return alert("Nhập ID phòng vào chứ!");
    socket.emit('joinRoom', { roomId: rId, username: myUsername });
}
function startGame() { socket.emit('startGame', currentRoomId); }

socket.on('roomCreated', (data) => setupRoomUI(data));
socket.on('joinSuccess', (data) => setupRoomUI(data));
socket.on('roomUpdated', (data) => {
    roomData = data;
    document.getElementById('slot1-name').innerText = data.players.slot1?.name || "Trống";
    document.getElementById('slot2-name').innerText = data.players.slot2?.name || "Trống";
    if (data.players.slot1 && data.players.slot2 && mySlot === 'slot1') {
        document.getElementById('start-btn').style.display = 'block';
        document.getElementById('wait-msg').style.display = 'none';
    }
});
socket.on('gameStarted', () => {
    document.getElementById('room-screen').style.display = 'none';
    canvas.style.display = 'block';
    gameState = 'playing';
    resizeCanvas();
    initGameWorld();
    gameLoop();
});

socket.on('peerAction', ({ actionType }) => {
    if (actionType === 'heal') {
        healEffectTimer = 90; 
        if (players.slot1) {
            players.slot1.hp = Math.min(players.slot1.maxHp, players.slot1.hp + Math.round(players.slot1.maxHp * 0.2));
        }
    } else if (actionType === 'shoot') {
        if (players.slot1) {
            playerProjectiles.push({
                x: players.slot1.x + (players.slot1.dir === 1 ? CAT_W : -30),
                y: players.slot1.y + CAT_H / 2,
                vx: players.slot1.dir * 8,
                w: 50, h: 20
            });
        }
    }
});

socket.on('peerUpdate', ({ slot, playerData }) => {
    if(players[slot]) {
        players[slot].x = playerData.x;
        players[slot].y = playerData.y;
        players[slot].state = playerData.state;
        players[slot].frame = playerData.frame;
        players[slot].dir = playerData.dir;
    }
});

socket.on('levelUp', (data) => {
    gameLevel = data.level;
    initGameWorld();
});
socket.on('errorMsg', (msg) => alert(msg));
socket.on('playerLeft', () => {
    alert("Đồng đội đã rời trận mất tiêu 😿!");
    location.reload();
});

function setupRoomUI(data) {
    currentRoomId = data.roomId;
    mySlot = data.slot;
    roomData = data.roomData;
    document.getElementById('lobby-screen').style.display = 'none';
    document.getElementById('room-screen').style.display = 'flex';
    document.getElementById('display-room-id').innerText = currentRoomId;
    document.getElementById('slot1-name').innerText = roomData.players.slot1?.name || "Trống";
    document.getElementById('slot2-name').innerText = roomData.players.slot2?.name || "Trống";
    
    if(mySlot === 'slot1') buttons.action.label = "KIẾM";
    if(mySlot === 'slot2') buttons.action.label = "HỒI MÁU";
}

function initGameWorld() {
    let pMaxHp = Math.round(100 * Math.pow(1.5, gameLevel - 1));

    // Đặt tọa độ y ban đầu chuẩn sàn cỏ
    players.slot1 = { x: 200, y: FLOOR_Y - CAT_H, vx: 0, vy: 0, state: 'idle', frame: 0, animTick: 0, dir: 1, isGrounded: true, width: CAT_W, height: CAT_H, hp: pMaxHp, maxHp: pMaxHp };
    players.slot2 = { x: 100, y: FLOOR_Y - CAT_H, vx: 0, vy: 0, state: 'idle', frame: 0, animTick: 0, dir: 1, isGrounded: true, width: CAT_W, height: CAT_H, hp: pMaxHp, maxHp: pMaxHp };
    
    // Nếu chơi chế độ TEST một mình, tạo bù bot slot 2 đứng cạnh cho dây không đứt
    if (!currentRoomId) {
        players.slot2.x = 280;
    }

    monsters = [];
    playerProjectiles = [];
    monsterProjectiles = [];
    ticket.spawned = false; ticket.pickedUp = false;
    portal.open = false;
    gameOverReason = "";
    myShootTimer = 0;
    myHealTimer = 0;

    spawnMonster(500);
    spawnMonster(900);
    spawnMonster(1300);
}

function spawnMonster(customX) {
    let mHp = Math.round(30 * Math.pow(1.4, gameLevel - 1));
    let spawnX = customX !== undefined ? customX : (Math.random() * 1100 + 400);
    monsters.push({
        x: spawnX,
        y: FLOOR_Y - MONSTER_H, 
        vx: (Math.random() > 0.5 ? 1 : -1) * 1.5,
        hp: mHp, maxHp: mHp,
        width: MONSTER_W, height: MONSTER_H,
        dir: 1,
        shootCooldown: Math.floor(Math.random() * 100) + 60
    });
}

function getTouchPos(touch) {
    let rect = canvas.getBoundingClientRect();
    return {
        x: (touch.clientX - rect.left) * (V_WIDTH / rect.width),
        y: (touch.clientY - rect.top) * (V_HEIGHT / rect.height)
    };
}

window.addEventListener('touchstart', (e) => {
    if(gameState !== 'playing' || gameOverReason) return;
    for (let touch of e.touches) {
        let pos = getTouchPos(touch);
        for (let b in buttons) {
            let btn = buttons[b];
            if (pos.x >= btn.x && pos.x <= btn.x + btn.w && pos.y >= btn.y && pos.y <= btn.y + btn.h) {
                btn.pressed = true;
                if(b === 'action') performAction();
            }
        }
    }
}, {passive: false});

window.addEventListener('touchend', (e) => {
    if(gameState !== 'playing') return;
    for (let b in buttons) buttons[b].pressed = false;
    for (let touch of e.touches) {
        let pos = getTouchPos(touch);
        for (let b in buttons) {
            let btn = buttons[b];
            if (pos.x >= btn.x && pos.x <= btn.x + btn.w && pos.y >= btn.y && pos.y <= btn.y + btn.h) {
                btn.pressed = true;
            }
        }
    }
});

function performAction() {
    if(gameOverReason) return;
    let me = players[mySlot];
    if (!me) return;

    if (mySlot === 'slot1') {
        if (myShootTimer > 0) return;
        me.state = 'attack';
        playerProjectiles.push({
            x: me.x + (me.dir === 1 ? CAT_W : -30),
            y: me.y + CAT_H / 2,
            vx: me.dir * 8,
            w: 50, h: 20
        });
        if(currentRoomId) socket.emit('playerAction', { roomId: currentRoomId, actionType: 'shoot' });
        myShootTimer = COOLDOWNS.shoot; 
    } else {
        if (myHealTimer > 0) return;
        if(currentRoomId) socket.emit('playerAction', { roomId: currentRoomId, actionType: 'heal' });
        healEffectTimer = 90; 
        if (players.slot1) {
            players.slot1.hp = Math.min(players.slot1.maxHp, players.slot1.hp + Math.round(players.slot1.maxHp * 0.2));
        }
        myHealTimer = COOLDOWNS.heal; 
        
        if (ticket.spawned && !ticket.pickedUp) {
            if (Math.abs((me.x + CAT_W/2) - ticket.x) < 90) {
                ticket.pickedUp = true;
            }
        }
        if (ticket.pickedUp && Math.abs((me.x + CAT_W/2) - (portal.x + 40)) < 90) {
            portal.open = true;
        }
    }
}

function update() {
    if(gameOverReason) return;

    let me = players[mySlot];
    if(!me) return;

    if (myShootTimer > 0) myShootTimer--;
    if (myHealTimer > 0) myHealTimer--;

    // Di chuyển trái/phải
    if (buttons.left.pressed) {
        me.vx = -4.5; me.dir = -1; me.state = 'run';
    } else if (buttons.right.pressed) {
        me.vx = 4.5; me.dir = 1; me.state = 'run';
    } else {
        me.vx = 0; if(me.state !== 'attack') me.state = 'idle';
    }

    if (buttons.jump.pressed && me.isGrounded) {
        me.vy = -13; me.isGrounded = false;
    }

    me.vy += 0.6; 
    me.x += me.vx; me.y += me.vy;

    // --- SỬA LỖI LỆCH KHI ĐỨNG IM ---
    // Vì sprite 'idle' của chú mèo nằm rạp thấp hơn sprite 'run' 20 pixel, 
    // ta trừ hao độ cao chân chạm sàn động để mèo luôn chạm cỏ đẹp đẽ.
    let currentFloorLimit = FLOOR_Y - CAT_H;
    if(me.state === 'idle') {
        currentFloorLimit = (FLOOR_Y - CAT_H) + 20; 
    }

    if(me.y >= currentFloorLimit) {
        me.y = currentFloorLimit; me.vy = 0; me.isGrounded = true;
    }
    if(me.x < 0) me.x = 0; if(me.x > MAP_WIDTH - CAT_W) me.x = MAP_WIDTH - CAT_W;

    me.animTick++;
    if (me.state === 'run') {
        if(me.animTick % 5 === 0) me.frame = (me.frame + 1) % 8;
    } else if (me.state === 'idle') {
        if(me.animTick % 10 === 0) me.frame = (me.frame + 1) % 3;
    }

    if(currentRoomId) {
        socket.emit('playerUpdate', {
            roomId: currentRoomId,
            slot: mySlot,
            playerData: { x: me.x, y: me.y, state: me.state, frame: me.frame, dir: me.dir }
        });
    }

    cameraX = me.x + CAT_W / 2 - V_WIDTH / 2;
    if(cameraX < 0) cameraX = 0;
    if(cameraX > MAP_WIDTH - V_WIDTH) cameraX = MAP_WIDTH - V_WIDTH;

    // --- CƠ CHẾ SỢI DÂY NỐI DAY.PNG LẶP LIÊN TỤC ---
    if (players.slot1 && players.slot2) {
        // Đồng bộ hạ sàn cho cả đồng đội p2 khi đứng im
        if(!currentRoomId && players.slot2.state === 'idle') {
            players.slot2.y = (FLOOR_Y - CAT_H) + 20;
        }
        
        let p1Center = players.slot1.x + CAT_W / 2;
        let p2Center = players.slot2.x + CAT_W / 2;
        let dist = Math.abs(p1Center - p2Center);

        if (dist > MAX_ROPE_DIST) {
            ropeWarningTimer++;
            let pullForce = (dist - MAX_ROPE_DIST) * 0.06;
            if (p1Center > p2Center) {
                players.slot1.x -= pullForce; if(currentRoomId) players.slot2.x += pullForce;
            } else {
                players.slot1.x += pullForce; if(currentRoomId) players.slot2.x -= pullForce;
            }
            if (ropeWarningTimer > 180) {
                gameOverReason = "SỢI DÂY ĐỊNH MỆNH ĐÃ BỊ ĐỨT DO HAI BẠN QUÁ XA NHAU!";
            }
        } else {
            if(ropeWarningTimer > 0) ropeWarningTimer--;
        }
    }

    // Quái vật chuột di chuyển tuần tra
    monsters.forEach((m) => {
        m.x += m.vx;
        if(m.x < 50 || m.x > MAP_WIDTH - 100) { m.vx *= -1; }
        m.dir = m.vx > 0 ? 1 : -1;

        m.shootCooldown--;
        if (m.shootCooldown <= 0) {
            let mDmg = Math.round(8 * Math.pow(1.4, gameLevel - 1));
            monsterProjectiles.push({
                x: m.x + (m.dir === 1 ? m.width : -20),
                y: m.y + 25,
                vx: m.dir * 4.5,
                w: 24, h: 24,
                dmg: mDmg
            });
            m.shootCooldown = Math.floor(Math.random() * 110) + 70;
        }
    });

    // Va chạm đạn kiếm
    playerProjectiles.forEach((p, pIdx) => {
        p.x += p.vx;
        monsters.forEach((m, mIdx) => {
            if (p.x + p.w >= m.x && p.x <= m.x + m.width && p.y + p.h >= m.y && p.y <= m.y + m.height) {
                m.hp -= Math.round(15 * Math.pow(1.5, gameLevel - 1));
                playerProjectiles.splice(pIdx, 1);

                if (m.hp <= 0) {
                    monsters.splice(mIdx, 1);
                    spawnMonster(); 

                    if (!ticket.spawned && Math.random() < 0.5) {
                        ticket.spawned = true;
                        ticket.x = m.x; ticket.y = FLOOR_Y - 45;
                    }
                }
            }
        });
    });
    playerProjectiles = playerProjectiles.filter(p => p.x > 0 && p.x < MAP_WIDTH);

    // Va chạm đạn chuột
    monsterProjectiles.forEach((mp, mpIdx) => {
        mp.x += mp.vx;
        for (let slot in players) {
            let cat = players[slot];
            if (cat && mp.x + mp.w >= cat.x && mp.x <= cat.x + CAT_W && mp.y + mp.h >= cat.y && mp.y <= cat.y + CAT_H) {
                cat.hp -= mp.dmg;
                monsterProjectiles.splice(mpIdx, 1);
                if (cat.hp <= 0) {
                    gameOverReason = `${slot === 'slot1' ? 'SÁT THỦ' : 'HỖ TRỢ'} ĐÃ BỊ CHUỘT HẠ GỤC!`;
                }
            }
        }
    });
    monsterProjectiles = monsterProjectiles.filter(mp => mp.x > 0 && mp.x < MAP_WIDTH);

    if (portal.open && players.slot1.x > portal.x - 20 && players.slot2.x > portal.x - 20) {
        if(!currentRoomId) {
            gameLevel++; initGameWorld();
        } else if(mySlot === 'slot1') {
            socket.emit('nextLevel', currentRoomId);
        }
    }

    if(healEffectTimer > 0) healEffectTimer--;
}

function draw() {
    ctx.clearRect(0, 0, V_WIDTH, V_HEIGHT);

    ctx.save();
    ctx.translate(-cameraX, 0);

    // Nền trời và mặt đất
    ctx.fillStyle = '#4682B4'; ctx.fillRect(0, 0, MAP_WIDTH, V_HEIGHT);
    ctx.fillStyle = '#228B22'; ctx.fillRect(0, FLOOR_Y, MAP_WIDTH, V_HEIGHT - FLOOR_Y);

    // VẼ SỢI DÂY NỐI DAY.PNG LẶP LIÊN TỤC TỪ MÈO 1 SANG MÈO 2
    if (players.slot1 && players.slot2) {
        let p1C = { x: players.slot1.x + CAT_W / 2, y: players.slot1.y + CAT_H / 2 };
        let p2C = { x: players.slot2.x + CAT_W / 2, y: players.slot2.y + CAT_H / 2 };
        
        let distance = Math.sqrt(Math.pow(p2C.x - p1C.x, 2) + Math.pow(p2C.y - p1C.y, 2));
        let segments = Math.floor(distance / 25); // Cứ mỗi 25px vẽ 1 mắc xích tơ hồng
        
        let singleW = imgLine.width / 2;
        let singleH = imgLine.height / 2;

        for(let i = 0; i <= segments; i++) {
            let t = segments === 0 ? 0 : i / segments;
            let currX = p1C.x + (p2C.x - p1C.x) * t;
            let currY = p1C.y + (p2C.y - p1C.y) * t;
            
            try {
                // Cắt mảnh ô vuông đầu tiên có hình quả tim của file day.png để vẽ dây nối mượt mà
                ctx.drawImage(imgLine, 0, 0, singleW, singleH, currX - 15, currY - 15, 30, 30);
            } catch(e) {
                ctx.fillStyle = '#ffb6c1'; ctx.fillRect(currX - 4, currY - 4, 8, 8);
            }
        }
    }

    // Cổng vượt ải
    ctx.fillStyle = portal.open ? '#00ffcc' : '#8b4513';
    ctx.fillRect(portal.x, portal.y, portal.width, portal.height);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial';
    ctx.fillText(portal.open ? "CỔNG MỞ" : "CỔNG KHÓA", portal.x + 2, portal.y - 15);

    // Bản đồ rơi dưới sàn
    if (ticket.spawned && !ticket.pickedUp) {
        try { ctx.drawImage(imgTicket, ticket.x, ticket.y, 45, 45); } catch(e){
            ctx.fillStyle = 'orange'; ctx.fillRect(ticket.x, ticket.y, 35, 35);
        }
    }

    // Quái chuột
    monsters.forEach(m => {
        ctx.save();
        if(m.dir === 1) { 
            ctx.translate(m.x + MONSTER_W/2, m.y + MONSTER_H/2); ctx.scale(-1, 1); ctx.translate(-(m.x + MONSTER_W/2), -(m.y + MONSTER_H/2));
        }
        try { ctx.drawImage(imgMonster, m.x, m.y, m.width, m.height); } catch(e){
            ctx.fillStyle = 'purple'; ctx.fillRect(m.x, m.y, m.width, m.height);
        }
        ctx.restore();
        
        ctx.fillStyle = 'black'; ctx.fillRect(m.x, m.y - 12, m.width, 5);
        ctx.fillStyle = '#ff3300'; ctx.fillRect(m.x, m.y - 12, m.width * (m.hp / m.maxHp), 5);
    });

    // Đạn nước bọt của chuột
    monsterProjectiles.forEach(mp => {
        try { ctx.drawImage(imgMSpit, mp.x, mp.y, mp.w, mp.h); } catch(e) {
            ctx.fillStyle = 'cyan'; ctx.fillRect(mp.x, mp.y, mp.w, mp.h);
        }
    });

    // Đạn kiếm nằm ngang phóng đi
    playerProjectiles.forEach(p => {
        ctx.save();
        ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
        ctx.rotate(p.vx > 0 ? Math.PI / 2 : -Math.PI / 2);
        try { ctx.drawImage(imgSword, -p.h / 2, -p.w / 2, p.h, p.w); } catch(e) {
            ctx.fillStyle = 'yellow'; ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
        }
        ctx.restore();
    });

    // HIỆU ỨNG TIM.PNG BAY PHẤP PHỚI LIÊN TỤC KHI BẤM SKILL HỒI MÁU
    if (healEffectTimer > 0 && players.slot1) {
        try {
            let pulseOffsetY = (healEffectTimer % 30) * 1.8; 
            ctx.drawImage(imgHeartFx, players.slot1.x + CAT_W/2 - 25, players.slot1.y - 45 - pulseOffsetY, 50, 50);
        } catch(e){}
    }

    // Vẽ 2 chú mèo
    for (let slot in players) {
        let p = players[slot];
        if (!p) continue;

        let sheet = p.state === 'run' ? imgRun : imgIdle;
        let cols = p.state === 'run' ? 3 : 2;
        let frameW = sheet.width / cols;
        let frameH = sheet.height / 3;
        let col = p.frame % cols;
        let row = Math.floor(p.frame / cols);

        ctx.save();
        if(p.dir === -1) {
            ctx.translate(p.x + CAT_W/2, p.y + CAT_H/2); ctx.scale(-1, 1); ctx.translate(-(p.x + CAT_W/2), -(p.y + CAT_H/2));
        }
        try {
            ctx.drawImage(sheet, col * frameW, row * frameH, frameW, frameH, p.x, p.y, CAT_W, CAT_H);
        } catch(e) {
            ctx.fillStyle = slot === 'slot1' ? '#00bfff' : '#ff69b4'; ctx.fillRect(p.x, p.y, CAT_W, CAT_H);
        }
        ctx.restore();

        ctx.fillStyle = 'white'; ctx.font = 'bold 12px Arial';
        ctx.fillText((slot === 'slot1' ? "⚔️ " : "📜 ") + (roomData?.players[slot]?.name || (slot === 'slot1'?'Sát Thủ':'Hỗ Trợ')), p.x, p.y - 20);
        
        ctx.fillStyle = 'red'; ctx.fillRect(p.x, p.y - 12, CAT_W, 6);
        ctx.fillStyle = '#00ff00'; ctx.fillRect(p.x, p.y - 12, CAT_W * (p.hp / p.maxHp), 6);
    }

    ctx.restore(); 

    // --- HUD CỐ ĐỊNH MÀN HÌNH ---
    ctx.fillStyle = '#ff1493'; ctx.font = 'bold 20px Arial';
    ctx.fillText(`ẢI HIỆN TẠI: ${gameLevel}`, 20, 35);

    if (ticket.pickedUp) {
        ctx.fillStyle = '#7fff00'; ctx.font = 'bold 15px Arial';
        ctx.fillText("✨ ĐÃ CÓ BẢN ĐỒ! CHẠY ĐẾN CỔNG ĐỂ KHAI THÔNG!", 150, 35);
    }

    if (ropeWarningTimer > 0) {
        ctx.fillStyle = 'red'; ctx.font = 'bold 16px Arial';
        ctx.fillText(`⚠️ DÂY SẮP ĐỨT: ${Math.max(0, Math.ceil((180-ropeWarningTimer)/60))} Giây`, 20, 70);
    }

    if (gameOverReason) {
        ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);
        ctx.fillStyle = 'red'; ctx.font = 'bold 30px Arial'; ctx.fillText("GAME OVER", V_WIDTH/2 - 90, V_HEIGHT/2 - 20);
        ctx.fillStyle = 'white'; ctx.font = '15px Arial'; ctx.fillText(gameOverReason, V_WIDTH/2 - 180, V_HEIGHT/2 + 20);
        return;
    }

    // Vẽ nút bấm HUD kèm bộ đếm ngược CD số giây hồi chiêu trực quan
    for (let b in buttons) {
        let btn = buttons[b];
