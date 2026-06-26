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
const imgLine = new Image(); imgLine.src = 'assets/day.png'; // Dây nối gốc
const imgTicket = new Image(); imgTicket.src = 'assets/bando.png';
const imgMonster = new Image(); imgMonster.src = 'assets/chuot.png';
const imgMSpit = new Image(); imgMSpit.src = 'assets/chuotskill.png';
const imgHeartFx = new Image(); imgHeartFx.src = 'assets/tim.png'; // Chỉ dùng khi hồi máu
const imgSword = new Image(); imgSword.src = 'assets/kiem.png';

// --- THÔNG SỐ KHÔNG GIAN GAME ---
const V_WIDTH = 850;   
const V_HEIGHT = 400;  
const MAP_WIDTH = 1700; 
const FLOOR_Y = 320;   // Mặt sàn cỏ bắt đầu từ y=320

// Kích thước nhân vật được phóng to và căn chỉnh chân chạm sàn
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
        healEffectTimer = 90; // Hiện tim liên tục trong vòng 1.5 giây (90 frames)
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

    // Đặt tọa độ y sao cho chân chạm đúng mặt sàn (FLOOR_Y - CAT_H)
    players.slot1 = { x: 200, y: FLOOR_Y - CAT_H, vx: 0, vy: 0, state: 'idle', frame: 0, animTick: 0, dir: 1, isGrounded: true, width: CAT_W, height: CAT_H, hp: pMaxHp, maxHp: pMaxHp };
    players.slot2 = { x: 100, y: FLOOR_Y - CAT_H, vx: 0, vy: 0, state: 'idle', frame: 0, animTick: 0, dir: 1, isGrounded: true, width: CAT_W, height: CAT_H, hp: pMaxHp, maxHp: pMaxHp };
    
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
        y: FLOOR_Y - MONSTER_H, // Căn chuột chạm đúng mặt sàn cỏ
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
        // Kiểm tra hồi chiêu Kiếm (1.5s)
        if (myShootTimer > 0) return;
        
        me.state = 'attack';
        playerProjectiles.push({
            x: me.x + (me.dir === 1 ? CAT_W : -30),
            y: me.y + CAT_H / 2,
            vx: me.dir * 8,
            w: 50, h: 20
        });
        socket.emit('playerAction', { roomId: currentRoomId, actionType: 'shoot' });
        myShootTimer = COOLDOWNS.shoot; // Bắt đầu tính thời gian hồi chiêu
    } else {
        // Kiểm tra hồi chiêu Hồi Máu (5s)
        if (myHealTimer > 0) return;

        socket.emit('playerAction', { roomId: currentRoomId, actionType: 'heal' });
        healEffectTimer = 90; // Kích hoạt tim bay liên tục
        if (players.slot1) {
            players.slot1.hp = Math.min(players.slot1.maxHp, players.slot1.hp + Math.round(players.slot1.maxHp * 0.2));
        }
        myHealTimer = COOLDOWNS.heal; // Bắt đầu tính thời gian hồi chiêu
        
        // Hỗ trợ nhặt bản đồ chủ động
        if (ticket.spawned && !ticket.pickedUp) {
            if (Math.abs((me.x + CAT_W/2) - ticket.x) < 90) {
                ticket.pickedUp = true;
            }
        }
        // Mở cổng bando khi sát cổng
        if (ticket.pickedUp && Math.abs((me.x + CAT_W/2) - (portal.x + 40)) < 90) {
            portal.open = true;
        }
    }
}

function update() {
    if(gameOverReason) return;

    let me = players[mySlot];
    if(!me) return;

    // Giảm thời gian hồi chiêu theo từng khung hình (Frame)
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

    me.vy += 0.6.toFixed(1) * 1; // Áp dụng trọng lực nhịp nhàng
    me.x += me.vx; me.y += me.vy;

    // Khóa chặt chân chạm sàn cỏ (y = FLOOR_Y - CAT_H) không lo lơ lửng nữa
    if(me.y >= FLOOR_Y - CAT_H) {
        me.y = FLOOR_Y - CAT_H; me.vy = 0; me.isGrounded = true;
    }
    if(me.x < 0) me.x = 0; if(me.x > MAP_WIDTH - CAT_W) me.x = MAP_WIDTH - CAT_W;

    me.animTick++;
    if (me.state === 'run') {
        if(me.animTick % 5 === 0) me.frame = (me.frame + 1) % 8;
    } else if (me.state === 'idle') {
        if(me.animTick % 10 === 0) me.frame = (me.frame + 1) % 3;
    }

    socket.emit('playerUpdate', {
        roomId: currentRoomId,
        slot: mySlot,
        playerData: { x: me.x, y: me.y, state: me.state, frame: me.frame, dir: me.dir }
    });

    cameraX = me.x + CAT_W / 2 - V_WIDTH / 2;
    if(cameraX < 0) cameraX = 0;
    if(cameraX > MAP_WIDTH - V_WIDTH) cameraX = MAP_WIDTH - V_WIDTH;

    // --- CƠ CHẾ SỢI DÂY CO GIÃN LIÊN KẾT (Dùng day.png) ---
    if (players.slot1 && players.slot2) {
        let p1Center = players.slot1.x + CAT_W / 2;
        let p2Center = players.slot2.x + CAT_W / 2;
        let dist = Math.abs(p1Center - p2Center);

        if (dist > MAX_ROPE_DIST) {
            ropeWarningTimer++;
            let pullForce = (dist - MAX_ROPE_DIST) * 0.06;
            if (p1Center > p2Center) {
                players.slot1.x -= pullForce; players.slot2.x += pullForce;
            } else {
                players.slot1.x += pullForce; players.slot2.x -= pullForce;
            }
            if (ropeWarningTimer > 180) {
                gameOverReason = "SỢI DÂY ĐỊNH MỆNH ĐÃ BỊ ĐỨT DO HAI BẠN QUÁ XA NHAU!";
            }
        } else {
            if(ropeWarningTimer > 0) ropeWarningTimer--;
        }
    }

    // --- QUÁI VẬT CHUỘT HỒI SINH LIÊN TỤC ---
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

    // --- ĐẠN KIẾM SÁT THỦ ---
    playerProjectiles.forEach((p, pIdx) => {
        p.x += p.vx;
        monsters.forEach((m, mIdx) => {
            if (p.x + p.w >= m.x && p.x <= m.x + m.width && p.y + p.h >= m.y && p.y <= m.y + m.height) {
                m.hp -= Math.round(15 * Math.pow(1.5, gameLevel - 1));
                playerProjectiles.splice(pIdx, 1);

                if (m.hp <= 0) {
                    monsters.splice(mIdx, 1);
                    spawnMonster(); // CHẾT LÀ HỒI SINH CON KHÁC NGAY

                    if (!ticket.spawned && Math.random() < 0.35) {
                        ticket.spawned = true;
                        ticket.x = m.x; ticket.y = FLOOR_Y - 45;
                    }
                }
            }
        });
    });
    playerProjectiles = playerProjectiles.filter(p => p.x > 0 && p.x < MAP_WIDTH);

    // --- ĐẠN NƯỚC BỌT CHUỘT ---
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
        if(mySlot === 'slot1') socket.emit('nextLevel', currentRoomId);
    }

    if(healEffectTimer > 0) healEffectTimer--;
}

function draw() {
    ctx.clearRect(0, 0, V_WIDTH, V_HEIGHT);

    ctx.save();
    ctx.translate(-cameraX, 0);

    // 1. Vẽ nền trời và Sàn Đứng cố định (Mèo đạp chân lên rìa cỏ mượt mà)
    ctx.fillStyle = '#4682B4'; ctx.fillRect(0, 0, MAP_WIDTH, V_HEIGHT);
    ctx.fillStyle = '#228B22'; ctx.fillRect(0, FLOOR_Y, MAP_WIDTH, V_HEIGHT - FLOOR_Y);

    // 2. Vẽ SỢI DÂY NỐI ĐỊNH MỆNH (Bản gốc dùng day.png cắt lưới 2x2 làm lõi sinh mạng)
    if (players.slot1 && players.slot2) {
        let p1C = { x: players.slot1.x + CAT_W / 2, y: players.slot1.y + CAT_H / 2 };
        let p2C = { x: players.slot2.x + CAT_W / 2, y: players.slot2.y + CAT_H / 2 };
        let midX = (p1C.x + p2C.x) / 2;
        let midY = (p1C.y + p2C.y) / 2;
        
        ctx.beginPath();
        ctx.strokeStyle = ropeWarningTimer > 0 ? "#ff0000" : "#ffb6c1"; 
        ctx.lineWidth = ropeWarningTimer > 0 ? 5 : 3;
        ctx.moveTo(p1C.x, p1C.y); ctx.lineTo(p2C.x, p2C.y); ctx.stroke();
        
        try {
            // Vẽ lõi tim sinh mạng từ tấm ảnh dây kết nối day.png
            let singleW = imgLine.width / 2;
            let singleH = imgLine.height / 2;
            ctx.drawImage(imgLine, 0, 0, singleW, singleH, midX - 20, midY - 20, 40, 40);
        } catch(e){}
    }

    // 3. Vẽ Cánh Cổng Vượt Ải ở cuối map dài x2
    ctx.fillStyle = portal.open ? '#00ffcc' : '#8b4513';
    ctx.fillRect(portal.x, portal.y, portal.width, portal.height);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial';
    ctx.fillText(portal.open ? "CỔNG MỞ" : "CỔNG KHÓA", portal.x + 2, portal.y - 15);

    // 4. Vẽ Bản đồ bando.png rớt dưới sàn cỏ
    if (ticket.spawned && !ticket.pickedUp) {
        try { ctx.drawImage(imgTicket, ticket.x, ticket.y, 45, 45); } catch(e){
            ctx.fillStyle = 'orange'; ctx.fillRect(ticket.x, ticket.y, 35, 35);
        }
    }

    // 5. Vẽ Lũ Chuột Quái Vật (Đã hạ chuẩn sàn)
    monsters.forEach(m => {
        ctx.save();
        if(m.dir === 1) { // Lật hướng chuột chạy theo vận tốc trái phải
            ctx.translate(m.x + MONSTER_W/2, m.y + MONSTER_H/2); ctx.scale(-1, 1); ctx.translate(-(m.x + MONSTER_W/2), -(m.y + MONSTER_H/2));
        }
        try { ctx.drawImage(imgMonster, m.x, m.y, m.width, m.height); } catch(e){
            ctx.fillStyle = 'purple'; ctx.fillRect(m.x, m.y, m.width, m.height);
        }
        ctx.restore();
        
        ctx.fillStyle = 'black'; ctx.fillRect(m.x, m.y - 12, m.width, 5);
        ctx.fillStyle = '#ff3300'; ctx.fillRect(m.x, m.y - 12, m.width * (m.hp / m.maxHp), 5);
    });

    // 6. Vẽ Đạn nước bọt chuotskill.png của Chuột
    monsterProjectiles.forEach(mp => {
        try { ctx.drawImage(imgMSpit, mp.x, mp.y, mp.w, mp.h); } catch(e) {
            ctx.fillStyle = 'cyan'; ctx.fillRect(mp.x, mp.y, mp.w, mp.h);
        }
    });

    // 7. Vẽ Đạn Kiếm kiem.png của Sát thủ xoay ĐÂM NGANG bay đi
    playerProjectiles.forEach(p => {
        ctx.save();
        ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
        // Xoay góc 90 độ để cây kiếm từ tư thế dọc sang nằm ngang phóng đi cực mạnh
        ctx.rotate(p.vx > 0 ? Math.PI / 2 : -Math.PI / 2);
        try {
            ctx.drawImage(imgSword, -p.h / 2, -p.w / 2, p.h, p.w);
        } catch(e) {
            ctx.fillStyle = 'yellow'; ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
        }
        ctx.restore();
    });

    // 8. HIỆU ỨNG TIM.PNG HỒI MÁU HIỆN LIÊN TỤC BAY LÊN TRÊN ĐẦU SÁT THỦ KHI ĐƯỢC BUFF
    if (healEffectTimer > 0 && players.slot1) {
        try {
            // Tim nhấp nháy bay bổng liên tục dựa theo chuỗi giảm dần của bộ đếm Timer
            let pulseOffsetY = (healEffectTimer % 30) * 1.5; 
            ctx.drawImage(imgHeartFx, players.slot1.x + CAT_W/2 - 25, players.slot1.y - 50 - pulseOffsetY, 50, 50);
        } catch(e){}
    }

    // 9. Vẽ 2 Chú Mèo (Kích thước to lớn vạm vỡ, đạp chân trên sàn đứng)
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

        // Tên tài khoản và Thanh HP người chơi
        ctx.fillStyle = 'white'; ctx.font = 'bold 12px Arial';
        ctx.fillText((slot === 'slot1' ? "⚔️ " : "📜 ") + (roomData?.players[slot]?.name || "Mèo"), p.x, p.y - 20);
        
        ctx.fillStyle = 'red'; ctx.fillRect(p.x, p.y - 12, CAT_W, 6);
        ctx.fillStyle = '#00ff00'; ctx.fillRect(p.x, p.y - 12, CAT_W * (p.hp / p.maxHp), 6);
    }

    ctx.restore(); // Quay về màn hình HUD tĩnh

    // --- 10. GIAO DIỆN HUD TĨNH CỐ ĐỊNH MÀN HÌNH ---
    ctx.fillStyle = '#ff1493'; ctx.font = 'bold 20px Arial';
    ctx.fillText(`ẢI HIỆN TẠI: ${gameLevel}`, 20, 35);

    if (ticket.pickedUp) {
        ctx.fillStyle = '#7fff00'; ctx.font = 'bold 15px Arial';
        ctx.fillText("✨ ĐÃ CÓ BẢN ĐỒ! HỖ TRỢ CHẠY ĐẾN CỔNG ĐỂ KHAI THÔNG!", 150, 35);
    }

    if (ropeWarningTimer > 0) {
        ctx.fillStyle = 'red'; ctx.font = 'bold 16px Arial';
        ctx.fillText(`⚠️ XA NHAU QUÁ! DÂY TƠ HỒNG SẮP ĐỨT: ${Math.max(0, Math.ceil((180-ropeWarningTimer)/60))} Giây`, 20, 70);
    }

    if (gameOverReason) {
        ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);
        ctx.fillStyle = 'red'; ctx.font = 'bold 30px Arial'; ctx.fillText("GAME OVER", V_WIDTH/2 - 90, V_HEIGHT/2 - 20);
        ctx.fillStyle = 'white'; ctx.font = '15px Arial'; ctx.fillText(gameOverReason, V_WIDTH/2 - 180, V_HEIGHT/2 + 20);
        ctx.fillStyle = 'yellow'; ctx.fillText("F5 trang để chơi lại cùng người thương nha!", V_WIDTH/2 - 170, V_HEIGHT/2 + 50);
        return;
    }

    // Vẽ nút bấm cảm ứng kèm TEXT HIỂN THỊ THỜI GIAN HỒI CHIÊU (CD Cooldown) trực quan
    for (let b in buttons) {
        let btn = buttons[b];
        ctx.fillStyle = btn.pressed ? 'rgba(255,105,180,0.8)' : 'rgba(255,255,255,0.35)';
        ctx.strokeStyle = '#ff69b4'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 12); ctx.fill(); ctx.stroke();
        
        ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Arial';
        
        // Hiển thị text giây đếm ngược lên trên mặt nút bấm ảo luôn
        if (b === 'action') {
            if (mySlot === 'slot1' && myShootTimer > 0) {
                ctx.fillStyle = '#ff0000';
                ctx.fillText(`CD: ${(myShootTimer/60).toFixed(1)}s`, btn.x + 8, btn.y + (btn.h/2) + 5);
            } else if (mySlot === 'slot2' && myHealTimer > 0) {
                ctx.fillStyle = '#ff0000';
                ctx.fillText(`CD: ${(myHealTimer/60).toFixed(1)}s`, btn.x + 8, btn.y + (btn.h/2) + 5);
            } else {
                ctx.fillText(btn.label, btn.x + 8, btn.y + (btn.h/2) + 5);
            }
        } else {
            ctx.fillText(btn.label, btn.x + 22, btn.y + (btn.h/2) + 5);
        }
    }
}

function gameLoop() {
    if (gameState !== 'playing') return;
    update();
    draw();
    requestAnimationFrame(gameLoop);
}
